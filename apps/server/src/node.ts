/**
 * The share server on Node's HTTP server, with any store: SQLite and a folder on disk, or
 * memory. main.ts starts it from the terminal, or in a container.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { handle } from "./handler.js";
import type { Client, ShareStore } from "./store.js";

/**
 * Which proxy in front of the server to believe about who sent a request. "none": nothing
 * in front, so the connection's address. "forwarded": a reverse proxy (Caddy, nginx, a
 * platform's load balancer) that adds the address it saw to X-Forwarded-For. "cloudflare":
 * Cloudflare's proxy, which sets CF-Connecting-IP, CF-IPCountry and CF-Ray. Headers are only
 * believed when there's a proxy that sets them: otherwise anyone could choose their address.
 */
export type TrustProxy = "none" | "forwarded" | "cloudflare";
export const TRUST_PROXY: TrustProxy[] = ["none", "forwarded", "cloudflare"];

export interface NodeServerOptions {
  store: ShareStore;
  port: number;
  /** All interfaces when unset. */
  host?: string;
  maxBytes: number;
  uploadsPerHour: number;
  trustProxy: TrustProxy;
  /** Each request answered, as a line. */
  log?(line: string): void;
}

/** An IPv4 address the way IPv6 sockets report it ("::ffff:203.0.113.7"), as plain IPv4. */
const plainIp = (ip: string | undefined | null) => (ip ? ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1") : null);

/** Who sent a request, as far as the server can tell. */
export function nodeClient(req: IncomingMessage, trust: TrustProxy): Client {
  const header = (name: string) => {
    const value = req.headers[name.toLowerCase()];
    return (Array.isArray(value) ? value.join(", ") : value)?.trim() || null;
  };
  let ip = plainIp(req.socket.remoteAddress);
  // The proxy appends the address it saw, so the last one is the only one it vouches for.
  if (trust === "forwarded") ip = plainIp(header("X-Forwarded-For")?.split(",").pop()?.trim()) ?? ip;
  if (trust === "cloudflare") ip = header("CF-Connecting-IP") ?? ip;
  const country = trust === "cloudflare" ? header("CF-IPCountry") : null;
  return {
    ip,
    country: country === "XX" ? null : country,
    city: null,
    asn: null,
    asOrganization: null,
    userAgent: header("User-Agent"),
    origin: header("Origin"),
    referer: header("Referer"),
    ray: trust === "cloudflare" ? header("CF-Ray") : null,
  };
}

/**
 * A request's body, but no more than `limit` bytes of it: past that, the handler refuses it
 * anyway. The rest is left unread, with the request paused rather than destroyed, so the answer
 * can still go back on its connection.
 */
function body(req: IncomingMessage, limit: number): Promise<{ bytes: Uint8Array; whole: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (whole: boolean) => {
      req.off("data", onData).off("end", onEnd).off("error", reject);
      resolve({ bytes: Buffer.concat(chunks).subarray(0, limit), whole });
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limit) {
        req.pause();
        finish(false);
      }
    };
    const onEnd = () => finish(true);
    req.on("data", onData).on("end", onEnd).on("error", reject);
  });
}

async function answer(req: IncomingMessage, res: ServerResponse, options: NodeServerOptions, origin: string, client: Client): Promise<number> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  // One byte over the limit is enough for the handler to know it's too big.
  const read = hasBody ? await body(req, options.maxBytes + 1) : null;
  const request = new Request(origin + (req.url ?? "/"), { method: req.method, headers, body: read?.bytes as Uint8Array<ArrayBuffer> | undefined });
  const response = await handle(request, { store: options.store, client, maxBytes: options.maxBytes, uploadsPerHour: options.uploadsPerHour });
  const out = Object.fromEntries(response.headers);
  // The rest of a body too big to read is never read, so this connection can't carry another request.
  if (read && !read.whole) out.connection = "close";
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
  return response.status;
}

/** Starts the server. Resolves once it's listening, with its address and a way to stop it. */
export function startServer(options: NodeServerOptions): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  let origin = "http://localhost";
  const server = createServer((req, res) => {
    const client = nodeClient(req, options.trustProxy);
    answer(req, res, options, origin, client)
      // Health checks ask for / every few seconds; a line for each would bury the rest.
      .then((status) => req.url !== "/" && options.log?.(`${new Date().toISOString()} ${status} ${req.method} ${req.url} ${client.ip ?? "-"}`))
      .catch((error: Error) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
        res.end("The share server failed.");
      });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      const { port } = server.address() as AddressInfo;
      origin = `http://localhost:${port}`;
      resolve({
        server,
        url: origin,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            // Keep-alive connections that aren't in the middle of a request don't hold it open.
            server.closeIdleConnections();
          }),
      });
    });
  });
}
