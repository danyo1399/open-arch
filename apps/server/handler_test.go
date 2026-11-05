package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A file shaped like the designer's: the format byte, then bytes standing in for the IV, ciphertext and tag.
func file(fill byte, length int) []byte {
	b := bytes.Repeat([]byte{fill}, length)
	b[0] = FileFormat
	return b
}

type harness struct {
	t      *testing.T
	store  Store
	server *Server
	now    int64
	ip     string
}

// Every test runs against both stores, so memory and SQLite answer the same.
func eachStore(t *testing.T, test func(t *testing.T, h *harness)) {
	stores := map[string]func(t *testing.T) Store{
		"memory": func(t *testing.T) Store { return NewMemoryStore() },
		"sqlite": func(t *testing.T) Store {
			s, err := OpenStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { s.Close() })
			return s
		},
	}
	for name, open := range stores {
		t.Run(name, func(t *testing.T) {
			h := &harness{t: t, store: open(t), now: 1_000_000, ip: "203.0.113.7"}
			h.server = &Server{Store: h.store, Now: func() int64 { return h.now }}
			test(t, h)
		})
	}
}

func (h *harness) send(method, path string, body []byte, headers map[string]string) *http.Response {
	h.t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	r := httptest.NewRequest(method, "https://share.example"+path, reader)
	r.RemoteAddr = h.ip + ":5555"
	r.Header.Set("User-Agent", "test-agent")
	for name, value := range headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	h.server.ServeHTTP(w, r)
	return w.Result()
}

func decode[T any](t *testing.T, r *http.Response) T {
	t.Helper()
	var v T
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

type created struct{ ID, Hash, Token string }

func (h *harness) create(body []byte) created {
	h.t.Helper()
	r := h.send("POST", "/v1/workspaces", body, nil)
	if r.StatusCode != 201 {
		h.t.Fatalf("create: %d", r.StatusCode)
	}
	return decode[created](h.t, r)
}

func expect[T comparable](t *testing.T, got, want T, what string) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", what, got, want)
	}
}

func TestCreate(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		body := file(7, 64)
		c := h.create(body)
		expect(t, idPattern.MatchString(c.ID), true, "id")
		expect(t, c.Hash, FileHash(body), "hash")
		expect(t, len(c.Token), 43, "token length")
		w, _ := h.store.Workspace(context.Background(), c.ID)
		// Only the token's hash is kept.
		expect(t, w.TokenHash == c.Token, false, "token stored as is")
		expect(t, w.TokenHash, tokenHash(c.Token), "token hash")
	})
}

func TestServesAVersionForGood(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		body := file(7, 64)
		c := h.create(body)
		r := h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil)
		expect(t, r.StatusCode, 200, "status")
		got, _ := io.ReadAll(r.Body)
		expect(t, bytes.Equal(got, body), true, "body")
		expect(t, r.Header.Get("Cache-Control"), "public, max-age=31536000, immutable", "cache")
		expect(t, r.Header.Get("ETag"), `"`+c.Hash+`"`, "etag")
		expect(t, r.Header.Get("Content-Type"), "application/octet-stream", "type")
		expect(t, r.Header.Get("Access-Control-Allow-Origin"), "*", "cors")
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, map[string]string{"If-None-Match": `"` + c.Hash + `"`}).StatusCode, 304, "revalidated")
		head := h.send("HEAD", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil)
		headBody, _ := io.ReadAll(head.Body)
		expect(t, len(headBody), 0, "HEAD body")
	})
}

func TestLatestVersion(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		c := h.create(file(7, 64))
		r := h.send("GET", "/v1/workspaces/"+c.ID, nil, nil)
		latest := decode[struct {
			ID, Hash string
			Updated  int64
		}](t, r)
		expect(t, latest.Hash, c.Hash, "latest")
		expect(t, latest.Updated, int64(1_000_000), "updated")
		expect(t, r.Header.Get("Cache-Control"), "no-cache", "cache")
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID, nil, map[string]string{"If-None-Match": `"` + c.Hash + `"`}).StatusCode, 304, "revalidated")

		h.now += 10
		update := h.send("PUT", "/v1/workspaces/"+c.ID, file(8, 64), map[string]string{"Authorization": "Bearer " + c.Token})
		expect(t, update.StatusCode, 200, "update")
		next := decode[created](t, update).Hash
		expect(t, next == c.Hash, false, "new hash")
		// The browser's copy names the old version, so it gets the new one.
		changed := h.send("GET", "/v1/workspaces/"+c.ID, nil, map[string]string{"If-None-Match": `"` + c.Hash + `"`})
		expect(t, changed.StatusCode, 200, "changed")
		expect(t, decode[created](t, changed).Hash, next, "latest after update")
		// A link to the old version still opens it: its URL's content never changes.
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil).StatusCode, 200, "old version")
	})
}

func TestOnlyTheTokenChangesIt(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		c := h.create(file(7, 64))
		path := "/v1/workspaces/" + c.ID
		expect(t, h.send("PUT", path, file(8, 64), nil).StatusCode, 401, "no token")
		expect(t, h.send("PUT", path, file(8, 64), map[string]string{"Authorization": "Bearer wrong"}).StatusCode, 403, "wrong token")
		expect(t, h.send("DELETE", path, nil, map[string]string{"Authorization": "Bearer wrong"}).StatusCode, 403, "wrong token delete")

		expect(t, h.send("DELETE", path, nil, map[string]string{"Authorization": "Bearer " + c.Token}).StatusCode, 204, "delete")
		f, _ := h.store.File(context.Background(), c.ID, c.Hash)
		expect(t, f == nil, true, "file deleted")
		gone := h.send("GET", path+"/"+c.Hash, nil, nil)
		expect(t, gone.StatusCode, 410, "gone")
		expect(t, gone.Header.Get("Cache-Control"), "no-store", "gone cache")
		expect(t, decode[map[string]string](t, h.send("GET", path, nil, nil))["error"], "This workspace isn't shared any more: whoever shared it stopped sharing it.", "message")
		expect(t, h.send("PUT", path, file(8, 64), map[string]string{"Authorization": "Bearer " + c.Token}).StatusCode, 410, "update after delete")
	})
}

func TestTakenDown(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		c := h.create(file(7, 64))
		switch s := h.store.(type) {
		case *MemoryStore:
			w := s.workspaces[c.ID]
			w.Blocked = h.now
			s.workspaces[c.ID] = w
		case *SQLStore:
			s.SetBlocked(context.Background(), c.ID, "abuse", h.now)
		}
		r := h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, nil)
		expect(t, r.StatusCode, 410, "status")
		expect(t, decode[map[string]string](t, r)["error"], "This shared workspace was taken down.", "message")
		// Even to a browser that has it, rather than telling it its copy is still good.
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+c.Hash, nil, map[string]string{"If-None-Match": `"` + c.Hash + `"`}).StatusCode, 410, "revalidated")
	})
}

func TestBlockedAndLimitedAddresses(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		switch s := h.store.(type) {
		case *MemoryStore:
			s.blockedIPs[h.ip] = true
			defer delete(s.blockedIPs, h.ip)
		case *SQLStore:
			s.SetIPBlocked(context.Background(), h.ip, "spam", h.now)
			defer s.SetIPBlocked(context.Background(), h.ip, "", h.now)
		}
		expect(t, h.send("POST", "/v1/workspaces", file(7, 64), nil).StatusCode, 403, "blocked")
	})
	eachStore(t, func(t *testing.T, h *harness) {
		h.server.UploadsPerHour = 3
		for i := 0; i < 3; i++ {
			h.create(file(byte(i), 64))
		}
		limited := h.send("POST", "/v1/workspaces", file(9, 64), nil)
		expect(t, limited.StatusCode, 429, "limited")
		expect(t, limited.Header.Get("Retry-After"), "3600", "retry after")
		// Another address, or the same one an hour later, can.
		h.ip = "198.51.100.1"
		expect(t, h.send("POST", "/v1/workspaces", file(9, 64), nil).StatusCode, 201, "other address")
		h.ip = "203.0.113.7"
		h.now += hour + 1
		expect(t, h.send("POST", "/v1/workspaces", file(9, 64), nil).StatusCode, 201, "an hour later")
	})
}

func TestRefusesFilesItCantKeep(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		h.server.MaxBytes = 100
		expect(t, h.send("POST", "/v1/workspaces", file(7, 101), nil).StatusCode, 413, "too big")
		expect(t, h.send("POST", "/v1/workspaces", []byte(`{"openarch": 9, "name": "plain"}`), nil).StatusCode, 400, "plain JSON")
		expect(t, h.send("POST", "/v1/workspaces", file(7, 10), nil).StatusCode, 400, "too short")
	})
}

func TestTooBigWithoutContentLength(t *testing.T) {
	server := httptest.NewServer(&Server{Store: NewMemoryStore(), MaxBytes: 100})
	defer server.Close()
	// Streamed, so there's no Content-Length to give it away.
	body := io.MultiReader(bytes.NewReader(file(7, 50)), strings.NewReader(strings.Repeat("x", 100_000)))
	r, err := http.Post(server.URL+"/v1/workspaces", "application/octet-stream", io.NopCloser(body))
	if err != nil {
		t.Fatal(err)
	}
	expect(t, r.StatusCode, 413, "status")
}

func TestCORSPreflight(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		r := h.send("OPTIONS", "/v1/workspaces/abcdefghijklmnop", nil, nil)
		expect(t, r.StatusCode, 204, "status")
		expect(t, r.Header.Get("Access-Control-Allow-Origin"), "*", "origin")
		expect(t, strings.Contains(r.Header.Get("Access-Control-Allow-Methods"), "PUT"), true, "methods")
		expect(t, strings.Contains(r.Header.Get("Access-Control-Allow-Headers"), "Authorization"), true, "headers")
	})
}

func TestWhatsWrongWithARequest(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		expect(t, h.send("GET", "/v1/workspaces/abcdefghijklmnop", nil, nil).StatusCode, 404, "unknown")
		expect(t, h.send("GET", "/v1/workspaces/not-an-id", nil, nil).StatusCode, 404, "bad id")
		expect(t, h.send("GET", "/elsewhere", nil, nil).StatusCode, 404, "elsewhere")
		expect(t, h.send("GET", "/", nil, nil).StatusCode, 200, "front page")
		c := h.create(file(7, 64))
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/AAAAAAAAAAAAAAAAAAAAAA", nil, nil).StatusCode, 404, "unknown hash")
		wrong := h.send("POST", "/v1/workspaces/"+c.ID, nil, nil)
		expect(t, wrong.StatusCode, 405, "method")
		expect(t, wrong.Header.Get("Allow"), "GET, HEAD, PUT, DELETE, OPTIONS", "allow")
	})
}

type failingStore struct{ *MemoryStore }

func (failingStore) Workspace(context.Context, string) (*Workspace, error) {
	return nil, errors.New("the disk is gone")
}

func TestFailureStillAnswers(t *testing.T) {
	server := &Server{Store: failingStore{NewMemoryStore()}}
	w := httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest("GET", "/v1/workspaces/abcdefghijklmnop", nil))
	expect(t, w.Code, 500, "status")
	expect(t, w.Header().Get("Access-Control-Allow-Origin"), "*", "cors")
	expect(t, strings.Contains(w.Body.String(), "The share server failed. Try again later."), true, "message")
}

func TestKeepsWhoSentEveryUpload(t *testing.T) {
	s, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := &harness{t: t, store: s, now: 1_000_000, ip: "203.0.113.7"}
	h.server = &Server{Store: s, Now: func() int64 { return h.now }}
	c := h.create(file(1, 40))
	h.now += 5
	h.send("PUT", "/v1/workspaces/"+c.ID, file(2, 50), map[string]string{"Authorization": "Bearer " + c.Token, "Origin": "https://designer.example"})
	rows, err := s.ListUploads(context.Background(), "workspace_id", c.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	expect(t, len(rows), 2, "uploads")
	expect(t, rows[0].Action, "update", "latest first")
	expect(t, rows[0].Size, 50, "size")
	expect(t, rows[0].Origin, "https://designer.example", "origin")
	expect(t, rows[1].Action, "create", "first")
	expect(t, rows[1].IP, "203.0.113.7", "ip")
	expect(t, rows[1].UserAgent, "test-agent", "user agent")
	expect(t, rows[1].At.UnixMilli(), int64(1_000_000), "time")
}
