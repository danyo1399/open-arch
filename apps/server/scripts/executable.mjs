// Builds the share server's Linux executables: one static file each for x64 and arm64, with
// nothing to install where they run. Go builds both from any machine.
//
//   pnpm --filter @open-arch/server executable
//
// It writes release/open-arch-share-linux-x64 and release/open-arch-share-linux-arm64, then
// scripts/smoke-executable.mjs runs the one for this machine, when it's Linux.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(server, "package.json"), "utf8"));
mkdirSync(join(server, "release"), { recursive: true });

for (const [arch, goarch] of [
  ["x64", "amd64"],
  ["arm64", "arm64"],
]) {
  const out = join(server, "release", `open-arch-share-linux-${arch}`);
  execFileSync(
    "go",
    // No C at all (the SQLite is pure Go), so it's one static file. -trimpath keeps this machine's
    // paths out of it, and -s -w leaves out the debugging tables, a third of its size.
    ["build", "-trimpath", "-ldflags", `-s -w -X main.version=${version}`, "-o", out, "."],
    { cwd: server, stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0", GOOS: "linux", GOARCH: goarch } },
  );
  console.log(`Built ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB).`);
}
