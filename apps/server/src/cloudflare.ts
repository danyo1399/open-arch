/**
 * The share server on Cloudflare Workers (wrangler.jsonc): each version's encrypted file in an R2
 * bucket, and the records of workspaces and uploads in a D1 database (migrations/). Only the
 * parts of Workers' API it uses are declared here, so it needs no Cloudflare packages to build.
 */
import { DEFAULT_MAX_BYTES, DEFAULT_UPLOADS_PER_HOUR, handle } from "./handler.js";
import type { Client, ShareStore, Upload, WorkspaceRecord } from "./store.js";

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs the statements in one transaction. */
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface R2Bucket {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string }): Promise<{ objects: { key: string }[]; truncated: boolean }>;
}

export interface Env {
  FILES: R2Bucket;
  DB: D1Database;
  MAX_BYTES?: string;
  UPLOADS_PER_HOUR?: string;
}

/** What Cloudflare tells a Worker about where a request came from. */
interface CfProperties {
  country?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
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

export class CloudflareStore implements ShareStore {
  constructor(
    private readonly files: R2Bucket,
    private readonly db: D1Database,
  ) {}

  async workspace(id: string): Promise<WorkspaceRecord | null> {
    const row = await this.db.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first<WorkspaceRow>();
    if (!row) return null;
    return { id: row.id, tokenHash: row.token_hash, latest: row.latest, created: row.created_at, updated: row.updated_at, deleted: row.deleted_at, blocked: row.blocked_at };
  }

  private recordUpload(u: Upload): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO uploads (workspace_id, hash, action, size, created_at, ip, country, city, asn, as_organization, user_agent, origin, referer, ray) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(u.workspace, u.hash, u.action, u.size, u.at, u.ip, u.country, u.city, u.asn, u.asOrganization, u.userAgent, u.origin, u.referer, u.ray);
  }

  // The file goes in first: if recording it then fails, R2 holds a file nothing names, which does no harm.
  async create(record: WorkspaceRecord, file: Uint8Array, upload: Upload): Promise<void> {
    await this.files.put(fileKey(record.id, upload.hash), file, { httpMetadata: { contentType: "application/octet-stream" } });
    await this.db.batch([
      this.db
        .prepare("INSERT INTO workspaces (id, token_hash, latest, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(record.id, record.tokenHash, record.latest, record.created, record.updated),
      this.recordUpload(upload),
    ]);
  }

  async update(id: string, file: Uint8Array, upload: Upload): Promise<void> {
    await this.files.put(fileKey(id, upload.hash), file, { httpMetadata: { contentType: "application/octet-stream" } });
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

/** Who sent a request, from what Cloudflare adds to it. CF-Connecting-IP is set by Cloudflare, so a client can't choose it. */
export function cloudflareClient(request: Request): Client {
  const cf = ((request as { cf?: CfProperties }).cf ?? {}) as CfProperties;
  const header = (name: string) => request.headers.get(name);
  return {
    ip: header("CF-Connecting-IP"),
    country: cf.country ?? null,
    city: cf.city ?? null,
    asn: cf.asn ?? null,
    asOrganization: cf.asOrganization ?? null,
    userAgent: header("User-Agent"),
    origin: header("Origin"),
    referer: header("Referer"),
    ray: header("CF-Ray"),
  };
}

const numberVar = (value: string | undefined, fallback: number) => (value && Number.isFinite(Number(value)) ? Number(value) : fallback);

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, {
      store: new CloudflareStore(env.FILES, env.DB),
      client: cloudflareClient(request),
      maxBytes: numberVar(env.MAX_BYTES, DEFAULT_MAX_BYTES),
      uploadsPerHour: numberVar(env.UPLOADS_PER_HOUR, DEFAULT_UPLOADS_PER_HOUR),
    });
  },
};
