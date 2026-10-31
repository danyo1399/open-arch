// Git runs this before every push, from the pre-push hook that pnpm install copies into the clone's
// hooks folder (scripts/setup-hooks.mjs). A push to main must carry files that passed pnpm verify
// in this clone; pushes to other branches go through. It uses nothing from the repository, so it
// works in a worktree on any branch, even one from before it existed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NO_COMMIT = /^0+$/;

/** The commits a push sends to main, from the lines git gives the hook: "<local ref> <sha> <remote ref> <sha>". */
export function pushedToMain(lines) {
  return lines
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, sha, remoteRef]) => remoteRef === "refs/heads/main" && sha && !NO_COMMIT.test(sha))
    .map(([, sha]) => sha);
}

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Whether pnpm verify passed these files: it records their tree where `verified` in scripts/lib.mjs says. */
const passed = (sha) => existsSync(join(resolve(git("rev-parse", "--git-common-dir")), "open-arch", "verified", git("rev-parse", `${sha}^{tree}`)));

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const unchecked = pushedToMain(readFileSync(0, "utf8")).filter((sha) => !passed(sha));
  if (unchecked.length) {
    console.error(`open-arch: main only takes code that passed the checks, and ${unchecked.map((s) => s.slice(0, 7)).join(", ")} hasn't.`);
    console.error("Run pnpm land: it runs the checks, reviews the branch and pushes it (AGENTS.md).");
    process.exit(1);
  }
}
