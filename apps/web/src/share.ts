/**
 * Sharing a workspace as a link, through the share server (apps/server). The browser compresses
 * the workspace and encrypts it with a new random key before uploading it, and the key goes in the
 * link's #fragment, which browsers never send to a server. So the server only has a file it can't
 * read, and whoever has the link can open it.
 *
 *   https://<designer>/?share=<workspace ID>&v=<version's hash>#key=<key>
 *
 * The workspace ID names what was shared, and the hash names the version: a new version gets a new
 * hash, so its URL is new, and each version's file can be cached for good. Opening a link opens the
 * latest version: whoever shared it can update it, and links they already sent show the change.
 *
 * Whoever shares a workspace gets a token from the server that lets them update it or stop sharing
 * it. It's kept in their settings (settings.ts), with the key, and never goes in the link.
 *
 * The file uploaded: one byte for the format (1), AES-GCM's 12-byte IV, then the ciphertext of
 * the workspace compressed with DEFLATE: {"name": <file name>, "text": <the .openarch text>}.
 */
import { FILE_EXTENSION } from "@open-arch/core";
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

/** What's shared: the workspace's .openarch text, and its file name. */
export interface SharedFile {
  name: string;
  text: string;
}

/** What a link names: the workspace, the version, and the key that decrypts it. */
export interface LinkParts {
  id: string;
  hash: string;
  key: string;
}

/** What whoever shared a workspace keeps, to update it or stop sharing it. */
export interface Share extends LinkParts {
  token: string;
  /** When it was last uploaded, in milliseconds since the epoch. */
  updated: number;
}

const FORMAT = 1;
const IV_BYTES = 12;
const ID = /^[A-Za-z0-9_-]{22}$/;
const HASH = /^[A-Za-z0-9_-]{22}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

/** The share server this build of the designer uses, from VITE_SHARE_SERVER when it was built. Without one, it can't share. */
export const shareServer: string | undefined = import.meta.env.VITE_SHARE_SERVER || undefined;

/** Where links made in the desktop app open: the web designer, from VITE_SHARE_APP_URL when it was built. */
export const PUBLIC_DESIGNER: string = import.meta.env.VITE_SHARE_APP_URL || "https://danyo1399.github.io/open-arch/";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The query and fragment that name a shared workspace, to put after the designer's address. */
export const linkSuffix = ({ id, hash, key }: LinkParts) => `?share=${id}&v=${hash}#key=${key}`;

/** A link that opens a shared workspace in the designer at `designer`. */
export const linkTo = (designer: string, parts: LinkParts) => designer.replace(/[?#].*$/, "") + linkSuffix(parts);

/** What a share link names, or null if it isn't one. */
export function readLink(link: string): LinkParts | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const id = url.searchParams.get("share") ?? "";
  const hash = url.searchParams.get("v") ?? "";
  const key = new URLSearchParams(url.hash.slice(1)).get("key") ?? "";
  return ID.test(id) && HASH.test(hash) && KEY.test(key) ? { id, hash, key } : null;
}

/** Web Crypto, which browsers only offer on a secure page: HTTPS, localhost, or the desktop app. */
function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) throw new Error("Sharing needs the designer opened over HTTPS, so the browser can encrypt.");
  return globalThis.crypto.subtle;
}

const aesKey = (key: string, use: KeyUsage) => subtle().importKey("raw", fromBase64url(key), "AES-GCM", false, [use]);

/** A new random 256-bit key. */
export const newKey = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** Compresses and encrypts a workspace, for uploading. */
export async function seal(file: SharedFile, key: string): Promise<Uint8Array> {
  const plain = deflateSync(strToU8(JSON.stringify({ name: file.name, text: file.text })), { level: 9 });
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, await aesKey(key, "encrypt"), plain));
  const out = new Uint8Array(1 + IV_BYTES + cipher.length);
  out[0] = FORMAT;
  out.set(iv, 1);
  out.set(cipher, 1 + IV_BYTES);
  return out;
}

/** Decrypts and decompresses what `seal` made. */
export async function unseal(bytes: Uint8Array, key: string): Promise<SharedFile> {
  if (bytes[0] !== FORMAT) throw new Error("This shared workspace was made by a newer version of open-arch. Update it, then open the link again.");
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: bytes.slice(1, 1 + IV_BYTES) }, await aesKey(key, "decrypt"), bytes.slice(1 + IV_BYTES));
  } catch {
    throw new Error("The link's key doesn't open this workspace. Check that all of the link was copied, with the part after the #.");
  }
  const value: unknown = JSON.parse(strFromU8(inflateSync(new Uint8Array(plain))));
  const { name, text } = (value ?? {}) as Partial<SharedFile>;
  if (typeof text !== "string") throw new Error("This shared workspace has no .openarch file in it.");
  // The name comes from whoever shared it: only its last part, and always a .openarch file.
  const base = typeof name === "string" ? (name.split(/[\\/]/).pop() ?? "").trim() : "";
  return { name: base.endsWith(FILE_EXTENSION) ? base : `${base || "shared"}${FILE_EXTENSION}`, text };
}

/** A request the share server refused, with its reason. */
export class ShareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** What the share server says went wrong, for the answers it marks, such as "no-workspace". */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** What went wrong: "Couldn't <doing>: <reason>", or the reason alone when what was being done is said elsewhere. */
const failed = (doing: string | null, reason: string) => (doing ? `Couldn't ${doing}: ${reason}` : reason.charAt(0).toUpperCase() + reason.slice(1));

/** The share server's reason a request failed, or one made up from its status. */
async function problem(response: Response, doing: string | null): Promise<ShareError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const reason = typeof body?.error === "string" ? body.error : `the share server answered ${response.status}.`;
  return new ShareError(failed(doing, reason), response.status, typeof body?.code === "string" ? body.code : undefined);
}

/** Talks to a share server. */
export class ShareClient {
  private readonly base: string;

  constructor(
    server: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.base = `${server.replace(/\/+$/, "")}/v1/workspaces`;
  }

  private async send(path: string, init: RequestInit, doing: string | null): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(this.base + path, init);
    } catch {
      throw new Error(failed(doing, "the share server didn't answer. Check you're online."));
    }
    if (!response.ok) throw await problem(response, doing);
    return response;
  }

  /** Shares a workspace: encrypts it with a new key, and uploads it. */
  async create(file: SharedFile, now = Date.now()): Promise<Share> {
    const key = newKey();
    const body = await seal(file, key);
    const response = await this.send("", { method: "POST", body: body as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream" } }, "share it");
    const { id, hash, token } = (await response.json()) as { id: string; hash: string; token: string };
    return { id, hash, token, key, updated: now };
  }

  /** Uploads a new version of a shared workspace, with the same key. */
  async update(share: Share, file: SharedFile, now = Date.now()): Promise<Share> {
    const body = await seal(file, share.key);
    const response = await this.send(
      `/${share.id}`,
      { method: "PUT", body: body as Uint8Array<ArrayBuffer>, headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${share.token}` } },
      "update the link",
    );
    const { hash } = (await response.json()) as { hash: string };
    return { ...share, hash, updated: now };
  }

  /** Stops sharing a workspace: the server deletes it, and its links stop working. */
  async remove(share: Share): Promise<void> {
    try {
      await this.send(`/${share.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${share.token}` } }, "stop sharing it");
    } catch (error) {
      // Already deleted, taken down, or gone from the server, as from one kept in memory that
      // restarted: whichever, it isn't shared, and there's nothing left to stop. Only the share
      // server's own "no workspace" counts as gone: any other 404, such as a wrong address or a
      // proxy's, says nothing about it, and forgetting the token then would leave it shared for good.
      const gone = error instanceof ShareError && (error.status === 410 || (error.status === 404 && error.code === "no-workspace"));
      if (!gone) throw error;
    }
  }

  /**
   * Opens the latest version of a shared workspace, and says which that is. A link to an earlier
   * version opens the latest: the server deletes a version once there's a newer one, and sends a
   * request for it on to the latest. If the server can't say which version is the latest, as
   * offline, it asks for the link's version: a browser that cached it opens that, and the server
   * sends it on. Its errors give the reason alone, as the designer says it couldn't open the
   * workspace.
   */
  async open(link: LinkParts): Promise<SharedFile & { hash: string }> {
    let hash = link.hash;
    let latest: Response | null = null;
    try {
      latest = await this.fetcher(`${this.base}/${link.id}`);
    } catch {
      latest = null;
    }
    if (latest?.ok) hash = ((await latest.json()) as { hash: string }).hash;
    else if (latest && (latest.status === 404 || latest.status === 410)) throw await problem(latest, null);
    const response = await this.send(`/${link.id}/${hash}`, {}, null);
    // Where a redirect led, if one did.
    const opened = response.url.split("/").pop() ?? "";
    const file = await unseal(new Uint8Array(await response.arrayBuffer()), link.key);
    return { ...file, hash: HASH.test(opened) ? opened : hash };
  }
}

/** The client for this build's share server, or null when it has none. */
export const shareClient: ShareClient | null = shareServer ? new ShareClient(shareServer) : null;
