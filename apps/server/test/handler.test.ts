import { beforeEach, describe, expect, it } from "vitest";
import { FILE_FORMAT, fileHash, handle, type ServerOptions } from "../src/handler.js";
import { MemoryStore, type Client } from "../src/store.js";

const client: Client = {
  ip: "203.0.113.7",
  country: "NZ",
  city: "Wellington",
  asn: 64500,
  asOrganization: "Example Net",
  userAgent: "test-agent",
  origin: "https://designer.example",
  referer: null,
  ray: "ray-1",
};

let store: MemoryStore;
let now: number;

beforeEach(() => {
  store = new MemoryStore();
  now = 1_000_000;
});

/** A file shaped like the designer's: the format byte, then bytes standing in for the IV, ciphertext and tag. */
const file = (fill = 7, length = 64) => {
  const bytes = new Uint8Array(length).fill(fill);
  bytes[0] = FILE_FORMAT;
  return bytes;
};

function send(method: string, path: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}, options: Partial<ServerOptions> = {}) {
  const request = new Request(`https://share.example${path}`, { method, body: init.body as Uint8Array<ArrayBuffer> | undefined, headers: init.headers });
  return handle(request, { store, client, now, ...options });
}

async function create(body = file()) {
  const response = await send("POST", "/v1/workspaces", { body });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; hash: string; token: string };
}

describe("share server", () => {
  it("names a new workspace and its version, and gives the uploader a token", async () => {
    const body = file();
    const { id, hash, token } = await create(body);
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(hash).toBe(await fileHash(body));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the token's hash is kept.
    expect(JSON.stringify([...store.workspaces.values()])).not.toContain(token);
  });

  it("serves a version's file for browsers and proxies to cache for good", async () => {
    const body = file();
    const { id, hash } = await create(body);
    const response = await send("GET", `/v1/workspaces/${id}/${hash}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("ETag")).toBe(`"${hash}"`);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const again = await send("GET", `/v1/workspaces/${id}/${hash}`, { headers: { "If-None-Match": `"${hash}"` } });
    expect(again.status).toBe(304);
  });

  it("names the latest version, checked each time", async () => {
    const { id, hash, token } = await create();
    const latest = await send("GET", `/v1/workspaces/${id}`);
    expect(await latest.json()).toEqual({ id, hash, updated: now });
    expect(latest.headers.get("Cache-Control")).toBe("no-cache");
    expect((await send("GET", `/v1/workspaces/${id}`, { headers: { "If-None-Match": `"${hash}"` } })).status).toBe(304);

    now += 10;
    const update = await send("PUT", `/v1/workspaces/${id}`, { body: file(8), headers: { Authorization: `Bearer ${token}` } });
    expect(update.status).toBe(200);
    const next = ((await update.json()) as { hash: string }).hash;
    expect(next).not.toBe(hash);
    // The browser's copy names the old version, so it gets the new one.
    const changed = await send("GET", `/v1/workspaces/${id}`, { headers: { "If-None-Match": `"${hash}"` } });
    expect(await changed.json()).toEqual({ id, hash: next, updated: now });
    // A link to the old version still opens it: its URL's content never changes.
    expect((await send("GET", `/v1/workspaces/${id}/${hash}`)).status).toBe(200);
  });

  it("lets only the token's holder change or delete a workspace", async () => {
    const { id, hash, token } = await create();
    expect((await send("PUT", `/v1/workspaces/${id}`, { body: file(8) })).status).toBe(401);
    expect((await send("PUT", `/v1/workspaces/${id}`, { body: file(8), headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
    expect((await send("DELETE", `/v1/workspaces/${id}`, { headers: { Authorization: "Bearer wrong" } })).status).toBe(403);
    expect(store.workspaces.get(id)?.latest).toBe(hash);

    expect((await send("DELETE", `/v1/workspaces/${id}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(204);
    expect(store.files.size).toBe(0);
    const gone = await send("GET", `/v1/workspaces/${id}/${hash}`);
    expect(gone.status).toBe(410);
    expect(gone.headers.get("Cache-Control")).toBe("no-store");
    expect((await send("GET", `/v1/workspaces/${id}`)).status).toBe(410);
    expect((await send("PUT", `/v1/workspaces/${id}`, { body: file(8), headers: { Authorization: `Bearer ${token}` } })).status).toBe(410);
  });

  it("keeps who sent every upload, to find abuse", async () => {
    const { id, hash, token } = await create(file(1, 40));
    now += 5;
    await send("PUT", `/v1/workspaces/${id}`, { body: file(2, 50), headers: { Authorization: `Bearer ${token}` } });
    expect(store.uploads).toEqual([
      { ...client, workspace: id, hash, action: "create", size: 40, at: 1_000_000 },
      { ...client, workspace: id, hash: await fileHash(file(2, 50)), action: "update", size: 50, at: 1_000_005 },
    ]);
  });

  it("stops serving a workspace taken down for abuse", async () => {
    const { id, hash } = await create();
    store.workspaces.get(id)!.blocked = now;
    const response = await send("GET", `/v1/workspaces/${id}/${hash}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "This shared workspace was taken down." });
    // Even to a browser that has it, rather than telling it its copy is still good.
    expect((await send("GET", `/v1/workspaces/${id}/${hash}`, { headers: { "If-None-Match": `"${hash}"` } })).status).toBe(410);
  });

  it("refuses uploads from a blocked address, and too many from one", async () => {
    store.blockedIps.add(client.ip!);
    expect((await send("POST", "/v1/workspaces", { body: file() })).status).toBe(403);
    store.blockedIps.clear();

    for (let i = 0; i < 3; i++) await create();
    const limited = await send("POST", "/v1/workspaces", { body: file() }, { uploadsPerHour: 3 });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    // Another address, or the same one an hour later, can.
    expect((await send("POST", "/v1/workspaces", { body: file() }, { uploadsPerHour: 3, client: { ...client, ip: "198.51.100.1" } })).status).toBe(201);
    now += 60 * 60 * 1000 + 1;
    expect((await send("POST", "/v1/workspaces", { body: file() }, { uploadsPerHour: 3 })).status).toBe(201);
  });

  it("refuses files that are too big, or that open-arch didn't encrypt", async () => {
    expect((await send("POST", "/v1/workspaces", { body: file(7, 101) }, { maxBytes: 100 })).status).toBe(413);
    expect((await send("POST", "/v1/workspaces", { body: new TextEncoder().encode('{"openarch": 9, "name": "plain"}') })).status).toBe(400);
    expect((await send("POST", "/v1/workspaces", { body: file(7, 10) })).status).toBe(400);
    expect(store.workspaces.size).toBe(0);
  });

  it("answers what browsers ask before a cross-origin upload", async () => {
    const response = await send("OPTIONS", "/v1/workspaces/abcdefghijklmnop");
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
  });

  it("says when it failed, in an answer the browser can read", async () => {
    store.workspace = async () => {
      throw new Error("D1 is down");
    };
    const original = console.error;
    console.error = () => undefined;
    try {
      const response = await send("GET", "/v1/workspaces/abcdefghijklmnop");
      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await response.json()).toEqual({ error: "The share server failed. Try again later." });
    } finally {
      console.error = original;
    }
  });

  it("says what's wrong with a request it can't answer", async () => {
    expect((await send("GET", "/v1/workspaces/abcdefghijklmnop")).status).toBe(404);
    expect((await send("GET", "/v1/workspaces/not-an-id")).status).toBe(404);
    expect((await send("GET", "/elsewhere")).status).toBe(404);
    const { id } = await create();
    expect((await send("GET", `/v1/workspaces/${id}/AAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
    const wrongMethod = await send("POST", `/v1/workspaces/${id}`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("Allow")).toBe("GET, HEAD, PUT, DELETE, OPTIONS");
  });
});
