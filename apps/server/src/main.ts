#!/usr/bin/env node
/**
 * The share server from the terminal, or as a container's command (Dockerfile):
 *
 *   node dist/main.js                 serve, keeping records and files in ./data
 *   node dist/main.js --memory        serve, keeping them in memory, for trying it out
 *   node dist/main.js block <id> …    take a shared workspace down
 *
 * `node dist/main.js help` lists the rest. Records are kept in SQLite (data/shares.db) and
 * each version's encrypted file in data/files/.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { HELP, readInvocation, UsageError, type Invocation } from "./config.js";
import { MemoryStore, type ShareStore } from "./store.js";

// node:sqlite still calls itself experimental in Node 22, and says so on every start. Other warnings still show.
const [showWarning] = process.listeners("warning");
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (warning.name === "ExperimentalWarning" && /SQLite/.test(warning.message)) return;
  showWarning?.(warning);
});

/** The database and the files, in the data folder. node:sqlite is loaded only when it's needed, to say clearly if this Node is too old for it. */
async function openData(folder: string) {
  let sqlite: typeof import("./sqlite.js");
  try {
    sqlite = await import("./sqlite.js");
  } catch {
    throw new UsageError(`The share server keeps its records with Node's built-in SQLite, which needs Node.js 22.13 or later. This is ${process.version}. Use a newer Node, or --memory.`);
  }
  const [{ SqlStore }, { diskBucket }] = await Promise.all([import("./sql.js"), import("./disk.js")]);
  mkdirSync(folder, { recursive: true });
  const { sqlite: database, db } = sqlite.openDatabase(join(folder, "shares.db"));
  return { db, store: new SqlStore(diskBucket(join(folder, "files")), db), close: () => database.close() };
}

async function serve({ config }: Invocation): Promise<void> {
  const { startServer } = await import("./node.js");
  const data = config.data === null ? null : await openData(config.data);
  const store: ShareStore = data?.store ?? new MemoryStore();
  const { url, close } = await startServer({ ...config, store, log: config.log ? (line) => console.log(line) : undefined });
  console.log(`Share server on ${url}, keeping shared workspaces ${config.data === null ? "in memory, until it stops" : `in ${config.data}`}.`);
  if (config.trustProxy !== "none") console.log(`Believing ${config.trustProxy === "cloudflare" ? "Cloudflare's CF-Connecting-IP" : "the proxy's X-Forwarded-For"} about who sent each request.`);
  // A container is stopped with SIGTERM: finish the requests under way, then close the database.
  const stop = () => {
    void close().then(() => {
      data?.close();
      process.exit(0);
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

async function admin(invocation: Invocation): Promise<void> {
  const { listUploads, setBlocked, setIpBlocked } = await import("./admin.js");
  const data = await openData(invocation.config.data!);
  try {
    const { command, target } = invocation;
    if (command === "uploads") {
      const rows = await listUploads(data.db, { workspace: invocation.workspace, ip: invocation.ip }, invocation.limit);
      if (rows.length) console.table(rows);
      else console.log("No uploads.");
    } else if (command === "block" || command === "unblock") {
      if (!(await setBlocked(data.db, target!, command === "block" ? invocation.reason! : null))) throw new UsageError(`There's no shared workspace ${target}.`);
      console.log(command === "block" ? `Took ${target} down. Its files are kept, but no longer served.` : `${target} is served again.`);
    } else {
      await setIpBlocked(data.db, target!, command === "block-ip" ? invocation.reason! : null);
      console.log(command === "block-ip" ? `Uploads from ${target} are refused.` : `Uploads from ${target} are accepted again.`);
    }
  } finally {
    data.close();
  }
}

try {
  const invocation = readInvocation(process.argv.slice(2), process.env);
  if (invocation.command === "help") console.log(HELP);
  else if (invocation.command === "serve") await serve(invocation);
  else await admin(invocation);
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}
