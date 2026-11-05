package main

import (
	"context"
	"strings"
	"sync"
)

// Where the share server keeps shared workspaces: the encrypted files, one per version, and what
// it knows about each workspace and each upload. The handler only talks to a Store, so the same
// server keeps them in SQLite and a folder on disk (store_sql.go), or in memory (MemoryStore).

// A shared workspace.
type Workspace struct {
	ID string
	// SHA-256 of the token that lets its owner change it. The token itself is never stored.
	TokenHash string
	// The hash of its latest version.
	Latest string
	// Milliseconds since the epoch.
	Created, Updated int64
	// When its owner stopped sharing it, or 0. Its files are gone.
	Deleted int64
	// When it was taken down for abuse, or 0. Its files are kept, but no longer served.
	Blocked int64
}

// Who sent a request, as far as the server can tell: kept with every upload, to find abuse.
// An empty string is something the request didn't say.
type Client struct {
	IP      string
	Country string
	// What the browser said about itself, and the page the request came from.
	UserAgent, Origin, Referer string
	// Cloudflare's ID for the request, to find it in Cloudflare's logs.
	Ray string
}

// One file uploaded: a workspace's first version, or a new one.
type Upload struct {
	Client
	Workspace string
	Hash      string
	// "create" or "update".
	Action string
	// Bytes.
	Size int
	At   int64
}

type Store interface {
	// The workspace with this ID, or nil.
	Workspace(ctx context.Context, id string) (*Workspace, error)
	// Stores a new workspace's first version.
	Create(ctx context.Context, w Workspace, file []byte, u Upload) error
	// Stores a new version of a workspace, and makes it the latest.
	Update(ctx context.Context, id string, file []byte, u Upload) error
	// Deletes a workspace's files, and marks it deleted. What's known about its uploads is kept.
	Remove(ctx context.Context, id string, at int64) error
	// The file of one version, or nil if there isn't one.
	File(ctx context.Context, id, hash string) ([]byte, error)
	// How many files were uploaded from an IP address since a time, for the rate limit.
	UploadsSince(ctx context.Context, ip string, since int64) (int, error)
	// Whether uploads from an IP address were blocked for abuse.
	IPBlocked(ctx context.Context, ip string) (bool, error)
}

// Keeps everything in memory, for trying the server out (--memory) and the tests.
type MemoryStore struct {
	mu         sync.Mutex
	workspaces map[string]Workspace
	files      map[string][]byte
	uploads    []Upload
	blockedIPs map[string]bool
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{workspaces: map[string]Workspace{}, files: map[string][]byte{}, blockedIPs: map[string]bool{}}
}

func (m *MemoryStore) Workspace(_ context.Context, id string) (*Workspace, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	w, ok := m.workspaces[id]
	if !ok {
		return nil, nil
	}
	return &w, nil
}

func (m *MemoryStore) Create(_ context.Context, w Workspace, file []byte, u Upload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[w.ID+"/"+u.Hash] = file
	m.workspaces[w.ID] = w
	m.uploads = append(m.uploads, u)
	return nil
}

func (m *MemoryStore) Update(_ context.Context, id string, file []byte, u Upload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[id+"/"+u.Hash] = file
	w := m.workspaces[id]
	w.Latest, w.Updated = u.Hash, u.At
	m.workspaces[id] = w
	m.uploads = append(m.uploads, u)
	return nil
}

func (m *MemoryStore) Remove(_ context.Context, id string, at int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for key := range m.files {
		if strings.HasPrefix(key, id+"/") {
			delete(m.files, key)
		}
	}
	if w, ok := m.workspaces[id]; ok {
		w.Deleted = at
		m.workspaces[id] = w
	}
	return nil
}

func (m *MemoryStore) File(_ context.Context, id, hash string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.files[id+"/"+hash], nil
}

func (m *MemoryStore) UploadsSince(_ context.Context, ip string, since int64) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, u := range m.uploads {
		if u.IP == ip && u.At >= since {
			n++
		}
	}
	return n, nil
}

func (m *MemoryStore) IPBlocked(_ context.Context, ip string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.blockedIPs[ip], nil
}
