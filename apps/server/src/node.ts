/**
 * The share server on Node, with everything in memory: for trying sharing in the designer
 * locally. Stopping it forgets every shared workspace.
 *
 *   pnpm --filter @open-arch/server dev
 *
 * It listens on http://localhost:8787, or the port in PORT.
 */
import { createServer, type IncomingMessage } from "node:http";
import { handle } from "./handler.js";
import { MemoryStore, type Client } from "./store.js";

const store = new MemoryStore();
const port = Number(process.env.PORT ?? 8787);

function client(req: IncomingMessage): Client {
  const header = (name: string) => (typeof req.headers[name] === "string" ? (req.headers[name] as string) : null);
  return {
    ip: req.socket.remoteAddress ?? null,
    country: null,
    city: null,
    asn: null,
    asOrganization: null,
    userAgent: header("user-agent"),
    origin: header("origin"),
    referer: header("referer"),
    ray: null,
  };
}

async function body(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

createServer((req, res) => {
  void (async () => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
    const request = new Request(`http://localhost:${port}${req.url ?? "/"}`, { method: req.method, headers, body: await body(req) });
    const response = await handle(request, { store, client: client(req) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  })().catch((error: Error) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("The share server failed.");
  });
}).listen(port, () => {
  console.log(`Share server on http://localhost:${port}, keeping shared workspaces in memory.`);
  console.log(`Run the designer with VITE_SHARE_SERVER=http://localhost:${port} to share to it.`);
});
