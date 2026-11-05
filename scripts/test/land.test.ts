import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pushedToMain } from "../git-hooks/open-arch-pre-push.mjs";
import { land, renderReview, reviewPrompt, Stop, VERDICT_SCHEMA, verdictFrom, writeChange } from "../land.mjs";
import { approved, cmdArg, spawnArgs, verified } from "../lib.mjs";
import { setupHooks } from "../setup-hooks.mjs";
import { checks, onlyMarkdown } from "../verify.mjs";

const LIB = pathToFileURL(join(import.meta.dirname, "..", "lib.mjs")).href;
const temps: string[] = [];
const savedEnv = { ...process.env };

beforeAll(() => {
  // The test repositories ignore this machine's git setup, and say who commits.
  const config = join(realpathSync(mkdtempSync(join(tmpdir(), "open-arch-gitconfig-"))), "gitconfig");
  writeFileSync(config, "");
  Object.assign(process.env, {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
});

afterAll(() => {
  process.env = savedEnv;
});

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(cwd: string, file: string, text: string, message = `Change ${file}`) {
  writeFileSync(join(cwd, file), text);
  git(cwd, "add", file);
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** A remote, a main checkout on main, and a worktree with one commit on the branch "feature". */
function repos() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "open-arch-land-")));
  temps.push(dir);
  const remote = join(dir, "remote.git");
  const main = join(dir, "main");
  const worktree = join(dir, "feature");
  git(dir, "init", "-q", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", "-q", remote, main);
  git(main, "symbolic-ref", "HEAD", "refs/heads/main");
  commit(main, "a.txt", "one\n", "First");
  git(main, "push", "-q", "-u", "origin", "main");
  git(main, "worktree", "add", "-q", "-b", "feature", worktree, "origin/main");
  const head = commit(worktree, "b.txt", "two\n", "Add b");
  return { remote, main, worktree, head };
}

/** A review and checks that pass, and remember being asked. */
function passing() {
  const reviews: unknown[] = [];
  const checked: string[] = [];
  return {
    reviews,
    checked,
    review: async (args: unknown) => (reviews.push(args), { approved: true, report: "Looks right." }),
    verify: (root: string) => {
      checked.push(git(root, "rev-parse", "HEAD"));
      verified.add(git(root, "rev-parse", "HEAD^{tree}"), root);
      return true;
    },
    log: () => {},
  };
}

const remoteMain = (remote: string) => git(remote, "rev-parse", "main");

describe("pnpm land", () => {
  it("reviews, checks and pushes a branch, then updates the main checkout and removes the worktree", async () => {
    const { remote, main, worktree, head } = repos();
    const fake = passing();
    await land({ cwd: worktree, task: "Add b", ...fake });
    expect(fake.reviews).toMatchObject([{ branch: "feature", task: "Add b", previous: undefined }]);
    expect(fake.checked).toEqual([head]);
    expect(remoteMain(remote)).toBe(head);
    expect(git(main, "rev-parse", "HEAD")).toBe(head);
    expect(existsSync(worktree)).toBe(false);
    expect(git(main, "branch", "--list", "feature")).toBe("");
  });

  it("asks what the branch is for before a review, and pushes nothing", async () => {
    const { remote, worktree } = repos();
    const before = remoteMain(remote);
    const fake = passing();
    await expect(land({ cwd: worktree, ...fake })).rejects.toThrow(/--task/);
    expect(fake.checked).toEqual([]);
    expect(remoteMain(remote)).toBe(before);
  });

  it("stops when changes are requested, and shows the next review what it asked for and the reply", async () => {
    const { remote, worktree, head } = repos();
    const before = remoteMain(remote);
    const fake = passing();
    const requesting = { ...fake, review: async () => ({ approved: false, report: "Rename b." }) };
    await expect(land({ cwd: worktree, task: "Add b", ...requesting })).rejects.toThrow(Stop);
    expect(remoteMain(remote)).toBe(before);

    await land({ cwd: worktree, task: "Add b", note: "b is the name the task asked for.", ...fake });
    expect(fake.reviews).toMatchObject([{ previous: { commit: head, approved: false, report: "Rename b." }, note: "b is the name the task asked for." }]);
    // The files passed the checks the first time, so they aren't run again.
    expect(fake.checked).toEqual([head]);
    expect(remoteMain(remote)).toBe(head);
  });

  it("stops at any defect, even from a review that says it's approved", async () => {
    const { remote, worktree } = repos();
    const before = remoteMain(remote);
    const fake = passing();
    const defect = { severity: "defect", file: "b.txt", line: 1, problem: "b stops working after a restart.", why: "Nobody can use it then." };
    const contradicting = { ...fake, review: async () => ({ approved: true, report: "Fine.", findings: [defect] }) };
    await expect(land({ cwd: worktree, task: "Add b", ...contradicting })).rejects.toThrow("1 defect must be fixed first.");
    expect(remoteMain(remote)).toBe(before);
    // The next review is told what the last one found, as for any review that asked for changes.
    await land({ cwd: worktree, task: "Add b", ...fake });
    expect(fake.reviews).toMatchObject([{ previous: { approved: false, findings: [defect] } }]);
  });

  it("lands a branch whose review has only suggestions", async () => {
    const { remote, worktree, head } = repos();
    const fake = passing();
    const suggesting = { ...fake, review: async () => verdictFrom({ findings: [{ severity: "suggestion", file: "b.txt", problem: "b could be named better.", why: "It's short." }], summary: "Adds b." }) };
    await land({ cwd: worktree, task: "Add b", ...suggesting });
    expect(remoteMain(remote)).toBe(head);
  });

  it("keeps an approval through a rebase without conflicts, and checks the result", async () => {
    const { remote, main, worktree, head } = repos();
    approved.add(head, worktree);
    commit(main, "c.txt", "three\n");
    git(main, "push", "-q", "origin", "main");
    const fake = passing();
    await land({ cwd: worktree, ...fake });
    expect(fake.reviews).toEqual([]);
    expect(fake.checked).toHaveLength(1);
    expect(git(remote, "log", "--format=%s", "main")).toBe("Add b\nChange c.txt\nFirst");
  });

  it("undoes a rebase that hits conflicts, and stops", async () => {
    const { remote, main, worktree, head } = repos();
    commit(main, "b.txt", "something else\n");
    git(main, "push", "-q", "origin", "main");
    const before = remoteMain(remote);
    await expect(land({ cwd: worktree, task: "Add b", ...passing() })).rejects.toThrow(/conflicts/);
    expect(git(worktree, "rev-parse", "HEAD")).toBe(head);
    expect(git(worktree, "status", "--porcelain")).toBe("");
    expect(remoteMain(remote)).toBe(before);
  });

  it("goes round again when main moves while the branch is being checked", async () => {
    const { remote, main, worktree } = repos();
    const fake = passing();
    let first = true;
    const verify = (root: string) => {
      if (first) {
        // Another branch lands meanwhile, its files checked as pnpm land would.
        first = false;
        commit(main, "c.txt", "three\n");
        verified.add(git(main, "rev-parse", "HEAD^{tree}"), main);
        git(main, "push", "-q", "origin", "main");
      }
      return fake.verify(root);
    };
    await land({ cwd: worktree, task: "Add b", ...fake, verify });
    expect(fake.reviews).toHaveLength(1);
    expect(fake.checked).toHaveLength(2);
    expect(git(remote, "log", "--format=%s", "main")).toBe("Add b\nChange c.txt\nFirst");
  });

  it("refuses uncommitted changes", async () => {
    const { worktree } = repos();
    writeFileSync(join(worktree, "c.txt"), "draft\n");
    await expect(land({ cwd: worktree, task: "Add b", ...passing() })).rejects.toThrow(/Commit or remove/);
  });

  it("refuses main, and a branch with nothing to land", async () => {
    const { main, worktree } = repos();
    await expect(land({ cwd: main, task: "x", ...passing() })).rejects.toThrow(/This is main/);
    git(worktree, "reset", "-q", "--hard", "origin/main");
    await expect(land({ cwd: worktree, task: "x", ...passing() })).rejects.toThrow(/Nothing to land/);
  });

  it("leaves a main checkout that isn't on main as it is", async () => {
    const { main, worktree } = repos();
    git(main, "checkout", "-q", "-b", "elsewhere");
    const messages: string[] = [];
    await land({ cwd: worktree, task: "Add b", ...passing(), log: (m: string) => messages.push(m) });
    expect(git(main, "branch", "--show-current")).toBe("elsewhere");
    expect(git(main, "rev-parse", "main")).not.toBe(git(main, "rev-parse", "origin/main"));
    expect(messages.join("\n")).toMatch(/is on elsewhere, not main/);
    expect(existsSync(worktree)).toBe(false);
  });

  it("puts the pre-push hook back in place before pushing", async () => {
    const { main, worktree } = repos();
    git(main, "config", "core.hooksPath", "scripts/git-hooks");
    await land({ cwd: worktree, task: "Add b", ...passing() });
    expect(spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: main, encoding: "utf8" }).stdout).toBe("");
    expect(existsSync(join(main, ".git", "hooks", "open-arch-pre-push.mjs"))).toBe(true);
  });

  it("lands from the main checkout without removing it", async () => {
    const { remote, main, worktree } = repos();
    git(main, "worktree", "remove", worktree);
    git(main, "checkout", "-q", "feature");
    await land({ cwd: main, task: "Add b", ...passing() });
    expect(remoteMain(remote)).toBe(git(main, "rev-parse", "HEAD"));
    expect(git(main, "branch", "--show-current")).toBe("feature");
  });

  it("stops, landing nothing, if the reviewer changed the worktree", async () => {
    const { remote, worktree } = repos();
    const before = remoteMain(remote);
    const fake = passing();
    const writing = { ...fake, review: async () => (writeFileSync(join(worktree, "diff.txt"), "oops\n"), { approved: true, report: "Fine." }) };
    await expect(land({ cwd: worktree, task: "Add b", ...writing })).rejects.toThrow(/reviewer changed the worktree[\s\S]*diff\.txt/);
    expect(remoteMain(remote)).toBe(before);
    expect(approved.has(git(worktree, "rev-parse", "HEAD"), worktree)).toBe(false);
  });

  it("keeps the worktree when asked", async () => {
    const { worktree } = repos();
    await land({ cwd: worktree, task: "Add b", keepWorktree: true, ...passing() });
    expect(existsSync(worktree)).toBe(true);
  });
});

describe("the pre-push hook", () => {
  const push = (cwd: string, ref: string) => spawnSync("git", ["push", "-q", "origin", ref], { cwd, encoding: "utf8" });
  const messages: string[] = [];
  const install = (cwd: string) => setupHooks(cwd, (m: string) => messages.push(m));

  it("refuses a push to main of files that haven't passed the checks, and lets them through once they have", () => {
    const { remote, worktree, head } = repos();
    install(worktree);
    const refused = push(worktree, "HEAD:main");
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toMatch(/main only takes code that passed the checks/);
    expect(remoteMain(remote)).not.toBe(head);

    verified.add(git(worktree, "rev-parse", "HEAD^{tree}"), worktree);
    expect(push(worktree, "HEAD:main").status).toBe(0);
    expect(remoteMain(remote)).toBe(head);
  });

  it("lets pushes to other branches through", () => {
    const { remote, worktree, head } = repos();
    install(worktree);
    expect(push(worktree, "HEAD:feature").status).toBe(0);
    expect(git(remote, "rev-parse", "feature")).toBe(head);
  });

  it("is installed once for every worktree, and works on a branch that has no scripts", () => {
    // These repositories have none of open-arch's files, as a branch from before the hook wouldn't.
    const { main, worktree } = repos();
    install(main);
    expect(git(worktree, "rev-parse", "--git-path", "hooks/pre-push")).toMatch(/hooks\/pre-push$/);
    const refused = push(worktree, "HEAD:main");
    expect(refused.stderr).toMatch(/main only takes code that passed the checks/);
  });

  it("leaves the clone's other hooks working, and a pre-push hook of its own alone", () => {
    const { main, worktree } = repos();
    const hooks = join(main, ".git", "hooks");
    writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\ntouch "${join(main, "..", "pre-commit-ran")}"\n`, { mode: 0o755 });
    install(main);
    commit(worktree, "c.txt", "three\n");
    expect(existsSync(join(main, "..", "pre-commit-ran"))).toBe(true);

    writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    messages.length = 0;
    install(main);
    expect(readFileSync(join(hooks, "pre-push"), "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(messages.join("\n")).toMatch(/already a pre-push hook/);
    expect(push(worktree, "HEAD:main").status).toBe(0);
  });

  it("takes over from the first version, which set core.hooksPath, and leaves a hooks folder of your own alone", () => {
    const { main, worktree } = repos();
    git(main, "config", "core.hooksPath", "scripts/git-hooks");
    install(main);
    expect(spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: main, encoding: "utf8" }).stdout).toBe("");
    expect(push(worktree, "HEAD:main").status).not.toBe(0);

    git(main, "config", "core.hooksPath", ".husky");
    messages.length = 0;
    install(main);
    expect(git(main, "config", "--get", "core.hooksPath")).toBe(".husky");
    expect(messages.join("\n")).toMatch(/hooks folder is \.husky/);
  });

  it("reads which commits go to main", () => {
    const zeros = "0".repeat(40);
    const lines = [`refs/heads/feature ${"a".repeat(40)} refs/heads/main ${zeros}`, `refs/heads/feature ${"b".repeat(40)} refs/heads/feature ${zeros}`, `(delete) ${zeros} refs/heads/main ${"c".repeat(40)}`, ""].join("\n");
    expect(pushedToMain(lines)).toEqual(["a".repeat(40)]);
  });
});

describe("pnpm verify", () => {
  it("skips the desktop smoke test only when Markdown alone changed", () => {
    expect(onlyMarkdown(["README.md", "packages/skill/open-arch/SKILL.md"])).toBe(true);
    expect(onlyMarkdown(["README.md", "apps/web/src/Designer.tsx"])).toBe(false);
    expect(onlyMarkdown([])).toBe(false);
  });

  it("runs every check AGENTS.md lists, on every example", () => {
    const commands = checks({ examples: ["examples/a/a.openarch", "examples/b/b.openarch"], smoke: true }).map(([c, args]: [string, string[]]) => [c, ...args].join(" "));
    expect(commands).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm typecheck",
      "pnpm test",
      "pnpm --filter @open-arch/server test",
      "pnpm build",
      "pnpm open-arch check --file examples/a/a.openarch",
      "pnpm open-arch fmt --check --file examples/a/a.openarch",
      "pnpm open-arch export --check --file examples/a/a.openarch",
      "pnpm open-arch check --file examples/b/b.openarch",
      "pnpm open-arch fmt --check --file examples/b/b.openarch",
      "pnpm open-arch export --check --file examples/b/b.openarch",
      "pnpm --filter @open-arch/desktop smoke",
      "pnpm --filter @open-arch/server executable",
    ]);
    expect(checks({ examples: [], smoke: false }).map(([, args]: [string, string[]]) => args.at(-1))).not.toContain("smoke");
    expect(checks({ examples: [], smoke: false }).map(([, args]: [string, string[]]) => args.at(-1))).not.toContain("executable");
  });
});

describe("running commands", () => {
  it("knows a script is the one being run when its path goes through a symlink", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "open-arch-link-")));
    temps.push(dir);
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "main.mjs"), `import { isMain } from ${JSON.stringify(LIB)};\nconsole.log(isMain(import.meta.url));\n`);
    symlinkSync(join(dir, "real"), join(dir, "link"), "junction");
    expect(spawnSync(process.execPath, [join(dir, "link", "main.mjs")], { encoding: "utf8" }).stdout.trim()).toBe("true");
  });

  it("runs .cmd files on Windows through the shell, with their arguments quoted for it, and anything else as it is", () => {
    const at = (file?: string) => ({ platform: "win32", find: () => file });
    expect(spawnArgs("pnpm", ["test"], at("C:\\node\\pnpm.cmd"))).toEqual({ command: "pnpm", args: [cmdArg("test")], shell: true });
    expect(spawnArgs("claude", ["-p"], at("C:\\bin\\claude.exe"))).toEqual({ command: "C:\\bin\\claude.exe", args: ["-p"], shell: false });
    expect(spawnArgs("missing", ["x"], at(undefined))).toEqual({ command: "missing", args: ["x"], shell: false });
    expect(spawnArgs("C:\\node\\node.exe", ["x"], at("never asked"))).toEqual({ command: "C:\\node\\node.exe", args: ["x"], shell: false });
    expect(spawnArgs("pnpm", ['{"a":1}'], { platform: "linux" })).toEqual({ command: "pnpm", args: ['{"a":1}'], shell: false });
  });

  it("quotes for cmd.exe reading a .cmd file: quotes, a trailing backslash, %, and spaces", () => {
    expect(cmdArg('{"a":1}')).toBe('^^^"{\\^^^"a\\^^^":1}^^^"');
    expect(cmdArg("dir\\")).toBe('^^^"dir\\\\^^^"');
    expect(cmdArg("100%")).toBe('^^^"100^^^%^^^"');
    expect(cmdArg("two words")).toBe('^^^"two^^^ words^^^"');
  });

  it("hands the reviewer the change, its commits and recent ones on main, as files", () => {
    const { worktree } = repos();
    const dir = join(worktree, "..", "change");
    writeChange(worktree, dir);
    expect(readFileSync(join(dir, "diff.patch"), "utf8")).toMatch(/\+\+\+ b\/b\.txt\n@@ -0,0 \+1 @@\n\+two/);
    expect(readFileSync(join(dir, "commits.txt"), "utf8")).toMatch(/Add b[\s\S]*b\.txt \| 1 \+/);
    expect(readFileSync(join(dir, "main-commits.txt"), "utf8")).toMatch(/First/);
  });

  it("gives the reviewer the task, where the change is, its last findings and the reply to them", () => {
    const prompt = reviewPrompt({ branch: "fix", task: "Fix the bug", note: "That finding is wrong.", previous: { commit: "abcdef1234", report: "Finding 1" }, change: "/tmp/x" });
    expect(prompt).toContain(`is in ${join("/tmp/x", "diff.patch")}`);
    expect(prompt).toContain("What it's for:\nFix the bug");
    expect(prompt).toContain("at abcdef1, found defects:\nFinding 1");
    expect(prompt).toContain("The author's reply to that review:\nThat finding is wrong.");
    expect(reviewPrompt({ branch: "fix", task: "Fix the bug", change: "/tmp/x" })).not.toContain("last review");
    expect(reviewPrompt({ branch: "fix", task: "Fix the bug", note: "The name is on purpose.", change: "/tmp/x" })).toContain("A note from the author:\nThe name is on purpose.");
  });

  it("tells the reviewer what a defect is, and that any one stops the merge", () => {
    const prompt = reviewPrompt({ branch: "fix", task: "Fix the bug", change: "/tmp/x" });
    expect(prompt).toContain("- defect: it must be fixed before the branch is merged.");
    for (const kind of ["edge cases and failures", "a restart, a race, a value at or past a limit", "says something the code doesn't do", "security, privacy or abuse protection"]) expect(prompt).toContain(kind);
    expect(prompt).toContain("If you're not sure whether something is a defect, it is one");
    expect(prompt).toContain("don't call one a suggestion because it's small, rare, or could be fixed later");
    // The checks passing is context, not a reason to approve.
    expect(prompt).toContain("They only show what they test");
  });

  it("asks the reviewer for findings, not a verdict, and approves only with no defects", () => {
    expect(Object.keys(VERDICT_SCHEMA.properties)).toEqual(["findings", "summary"]);
    expect(VERDICT_SCHEMA.properties.findings.items.properties.severity.enum).toEqual(["defect", "suggestion"]);
    const findings = [
      { severity: "suggestion", file: "a.ts", problem: "A clearer name.", why: "It reads better." },
      { severity: "defect", file: "b.ts", line: 12, problem: "Stop sharing fails on a 404.", why: "The dialog is stuck." },
    ];
    const verdict = verdictFrom({ findings, summary: "Checked the dialog." });
    expect(verdict.approved).toBe(false);
    expect(verdict.report).toBe("Must be fixed:\n1. b.ts:12: Stop sharing fails on a 404. The dialog is stuck.\n\nSuggestions:\n1. a.ts: A clearer name. It reads better.\n\nChecked the dialog.");
    expect(verdictFrom({ findings: [findings[0]!], summary: "Fine." }).approved).toBe(true);
    expect(renderReview({ findings: [], summary: "Fine." })).toBe("Nothing must be fixed.\n\nFine.");
  });
});
