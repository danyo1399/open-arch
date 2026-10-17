// Launches the built desktop app against a temporary copy of examples/shop and
// checks it end to end: it reopens the last workspace, saves through the
// bridge, and reloads when a file changes on disk. Screenshots go to
// apps/desktop/smoke/.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "open-arch-smoke-"));
const workspace = join(temp, "shop");
const userData = join(temp, "user");
cpSync(at("../../../examples/shop"), workspace, { recursive: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "state.json"), JSON.stringify({ lastWorkspace: workspace }));
const out = at("../smoke");
mkdirSync(out, { recursive: true });

const result = spawnSync(electron, [at("./smoke-main.mjs")], {
  stdio: "inherit",
  env: { ...process.env, OPEN_ARCH_SMOKE_WORKSPACE: workspace, OPEN_ARCH_SMOKE_USERDATA: userData, OPEN_ARCH_SMOKE_OUT: out },
  timeout: 60_000,
});
rmSync(temp, { recursive: true, force: true });
process.exit(result.status ?? 1);
