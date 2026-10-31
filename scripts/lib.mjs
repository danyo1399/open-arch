// What scripts/verify.mjs, scripts/land.mjs and the pre-push hook share: running commands, and
// what this clone remembers about which code passed the checks and which commits were approved.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Whether the module at `url` is the script node was asked to run, wherever symlinks lead. */
export function isMain(url) {
  return !!process.argv[1] && url === pathToFileURL(realpathSync(process.argv[1])).href;
}

/** Where a command is on PATH on Windows, with the extension that makes it run. */
function findOnPath(command) {
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";");
  for (const dir of (process.env.PATH ?? "").split(";")) {
    for (const ext of exts) if (dir && existsSync(join(dir, command + ext))) return join(dir, command + ext);
  }
  return undefined;
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * An argument quoted for cmd.exe running a .cmd or .bat file, which reads it twice: once for the
 * command line and again for the file's %*. cross-spawn quotes the same way, though it escapes
 * twice only for shims in node_modules/.bin; pnpm.cmd and claude.cmd, from npm or corepack, are
 * shims too, wherever they are.
 */
export function cmdArg(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
}

/**
 * How to spawn a command. On Windows, pnpm, and claude when npm installed it, are .cmd files,
 * which only run through the shell, so their arguments are quoted for it. Anything else runs as it is.
 */
export function spawnArgs(command, args, { platform = process.platform, find = findOnPath } = {}) {
  if (platform !== "win32" || /[\\/]/.test(command)) return { command, args, shell: false };
  const file = find(command);
  if (!file || !/\.(cmd|bat)$/i.test(file)) return { command: file ?? command, args, shell: false };
  return { command, args: args.map(cmdArg), shell: true };
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

/** Trees (the files of a commit) that passed `pnpm verify`. The pre-push hook reads the same folder. */
export const verified = hashSet("verified");

/** Commits whose branch a review approved. */
export const approved = hashSet("approved");
