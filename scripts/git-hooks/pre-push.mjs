// Git runs this before every push (scripts/setup-hooks.mjs points git here). A push to main must
// carry files that passed pnpm verify in this clone; pushes to other branches go through.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { git, verified } from "../lib.mjs";

const NO_COMMIT = /^0+$/;

/** The commits a push sends to main, from the lines git gives the hook: "<local ref> <sha> <remote ref> <sha>". */
export function pushedToMain(lines) {
  return lines
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([, sha, remoteRef]) => remoteRef === "refs/heads/main" && sha && !NO_COMMIT.test(sha))
    .map(([, sha]) => sha);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const unchecked = pushedToMain(readFileSync(0, "utf8")).filter((sha) => !verified.has(git(["rev-parse", `${sha}^{tree}`])));
  if (unchecked.length) {
    console.error(`open-arch: main only takes code that passed the checks, and ${unchecked.map((s) => s.slice(0, 7)).join(", ")} hasn't.`);
    console.error("Run pnpm land: it reviews the branch, runs the checks and pushes it (AGENTS.md).");
    process.exit(1);
  }
}
