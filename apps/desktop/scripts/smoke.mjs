// Launches the built desktop app against a temporary copy of examples/shop and
// checks it end to end: it reopens the last file, saves edits from the
// designer and refreshes the docs folder, reloads when the open-arch CLI
// changes the file, and runs an "Ask AI" request against a scripted agent.
// Screenshots go to apps/desktop/smoke/.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
// The CLI bundled with the app, which the AI agent runs.
const cli = at("../dist/cli/bin/open-arch.js");
if (!existsSync(cli)) throw new Error("Build the app first: pnpm --filter @open-arch/desktop build");

const temp = mkdtempSync(join(tmpdir(), "open-arch-smoke-"));
const folder = join(temp, "shop");
const userData = join(temp, "user");
cpSync(at("../../../examples/shop"), folder, { recursive: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "state.json"), JSON.stringify({ lastFile: join(folder, "shop.openarch") }));
const out = at("../smoke");
mkdirSync(out, { recursive: true });

// Electron refuses to run as root, as agents often do in containers, unless its sandbox is off.
const args = [...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), at("./smoke-main.mjs")];
// On Linux with no display, as on a server or in a container, the app gets a virtual one.
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const [command, commandArgs] = headless ? ["xvfb-run", ["--auto-servernum", "--server-args=-screen 0 1920x1080x24", electron, ...args]] : [electron, args];
const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  env: { ...process.env, OPEN_ARCH_SMOKE_FOLDER: folder, OPEN_ARCH_SMOKE_USERDATA: userData, OPEN_ARCH_SMOKE_OUT: out, OPEN_ARCH_SMOKE_CLI: cli },
  timeout: 60_000,
});
// On Windows, Electron's helper processes can hold files in userData for a moment after it exits.
rmSync(temp, { recursive: true, force: true, maxRetries: 10 });
if (result.error?.code === "ENOENT" && headless) console.error("There's no display, and xvfb-run isn't installed to make one. Install xvfb, or run this where there's a display.");
process.exit(result.status ?? 1);
