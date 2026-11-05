// Builds the share server as one Linux executable, with nothing to install where it runs: Node's
// own binary with the server inside it, as a single executable application
// (https://nodejs.org/api/single-executable-applications.html). Node's built-in SQLite comes with it.
//
//   pnpm --filter @open-arch/server executable
//
// It writes release/open-arch-share-linux-<arch>, for this machine's architecture (x64 or arm64),
// from the Node that runs this script, so build it with Node 22.13 or later. Build on an arm64
// machine for arm64. scripts/smoke-executable.mjs checks what it built.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";

if (process.platform !== "linux") {
  console.error("This builds the Linux executable, on Linux. Elsewhere, run the server with Node (README, The share server).");
  process.exit(1);
}

const server = fileURLToPath(new URL("..", import.meta.url));
const work = join(server, "build", "executable");
const out = join(server, "release", `open-arch-share-linux-${process.arch}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(join(server, "release"), { recursive: true });

// 1. The server as one CommonJS file, which is what Node 22 runs inside an executable.
const main = join(work, "main.cjs");
await build({
  entryPoints: [join(server, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: main,
  // Only the code that reads migrations/ beside dist/ uses import.meta, and the executable doesn't run it.
  logOverride: { "empty-import-meta": "silent" },
  logLevel: "warning",
});
writeFileSync(main, readFileSync(main, "utf8").replace(/^#!.*\n/, ""));

// 2. The migrations, which it has no folder for, as an asset inside it (main.ts reads them back).
const migrationsDir = join(server, "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
writeFileSync(join(work, "migrations.json"), JSON.stringify(migrations));

// 3. Node packs them into a blob, then the blob goes into a copy of Node's binary.
const blob = join(work, "sea.blob");
writeFileSync(
  join(work, "sea-config.json"),
  JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, assets: { "migrations.json": join(work, "migrations.json") } }),
);
execFileSync(process.execPath, ["--experimental-sea-config", join(work, "sea-config.json")], { stdio: "inherit" });
rmSync(out, { force: true });
copyFileSync(process.execPath, out);
chmodSync(out, 0o755);
await inject(out, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2" });

console.log(`Built ${out}, with Node ${process.version} inside.`);
