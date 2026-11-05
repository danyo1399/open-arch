/**
 * The share server's store on a SQL database and a bucket of files: the records of workspaces
 * and uploads in the database (the schema is in migrations/), and each version's encrypted file
 * in the bucket. The same store runs on Cloudflare, with D1 and R2 (cloudflare.ts), and on Node,
 * with SQLite and a folder on disk (sqlite.ts, disk.ts). The interfaces below are the parts of
 * D1's and R2's APIs it uses, which the Node versions copy.
 */
import type { ShareStore, Upload, WorkspaceRecord } from "./store.js";

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  /** The first row the statement gives, or null. */
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** Runs the statements in one transaction. */
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

/** Files by key, like `workspaces/<id>/<hash>`. */
export interface Bucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  /** Some of the keys that start with a prefix, and whether there are more. */
  list(options: { prefix: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>;
}

interface WorkspaceRow {
  id: string;
  token_hash: string;
  latest: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  blocked_at: number | null;
}

const fileKey = (id: string, hash: string) => `workspaces/${id}/${hash}`;

export class SqlStore implements ShareStore {
  constructor(
    private readonly files: Bucket,
    private readonly db: SqlDatabase,
  ) {}

  async workspace(id: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first<WorkspaceRow>();
    if (!row) return null;
    return { id: row.id, tokenHash: row.token_hash, latest: row.latest, created: row.created_at, updated: row.updated_at, deleted: row.deleted_at, blocked: row.blocked_at };
  }

  private recordUpload(u: Upload): SqlStatement {
    return this.db
      .prepare(
        "INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip, country, city, asn, as_organization, user_agent, origin, referer, ray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(u.workspace, u.hash, u.action, u.size, u.at, u.ip, u.country, u.city, u.asn, u.asOrganization, u.userAgent, u.origin, u.referer, u.ray);
  }

  // The file goes in first: if recording it then fails, the bucket holds a file nothing names, which does no harm.
  async create(record: WorkspaceRecord, file: Uint8Array, upload: Upload): Promise<void> {
    await this.files.put(fileKey(record.id, upload.hash), file);
    await this.db.batch([
      this.db
        .prepare("INSERT INTO workspaces (id, token_hash, latest, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(record.id, record.tokenHash, record.latest, record.created, record.updated),
      this.recordUpload(upload),
    ]);
  }

  async update(id: string, file: Uint8Array, upload: Upload): Promise<void> {
    await this.files.put(fileKey(id, upload.hash), file);
    await this.db.batch([this.db.prepare("UPDATE workspaces SET latest = ?, updated_at = ? WHERE id = ?").bind(upload.hash, upload.at, id), this.recordUpload(upload)]);
  }

  // Marked deleted first, so nothing serves a version while its files go. Each page listed is
  // deleted, so the next list starts again from the first file left, rather than from a cursor.
  async remove(id: string, at: number): Promise<void> {
    await this.db.prepare("UPDATE workspaces SET deleted_at = ? WHERE id = ?").bind(at, id).run();
    for (;;) {
      const page = await this.files.list({ prefix: `workspaces/${id}/` });
      if (page.objects.length) await this.files.delete(page.objects.map((o) => o.key));
      if (!page.truncated) break;
    }
  }

  async file(id: string, hash: string): Promise<Uint8Array | null> {
    const object = await this.files.get(fileKey(id, hash));
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  }

  async uploadsSince(ip: string, since: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM uploads WHERE ip = ? AND created_at >= ?").bind(ip, since).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async ipBlocked(ip: string): Promise<boolean> {
    return !!(await this.db.prepare("SELECT 1 AS blocked FROM blocked_ips WHERE ip = ?").bind(ip).first());
  }
}
