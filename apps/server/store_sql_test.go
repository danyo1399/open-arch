package main

import (
	"context"
	"os"
	"path/filepath"
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
	found, _ = s.SetBlocked(ctx, "AAAAAAAAAAAAAAAA", "spam", 5)
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
