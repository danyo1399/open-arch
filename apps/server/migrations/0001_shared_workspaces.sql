-- The share server's records, in SQLite (store_sql.go). The encrypted files are beside the
-- database, in files/. The server applies these files in order when it opens the database, and
-- notes each in schema_migrations, so a newer server brings an older database up to date.

-- One row per shared workspace.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  -- SHA-256 of the token its owner was given. The token itself is never stored.
  token_hash TEXT NOT NULL,
  -- The hash of its latest version.
  latest TEXT NOT NULL,
  -- Milliseconds since the epoch.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- When its owner stopped sharing it. Its files are deleted.
  deleted_at INTEGER,
  -- When it was taken down for abuse, and why. Its files are kept, but no longer served.
  blocked_at INTEGER,
  blocked_reason TEXT
);

-- One row per file uploaded, with what the request said about who sent it, to find abuse.
CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  -- create: a workspace's first version. update: a new one.
  action TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ip TEXT,
  -- From Cloudflare's CF-IPCountry, behind Cloudflare's proxy.
  country TEXT,
  user_agent TEXT,
  origin TEXT,
  referer TEXT,
  -- Cloudflare's ID for the request, to find it in Cloudflare's logs.
  ray TEXT
);
CREATE INDEX uploads_by_workspace ON uploads (workspace_id, created_at);
CREATE INDEX uploads_by_ip ON uploads (ip, created_at);

-- Addresses that can't upload any more.
CREATE TABLE blocked_ips (
  ip TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL
);
