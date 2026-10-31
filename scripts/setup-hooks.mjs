// Points git at scripts/git-hooks, so a push to main checks the code passed pnpm verify first.
// pnpm install runs this ("prepare"). Outside a git checkout there's nothing to set up, and a
// hooks folder chosen for this clone already is left alone.
import { capture } from "./lib.mjs";

const HOOKS = "scripts/git-hooks";
if (capture("git", ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true") {
  const current = capture("git", ["config", "--local", "--get", "core.hooksPath"]).stdout.trim();
  if (!current) capture("git", ["config", "--local", "core.hooksPath", HOOKS]);
  else if (current !== HOOKS) console.log(`open-arch: core.hooksPath is ${current}, so the pre-push check in ${HOOKS} isn't on.`);
}
