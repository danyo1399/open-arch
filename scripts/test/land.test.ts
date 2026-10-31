import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { land, reviewPrompt, Stop } from "../land.mjs";
import { pushedToMain } from "../git-hooks/pre-push.mjs";
import { approved, spawnArgs, verified } from "../lib.mjs";
import { checks, onlyMarkdown } from "../verify.mjs";

const HOOKS = fileURLToPath(new URL("../git-hooks", import.meta.url));
const temps: string[] = [];

beforeAll(() => {
  // Commits in the test repositories, whatever this machine's git setup.
  Object.assign(process.env, { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" });
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
  git(dir, "init", "-q", "--bare", "-b", "main", remote);
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
        // Another branch lands meanwhile.
        first = false;
        commit(main, "c.txt", "three\n");
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

  it("lands from the main checkout without removing it", async () => {
    const { remote, main, worktree } = repos();
    git(main, "worktree", "remove", worktree);
    git(main, "checkout", "-q", "feature");
    await land({ cwd: main, task: "Add b", ...passing() });
    expect(remoteMain(remote)).toBe(git(main, "rev-parse", "HEAD"));
    expect(git(main, "branch", "--show-current")).toBe("feature");
  });

  it("keeps the worktree when asked", async () => {
    const { worktree } = repos();
    await land({ cwd: worktree, task: "Add b", keepWorktree: true, ...passing() });
    expect(existsSync(worktree)).toBe(true);
  });
});

describe("the pre-push hook", () => {
  const push = (cwd: string, ref: string) => spawnSync("git", ["-c", `core.hooksPath=${HOOKS}`, "push", "-q", "origin", ref], { cwd, encoding: "utf8" });

  it("refuses a push to main of files that haven't passed the checks, and lets them through once they have", () => {
    const { remote, worktree, head } = repos();
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
    expect(push(worktree, "HEAD:feature").status).toBe(0);
    expect(git(remote, "rev-parse", "feature")).toBe(head);
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
      "pnpm build",
      "pnpm open-arch check --file examples/a/a.openarch",
      "pnpm open-arch fmt --check --file examples/a/a.openarch",
      "pnpm open-arch export --check --file examples/a/a.openarch",
      "pnpm open-arch check --file examples/b/b.openarch",
      "pnpm open-arch fmt --check --file examples/b/b.openarch",
      "pnpm open-arch export --check --file examples/b/b.openarch",
      "pnpm --filter @open-arch/desktop smoke",
    ]);
    expect(checks({ examples: [], smoke: false }).map(([, args]: [string, string[]]) => args[0])).not.toContain("--filter");
  });
});

describe("running commands", () => {
  it("quotes arguments for the Windows shell, and leaves them alone elsewhere", () => {
    expect(spawnArgs("claude", ["--json-schema", '{"type":"object"}'], "win32")).toEqual({ command: "claude", args: ['"--json-schema"', '"{\\"type\\":\\"object\\"}"'], shell: true });
    expect(spawnArgs("git", ["log"], "win32")).toEqual({ command: "git", args: ["log"], shell: false });
    expect(spawnArgs("claude", ['{"a":1}'], "linux")).toEqual({ command: "claude", args: ['{"a":1}'], shell: false });
  });

  it("gives the reviewer the task, its last findings and the reply to them", () => {
    const prompt = reviewPrompt({ branch: "fix", task: "Fix the bug", note: "That finding is wrong.", previous: { commit: "abcdef1234", report: "Finding 1" } });
    expect(prompt).toContain("What it's for:\nFix the bug");
    expect(prompt).toContain("at abcdef1, asked for changes:\nFinding 1");
    expect(prompt).toContain("The author's reply to that review:\nThat finding is wrong.");
    expect(reviewPrompt({ branch: "fix", task: "Fix the bug" })).not.toContain("last review");
  });
});
