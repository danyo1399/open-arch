package main

import (
	"bytes"
	"fmt"
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
	expect(t, ClientOf(r, TrustNone), Client{IP: "10.0.0.5", Group: "10.0.0.5"}, "none")
	// The last address is the one the proxy saw; the earlier ones are whatever the client said.
	expect(t, ClientOf(r, TrustForwarded).IP, "203.0.113.7", "forwarded")
	expect(t, ClientOf(r, TrustCloudflare), Client{IP: "192.0.2.4", Group: "192.0.2.4", Country: "NZ", Ray: "ray"}, "cloudflare")
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

func TestRefusesLimitsOfZero(t *testing.T) {
	for _, args := range [][]string{{"--uploads-per-hour", "0"}, {"--failed-lookups-per-hour", "0"}, {"--max-bytes", "0"}} {
		_, err := ReadInvocation(args, env(nil))
		if err == nil || !strings.Contains(err.Error(), "at least 1") {
			t.Errorf("%v: got %v", args, err)
		}
	}
	_, err := ReadInvocation(nil, env(map[string]string{"UPLOADS_PER_HOUR": "0"}))
	expect(t, err != nil && strings.Contains(err.Error(), "The uploads an hour must be at least 1"), true, "from the environment")
	// uploads --limit isn't one of them: 0 lists none.
	inv, err := ReadInvocation([]string{"uploads", "--ip", "192.0.2.1", "--limit", "0", "--data", "/tmp/x"}, env(nil))
	expect(t, err, nil, "--limit 0")
	expect(t, inv.Limit, 0, "limit")
	// Port 0 still means any free port.
	inv, err = ReadInvocation([]string{"--port", "0"}, env(nil))
	expect(t, err, nil, "port 0")
	expect(t, inv.Config.Port, 0, "port")
}

func TestBlockIPTakesAnAddressOrAnIPv6Network(t *testing.T) {
	for target, want := range map[string]string{
		"203.0.113.7":         "203.0.113.7",
		"2001:DB8::1":         "2001:db8::1",
		"2001:db8:1:2:3::/64": "2001:db8:1:2::/64",
		"2001:db8:1:2::/64":   "2001:db8:1:2::/64",
	} {
		inv, err := ReadInvocation([]string{"block-ip", target, "--reason", "spam", "--data", "/tmp/x"}, env(nil))
		expect(t, err, nil, target)
		expect(t, inv.Target, want, target)
	}
	// Ones with a "/" that isn't a network at all are refused the same way, not crashed on.
	for _, target := range []string{"not-an-address", "203.0.113.0/24", "2001:db8::/48", "nonsense/64", "2001:db8::/200", "1.2.3.4/33", "/"} {
		for _, args := range [][]string{{"block-ip", target, "--reason", "spam"}, {"unblock-ip", target}, {"uploads", "--ip", target}} {
			_, err := ReadInvocation(append(args, "--data", "/tmp/x"), env(nil))
			expect(t, err != nil && strings.Contains(err.Error(), "an IP address, or an IPv6 /64"), true, strings.Join(args, " "))
		}
	}
}

// The limits count an IPv4 address as it is, and an IPv6 one by its /64, written one way.
func TestGroupsAddressesTheWayTheLimitsCountThem(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	for remote, group := range map[string]string{
		"203.0.113.7:4000":               "203.0.113.7",
		"[::ffff:203.0.113.7]:4000":      "203.0.113.7",
		"[2001:db8:1:2:aaaa::1]:4000":    "2001:db8:1:2::/64",
		"[2001:db8:1:2:ffff:1:2:3]:4000": "2001:db8:1:2::/64",
		"[2001:db8:1:3::1]:4000":         "2001:db8:1:3::/64",
	} {
		r.RemoteAddr = remote
		expect(t, ClientOf(r, TrustNone).Group, group, remote)
	}
	// IPv6 is recorded in its short form, so uploads --ip and block-ip find it.
	r.RemoteAddr = "[2001:DB8:0:0::1]:4000"
	expect(t, ClientOf(r, TrustNone).IP, "2001:db8::1", "short form")
	// A proxy's header is believed only for an address: anything else means the connection's.
	r.RemoteAddr = "10.0.0.5:4000"
	for _, header := range []string{"X-Forwarded-For", "CF-Connecting-IP"} {
		r.Header.Set(header, "not-an-address")
	}
	expect(t, ClientOf(r, TrustForwarded).IP, "10.0.0.5", "forwarded, not an address")
	expect(t, ClientOf(r, TrustCloudflare).IP, "10.0.0.5", "cloudflare, not an address")
	r.Header.Set("X-Forwarded-For", "203.0.113.9, 2001:DB8::2")
	expect(t, ClientOf(r, TrustForwarded), Client{IP: "2001:db8::2", Group: "2001:db8::/64"}, "forwarded IPv6")
}

// unblock-ip says what it did, and says so when an address is still blocked by its network.
func TestUnblockIPSaysWhatItDid(t *testing.T) {
	data := t.TempDir()
	run := func(args ...string) (string, error) {
		inv, err := ReadInvocation(append(args, "--data", data), env(nil))
		if err != nil {
			return "", err
		}
		var out bytes.Buffer
		err = admin(inv, &out)
		return out.String(), err
	}
	out, _ := run("block-ip", "2001:db8:1:2::/64", "--reason", "spam")
	expect(t, out, "Uploads from 2001:db8:1:2::/64 are refused.\n", "block a /64")

	_, err := run("unblock-ip", "2001:db8:1:2::5")
	expect(t, err != nil && err.Error() == "Uploads from 2001:db8:1:2::5 are still refused. There was no block on it, but its network 2001:db8:1:2::/64 is blocked: unblock-ip 2001:db8:1:2::/64 accepts the whole network again.", true, fmt.Sprint(err))
	run("block-ip", "2001:db8:1:2::5", "--reason", "spam")
	_, err = run("unblock-ip", "2001:db8:1:2::5")
	expect(t, err != nil && strings.HasPrefix(err.Error(), "Uploads from 2001:db8:1:2::5 are still refused. Removed the block on it, but its network"), true, fmt.Sprint(err))

	out, err = run("unblock-ip", "2001:db8:1:2::/64")
	expect(t, err, nil, "unblock the /64")
	expect(t, out, "Uploads from 2001:db8:1:2::/64 are accepted again.\n", "unblock the /64")
	out, _ = run("unblock-ip", "2001:db8:1:2::5")
	expect(t, out, "Uploads from 2001:db8:1:2::5 weren't blocked.\n", "nothing to unblock")
}

// Some proxies add the port to the address they pass on.
func TestTakesAForwardedAddressWithItsPort(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.5:4000"
	for header, want := range map[string]string{
		"203.0.113.7:4000":              "203.0.113.7",
		"[2001:db8::7]:4000":            "2001:db8::7",
		"198.51.100.1, [2001:DB8::8]:1": "2001:db8::8",
		"203.0.113.7:notaport":          "10.0.0.5",
		// IPv6 in brackets without a port, as some proxies write it.
		"[2001:DB8::9]":    "2001:db8::9",
		"[not-an-address]": "10.0.0.5",
		"[203.0.113.7":     "10.0.0.5",
	} {
		r.Header.Set("X-Forwarded-For", header)
		expect(t, ClientOf(r, TrustForwarded).IP, want, header)
	}
}
