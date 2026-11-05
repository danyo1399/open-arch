/**
 * The share server's HTTP API. The designer encrypts a workspace in the browser and uploads the
 * result; the key stays in the link's #fragment, which browsers never send, so the server only
 * ever has files it can't read. Uploads are anonymous: whoever creates a workspace gets a token
 * that lets them change or delete it, and nobody else can.
 *
 *   POST   /v1/workspaces              upload a new workspace          → 201 { id, hash, token }
 *   PUT    /v1/workspaces/:id          upload a new version (token)    → 200 { id, hash }
 *   DELETE /v1/workspaces/:id          stop sharing it (token)         → 204
 *   GET    /v1/workspaces/:id          its latest version              → 200 { id, hash, updated }
 *   GET    /v1/workspaces/:id/:hash    one version's encrypted file    → 200 bytes
 *
 * A version's file never changes, as its hash is the hash of its bytes, so browsers and proxies
 * can cache it for good. Only the small answer naming the latest version is checked each time.
 *
 * Every upload is kept with what the request said about who sent it (handler's `client`), so
 * abuse can be found and taken down, and uploads from one address are limited per hour.
 */
import type { Client, ShareStore, Upload } from "./store.js";

export interface ServerOptions {
  store: ShareStore;
  /** Who sent this request. Worked out by the host (cloudflare.ts or node.ts), not from headers anyone can set. */
  client: Client;
  /** Milliseconds since the epoch. */
  now?: number;
  /** The largest encrypted file accepted, in bytes. */
  maxBytes?: number;
  /** How many files one IP address can upload in an hour. */
  uploadsPerHour?: number;
}

export const DEFAULT_MAX_BYTES = 1_000_000;
export const DEFAULT_UPLOADS_PER_HOUR = 60;

/** The first byte of every file the designer uploads: the version of its format (see apps/web/src/share.ts). */
export const FILE_FORMAT = 1;
/** The format byte, AES-GCM's 12-byte IV and its 16-byte tag: the smallest file there can be. */
const MIN_BYTES = 1 + 12 + 16;

const HOUR = 60 * 60 * 1000;
const IMMUTABLE = "public, max-age=31536000, immutable";

const ID = /^[A-Za-z0-9_-]{16}$/;
const HASH = /^[A-Za-z0-9_-]{22}$/;

const CORS = {
  // The designer runs on any host, and from file:// in the desktop app. Nothing here relies on cookies.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag",
};

function respond(status: number, body: ConstructorParameters<typeof Response>[0], headers: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...CORS, ...headers } });
}

function json(status: number, value: unknown, cache = "no-store", extra: Record<string, string> = {}): Response {
  return respond(status, JSON.stringify(value), { "Content-Type": "application/json", "Cache-Control": cache, ...extra });
}

const fail = (status: number, error: string, extra: Record<string, string> = {}) => json(status, { error }, "no-store", extra);

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const random = (length: number) => base64url(crypto.getRandomValues(new Uint8Array(length)));

async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

/** A file's hash: the first 128 bits of its SHA-256, which names it in its URL. */
export async function fileHash(file: Uint8Array): Promise<string> {
  return base64url((await sha256(file)).slice(0, 16));
}

export const tokenHash = async (token: string) => base64url(await sha256(token));

/** Whether the request's If-None-Match names this ETag, so the copy the browser has is still right. */
function notModified(request: Request, etag: string): boolean {
  const header = request.headers.get("If-None-Match");
  return !!header && header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

/** Answers a request. A failure of the store still answers, with the headers the browser needs to read why. */
export async function handle(request: Request, options: ServerOptions): Promise<Response> {
  try {
    return await route(request, options);
  } catch (error) {
    console.error(error);
    return fail(500, "The share server failed. Try again later.");
  }
}

async function route(request: Request, options: ServerOptions): Promise<Response> {
  const { store, client } = options;
  const now = options.now ?? Date.now();
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "OPTIONS") {
    return respond(204, null, {
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  }

  if (parts.length === 0 && (method === "GET" || method === "HEAD")) {
    return respond(200, method === "HEAD" ? null : "open-arch share server: it keeps workspaces shared from the designer, encrypted.\n", {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });
  }

  if (parts[0] !== "v1" || parts[1] !== "workspaces" || parts.length > 4) return fail(404, "There's nothing here.");
  const [, , id, hash] = parts;
  if (id !== undefined && !ID.test(id)) return fail(404, "There's no shared workspace with that ID.");
  if (hash !== undefined && !HASH.test(hash)) return fail(404, "There's no version of this workspace with that hash.");

  const allowed = id === undefined ? ["POST"] : hash === undefined ? ["GET", "HEAD", "PUT", "DELETE"] : ["GET", "HEAD"];
  if (!allowed.includes(method)) return fail(405, `Use ${allowed.join(" or ")} here.`, { Allow: [...allowed, "OPTIONS"].join(", ") });

  /** Reads an upload, and checks it's a file the designer could have made and its sender may upload now. */
  const readUpload = async (): Promise<Uint8Array | Response> => {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes) return fail(413, `A shared workspace can be at most ${maxBytes} bytes, encrypted.`);
    if (client.ip && (await store.ipBlocked(client.ip))) return fail(403, "Uploads from this address are blocked.");
    const limit = options.uploadsPerHour ?? DEFAULT_UPLOADS_PER_HOUR;
    if (client.ip && (await store.uploadsSince(client.ip, now - HOUR)) >= limit) {
      return fail(429, `Too many uploads from this address: at most ${limit} an hour. Try again later.`, { "Retry-After": "3600" });
    }
    const file = new Uint8Array(await request.arrayBuffer());
    if (file.length > maxBytes) return fail(413, `A shared workspace can be at most ${maxBytes} bytes, encrypted.`);
    if (file.length < MIN_BYTES || file[0] !== FILE_FORMAT) return fail(400, "That isn't a workspace encrypted by open-arch.");
    return file;
  };

  const upload = async (workspace: string, file: Uint8Array, action: Upload["action"]): Promise<Upload> => ({
    ...client,
    workspace,
    hash: await fileHash(file),
    action,
    size: file.length,
    at: now,
  });

  if (id === undefined) {
    const file = await readUpload();
    if (file instanceof Response) return file;
    const newId = random(12);
    const token = random(32);
    const record = await upload(newId, file, "create");
    await store.create({ id: newId, tokenHash: await tokenHash(token), latest: record.hash, created: now, updated: now, deleted: null, blocked: null }, file, record);
    return json(201, { id: newId, hash: record.hash, token });
  }

  const workspace = await store.workspace(id);
  if (!workspace) return fail(404, "There's no shared workspace with that ID.");
  if (workspace.blocked !== null) return fail(410, "This shared workspace was taken down.");
  if (workspace.deleted !== null) return fail(410, "This workspace isn't shared any more: whoever shared it stopped sharing it.");

  if (method === "PUT" || method === "DELETE") {
    const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) return fail(401, "Only whoever shared this workspace can change it, with the token they were given.");
    if ((await tokenHash(token)) !== workspace.tokenHash) return fail(403, "Only whoever shared this workspace can change it.");
    if (method === "DELETE") {
      await store.remove(id, now);
      return respond(204, null, { "Cache-Control": "no-store" });
    }
    const file = await readUpload();
    if (file instanceof Response) return file;
    const record = await upload(id, file, "update");
    await store.update(id, file, record);
    return json(200, { id, hash: record.hash });
  }

  if (hash === undefined) {
    // Small, and checked each time: the browser keeps it, and asks whether it's still right.
    const etag = `"${workspace.latest}"`;
    if (notModified(request, etag)) return respond(304, null, { ETag: etag, "Cache-Control": "no-cache" });
    const body = JSON.stringify({ id, hash: workspace.latest, updated: workspace.updated });
    return respond(200, method === "HEAD" ? null : body, { "Content-Type": "application/json", "Cache-Control": "no-cache", ETag: etag });
  }

  const etag = `"${hash}"`;
  if (notModified(request, etag)) return respond(304, null, { ETag: etag, "Cache-Control": IMMUTABLE });
  const file = await store.file(id, hash);
  if (!file) return fail(404, "There's no version of this workspace with that hash.");
  return respond(200, method === "HEAD" ? null : (file as Uint8Array<ArrayBuffer>), {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(file.length),
    "Cache-Control": IMMUTABLE,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
}
