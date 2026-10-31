// Copies the pre-push hook in scripts/git-hooks into this clone's hooks folder, which every worktree
// shares, so a push to main checks the code passed pnpm verify first. pnpm install runs this
// ("prepare"). The clone's other hooks keep working. A pre-push hook that isn't this one, and a
// hooks folder set with core.hooksPath, are left alone.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capture, isMain } from "./lib.mjs";

const SOURCE = fileURLToPath(new URL("./git-hooks/", import.meta.url));
const MARK = "open-arch pre-push hook";

export function setupHooks(cwd = process.cwd(), log = console.log) {
  const git = (...args) => capture("git", args, { cwd });
  if (git("rev-parse", "--is-inside-work-tree").stdout.trim() !== "true") return;
  // The first version pointed core.hooksPath at scripts/git-hooks, which turned the clone's own hooks off.
  if (git("config", "--local", "--get", "core.hooksPath").stdout.trim() === "scripts/git-hooks") git("config", "--local", "--unset", "core.hooksPath");
  const custom = git("config", "--get", "core.hooksPath").stdout.trim();
  if (custom) return log(`open-arch: git's hooks folder is ${custom}, so the pre-push hook that keeps unchecked code off main isn't installed. Copy scripts/git-hooks into it to turn it on.`);

  const hooks = resolve(cwd, git("rev-parse", "--git-path", "hooks").stdout.trim());
  const target = join(hooks, "pre-push");
  if (existsSync(target) && !readFileSync(target, "utf8").includes(MARK)) {
    return log(`open-arch: there's already a pre-push hook, ${target}, so the one that keeps unchecked code off main isn't installed.`);
  }
  mkdirSync(hooks, { recursive: true });
  copyFileSync(join(SOURCE, "pre-push"), target);
  chmodSync(target, 0o755);
  copyFileSync(join(SOURCE, "open-arch-pre-push.mjs"), join(hooks, "open-arch-pre-push.mjs"));
}

if (isMain(import.meta.url)) setupHooks();
