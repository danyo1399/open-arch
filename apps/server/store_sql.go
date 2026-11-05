package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

	// SQLite in pure Go, so the executable needs no C library and builds for any platform.
	_ "modernc.org/sqlite"
)

// The schema, inside the executable: the files in migrations/, applied in order.
//
//go:embed migrations/*.sql
var migrations embed.FS

// SQLStore keeps the records of workspaces and uploads in SQLite, in <folder>/shares.db, and
// each version's encrypted file in <folder>/files/workspaces/<id>/<hash>.
type SQLStore struct {
	db    *sql.DB
	files string
}

// A file's path from an ID and a hash, which the handler checked, but the store doesn't count on it.
var fileName = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// OpenStore opens (or creates) the store in a data folder, and brings its schema up to date.
// Write-ahead logging lets the admin commands read and change it while the server runs.
func OpenStore(folder string) (*SQLStore, error) {
	if err := os.MkdirAll(filepath.Join(folder, "files"), 0o750); err != nil {
		return nil, err
	}
	return openStore(databaseURI(filepath.Join(folder, "shares.db")), filepath.Join(folder, "files"))
}

// databaseURI is SQLite's URI for a database file, with its settings. The path is escaped, so a
// folder with "#" or "?" in its name doesn't end the path early.
func databaseURI(path string) string {
	absolute, err := filepath.Abs(path)
	if err == nil {
		path = absolute
	}
	uri := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"}
	return uri.String()
}

func openStore(dsn, files string) (*SQLStore, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection: SQLite writes one at a time anyway, and this way nothing waits on a lock in-process.
	db.SetMaxOpenConns(1)
	if _, err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	return &SQLStore{db: db, files: files}, nil
}

func (s *SQLStore) Close() error { return s.db.Close() }

// migrate applies the migrations a database doesn't have yet, in order, and returns their names.
func migrate(db *sql.DB) ([]string, error) {
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"); err != nil {
		return nil, err
	}
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return nil, err
	}
	sort.Strings(names)
	var applied []string
	for _, path := range names {
		name := filepath.Base(path)
		var found int
		if err := db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE name = ?", name).Scan(&found); err != nil {
			return nil, err
		}
		if found > 0 {
			continue
		}
		script, err := migrations.ReadFile(path)
		if err != nil {
			return nil, err
		}
		tx, err := db.Begin()
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(string(script)); err != nil {
			tx.Rollback()
			return nil, fmt.Errorf("couldn't apply the migration %s: %w", name, err)
		}
		if _, err := tx.Exec("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", name, time.Now().UnixMilli()); err != nil {
			tx.Rollback()
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		applied = append(applied, name)
	}
	return applied, nil
}

// null stores what a request didn't say as NULL, not as an empty string.
func null(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (s *SQLStore) path(id, hash string) (string, error) {
	if !fileName.MatchString(id) || !fileName.MatchString(hash) {
		return "", fmt.Errorf("not a file: %q/%q", id, hash)
	}
	return filepath.Join(s.files, "workspaces", id, hash), nil
}

// putFile writes beside the file, then renames it into place, so a reader never sees half of one.
func (s *SQLStore) putFile(id, hash string, file []byte) error {
	path, err := s.path(id, hash)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	suffix := make([]byte, 6)
	rand.Read(suffix)
	partial := path + "." + hex.EncodeToString(suffix) + ".partial"
	if err := os.WriteFile(partial, file, 0o640); err != nil {
		return err
	}
	return os.Rename(partial, path)
}

func (s *SQLStore) Workspace(ctx context.Context, id string) (*Workspace, error) {
	var w Workspace
	var deleted, blocked sql.NullInt64
	err := s.db.QueryRowContext(ctx, "SELECT id, token_hash, latest, created_at, updated_at, deleted_at, blocked_at FROM workspaces WHERE id = ?", id).
		Scan(&w.ID, &w.TokenHash, &w.Latest, &w.Created, &w.Updated, &deleted, &blocked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	w.Deleted, w.Blocked = deleted.Int64, blocked.Int64
	return &w, nil
}

const insertUpload = "INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip, country, user_agent, origin, referer, ray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

func uploadValues(u Upload) []any {
	return []any{u.Workspace, u.Hash, u.Action, u.Size, u.At, null(u.IP), null(u.Country), null(u.UserAgent), null(u.Origin), null(u.Referer), null(u.Ray)}
}

// inTx runs statements in one transaction.
func (s *SQLStore) inTx(ctx context.Context, statements ...func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	for _, statement := range statements {
		if err := statement(tx); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// The file goes in first: if recording it then fails, the folder holds a file nothing names, which does no harm.
func (s *SQLStore) Create(ctx context.Context, w Workspace, file []byte, u Upload) error {
	if err := s.putFile(w.ID, u.Hash, file); err != nil {
		return err
	}
	return s.inTx(ctx,
		func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, "INSERT INTO workspaces (id, token_hash, latest, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", w.ID, w.TokenHash, w.Latest, w.Created, w.Updated)
			return err
		},
		func(tx *sql.Tx) error { _, err := tx.ExecContext(ctx, insertUpload, uploadValues(u)...); return err },
	)
}

func (s *SQLStore) Update(ctx context.Context, id string, file []byte, u Upload) error {
	if err := s.putFile(id, u.Hash, file); err != nil {
		return err
	}
	return s.inTx(ctx,
		func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, "UPDATE workspaces SET latest = ?, updated_at = ? WHERE id = ?", u.Hash, u.At, id)
			return err
		},
		func(tx *sql.Tx) error { _, err := tx.ExecContext(ctx, insertUpload, uploadValues(u)...); return err },
	)
}

// Marked deleted first, so nothing serves a version while its files go.
func (s *SQLStore) Remove(ctx context.Context, id string, at int64) error {
	if _, err := s.db.ExecContext(ctx, "UPDATE workspaces SET deleted_at = ? WHERE id = ?", at, id); err != nil {
		return err
	}
	if !fileName.MatchString(id) {
		return fmt.Errorf("not a workspace: %q", id)
	}
	return os.RemoveAll(filepath.Join(s.files, "workspaces", id))
}

func (s *SQLStore) File(_ context.Context, id, hash string) ([]byte, error) {
	path, err := s.path(id, hash)
	if err != nil {
		return nil, err
	}
	file, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	return file, err
}

func (s *SQLStore) UploadsSince(ctx context.Context, ip string, since int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM uploads WHERE ip = ? AND created_at >= ?", ip, since).Scan(&n)
	return n, err
}

func (s *SQLStore) IPBlocked(ctx context.Context, ip string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM blocked_ips WHERE ip = ?", ip).Scan(&n)
	return n > 0, err
}

// --- Finding and stopping abuse (the uploads, block and block-ip commands) --------------------

// An upload, as the uploads command lists it.
type UploadRow struct {
	At                             time.Time
	Workspace                      string
	Action                         string
	Size                           int
	IP, Country, UserAgent, Origin string
}

// ListUploads gives the latest uploads to a workspace (column "workspace_id") or from an IP address ("ip").
func (s *SQLStore) ListUploads(ctx context.Context, column, value string, limit int) ([]UploadRow, error) {
	if column != "workspace_id" && column != "ip" {
		return nil, fmt.Errorf("can't list uploads by %s", column)
	}
	rows, err := s.db.QueryContext(ctx, "SELECT created_at, workspace_id, action, size, ip, country, user_agent, origin FROM uploads WHERE "+column+" = ? ORDER BY created_at DESC, id DESC LIMIT ?", value, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []UploadRow
	for rows.Next() {
		var r UploadRow
		var at int64
		var ip, country, agent, origin sql.NullString
		if err := rows.Scan(&at, &r.Workspace, &r.Action, &r.Size, &ip, &country, &agent, &origin); err != nil {
			return nil, err
		}
		r.At = time.UnixMilli(at).UTC()
		r.IP, r.Country, r.UserAgent, r.Origin = ip.String, country.String, agent.String, origin.String
		list = append(list, r)
	}
	return list, rows.Err()
}

// SetBlocked takes a workspace down, or puts it back with an empty reason. It returns whether there's a workspace with that ID.
func (s *SQLStore) SetBlocked(ctx context.Context, id, reason string, now int64) (bool, error) {
	var at any
	if reason != "" {
		at = now
	}
	result, err := s.db.ExecContext(ctx, "UPDATE workspaces SET blocked_at = ?, blocked_reason = ? WHERE id = ?", at, null(reason), id)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n > 0, err
}

// SetIPBlocked refuses uploads from an IP address, or accepts them again with an empty reason.
func (s *SQLStore) SetIPBlocked(ctx context.Context, ip, reason string, now int64) error {
	if reason == "" {
		_, err := s.db.ExecContext(ctx, "DELETE FROM blocked_ips WHERE ip = ?", ip)
		return err
	}
	_, err := s.db.ExecContext(ctx, "INSERT INTO blocked_ips (ip, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET reason = excluded.reason", ip, reason, now)
	return err
}
