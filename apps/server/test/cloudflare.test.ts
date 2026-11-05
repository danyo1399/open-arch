/**
 * The Cloudflare store against the real schema, in SQLite (which D1 is), and a bucket in memory
 * standing in for R2.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker, { cloudflareClient, CloudflareStore, type D1Database, type D1PreparedStatement, type R2Bucket } from "../src/cloudflare.js";
import { FILE_FORMAT } from "../src/handler.js";

function d1(): { db: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0001_shared_workspaces.sql", import.meta.url), "utf8"));
  const statement = (sql: string, values: unknown[] = []): D1PreparedStatement & { exec(): unknown } => ({
    bind: (...next) => statement(sql, next),
    first: async <T,>() => (sqlite.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
    run: async () => sqlite.prepare(sql).run(...(values as never[])),
    exec: () => sqlite.prepare(sql).run(...(values as never[])),
  });
  const db: D1Database = {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { db, sqlite };
}

/** A bucket that lists two keys at a time, so deleting a workspace's files takes more than one page. */
function r2(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key, value) => void objects.set(key, value),
    get: async (key) => {
      const value = objects.get(key);
      return value ? { arrayBuffer: async () => value.slice().buffer } : null;
    },
    delete: async (keys) => {
      for (const key of [keys].flat()) objects.delete(key);
    },
    list: async ({ prefix }) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: keys.slice(0, 2).map((key) => ({ key })), truncated: keys.length > 2 };
    },
  };
}

const file = (fill: number) => {
  const bytes = new Uint8Array(48).fill(fill);
  bytes[0] = FILE_FORMAT;
  return bytes;
};

describe("share server on Cloudflare", () => {
  it("keeps workspaces, versions and uploads in D1 and R2", async () => {
    const { db, sqlite } = d1();
    const bucket = r2();
    const env = { FILES: bucket, DB: db, UPLOADS_PER_HOUR: "3" };
    const request = (method: string, path: string, init: RequestInit = {}) =>
      Object.assign(new Request(`https://share.example${path}`, { method, ...init, headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "test", ...init.headers } }), {
        cf: { country: "NZ", city: "Auckland", asn: 64500, asOrganization: "Example Net" },
      });

    const created = await worker.fetch(request("POST", "/v1/workspaces", { body: file(1) }), env);
    expect(created.status).toBe(201);
    const { id, hash, token } = (await created.json()) as { id: string; hash: string; token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const updated = await worker.fetch(request("PUT", `/v1/workspaces/${id}`, { body: file(2), headers: auth }), env);
    const next = ((await updated.json()) as { hash: string }).hash;
    expect(await (await worker.fetch(request("GET", `/v1/workspaces/${id}`), env)).json()).toMatchObject({ id, hash: next });
    expect(new Uint8Array(await (await worker.fetch(request("GET", `/v1/workspaces/${id}/${hash}`), env)).arrayBuffer())).toEqual(file(1));

    expect(sqlite.prepare("SELECT workspace_id, hash, action, size, ip, country, city, asn, as_organization, user_agent FROM uploads ORDER BY id").all()).toEqual([
      { workspace_id: id, hash, action: "create", size: 48, ip: "203.0.113.7", country: "NZ", city: "Auckland", asn: 64500, as_organization: "Example Net", user_agent: "test" },
      { workspace_id: id, hash: next, action: "update", size: 48, ip: "203.0.113.7", country: "NZ", city: "Auckland", asn: 64500, as_organization: "Example Net", user_agent: "test" },
    ]);

    // The rate limit counts uploads in D1: two so far, so one more, then no more.
    expect((await worker.fetch(request("PUT", `/v1/workspaces/${id}`, { body: file(3), headers: auth }), env)).status).toBe(200);
    expect((await worker.fetch(request("PUT", `/v1/workspaces/${id}`, { body: file(4), headers: auth }), env)).status).toBe(429);

    expect(bucket.objects.size).toBe(3);
    expect((await worker.fetch(request("DELETE", `/v1/workspaces/${id}`, { headers: auth }), env)).status).toBe(204);
    expect(bucket.objects.size).toBe(0);
    expect((await worker.fetch(request("GET", `/v1/workspaces/${id}`), env)).status).toBe(410);
    // What's known about the uploads stays.
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM uploads").get()).toEqual({ n: 3 });
  });

  it("refuses uploads from an address in blocked_ips, and serves nothing of a blocked workspace", async () => {
    const { db, sqlite } = d1();
    const store = new CloudflareStore(r2(), db);
    sqlite.prepare("INSERT INTO blocked_ips (ip, reason, created_at) VALUES (?, ?, ?)").run("203.0.113.7", "spam", 1);
    expect(await store.ipBlocked("203.0.113.7")).toBe(true);
    expect(await store.ipBlocked("198.51.100.1")).toBe(false);

    const env = { FILES: r2(), DB: db };
    const post = new Request("https://share.example/v1/workspaces", { method: "POST", body: file(1), headers: { "CF-Connecting-IP": "198.51.100.1" } });
    const { id, hash } = (await (await worker.fetch(post, env)).json()) as { id: string; hash: string };
    sqlite.prepare("UPDATE workspaces SET blocked_at = 5, blocked_reason = 'abuse' WHERE id = ?").run(id);
    expect((await worker.fetch(new Request(`https://share.example/v1/workspaces/${id}/${hash}`), env)).status).toBe(410);
  });

  it("takes who sent a request from what Cloudflare adds, not from headers a client can set", () => {
    const request = new Request("https://share.example/", { headers: { "X-Forwarded-For": "192.0.2.1", "CF-Ray": "abc" } });
    expect(cloudflareClient(request)).toMatchObject({ ip: null, ray: "abc", country: null });
  });
});
