package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestKeepsWorkspacesThroughARestart(t *testing.T) {
	folder := t.TempDir()
	s, err := OpenStore(folder)
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{t: t, store: s, ip: "127.0.0.1"}
	h.server = &Server{Store: s}
	c := h.create(file(1, 48))
	entries, _ := os.ReadDir(filepath.Join(folder, "files", "workspaces", c.ID))
	expect(t, len(entries), 1, "files")
	expect(t, entries[0].Name(), c.Hash, "file name")
	s.Close()

	s, err = OpenStore(folder)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	got, _ := s.File(context.Background(), c.ID, c.Hash)
	expect(t, string(got), string(file(1, 48)), "file after restart")
	w, _ := s.Workspace(context.Background(), c.ID)
	expect(t, w.Latest, c.Hash, "latest after restart")
}

func TestDeletesAWorkspacesFolder(t *testing.T) {
	folder := t.TempDir()
	s, _ := OpenStore(folder)
	defer s.Close()
	h := &harness{t: t, store: s, ip: "127.0.0.1"}
	h.server = &Server{Store: s}
	c := h.create(file(1, 48))
	h.send("PUT", "/v1/workspaces/"+c.ID, file(2, 48), map[string]string{"Authorization": "Bearer " + c.Token})
	h.send("DELETE", "/v1/workspaces/"+c.ID, nil, map[string]string{"Authorization": "Bearer " + c.Token})
	entries, _ := os.ReadDir(filepath.Join(folder, "files", "workspaces"))
	expect(t, len(entries), 0, "folders left")
}

func TestMigratesOnce(t *testing.T) {
	folder := t.TempDir()
	s, _ := OpenStore(folder)
	applied, err := migrate(s.db)
	expect(t, err, nil, "migrate")
	expect(t, len(applied), 0, "applied again")
	var names int
	s.db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE name = '0001_shared_workspaces.sql'").Scan(&names)
	expect(t, names, 1, "recorded")
	s.Close()
}

func TestBlockingCommands(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	defer s.Close()
	ctx := context.Background()
	h := &harness{t: t, store: s, ip: "127.0.0.1"}
	h.server = &Server{Store: s}
	c := h.create(file(1, 48))

	found, _ := s.SetBlocked(ctx, c.ID, "spam", 5)
	expect(t, found, true, "found")
	expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil).StatusCode, 410, "blocked")
	s.SetBlocked(ctx, c.ID, "", 6)
	expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil).StatusCode, 200, "unblocked")
	found, _ = s.SetBlocked(ctx, "AAAAAAAAAAAAAAAAAAAAAA", "spam", 5)
	expect(t, found, false, "unknown workspace")

	s.SetIPBlocked(ctx, "127.0.0.1", "spam", 5)
	s.SetIPBlocked(ctx, "127.0.0.1", "still spam", 6)
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, 403, "address blocked")
	s.SetIPBlocked(ctx, "127.0.0.1", "", 7)
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, 201, "address unblocked")

	rows, _ := s.ListUploads(ctx, "ip", "127.0.0.1", 1)
	expect(t, len(rows), 1, "limit")
	if _, err := s.ListUploads(ctx, "token_hash", "x", 1); err == nil {
		t.Error("listed uploads by a column it shouldn't")
	}
}

func TestDataFolderWithAnyName(t *testing.T) {
	for _, name := range []string{"with#hash", "with?question", "with space", "with%percent"} {
		folder := filepath.Join(t.TempDir(), name)
		s, err := OpenStore(folder)
		if err != nil {
			t.Fatal(err)
		}
		h := &harness{t: t, store: s, ip: "127.0.0.1"}
		h.server = &Server{Store: s}
		h.create(file(1, 48))
		s.Close()
		// The database is in the folder named, not one whose name was cut short.
		if _, err := os.Stat(filepath.Join(folder, "shares.db")); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestUpdatesAtOnceLeaveOnlyTheLatest(t *testing.T) {
	folder := t.TempDir()
	s, _ := OpenStore(folder)
	defer s.Close()
	h := &harness{t: t, store: s, ip: "127.0.0.1"}
	h.server = &Server{Store: s, UploadsPerHour: 1000}
	c := h.create(file(1, 48))
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(fill byte) {
			defer wg.Done()
			r := httptest.NewRequest("PUT", "/v1/workspaces/"+c.ID, bytes.NewReader(file(fill, 48)))
			r.RemoteAddr = "127.0.0.1:5555"
			r.Header.Set("Authorization", "Bearer "+c.Token)
			h.server.ServeHTTP(httptest.NewRecorder(), r)
		}(byte(10 + i))
	}
	wg.Wait()
	w, _ := s.Workspace(context.Background(), c.ID)
	entries, _ := os.ReadDir(filepath.Join(folder, "files", "workspaces", c.ID))
	expect(t, len(entries), 1, "files left")
	expect(t, entries[0].Name(), w.Latest, "the one left is the latest")
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
		var mu sync.Mutex
		statuses := map[int]int{}
		send := func(method string, body []byte) {
			defer wg.Done()
			r := httptest.NewRequest(method, "/v1/workspaces/"+c.ID, bytes.NewReader(body))
			r.RemoteAddr = "127.0.0.1:5555"
			r.Header.Set("Authorization", "Bearer "+c.Token)
			w := httptest.NewRecorder()
			h.server.ServeHTTP(w, r)
			mu.Lock()
			statuses[w.Code]++
			mu.Unlock()
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
		// Each update either went in before the delete or is told the workspace isn't shared: none fails.
		for status := range statuses {
			if status != 200 && status != 204 && status != 410 {
				t.Fatalf("round %d: an update answered %d", round, status)
			}
		}
		s.Close()
	}
}

func TestBlocksAnIPv6Network(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	defer s.Close()
	h := &harness{t: t, store: s, ip: "2001:db8:5:6::1"}
	h.server = &Server{Store: s}
	ctx := context.Background()
	_, err := s.SetIPBlocked(ctx, "2001:db8:5:6::/64", "spam", 1)
	expect(t, err, nil, "block a /64")
	expect(t, h.send("POST", "/v1/workspaces", file(1, 48), nil).StatusCode, http.StatusForbidden, "an address in it")
	h.ip = "2001:db8:5:7::1"
	expect(t, h.send("POST", "/v1/workspaces", file(1, 48), nil).StatusCode, 201, "an address outside it")
	// Blocking one address still blocks only it.
	_, err = s.SetIPBlocked(ctx, "2001:db8:5:7::1", "spam", 1)
	expect(t, err, nil, "block one address")
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, http.StatusForbidden, "that address")
	h.ip = "2001:db8:5:7::2"
	expect(t, h.send("POST", "/v1/workspaces", file(2, 48), nil).StatusCode, 201, "its neighbour")
	// uploads --ip with a /64 lists the network's.
	rows, _ := s.ListUploads(ctx, "ip", "2001:db8:5:7::/64", 10)
	expect(t, len(rows), 2, "a /64's uploads")
}

// A database made before uploads had a group gets the column, and its uploads still count, IPv6 ones by their /64.
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
	n, _ = s.UploadsSince(context.Background(), "2001:db8::/64", 0)
	expect(t, n, 1, "an IPv6 upload from before counts towards its /64")
	rows, _ := s.ListUploads(context.Background(), "ip", "2001:db8::1", 10)
	expect(t, len(rows), 1, "an IPv6 upload from before is still listed")
	var applied int
	s.db.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&applied)
	expect(t, applied, 2, "both migrations recorded")
}

// A store that still says a workspace is shared after it was deleted: the handler's view of it,
// a moment before the delete landed.
type staleStore struct{ *SQLStore }

func (s staleStore) Workspace(ctx context.Context, id string) (*Workspace, error) {
	w, err := s.SQLStore.Workspace(ctx, id)
	if w != nil {
		w.Deleted = 0
	}
	return w, err
}

// An update that a delete overtook answers 410, whether its file went in before the delete
// removed the folder, or couldn't be written because the folder had gone.
func TestAnUpdateOvertakenByADeleteIsAnswered410(t *testing.T) {
	for _, folderGone := range []bool{false, true} {
		folder := t.TempDir()
		s, _ := OpenStore(folder)
		h := &harness{t: t, store: s, ip: "127.0.0.1"}
		h.server = &Server{Store: s}
		c := h.create(file(1, 48))
		expect(t, s.Remove(context.Background(), c.ID, 1), nil, "remove")
		workspace := filepath.Join(folder, "files", "workspaces", c.ID)
		if folderGone {
			// So the update can't make the workspace's folder to put its file in, as when the
			// delete removed it in the middle of the update's write.
			os.WriteFile(workspace, nil, 0o640)
		}
		h.server.Store = staleStore{s}
		r := h.send("PUT", "/v1/workspaces/"+c.ID, file(2, 48), map[string]string{"Authorization": "Bearer " + c.Token})
		expect(t, r.StatusCode, http.StatusGone, fmt.Sprintf("folder gone: %v", folderGone))
		if !folderGone {
			_, err := os.Stat(workspace)
			expect(t, errors.Is(err, os.ErrNotExist), true, "nothing left")
		}
		s.Close()
	}
}
