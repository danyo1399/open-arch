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
	"log"
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
	if err := groupAddresses(db); err != nil {
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

// groupAddresses gives each upload recorded before uploads had a group (0002_upload_ip_groups.sql)
// the group the limits count it under, so the hour after an upgrade still counts them. It's Go's
// work, not SQL's, as SQLite can't find an IPv6 address's /64. Once they all have one, it finds none.
func groupAddresses(db *sql.DB) error {
	rows, err := db.Query("SELECT id, ip FROM uploads WHERE ip_group IS NULL AND ip IS NOT NULL")
	if err != nil {
		return err
	}
	groups := map[int64]string{}
	for rows.Next() {
		var id int64
		var ip string
		if err := rows.Scan(&id, &ip); err != nil {
			rows.Close()
			return err
		}
		groups[id] = AddressGroup(ip)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for id, group := range groups {
		if _, err := db.Exec("UPDATE uploads SET ip_group = ? WHERE id = ?", group, id); err != nil {
			return err
		}
	}
	return nil
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

const insertUpload = "INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip, ip_group, country, user_agent, origin, referer, ray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

func uploadValues(u Upload) []any {
	return []any{u.Workspace, u.Hash, u.Action, u.Size, u.At, null(u.IP), null(u.Group), null(u.Country), null(u.UserAgent), null(u.Origin), null(u.Referer), null(u.Ray)}
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

// The version it replaces is read in the same transaction that replaces it, so of two updates at
// once, each deletes the one it replaced. Its file goes once the new one is the latest: if that
// fails, it's a file nothing serves, and it's only logged.
//
// The workspace is checked in that transaction too, as it may have been deleted or taken down
// since the handler looked. Then the new file goes, and for a deleted one, so does its folder: a
// delete that ran first removed the folder before this file was put in it.
func (s *SQLStore) Update(ctx context.Context, id string, file []byte, u Upload) error {
	if err := s.putFile(id, u.Hash, file); err != nil {
		// A delete that removed the folder while the file was being written leaves it nowhere to go.
		if gone, _ := s.notShared(ctx, id); gone {
			s.dropFile(id, u.Hash)
			return ErrNotShared
		}
		return err
	}
	var previous string
	var deleted, blocked sql.NullInt64
	err := s.inTx(ctx,
		func(tx *sql.Tx) error {
			if err := tx.QueryRowContext(ctx, "SELECT latest, deleted_at, blocked_at FROM workspaces WHERE id = ?", id).Scan(&previous, &deleted, &blocked); err != nil {
				return err
			}
			if deleted.Valid || blocked.Valid {
				return ErrNotShared
			}
			return nil
		},
		func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, "UPDATE workspaces SET latest = ?, updated_at = ? WHERE id = ?", u.Hash, u.At, id)
			return err
		},
		func(tx *sql.Tx) error { _, err := tx.ExecContext(ctx, insertUpload, uploadValues(u)...); return err },
	)
	if errors.Is(err, ErrNotShared) || errors.Is(err, sql.ErrNoRows) {
		s.dropFile(id, u.Hash)
		return ErrNotShared
	}
	if err != nil || previous == u.Hash {
		return err
	}
	if path, err := s.path(id, previous); err == nil {
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			log.Printf("couldn't delete %s's previous version %s: %v", id, previous, err)
		}
	}
	return nil
}

// notShared says whether a workspace was deleted or taken down, or isn't there at all.
func (s *SQLStore) notShared(ctx context.Context, id string) (bool, error) {
	w, err := s.Workspace(ctx, id)
	if err != nil {
		return false, err
	}
	return w == nil || w.Deleted != 0 || w.Blocked != 0, nil
}

// dropFile removes a file an update wrote for a workspace that's gone, and its folder if that's
// left empty: a deleted workspace's is, and a taken-down one keeps its other files.
func (s *SQLStore) dropFile(id, hash string) {
	if path, err := s.path(id, hash); err == nil {
		os.Remove(path)
		os.Remove(filepath.Dir(path))
	}
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

func (s *SQLStore) UploadsSince(ctx context.Context, group string, since int64) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM uploads WHERE ip_group = ? AND created_at >= ?", group, since).Scan(&n)
	return n, err
}

func (s *SQLStore) IPBlocked(ctx context.Context, ip, group string) (bool, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM blocked_ips WHERE ip IN (?, ?)", ip, group).Scan(&n)
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

// ListUploads gives the latest uploads to a workspace (column "workspace_id"), or from an IP
// address or an IPv6 /64 ("ip").
func (s *SQLStore) ListUploads(ctx context.Context, column, value string, limit int) ([]UploadRow, error) {
	where := map[string]string{"workspace_id": "workspace_id = ?1", "ip": "(ip = ?1 OR ip_group = ?1)"}[column]
	if where == "" {
		return nil, fmt.Errorf("can't list uploads by %s", column)
	}
	rows, err := s.db.QueryContext(ctx, "SELECT created_at, workspace_id, action, size, ip, country, user_agent, origin FROM uploads WHERE "+where+" ORDER BY created_at DESC, id DESC LIMIT ?2", value, limit)
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
