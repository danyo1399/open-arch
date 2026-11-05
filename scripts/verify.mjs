// pnpm verify: every check a branch must pass before it's merged into main (AGENTS.md), in order,
// stopping at the first that fails. When they all pass on committed code, it records that, so
// pnpm land and the pre-push hook know these files passed.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { capture, git, isMain, run, verified } from "./lib.mjs";

/** The desktop app bundles nearly everything, so only a change to Markdown alone skips its smoke test. */
export function onlyMarkdown(paths) {
  return paths.length > 0 && paths.every((p) => p.endsWith(".md"));
}

/** Files changed since the branch left origin/main, committed or not. Null when there's no origin/main to compare with. */
function changedSinceMain(cwd) {
  const base = capture("git", ["merge-base", "origin/main", "HEAD"], { cwd });
  if (base.status !== 0) return null;
  const tracked = git(["diff", "--name-only", base.stdout.trim()], cwd);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd);
  return [...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean);
}

/** The checks, as commands to run in order. `executable`: build the share server's Linux executable, and run it. */
export function checks({ examples, smoke, executable = false }) {
  return [
    ["pnpm", ["install", "--frozen-lockfile"]],
    ["pnpm", ["typecheck"]],
    ["pnpm", ["test"]],
    ["pnpm", ["build"]],
    ...examples.flatMap((file) => [
      ["pnpm", ["open-arch", "check", "--file", file]],
      ["pnpm", ["open-arch", "fmt", "--check", "--file", file]],
      ["pnpm", ["open-arch", "export", "--check", "--file", file]],
    ]),
    ...(smoke ? [["pnpm", ["--filter", "@open-arch/desktop", "smoke"]]] : []),
    ...(executable ? [["pnpm", ["--filter", "@open-arch/server", "executable"]]] : []),
  ];
}

/** Runs the checks in `cwd`, the root of a checkout. Returns whether they all passed. */
export function verify(cwd = process.cwd()) {
  const clean = () => git(["status", "--porcelain"], cwd) === "";
  const head = git(["rev-parse", "HEAD"], cwd);
  const wasClean = clean();

  const examples = readdirSync(join(cwd, "examples"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(cwd, "examples", d.name)).filter((f) => f.endsWith(".openarch")).map((f) => `examples/${d.name}/${f}`))
    .sort();
  const changed = changedSinceMain(cwd);
  const smoke = !(changed && onlyMarkdown(changed));
  if (!smoke) console.log("Only Markdown changed since main, so the desktop smoke test and the share server's executable are skipped.");
  // The executable is a Linux one, built from this machine's Node.
  const executable = smoke && process.platform === "linux";
  if (smoke && !executable) console.log("The share server's Linux executable is only built on Linux, so it's skipped here.");

  for (const [command, args] of checks({ examples, smoke, executable })) {
    if (run(command, args, { cwd }) !== 0) {
      console.error(`\nFailed: ${[command, ...args].join(" ")}`);
      if (args.includes("export")) console.error(`If the docs were meant to change, regenerate them with pnpm open-arch export --file ${args.at(-1)} and commit them.`);
      return false;
    }
  }

  if (wasClean && clean() && git(["rev-parse", "HEAD"], cwd) === head) {
    verified.add(git(["rev-parse", "HEAD^{tree}"], cwd), cwd);
    console.log(`\nEvery check passed on ${head.slice(0, 7)}.`);
  } else {
    console.log("\nEvery check passed, but on uncommitted changes, so it wasn't recorded. Commit them and run pnpm verify again before pushing to main.");
  }
  return true;
}

if (isMain(import.meta.url)) {
  process.exit(verify(git(["rev-parse", "--show-toplevel"])) ? 0 : 1);
}
