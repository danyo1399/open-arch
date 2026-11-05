import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listUploads, setBlocked, setIpBlocked } from "../src/admin.js";
import { readInvocation } from "../src/config.js";
import { diskBucket } from "../src/disk.js";
import { FILE_FORMAT } from "../src/handler.js";
import { nodeClient, startServer, type TrustProxy } from "../src/node.js";
import { SqlStore } from "../src/sql.js";
import { migrate, openDatabase } from "../src/sqlite.js";

const folders: string[] = [];
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function dataFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "open-arch-share-"));
  folders.push(folder);
  return folder;
}

/** The server as main.ts starts it, on a free port, keeping its data in `folder`. */
async function serve(folder: string, options: { maxBytes?: number; trustProxy?: TrustProxy } = {}) {
  const { sqlite, db } = openDatabase(join(folder, "shares.db"));
  const store = new SqlStore(diskBucket(join(folder, "files")), db);
  const running = await startServer({ store, port: 0, host: "127.0.0.1", maxBytes: options.maxBytes ?? 1000, uploadsPerHour: 60, trustProxy: options.trustProxy ?? "none" });
  const stop = async () => {
    await running.close();
    sqlite.close();
  };
  stops.push(stop);
  return { ...running, db, sqlite, stop };
}

const file = (fill: number, length = 48) => {
  const bytes = new Uint8Array(length).fill(fill);
  bytes[0] = FILE_FORMAT;
  return bytes;
};

describe("share server on Node", () => {
  it("keeps shared workspaces in its data folder, through a restart", async () => {
    const folder = dataFolder();
    let server = await serve(folder);
    const created = await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: file(1) });
    expect(created.status).toBe(201);
    const { id, hash } = (await created.json()) as { id: string; hash: string };
    expect(readdirSync(join(folder, "files", "workspaces", id))).toEqual([hash]);
    await server.stop();
    stops.pop();

    server = await serve(folder);
    const latest = await fetch(`${server.url}/v1/workspaces/${id}`);
    expect(await latest.json()).toMatchObject({ id, hash });
    const got = await fetch(`${server.url}/v1/workspaces/${id}/${hash}`);
    expect(got.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(file(1));
    expect(server.sqlite.prepare("SELECT workspace_id, action, size, ip FROM uploads").all()).toEqual([{ workspace_id: id, action: "create", size: 48, ip: "127.0.0.1" }]);
  });

  it("deletes a workspace's files, and its folder, when sharing stops", async () => {
    const folder = dataFolder();
    const server = await serve(folder);
    const { id, token } = (await (await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: file(1) })).json()) as { id: string; token: string };
    await fetch(`${server.url}/v1/workspaces/${id}`, { method: "PUT", body: file(2), headers: { Authorization: `Bearer ${token}` } });
    expect(readdirSync(join(folder, "files", "workspaces", id))).toHaveLength(2);
    expect((await fetch(`${server.url}/v1/workspaces/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })).status).toBe(204);
    expect(readdirSync(join(folder, "files", "workspaces"))).toEqual([]);
  });

  it("refuses a body that's too big without reading all of it", async () => {
    const server = await serve(dataFolder(), { maxBytes: 100 });
    // Sent in pieces, with no Content-Length to give it away.
    const chunks = Array.from({ length: 50 }, (_, i) => file(i, 1000));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    const response = await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
  });

  it("brings an older database's schema up to date, once", () => {
    const { sqlite } = openDatabase(":memory:");
    expect(migrate(sqlite)).toEqual([]);
    expect(sqlite.prepare("SELECT name FROM schema_migrations").all()).toEqual([{ name: "0001_shared_workspaces.sql" }]);
  });

  it("believes a proxy's headers about who sent a request only when told there's one", () => {
    const req = (headers: Record<string, string>, remoteAddress = "::ffff:10.0.0.5") => ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;
    const headers = { "x-forwarded-for": "198.51.100.9, 203.0.113.7", "cf-connecting-ip": "192.0.2.4", "cf-ipcountry": "NZ", "cf-ray": "ray", "user-agent": "agent" };
    expect(nodeClient(req(headers), "none")).toMatchObject({ ip: "10.0.0.5", country: null, ray: null, userAgent: "agent" });
    // The last address is the one the proxy saw; the earlier ones are whatever the client said.
    expect(nodeClient(req(headers), "forwarded")).toMatchObject({ ip: "203.0.113.7", country: null });
    expect(nodeClient(req(headers), "cloudflare")).toMatchObject({ ip: "192.0.2.4", country: "NZ", ray: "ray" });
    expect(nodeClient(req({}), "forwarded").ip).toBe("10.0.0.5");
  });

  it("finds a workspace's uploads, takes it down, and blocks an address", async () => {
    const server = await serve(dataFolder());
    const { id, hash } = (await (await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: file(1), headers: { "User-Agent": "spammer" } })).json()) as { id: string; hash: string };
    expect(await listUploads(server.db, { workspace: id }, 10)).toEqual([
      { at: expect.any(String), workspace: id, action: "create", size: 48, ip: "127.0.0.1", country: null, network: null, userAgent: "spammer", origin: null },
    ]);
    expect(await listUploads(server.db, { ip: "127.0.0.1" }, 10)).toHaveLength(1);

    expect(await setBlocked(server.db, id, "spam")).toBe(true);
    expect((await fetch(`${server.url}/v1/workspaces/${id}/${hash}`)).status).toBe(410);
    expect(await setBlocked(server.db, id, null)).toBe(true);
    expect((await fetch(`${server.url}/v1/workspaces/${id}/${hash}`)).status).toBe(200);
    expect(await setBlocked(server.db, "AAAAAAAAAAAAAAAA", "spam")).toBe(false);

    await setIpBlocked(server.db, "127.0.0.1", "spam");
    expect((await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: file(2) })).status).toBe(403);
    await setIpBlocked(server.db, "127.0.0.1", null);
    expect((await fetch(`${server.url}/v1/workspaces`, { method: "POST", body: file(2) })).status).toBe(201);
  });
});

describe("share server's command line", () => {
  it("takes settings from flags, then the environment, then defaults", () => {
    expect(readInvocation([], {}).config).toEqual({ port: 8787, host: undefined, data: "./data", maxBytes: 1_000_000, uploadsPerHour: 60, trustProxy: "none", log: true });
    const env = { PORT: "9000", HOST: "127.0.0.1", DATA_DIR: "/data", TRUST_PROXY: "forwarded", MAX_BYTES: "500", UPLOADS_PER_HOUR: "5", LOG: "off" };
    expect(readInvocation([], env).config).toEqual({ port: 9000, host: "127.0.0.1", data: "/data", maxBytes: 500, uploadsPerHour: 5, trustProxy: "forwarded", log: false });
    expect(readInvocation(["--port", "9100", "--memory", "--trust-proxy", "cloudflare"], env).config).toMatchObject({ port: 9100, data: null, trustProxy: "cloudflare" });
    expect(readInvocation([], { DATA_DIR: ":memory:" }).config.data).toBeNull();
  });

  it("reads the abuse commands", () => {
    expect(readInvocation(["block", "abcdefghijklmnop", "--reason", "spam"], {})).toMatchObject({ command: "block", target: "abcdefghijklmnop", reason: "spam" });
    expect(readInvocation(["uploads", "--ip", "192.0.2.1", "--limit", "5"], {})).toMatchObject({ command: "uploads", ip: "192.0.2.1", limit: 5 });
  });

  it("says what's wrong with a command line", () => {
    expect(() => readInvocation(["--port", "http"], {})).toThrow('The port must be a whole number, not "http".');
    expect(() => readInvocation([], { TRUST_PROXY: "yes" })).toThrow('The trusted proxy must be none, forwarded, cloudflare, not "yes".');
    expect(() => readInvocation(["block", "abcdefghijklmnop"], {})).toThrow("Say why, with --reason");
    expect(() => readInvocation(["uploads"], {})).toThrow("Say whose uploads to list");
    expect(() => readInvocation(["block-ip", "--memory"], {})).toThrow("block-ip needs the data folder");
    expect(() => readInvocation(["serve", "--colour"], {})).toThrow("Unknown option '--colour'");
  });
});
