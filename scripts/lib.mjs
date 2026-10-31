// What scripts/verify.mjs, scripts/land.mjs and the pre-push hook share: running commands, and
// what this clone remembers about which code passed the checks and which commits were approved.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * On Windows, pnpm and claude are .cmd files, which only run through the shell. The shell would
 * drop the quotes in an argument like a JSON schema, so each argument is quoted for it.
 */
export function spawnArgs(command, args, platform = process.platform) {
  if (platform !== "win32" || command === "git" || command === process.execPath) return { command, args, shell: false };
  return { command, args: args.map((a) => `"${a.replace(/"/g, '\\"')}"`), shell: true };
}

/** Runs a command with its output on screen, and returns its exit status. */
export function run(command, args, { cwd } = {}) {
  console.log(`\n» ${[command, ...args].join(" ")}`);
  const s = spawnArgs(command, args);
  const result = spawnSync(s.command, s.args, { cwd, stdio: "inherit", shell: s.shell });
  return result.status ?? 1;
}

/** Runs a command quietly, for its output. */
export function capture(command, args, { cwd, input } = {}) {
  const s = spawnArgs(command, args);
  const result = spawnSync(s.command, s.args, { cwd, input, encoding: "utf8", shell: s.shell, maxBuffer: 64 * 1024 * 1024 });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

/** A git command's output, trimmed. Throws with git's message if it fails. */
export function git(args, cwd) {
  const r = capture("git", args, { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Where this clone keeps what the scripts remember: in the git folder that every worktree shares. */
export function stateDir(cwd) {
  return join(resolve(cwd ?? ".", git(["rev-parse", "--git-common-dir"], cwd)), "open-arch");
}

/** A set of hashes kept as empty files, so worktrees running at once never write over each other. */
function hashSet(name) {
  const file = (hash, cwd) => join(stateDir(cwd), name, hash);
  return {
    has: (hash, cwd) => existsSync(file(hash, cwd)),
    add(hash, cwd) {
      mkdirSync(join(stateDir(cwd), name), { recursive: true });
      writeFileSync(file(hash, cwd), "");
    },
  };
}

/** Trees (the files of a commit) that passed `pnpm verify`. */
export const verified = hashSet("verified");

/** Commits whose branch a review approved. */
export const approved = hashSet("approved");
