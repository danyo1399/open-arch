package main

// The share server's HTTP API. The designer encrypts a workspace in the browser and uploads the
// result; the key stays in the link's #fragment, which browsers never send, so the server only
// ever has files it can't read. Uploads are anonymous: whoever creates a workspace gets a token
// that lets them change or delete it, and nobody else can.
//
//	POST   /v1/workspaces              upload a new workspace          → 201 {id, hash, token}
//	PUT    /v1/workspaces/:id          upload a new version (token)    → 200 {id, hash}
//	DELETE /v1/workspaces/:id          stop sharing it (token)         → 204
//	GET    /v1/workspaces/:id          its latest version              → 200 {id, hash, updated}
//	GET    /v1/workspaces/:id/:hash    one version's encrypted file    → 200 bytes
//
// A version's file never changes, as its hash is the hash of its bytes, so browsers and proxies
// can cache it for good. Only the small answer naming the latest version is checked each time.
//
// Every upload is kept with what the request said about who sent it (client.go), so abuse can
// be found and taken down, and uploads from one address are limited per hour.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultMaxBytes       = 1_000_000
	DefaultUploadsPerHour = 60
	// The first byte of every file the designer uploads: the version of its format (apps/web/src/share.ts).
	FileFormat = 1
	// The format byte, AES-GCM's 12-byte IV and its 16-byte tag: the smallest file there can be.
	minBytes  = 1 + 12 + 16
	immutable = "public, max-age=31536000, immutable"
	hour      = int64(time.Hour / time.Millisecond)
)

var (
	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{16}$`)
	hashPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{22}$`)
	bearer      = regexp.MustCompile(`^Bearer (\S+)$`)
)

// Server answers the share server's requests.
type Server struct {
	Store          Store
	MaxBytes       int64
	UploadsPerHour int
	// Whose word to take for a request's address (client.go).
	TrustProxy TrustProxy
	// Milliseconds since the epoch. The clock, unless a test sets it.
	Now func() int64
	// Prints a line for each request, when set.
	Log func(line string)
}

var b64 = base64.RawURLEncoding

func random(n int) string {
	bytes := make([]byte, n)
	rand.Read(bytes)
	return b64.EncodeToString(bytes)
}

// FileHash is a file's hash: the first 128 bits of its SHA-256, which names it in its URL.
func FileHash(file []byte) string {
	sum := sha256.Sum256(file)
	return b64.EncodeToString(sum[:16])
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return b64.EncodeToString(sum[:])
}

// The status a handler wrote, for the log.
type recorder struct {
	http.ResponseWriter
	status int
}

func (r *recorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return r.ResponseWriter.Write(b)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"error": message})
}

// Whether the request's If-None-Match names this ETag, so the copy the browser has is still right.
func notModified(r *http.Request, etag string) bool {
	for _, tag := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		if strings.TrimPrefix(strings.TrimSpace(tag), "W/") == etag {
			return true
		}
	}
	return false
}

func (s *Server) now() int64 {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now().UnixMilli()
}

// ServeHTTP answers a request. When the store fails, it still answers, with the headers the browser needs to read why.
func (s *Server) ServeHTTP(rw http.ResponseWriter, r *http.Request) {
	w := &recorder{ResponseWriter: rw}
	client := ClientOf(r, s.TrustProxy)
	// The designer runs on any host, and from file:// in the desktop app. Nothing here relies on cookies.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Expose-Headers", "ETag")
	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("panic: %v", recovered)
			if w.status == 0 {
				fail(w, http.StatusInternalServerError, "The share server failed. Try again later.")
			}
		}
		// Health checks ask for / every few seconds; a line for each would bury the rest.
		if s.Log != nil && r.URL.Path != "/" {
			ip := client.IP
			if ip == "" {
				ip = "-"
			}
			s.Log(fmt.Sprintf("%s %d %s %s %s", time.Now().UTC().Format(time.RFC3339Nano), w.status, r.Method, r.URL.Path, ip))
		}
	}()
	if err := s.route(w, r, client); err != nil {
		log.Printf("%s %s: %v", r.Method, r.URL.Path, err)
		if w.status == 0 {
			fail(w, http.StatusInternalServerError, "The share server failed. Try again later.")
		}
	}
}

func (s *Server) route(w http.ResponseWriter, r *http.Request, client Client) error {
	ctx := r.Context()
	now := s.now()
	method := r.Method
	var parts []string
	for _, part := range strings.Split(r.URL.Path, "/") {
		if part != "" {
			parts = append(parts, part)
		}
	}

	if method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.WriteHeader(http.StatusNoContent)
		return nil
	}

	if len(parts) == 0 && (method == http.MethodGet || method == http.MethodHead) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		io.WriteString(w, "open-arch share server: it keeps workspaces shared from the designer, encrypted.\n")
		return nil
	}

	if len(parts) < 2 || parts[0] != "v1" || parts[1] != "workspaces" || len(parts) > 4 {
		fail(w, http.StatusNotFound, "There's nothing here.")
		return nil
	}
	var id, hash string
	if len(parts) > 2 {
		id = parts[2]
		if !idPattern.MatchString(id) {
			fail(w, http.StatusNotFound, "There's no shared workspace with that ID.")
			return nil
		}
	}
	if len(parts) > 3 {
		hash = parts[3]
		if !hashPattern.MatchString(hash) {
			fail(w, http.StatusNotFound, "There's no version of this workspace with that hash.")
			return nil
		}
	}

	allowed := []string{"GET", "HEAD", "PUT", "DELETE"}
	if id == "" {
		allowed = []string{"POST"}
	} else if hash != "" {
		allowed = []string{"GET", "HEAD"}
	}
	if !contains(allowed, method) {
		w.Header().Set("Allow", strings.Join(append(allowed, "OPTIONS"), ", "))
		fail(w, http.StatusMethodNotAllowed, "Use "+strings.Join(allowed, " or ")+" here.")
		return nil
	}

	if id == "" {
		file, err := s.readUpload(w, r, client, now)
		if file == nil || err != nil {
			return err
		}
		newID, token := random(12), random(32)
		u := upload(client, newID, file, "create", now)
		workspace := Workspace{ID: newID, TokenHash: tokenHash(token), Latest: u.Hash, Created: now, Updated: now}
		if err := s.Store.Create(ctx, workspace, file, u); err != nil {
			return err
		}
		writeJSON(w, http.StatusCreated, map[string]string{"id": newID, "hash": u.Hash, "token": token})
		return nil
	}

	workspace, err := s.Store.Workspace(ctx, id)
	if err != nil {
		return err
	}
	if workspace == nil {
		fail(w, http.StatusNotFound, "There's no shared workspace with that ID.")
		return nil
	}
	if workspace.Blocked != 0 {
		fail(w, http.StatusGone, "This shared workspace was taken down.")
		return nil
	}
	if workspace.Deleted != 0 {
		fail(w, http.StatusGone, "This workspace isn't shared any more: whoever shared it stopped sharing it.")
		return nil
	}

	if method == http.MethodPut || method == http.MethodDelete {
		match := bearer.FindStringSubmatch(r.Header.Get("Authorization"))
		if match == nil {
			fail(w, http.StatusUnauthorized, "Only whoever shared this workspace can change it, with the token they were given.")
			return nil
		}
		if tokenHash(match[1]) != workspace.TokenHash {
			fail(w, http.StatusForbidden, "Only whoever shared this workspace can change it.")
			return nil
		}
		if method == http.MethodDelete {
			if err := s.Store.Remove(ctx, id, now); err != nil {
				return err
			}
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return nil
		}
		file, err := s.readUpload(w, r, client, now)
		if file == nil || err != nil {
			return err
		}
		u := upload(client, id, file, "update", now)
		if err := s.Store.Update(ctx, id, file, u); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": id, "hash": u.Hash})
		return nil
	}

	if hash == "" {
		// Small, and checked each time: the browser keeps it, and asks whether it's still right.
		etag := `"` + workspace.Latest + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "no-cache")
		if notModified(r, etag) {
			w.WriteHeader(http.StatusNotModified)
			return nil
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "hash": workspace.Latest, "updated": workspace.Updated})
		return nil
	}

	etag := `"` + hash + `"`
	if notModified(r, etag) {
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", immutable)
		w.WriteHeader(http.StatusNotModified)
		return nil
	}
	file, err := s.Store.File(ctx, id, hash)
	if err != nil {
		return err
	}
	if file == nil {
		fail(w, http.StatusNotFound, "There's no version of this workspace with that hash.")
		return nil
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(file)))
	w.Header().Set("Cache-Control", immutable)
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if method != http.MethodHead {
		w.Write(file)
	}
	return nil
}

// readUpload reads an upload, and checks it's a file the designer could have made and its sender
// may upload now. When it can't be uploaded, it answers why and returns nil.
func (s *Server) readUpload(w http.ResponseWriter, r *http.Request, client Client, now int64) ([]byte, error) {
	maxBytes := s.MaxBytes
	if maxBytes == 0 {
		maxBytes = DefaultMaxBytes
	}
	tooBig := fmt.Sprintf("A shared workspace can be at most %d bytes, encrypted.", maxBytes)
	if r.ContentLength > maxBytes {
		fail(w, http.StatusRequestEntityTooLarge, tooBig)
		return nil, nil
	}
	if client.IP != "" {
		blocked, err := s.Store.IPBlocked(r.Context(), client.IP)
		if err != nil {
			return nil, err
		}
		if blocked {
			fail(w, http.StatusForbidden, "Uploads from this address are blocked.")
			return nil, nil
		}
		limit := s.UploadsPerHour
		if limit == 0 {
			limit = DefaultUploadsPerHour
		}
		recent, err := s.Store.UploadsSince(r.Context(), client.IP, now-hour)
		if err != nil {
			return nil, err
		}
		if recent >= limit {
			w.Header().Set("Retry-After", "3600")
			fail(w, http.StatusTooManyRequests, fmt.Sprintf("Too many uploads from this address: at most %d an hour. Try again later.", limit))
			return nil, nil
		}
	}
	// One byte over the limit is enough to know it's too big. The rest is never read, so the
	// connection closes after the answer.
	file, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil {
		fail(w, http.StatusBadRequest, "The upload didn't arrive whole.")
		return nil, nil
	}
	if int64(len(file)) > maxBytes {
		w.Header().Set("Connection", "close")
		fail(w, http.StatusRequestEntityTooLarge, tooBig)
		return nil, nil
	}
	if len(file) < minBytes || file[0] != FileFormat {
		fail(w, http.StatusBadRequest, "That isn't a workspace encrypted by open-arch.")
		return nil, nil
	}
	return file, nil
}

func upload(client Client, workspace string, file []byte, action string, now int64) Upload {
	return Upload{Client: client, Workspace: workspace, Hash: FileHash(file), Action: action, Size: len(file), At: now}
}

func contains(list []string, s string) bool {
	for _, item := range list {
		if item == s {
			return true
		}
	}
	return false
}
