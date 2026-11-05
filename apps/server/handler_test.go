package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	r.RemoteAddr = net.JoinHostPort(h.ip, "5555")
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
		// 128 random bits.
		expect(t, len(c.ID), 22, "id length")
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
	})
}

func TestReplacesTheVersionBefore(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		c := h.create(file(7, 64))
		auth := map[string]string{"Authorization": "Bearer " + c.Token}
		second := decode[created](t, h.send("PUT", "/v1/workspaces/"+c.ID, file(8, 64), auth)).Hash
		third := decode[created](t, h.send("PUT", "/v1/workspaces/"+c.ID, file(9, 64), auth)).Hash

		// Only the latest version's file is kept.
		for _, hash := range []string{c.Hash, second} {
			f, err := h.store.File(context.Background(), c.ID, hash)
			expect(t, err, nil, "file")
			expect(t, f == nil, true, "earlier version deleted")
		}
		latest, _ := h.store.File(context.Background(), c.ID, third)
		expect(t, bytes.Equal(latest, file(9, 64)), true, "latest kept")

		// A link to an earlier version is sent on to the latest, every time: never from a cache.
		for _, hash := range []string{c.Hash, second} {
			for _, method := range []string{"GET", "HEAD"} {
				r := h.send(method, "/v1/workspaces/"+c.ID+"/"+hash, nil, map[string]string{"If-None-Match": `"` + hash + `"`})
				expect(t, r.StatusCode, http.StatusFound, method+" earlier version")
				expect(t, r.Header.Get("Location"), "/v1/workspaces/"+c.ID+"/"+third, "location")
				expect(t, r.Header.Get("Cache-Control"), "no-store", "redirect cache")
				expect(t, r.Header.Get("Access-Control-Allow-Origin"), "*", "cors")
			}
		}

		// The same file again is the same version, so nothing is deleted.
		h.send("PUT", "/v1/workspaces/"+c.ID, file(9, 64), auth)
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/"+third, nil, nil).StatusCode, 200, "same version again")
	})
}

func TestFollowsTheRedirectToTheLatest(t *testing.T) {
	server := httptest.NewServer(&Server{Store: NewMemoryStore()})
	defer server.Close()
	post := func(method, path string, body []byte, token string) *http.Response {
		r, _ := http.NewRequest(method, server.URL+path, bytes.NewReader(body))
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	c := decode[created](t, post("POST", "/v1/workspaces", file(1, 48), ""))
	post("PUT", "/v1/workspaces/"+c.ID, file(2, 48), c.Token)
	// As a browser does: it asks for the old version, and gets the latest.
	r, err := http.Get(server.URL + "/v1/workspaces/" + c.ID + "/" + c.Hash)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(r.Body)
	expect(t, r.StatusCode, 200, "followed")
	expect(t, bytes.Equal(body, file(2, 48)), true, "latest file")
	expect(t, r.Request.URL.Path, "/v1/workspaces/"+c.ID+"/"+FileHash(file(2, 48)), "final URL")
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
		r := h.send("OPTIONS", "/v1/workspaces/abcdefghijklmnopqrstuv", nil, nil)
		expect(t, r.StatusCode, 204, "status")
		expect(t, r.Header.Get("Access-Control-Allow-Origin"), "*", "origin")
		expect(t, strings.Contains(r.Header.Get("Access-Control-Allow-Methods"), "PUT"), true, "methods")
		expect(t, strings.Contains(r.Header.Get("Access-Control-Allow-Headers"), "Authorization"), true, "headers")
	})
}

func TestWhatsWrongWithARequest(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		expect(t, h.send("GET", "/v1/workspaces/abcdefghijklmnopqrstuv", nil, nil).StatusCode, 404, "unknown")
		expect(t, h.send("GET", "/v1/workspaces/not-an-id", nil, nil).StatusCode, 404, "bad id")
		expect(t, h.send("GET", "/elsewhere", nil, nil).StatusCode, 404, "elsewhere")
		expect(t, h.send("GET", "/", nil, nil).StatusCode, 200, "front page")
		c := h.create(file(7, 64))
		// A version there never was is sent on to the latest, as an earlier one is.
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID+"/AAAAAAAAAAAAAAAAAAAAAA", nil, nil).StatusCode, 302, "unknown hash")
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
	server.ServeHTTP(w, httptest.NewRequest("GET", "/v1/workspaces/abcdefghijklmnopqrstuv", nil))
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

func TestCountsAnIPv6NetworkAsOneAddress(t *testing.T) {
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

// The 404 for a workspace that isn't there says so in a way the designer can tell from any other.
func TestMarksANoWorkspaceAnswer(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		for _, path := range []string{"/v1/workspaces/AAAAAAAAAAAAAAAAAAAAAA", "/v1/workspaces/short"} {
			body := decode[map[string]string](t, h.send("DELETE", path, nil, map[string]string{"Authorization": "Bearer x"}))
			expect(t, body["code"], "no-workspace", path)
			expect(t, body["error"], "There's no shared workspace with that ID.", path)
		}
		// Another 404 isn't marked.
		expect(t, decode[map[string]string](t, h.send("DELETE", "/elsewhere", nil, nil))["code"], "", "elsewhere")
	})
}
