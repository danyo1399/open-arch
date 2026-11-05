// Builds the share server's executables, for Linux and macOS, each on x64 and arm64: one static
// file each, with nothing to install where it runs. Go builds them all from any machine.
//
//   pnpm --filter @open-arch/server executable
//
// It writes release/open-arch-share-<linux|macos>-<x64|arm64>, then scripts/smoke-executable.mjs
// runs the one for this machine, when there is one. Each says its version: OPEN_ARCH_VERSION, or
// package.json's.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("..", import.meta.url));
// A release names its version (.github/workflows/release.yml); otherwise it's package.json's.
const version = process.env.OPEN_ARCH_VERSION || JSON.parse(readFileSync(join(server, "package.json"), "utf8")).version;
mkdirSync(join(server, "release"), { recursive: true });

/** Each executable: its name's platform and architecture, and Go's. */
const TARGETS = [
  { platform: "linux", arch: "x64", goos: "linux", goarch: "amd64" },
  { platform: "linux", arch: "arm64", goos: "linux", goarch: "arm64" },
  { platform: "macos", arch: "x64", goos: "darwin", goarch: "amd64" },
  { platform: "macos", arch: "arm64", goos: "darwin", goarch: "arm64" },
];

// Mach-O's CPU types, and its load command for a code signature.
const MACH_CPU = { x64: 0x01000007, arm64: 0x0100000c };
const LC_CODE_SIGNATURE = 0x1d;

/**
 * Checks a macOS executable is one for its CPU, and, on Apple Silicon, signed: macOS won't run an
 * arm64 program with no signature at all. Go's linker signs it ad hoc, even built elsewhere, but
 * a change to how it's linked could drop that, and only a Mac would notice.
 */
function checkMacho(path, arch) {
  const file = readFileSync(path);
  if (file.readUInt32LE(0) !== 0xfeedfacf || file.readUInt32LE(4) !== MACH_CPU[arch]) throw new Error(`${path} isn't a 64-bit macOS executable for ${arch}.`);
  const commands = [];
  for (let i = 0, at = 32; i < file.readUInt32LE(16); i++, at += file.readUInt32LE(at + 4)) commands.push(file.readUInt32LE(at));
  if (arch === "arm64" && !commands.includes(LC_CODE_SIGNATURE)) throw new Error(`${path} has no code signature, so Apple Silicon Macs won't run it.`);
}

for (const { platform, arch, goos, goarch } of TARGETS) {
  const out = join(server, "release", `open-arch-share-${platform}-${arch}`);
  execFileSync(
    "go",
    // No C at all (the SQLite is pure Go), so it's one static file. -trimpath keeps this machine's
    // paths out of it, and -s -w leaves out the debugging tables, a third of its size.
    ["build", "-trimpath", "-ldflags", `-s -w -X main.version=${version}`, "-o", out, "."],
    { cwd: server, stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch } },
  );
  if (platform === "macos") checkMacho(out, arch);
  console.log(`Built ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB).`);
}
