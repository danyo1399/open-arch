package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func env(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

func TestSettingsFromFlagsThenEnvironmentThenDefaults(t *testing.T) {
	inv, _ := ReadInvocation(nil, env(nil))
	expect(t, inv.Config, Config{Port: 8787, Data: "./data", MaxBytes: 1_000_000, UploadsPerHour: 60, FailedLookupsPerHour: 60, TrustProxy: TrustNone, Log: true}, "defaults")

	vars := env(map[string]string{"PORT": "9000", "HOST": "127.0.0.1", "DATA_DIR": "/data", "TRUST_PROXY": "forwarded", "MAX_BYTES": "500", "UPLOADS_PER_HOUR": "5", "FAILED_LOOKUPS_PER_HOUR": "7", "LOG": "off"})
	inv, _ = ReadInvocation(nil, vars)
	expect(t, inv.Config, Config{Port: 9000, Host: "127.0.0.1", Data: "/data", MaxBytes: 500, UploadsPerHour: 5, FailedLookupsPerHour: 7, TrustProxy: TrustForwarded}, "environment")

	inv, _ = ReadInvocation([]string{"--port", "9100", "--memory", "--trust-proxy=cloudflare", "--failed-lookups-per-hour", "3"}, vars)
	expect(t, inv.Config.Port, 9100, "flag port")
	expect(t, inv.Config.FailedLookupsPerHour, 3, "flag failed lookups")
	expect(t, inv.Config.Data, "", "memory")
	expect(t, inv.Config.TrustProxy, TrustCloudflare, "flag proxy")
	inv, _ = ReadInvocation(nil, env(map[string]string{"DATA_DIR": ":memory:"}))
	expect(t, inv.Config.Data, "", "memory from the environment")
}

func TestReadsTheAbuseCommands(t *testing.T) {
	inv, err := ReadInvocation([]string{"block", "abcdefghijklmnopqrstuv", "--reason", "spam"}, env(nil))
	expect(t, err, nil, "block")
	expect(t, inv.Command+" "+inv.Target+" "+inv.Reason, "block abcdefghijklmnopqrstuv spam", "block")
	inv, _ = ReadInvocation([]string{"uploads", "--ip", "192.0.2.1", "--limit", "5"}, env(nil))
	expect(t, inv.IP, "192.0.2.1", "ip")
	expect(t, inv.Limit, 5, "limit")
}

func TestSaysWhatsWrongWithACommandLine(t *testing.T) {
	for args, want := range map[string]string{
		"--port http":                  `The port must be a whole number, not "http".`,
		"block abcdefghijklmnopqrstuv": "Say why, with --reason",
		"uploads":                      "Say whose uploads to list",
		"block-ip --memory":            "block-ip needs the data folder",
		"serve --colour":               "There's no option --colour.",
		"frob":                         `There's no command "frob".`,
		"--port":                       "--port needs a value.",
	} {
		_, err := ReadInvocation(strings.Fields(args), env(nil))
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", args, err, want)
		}
	}
	_, err := ReadInvocation(nil, env(map[string]string{"TRUST_PROXY": "yes"}))
	expect(t, err.Error(), `The trusted proxy must be none, forwarded or cloudflare, not "yes".`, "trust proxy")
}

func TestBelievesAProxyOnlyWhenToldTheresOne(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "[::ffff:10.0.0.5]:4000"
	r.Header.Set("X-Forwarded-For", "198.51.100.9, 203.0.113.7")
	r.Header.Set("CF-Connecting-IP", "192.0.2.4")
	r.Header.Set("CF-IPCountry", "NZ")
	r.Header.Set("CF-Ray", "ray")
	expect(t, ClientOf(r, TrustNone), Client{IP: "10.0.0.5"}, "none")
	// The last address is the one the proxy saw; the earlier ones are whatever the client said.
	expect(t, ClientOf(r, TrustForwarded).IP, "203.0.113.7", "forwarded")
	expect(t, ClientOf(r, TrustCloudflare), Client{IP: "192.0.2.4", Country: "NZ", Ray: "ray"}, "cloudflare")
	r.Header.Del("X-Forwarded-For")
	expect(t, ClientOf(r, TrustForwarded).IP, "10.0.0.5", "forwarded without the header")
}

func TestListensAndStops(t *testing.T) {
	url, stop, err := Listen(Config{Port: 0, Host: "127.0.0.1", MaxBytes: 1000, UploadsPerHour: 60, TrustProxy: TrustNone}, NewMemoryStore())
	if err != nil {
		t.Fatal(err)
	}
	expect(t, strings.HasPrefix(url, "http://127.0.0.1:"), true, "url")
	port := strings.TrimPrefix(url, "http://127.0.0.1:")
	inv, _ := ReadInvocation([]string{"health", "--port", port, "--host", "127.0.0.1"}, env(nil))
	expect(t, health(inv.Config), nil, "healthy")
	expect(t, stop(), nil, "stop")
	if health(inv.Config) == nil {
		t.Error("healthy after it stopped")
	}
}
