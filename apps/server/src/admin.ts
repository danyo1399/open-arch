/**
 * Finding and stopping abuse on a server that keeps its records in SQLite (main.ts's commands).
 * On Cloudflare, the same SQL runs on D1 with `wrangler d1 execute` (README).
 */
import type { SqlDatabase } from "./sql.js";

export interface UploadRow {
  at: string;
  workspace: string;
  action: string;
  size: number;
  ip: string | null;
  country: string | null;
  network: string | null;
  userAgent: string | null;
  origin: string | null;
}

/** The latest uploads to a workspace, or from an IP address. */
export async function listUploads(db: SqlDatabase, by: { workspace?: string; ip?: string }, limit: number): Promise<UploadRow[]> {
  const [column, value] = by.workspace ? ["workspace_id", by.workspace] : ["ip", by.ip];
  const { results } = await db
    .prepare(
      `SELECT created_at, workspace_id, action, size, ip, country, asn, as_organization, user_agent, origin FROM uploads WHERE ${column} = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(value, limit)
    .all<{ created_at: number; workspace_id: string; action: string; size: number; ip: string | null; country: string | null; asn: number | null; as_organization: string | null; user_agent: string | null; origin: string | null }>();
  return results.map((r) => ({
    at: new Date(r.created_at).toISOString(),
    workspace: r.workspace_id,
    action: r.action,
    size: r.size,
    ip: r.ip,
    country: r.country,
    network: r.asn === null ? null : `AS${r.asn}${r.as_organization ? ` ${r.as_organization}` : ""}`,
    userAgent: r.user_agent,
    origin: r.origin,
  }));
}

/** Takes a workspace down, or (reason null) puts it back. Resolves to whether there's a workspace with that ID. */
export async function setBlocked(db: SqlDatabase, id: string, reason: string | null, now = Date.now()): Promise<boolean> {
  const found = await db.prepare("SELECT 1 AS found FROM workspaces WHERE id = ?").bind(id).first();
  if (!found) return false;
  await db
    .prepare("UPDATE workspaces SET blocked_at = ?, blocked_reason = ? WHERE id = ?")
    .bind(reason === null ? null : now, reason, id)
    .run();
  return true;
}

/** Refuses uploads from an IP address, or (reason null) accepts them again. */
export async function setIpBlocked(db: SqlDatabase, ip: string, reason: string | null, now = Date.now()): Promise<void> {
  if (reason === null) await db.prepare("DELETE FROM blocked_ips WHERE ip = ?").bind(ip).run();
  else await db.prepare("INSERT INTO blocked_ips (ip, reason, created_at) VALUES (?, ?, ?) ON CONFLICT (ip) DO UPDATE SET reason = excluded.reason").bind(ip, reason, now).run();
}
