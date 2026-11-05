package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// An update that lands after the workspace was deleted keeps nothing: its files were deleted.
func TestUpdateAfterADeleteKeepsNothing(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		c := h.create(file(1, 48))
		ctx := context.Background()
		// The update checked the workspace before the delete, then the delete ran first.
		expect(t, h.store.Remove(ctx, c.ID, h.now), nil, "remove")
		u := upload(Client{IP: h.ip}, c.ID, file(2, 48), "update", h.now)
		err := h.store.Update(ctx, c.ID, file(2, 48), u)
		expect(t, errors.Is(err, ErrNotShared), true, "update after delete")
		f, _ := h.store.File(ctx, c.ID, u.Hash)
		expect(t, f == nil, true, "its file isn't kept")
		if s, ok := h.store.(*SQLStore); ok {
			_, err := os.Stat(filepath.Join(s.files, "workspaces", c.ID))
			expect(t, errors.Is(err, os.ErrNotExist), true, "the workspace's folder is gone")
		}
	})
}

// Updates sent while the workspace is deleted leave none of their files behind, whichever goes first.
func TestUpdatesRacingADeleteLeaveNoFiles(t *testing.T) {
	for round := 0; round < 20; round++ {
		folder := t.TempDir()
		s, _ := OpenStore(folder)
		h := &harness{t: t, store: s, ip: "127.0.0.1"}
		h.server = &Server{Store: s, UploadsPerHour: 1000}
		c := h.create(file(1, 48))
		var wg sync.WaitGroup
		send := func(method string, body []byte) {
			defer wg.Done()
			r := httptest.NewRequest(method, "/v1/workspaces/"+c.ID, bytes.NewReader(body))
			r.RemoteAddr = "127.0.0.1:5555"
			r.Header.Set("Authorization", "Bearer "+c.Token)
			h.server.ServeHTTP(httptest.NewRecorder(), r)
		}
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go send("PUT", file(byte(10+i), 48))
		}
		wg.Add(1)
		go send("DELETE", nil)
		wg.Wait()
		_, err := os.Stat(filepath.Join(folder, "files", "workspaces", c.ID))
		if !errors.Is(err, os.ErrNotExist) {
			entries, _ := os.ReadDir(filepath.Join(folder, "files", "workspaces", c.ID))
			t.Fatalf("round %d: %d files left in a deleted workspace", round, len(entries))
		}
		s.Close()
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
	// Port 0 still means any free port.
	inv, err := ReadInvocation([]string{"--port", "0"}, env(nil))
	expect(t, err, nil, "port 0")
	expect(t, inv.Config.Port, 0, "port")
}

func TestCountsAnIPv6NetworkAsOneAddress(t *testing.T) {
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

	eachStore(t, func(t *testing.T, h *harness) {
		h.server.UploadsPerHour = 2
		h.server.FailedLookupsPerHour = 2
		// Two addresses of one /64 share its limits.
		h.ip = "2001:db8:1:2::a"
		h.create(file(1, 48))
		h.ip = "2001:db8:1:2::b"
		h.create(file(2, 48))
		expect(t, h.send("POST", "/v1/workspaces", file(3, 48), nil).StatusCode, http.StatusTooManyRequests, "uploads from the same /64")
		h.ip = "2001:db8:1:2::c"
		h.send("GET", "/v1/workspaces/AAAAAAAAAAAAAAAAAAAAAA", nil, nil)
		h.ip = "2001:db8:1:2::d"
		h.send("GET", "/v1/workspaces/BBBBBBBBBBBBBBBBBBBBBB", nil, nil)
		expect(t, h.send("GET", "/v1/workspaces/CCCCCCCCCCCCCCCCCCCCCC", nil, nil).StatusCode, http.StatusTooManyRequests, "lookups from the same /64")
		// Another /64 has its own.
		h.ip = "2001:db8:1:3::a"
		expect(t, h.send("POST", "/v1/workspaces", file(4, 48), nil).StatusCode, 201, "another /64")
	})
}

func TestBlocksAnIPv6Network(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	defer s.Close()
	h := &harness{t: t, store: s, ip: "2001:db8:5:6::1"}
	h.server = &Server{Store: s}
	ctx := context.Background()
	expect(t, s.SetIPBlocked(ctx, "2001:db8:5:6::/64", "spam", 1), nil, "block a /64")
	expect(t, h.send("POST", "/v1/workspaces", file(1, 48), nil).StatusCode, http.StatusForbidden, "an address in it")
	h.ip = "2001:db8:5:7::1"
	expect(t, h.send("POST", "/v1/workspaces", file(1, 48), nil).StatusCode, 201, "an address outside it")
	// Blocking one address still blocks only it.
	expect(t, s.SetIPBlocked(ctx, "2001:db8:5:7::1", "spam", 1), nil, "block one address")
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, http.StatusForbidden, "that address")
	h.ip = "2001:db8:5:7::2"
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, 201, "its neighbour")
	// uploads --ip with a /64 lists the network's.
	rows, _ := s.ListUploads(ctx, "ip", "2001:db8:5:7::/64", 10)
	expect(t, len(rows), 2, "a /64's uploads")
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
	for _, target := range []string{"not-an-address", "203.0.113.0/24", "2001:db8::/48"} {
		_, err := ReadInvocation([]string{"block-ip", target, "--reason", "spam", "--data", "/tmp/x"}, env(nil))
		expect(t, err != nil && strings.Contains(err.Error(), "an IP address, or an IPv6 /64"), true, target)
	}
}

// A database made before IPv6 addresses were grouped gets the column, and its IPv4 uploads still count.
func TestUpgradesADatabaseToGroupAddresses(t *testing.T) {
	folder := t.TempDir()
	db, err := sql.Open("sqlite", databaseURI(filepath.Join(folder, "shares.db")))
	if err != nil {
		t.Fatal(err)
	}
	first, _ := migrations.ReadFile("migrations/0001_shared_workspaces.sql")
	for _, statement := range []string{
		"CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
		string(first),
		"INSERT INTO schema_migrations VALUES ('0001_shared_workspaces.sql', 1)",
		"INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip) VALUES ('w', 'h', 'create', 48, 100, '203.0.113.7')",
		"INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip) VALUES ('w', 'h', 'update', 48, 100, '2001:db8::1')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	db.Close()

	s, err := OpenStore(folder)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	n, _ := s.UploadsSince(context.Background(), "203.0.113.7", 0)
	expect(t, n, 1, "an IPv4 upload from before still counts")
	rows, _ := s.ListUploads(context.Background(), "ip", "2001:db8::1", 10)
	expect(t, len(rows), 1, "an IPv6 upload from before is still listed")
	var applied int
	s.db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&applied)
	expect(t, applied, 2, "both migrations recorded")
}
