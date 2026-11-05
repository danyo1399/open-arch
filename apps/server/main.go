// The open-arch share server: keeps workspaces shared from the designer, encrypted. One
// executable, with its records in SQLite and each version's encrypted file in a folder:
//
//	open-arch-share                 serve, keeping records and files in ./data
//	open-arch-share --memory        serve, keeping them in memory, for trying it out
//	open-arch-share block <id> …    take a shared workspace down
//
// `open-arch-share help` lists the rest. Settings are flags or environment variables, the flag
// winning: environment variables suit a container or a service, flags suit a terminal.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"
)

var commands = []string{"serve", "uploads", "block", "unblock", "block-ip", "unblock-ip", "health", "version", "help"}

// version is set when the executable is built (scripts/executable.mjs), from package.json.
var version = "dev"

// Config is how to run the server.
type Config struct {
	Port int
	// All interfaces when empty.
	Host string
	// Where the records and files are kept. Empty keeps them in memory, and forgets them when it stops.
	Data           string
	MaxBytes       int64
	UploadsPerHour int
	TrustProxy     TrustProxy
	// Whether to print a line for each request.
	Log bool
}

// Invocation is a command line: a command, what it's about, and the settings.
type Invocation struct {
	Command string
	// A workspace ID or an IP address.
	Target string
	Config Config
	// For uploads: whose, and how many. For block and block-ip: why.
	Workspace, IP, Reason string
	Limit                 int
}

// A UsageError is something wrong with the command line, said for the person who typed it.
type UsageError struct{ message string }

func (e UsageError) Error() string { return e.message }

func usage(format string, args ...any) error { return UsageError{fmt.Sprintf(format, args...)} }

func help(program string) string {
	return fmt.Sprintf(`open-arch share server: keeps workspaces shared from the designer, encrypted.

Usage: %s [command] [options]

Commands:
  serve                     Answer requests (the default)
  uploads --workspace <id>  List a workspace's uploads, and who sent them
  uploads --ip <address>    List the uploads from an IP address
  block <id> --reason <why>          Take a workspace down: it's no longer served
  unblock <id>                       Serve it again
  block-ip <address> --reason <why>  Refuse uploads from an IP address
  unblock-ip <address>               Accept them again
  health                    Check the server on this machine answers, for a container's health check
  version                   Say which version this is

Options, each also an environment variable:
  --port <n>             PORT              Port to listen on (8787)
  --host <address>       HOST              Address to listen on (all of them)
  --data <folder>        DATA_DIR          Where to keep records and files (./data)
  --memory               DATA_DIR=:memory: Keep them in memory, and forget them when it stops
  --trust-proxy <which>  TRUST_PROXY       Who to believe about a request's address:
                                           none (the connection, the default), forwarded
                                           (X-Forwarded-For, from a reverse proxy) or
                                           cloudflare (CF-Connecting-IP)
  --max-bytes <n>        MAX_BYTES         Largest encrypted workspace (%d)
  --uploads-per-hour <n> UPLOADS_PER_HOUR  Uploads one address can make an hour (%d)
  --quiet                LOG=off           Don't print a line for each request
  --limit <n>                              How many uploads to list (50)
`, program, DefaultMaxBytes, DefaultUploadsPerHour)
}

func whole(value, name string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 0 {
		return 0, usage("%s must be a whole number, not %q.", name, value)
	}
	return n, nil
}

var valueFlags = map[string]bool{"port": true, "host": true, "data": true, "trust-proxy": true, "max-bytes": true, "uploads-per-hour": true, "workspace": true, "ip": true, "limit": true, "reason": true}
var boolFlags = map[string]bool{"memory": true, "quiet": true, "help": true}

// ReadInvocation reads the command line and the environment. It returns a UsageError saying what's wrong with them.
func ReadInvocation(args []string, getenv func(string) string) (Invocation, error) {
	flags := map[string]string{}
	var positionals []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-h" {
			arg = "--help"
		}
		if arg == "--version" || arg == "-v" {
			positionals = append([]string{"version"}, positionals...)
			continue
		}
		if !strings.HasPrefix(arg, "--") {
			positionals = append(positionals, arg)
			continue
		}
		name, value, hasValue := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
		switch {
		case boolFlags[name] && !hasValue:
			flags[name] = "true"
		case valueFlags[name] && hasValue:
			flags[name] = value
		case valueFlags[name]:
			if i+1 >= len(args) {
				return Invocation{}, usage("--%s needs a value.", name)
			}
			i++
			flags[name] = args[i]
		default:
			return Invocation{}, usage("There's no option --%s. The help command lists them.", name)
		}
	}

	command := "serve"
	if len(positionals) > 0 {
		command = positionals[0]
	}
	if !contains(commands, command) {
		return Invocation{}, usage("There's no command %q. Commands: %s.", command, strings.Join(commands, ", "))
	}
	if len(positionals) > 2 {
		return Invocation{}, usage("Unexpected: %s", strings.Join(positionals[2:], " "))
	}
	if flags["help"] != "" {
		command = "help"
	}
	setting := func(flag, variable, fallback string) string {
		if value, ok := flags[flag]; ok {
			return value
		}
		if value := getenv(variable); value != "" {
			return value
		}
		return fallback
	}

	inv := Invocation{Command: command, Workspace: flags["workspace"], IP: flags["ip"], Reason: flags["reason"]}
	if len(positionals) > 1 {
		inv.Target = positionals[1]
	}
	var err error
	if inv.Config.Port, err = whole(setting("port", "PORT", "8787"), "The port"); err != nil {
		return inv, err
	}
	maxBytes, err := whole(setting("max-bytes", "MAX_BYTES", strconv.Itoa(DefaultMaxBytes)), "The largest workspace")
	if err != nil {
		return inv, err
	}
	inv.Config.MaxBytes = int64(maxBytes)
	if inv.Config.UploadsPerHour, err = whole(setting("uploads-per-hour", "UPLOADS_PER_HOUR", strconv.Itoa(DefaultUploadsPerHour)), "The uploads an hour"); err != nil {
		return inv, err
	}
	if inv.Limit, err = whole(setting("limit", "", "50"), "The limit"); err != nil {
		return inv, err
	}
	inv.Config.Host = setting("host", "HOST", "")
	inv.Config.TrustProxy = TrustProxy(setting("trust-proxy", "TRUST_PROXY", "none"))
	if !containsTrust(inv.Config.TrustProxy) {
		return inv, usage("The trusted proxy must be none, forwarded or cloudflare, not %q.", inv.Config.TrustProxy)
	}
	inv.Config.Data = setting("data", "DATA_DIR", "./data")
	if flags["memory"] != "" || inv.Config.Data == ":memory:" {
		inv.Config.Data = ""
	}
	inv.Config.Log = flags["quiet"] == "" && getenv("LOG") != "off"

	switch command {
	case "help", "serve", "health", "version":
		return inv, nil
	}
	if inv.Config.Data == "" {
		return inv, usage("%s needs the data folder the server keeps its records in: --data or DATA_DIR.", command)
	}
	if command == "uploads" && (inv.Workspace == "") == (inv.IP == "") {
		return inv, usage("Say whose uploads to list: --workspace <id> or --ip <address>.")
	}
	if command != "uploads" && inv.Target == "" {
		what := "workspace id"
		if strings.HasSuffix(command, "-ip") {
			what = "address"
		}
		return inv, usage("Say what to %s: %s <%s>.", strings.TrimSuffix(command, "-ip"), command, what)
	}
	if (command == "block" || command == "block-ip") && inv.Reason == "" {
		return inv, usage("Say why, with --reason, so whoever reads the records later knows.")
	}
	return inv, nil
}

func containsTrust(t TrustProxy) bool {
	for _, known := range trustProxies {
		if t == known {
			return true
		}
	}
	return false
}

// Listen starts the server. It returns the address it's listening on, and a function that stops
// it: the requests under way finish first, for up to 30 seconds.
func Listen(config Config, store Store) (string, func() error, error) {
	listener, err := net.Listen("tcp", net.JoinHostPort(config.Host, strconv.Itoa(config.Port)))
	if err != nil {
		return "", nil, err
	}
	server := &Server{Store: store, MaxBytes: config.MaxBytes, UploadsPerHour: config.UploadsPerHour, TrustProxy: config.TrustProxy}
	if config.Log {
		server.Log = func(line string) { fmt.Println(line) }
	}
	httpServer := &http.Server{
		Handler: server,
		// A slow client can't hold a connection open for ever.
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	go func() {
		if err := httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	host := config.Host
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	url := "http://" + net.JoinHostPort(host, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	stop := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		return httpServer.Shutdown(ctx)
	}
	return url, stop, nil
}

func serve(config Config) error {
	var store Store = NewMemoryStore()
	where := "in memory, until it stops"
	var sqlStore *SQLStore
	if config.Data != "" {
		var err error
		if sqlStore, err = OpenStore(config.Data); err != nil {
			return fmt.Errorf("couldn't open the data folder %s: %w", config.Data, err)
		}
		defer sqlStore.Close()
		store, where = sqlStore, "in "+config.Data
	}
	url, stop, err := Listen(config, store)
	if err != nil {
		return err
	}
	fmt.Printf("Share server on %s, keeping shared workspaces %s.\n", url, where)
	switch config.TrustProxy {
	case TrustForwarded:
		fmt.Println("Believing the proxy's X-Forwarded-For about who sent each request.")
	case TrustCloudflare:
		fmt.Println("Believing Cloudflare's CF-Connecting-IP about who sent each request.")
	}
	// A container or a service is stopped with SIGTERM, a terminal with Ctrl+C.
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer cancel()
	<-ctx.Done()
	return stop()
}

// health asks the server on this machine for its front page, as a container's health check.
func health(config Config) error {
	host := config.Host
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	client := http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + net.JoinHostPort(host, strconv.Itoa(config.Port)) + "/")
	if err != nil {
		return err
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("the server answered %d", response.StatusCode)
	}
	return nil
}

func admin(inv Invocation, out io.Writer) error {
	store, err := OpenStore(inv.Config.Data)
	if err != nil {
		return fmt.Errorf("couldn't open the data folder %s: %w", inv.Config.Data, err)
	}
	defer store.Close()
	ctx := context.Background()
	now := time.Now().UnixMilli()
	switch inv.Command {
	case "uploads":
		column, value := "workspace_id", inv.Workspace
		if inv.IP != "" {
			column, value = "ip", inv.IP
		}
		rows, err := store.ListUploads(ctx, column, value, inv.Limit)
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			fmt.Fprintln(out, "No uploads.")
			return nil
		}
		table := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
		fmt.Fprintln(table, "TIME\tWORKSPACE\tACTION\tSIZE\tIP\tCOUNTRY\tUSER AGENT\tORIGIN")
		dash := func(s string) string {
			if s == "" {
				return "-"
			}
			return s
		}
		for _, r := range rows {
			fmt.Fprintf(table, "%s\t%s\t%s\t%d\t%s\t%s\t%s\t%s\n", r.At.Format(time.RFC3339), r.Workspace, r.Action, r.Size, dash(r.IP), dash(r.Country), dash(r.UserAgent), dash(r.Origin))
		}
		return table.Flush()
	case "block", "unblock":
		reason := inv.Reason
		if inv.Command == "unblock" {
			reason = ""
		}
		found, err := store.SetBlocked(ctx, inv.Target, reason, now)
		if err != nil {
			return err
		}
		if !found {
			return usage("There's no shared workspace %s.", inv.Target)
		}
		if reason != "" {
			fmt.Fprintf(out, "Took %s down. Its files are kept, but no longer served.\n", inv.Target)
		} else {
			fmt.Fprintf(out, "%s is served again.\n", inv.Target)
		}
	default:
		reason := inv.Reason
		if inv.Command == "unblock-ip" {
			reason = ""
		}
		if err := store.SetIPBlocked(ctx, inv.Target, reason, now); err != nil {
			return err
		}
		if reason != "" {
			fmt.Fprintf(out, "Uploads from %s are refused.\n", inv.Target)
		} else {
			fmt.Fprintf(out, "Uploads from %s are accepted again.\n", inv.Target)
		}
	}
	return nil
}

func run(args []string) error {
	inv, err := ReadInvocation(args, os.Getenv)
	if err != nil {
		return err
	}
	switch inv.Command {
	case "help":
		fmt.Print(help(filepath.Base(os.Args[0])))
		return nil
	case "serve":
		return serve(inv.Config)
	case "health":
		return health(inv.Config)
	case "version":
		fmt.Printf("open-arch-share %s\n", version)
		return nil
	}
	return admin(inv, os.Stdout)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		var usageErr UsageError
		if errors.As(err, &usageErr) {
			fmt.Fprintln(os.Stderr, err)
		} else {
			fmt.Fprintln(os.Stderr, "open-arch-share:", err)
		}
		os.Exit(1)
	}
}
