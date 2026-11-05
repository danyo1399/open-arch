// pnpm land: takes the branch checked out here to main (AGENTS.md, Review and merge). In order, it
// brings the branch up to date with main, runs pnpm verify, has Claude review it, pushes it to
// main, and tidies up the main checkout and the worktree. At anything that needs you, it stops and
// says what to do next.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { approved, capture, git, isMain, spawnArgs, stateDir, verified } from "./lib.mjs";
import { setupHooks } from "./setup-hooks.mjs";
import { verify as runChecks } from "./verify.mjs";

const USAGE = `pnpm land --task "<what the branch is for>" [--note "<your reply to the last review>"] [--keep-worktree]

Takes the branch checked out here to main: rebases it onto origin/main, runs pnpm verify, has
Claude review it, pushes it to main, then updates the main checkout and removes the worktree and
the branch. --task is needed when the branch hasn't been approved yet. See AGENTS.md.`;

/** Something that needs whoever is landing the branch. */
export class Stop extends Error {}

/** How many times to go round when main moves while a branch is being checked. */
const ATTEMPTS = 3;

/**
 * The reviewer's answer: each finding, marked a defect, which must be fixed before the branch is
 * merged, or a suggestion, which needn't be, and a summary. There's no verdict to give: the
 * branch is approved when there are no defects, so a review can't list one and approve anyway.
 */
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["defect", "suggestion"] },
          file: { type: "string" },
          line: { type: "integer" },
          problem: { type: "string" },
          why: { type: "string" },
        },
        required: ["severity", "file", "problem", "why"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["findings", "summary"],
  additionalProperties: false,
};

/**
 * The findings that must be fixed before the branch is merged: every one that isn't a suggestion.
 * One with a misspelled severity counts as a defect, so a slip can't let a branch through. One
 * with none at all doesn't get here: claudeReview refuses the whole answer (wellFormed).
 */
export const defects = (verdict) => (verdict.findings ?? []).filter((f) => f.severity !== "suggestion");

/** The review as it's printed, and shown to the next review: the defects first, then the suggestions, then the summary. */
export function renderReview({ findings, summary }) {
  const list = (some) => some.map((f, i) => `${i + 1}. ${f.file}${f.line ? `:${f.line}` : ""}: ${f.problem} ${f.why}`).join("\n");
  const must = list(defects({ findings }));
  const may = list(findings.filter((f) => f.severity === "suggestion"));
  return [must ? `Must be fixed:\n${must}` : "Nothing must be fixed.", ...(may ? [`Suggestions:\n${may}`] : []), summary].join("\n\n");
}

/** Whether the reviewer's answer has the shape VERDICT_SCHEMA asks for, checked here rather than trusted. */
export function wellFormed(answer) {
  const text = (value) => typeof value === "string";
  return (
    !!answer &&
    Array.isArray(answer.findings) &&
    text(answer.summary) &&
    answer.findings.every((f) => !!f && text(f.severity) && text(f.file) && text(f.problem) && text(f.why) && (f.line === undefined || Number.isInteger(f.line)))
  );
}

/** What a review's structured answer means: approved only with no defects. */
export function verdictFrom({ findings, summary }) {
  const verdict = { findings, summary };
  return { approved: defects(verdict).length === 0, findings, report: renderReview(verdict) };
}

/**
 * The reviewer's tools only read files. With no shell, nothing it runs can write one (git diff and
 * git log can, with --output), so the change and its commits are handed to it as files instead.
 */
const REVIEWER_TOOLS = ["Read", "Grep", "Glob"];

/** Writes what the reviewer reads besides the code into `dir`: the change, its commits, and recent ones on main. */
export function writeChange(cwd, dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "diff.patch"), git(["diff", "origin/main...HEAD"], cwd));
  writeFileSync(join(dir, "commits.txt"), git(["log", "--stat", "origin/main..HEAD"], cwd));
  writeFileSync(join(dir, "main-commits.txt"), git(["log", "-20", "origin/main"], cwd));
}

export function reviewPrompt({ branch, task, note, previous, change }) {
  return [
    `You're reviewing the branch "${branch}" of this repository before it's merged into main. Review only: you can read files, but not change them or run commands.`,
    `What it's for:\n${task}`,
    `The change, \`git diff origin/main...HEAD\`, is in ${join(change, "diff.patch")}. Its commits, with their messages, are in ${join(change, "commits.txt")}, and the last 20 commits on main, for how messages are written here, in ${join(change, "main-commits.txt")}. The repository's files are as the branch has them. AGENTS.md says how features are built and bugs fixed here, and what a commit should look like: read it. Read the code around the change, not just the diff. Check that the change does what it's for, and fixes a bug's cause, not just where it shows; that it's correct, on every path that handles the same data; that it matches the code around it; that new behaviour has tests; that everything describing the behaviour (CLI help, the skill, the README, the tour's notes) says what it now does; that nothing unrelated changed; and that the commits follow AGENTS.md.`,
    "The checks (typecheck, tests, builds, the examples and the desktop smoke test) have passed. They only show what they test: look for what they don't, such as failures, edge cases and what happens at once.",
    ...(previous ? [`Your last review of this branch, at ${previous.commit.slice(0, 7)}, found defects:\n${previous.report}\n\nCheck whether they're fixed, but review the whole branch again.`] : []),
    ...(note ? [`${previous ? "The author's reply to that review" : "A note from the author"}:\n${note}`] : []),
    [
      "List every finding in findings, with its file, its line if it has one, the problem, and why it matters. Mark each one:",
      "- defect: it must be fixed before the branch is merged. That's anything in what the branch adds or changes, or relies on, that doesn't work as it should on any path, including edge cases and failures: an error answer, a restart, a race, a value at or past a limit. A setting, message, help text or document that says something the code doesn't do. A weakness in security, privacy or abuse protection. New behaviour without a test. A commit that doesn't follow AGENTS.md. A change the task didn't need.",
      "- suggestion: an improvement that isn't a defect, such as a clearer name, a simpler way, or a test for something that already works.",
      "If you're not sure whether something is a defect, it is one: the author can say why it isn't with --note. The branch is merged only if there are no defects, so don't call one a suggestion because it's small, rare, or could be fixed later. In summary, say what you checked, and whether the branch does what it's for.",
    ].join("\n"),
  ].join("\n\n");
}

/** Reviews the branch with the claude CLI, on read-only tools. Resolves to its verdict. */
export function claudeReview({ cwd, branch, task, note, previous, log }) {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-review-"));
  const change = join(dir, "change");
  writeChange(cwd, change);
  const settings = join(dir, "settings.json");
  // The reviewer's own hooks have nothing to do with a review.
  writeFileSync(settings, JSON.stringify({ disableAllHooks: true, permissions: { allow: REVIEWER_TOOLS } }));
  const args = ["-p", "--output-format", "json", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", REVIEWER_TOOLS.join(","), "--add-dir", change, "--settings", settings, "--json-schema", JSON.stringify(VERDICT_SCHEMA)];
  const s = spawnArgs("claude", args);
  return new Promise((resolve, reject) => {
    const child = spawn(s.command, s.args, { cwd, shell: s.shell, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const started = Date.now();
    const tick = setInterval(() => log(`Still reviewing (${Math.round((Date.now() - started) / 60_000)} min)`), 60_000);
    const limit = setTimeout(() => child.kill(), 30 * 60_000);
    const done = () => {
      clearInterval(tick);
      clearTimeout(limit);
      rmSync(dir, { recursive: true, force: true });
    };
    child.on("error", (error) => {
      done();
      reject(error.code === "ENOENT" ? new Stop("pnpm land reviews with the claude CLI (Claude Code), and it isn't installed here.") : error);
    });
    child.on("close", (code) => {
      done();
      let result;
      try {
        result = JSON.parse(out);
      } catch {
        // Reported below.
      }
      const verdict = result?.structured_output;
      if (code !== 0 || result?.is_error || !wellFormed(verdict)) {
        const why = (typeof result?.result === "string" && result.result) || err || out;
        return reject(new Stop(`The review didn't finish: ${why.trim() || `claude exited with ${code}`}`));
      }
      resolve(verdictFrom(verdict));
    });
    child.stdin.end(reviewPrompt({ branch, task, note, previous, change }));
  });
}

/** The last review of each branch, so the next one can see what it asked for. */
const lastReview = {
  file: (branch, cwd) => join(stateDir(cwd), "reviews", `${encodeURIComponent(branch)}.json`),
  get(branch, cwd) {
    const file = this.file(branch, cwd);
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  },
  set(branch, review, cwd) {
    mkdirSync(join(stateDir(cwd), "reviews"), { recursive: true });
    writeFileSync(this.file(branch, cwd), JSON.stringify(review, null, 2));
  },
  delete(branch, cwd) {
    rmSync(this.file(branch, cwd), { force: true });
  },
};

const isAncestor = (a, b, cwd) => capture("git", ["merge-base", "--is-ancestor", a, b], { cwd }).status === 0;

/** Rebases onto origin/main, if it moved. A conflict undoes the rebase and stops. */
function rebase(root, log) {
  if (isAncestor("origin/main", "HEAD", root)) return;
  const before = git(["rev-parse", "HEAD"], root);
  log("Rebasing onto origin/main");
  if (capture("git", ["rebase", "origin/main"], { cwd: root }).status !== 0) {
    capture("git", ["rebase", "--abort"], { cwd: root });
    throw new Stop("Rebasing onto main hit conflicts, so the rebase was undone. Run git rebase origin/main, resolve them, and run pnpm land again: the result gets a new review.");
  }
  // AGENTS.md asks for another review only when a rebase had conflicts, so a clean one keeps the approval.
  if (approved.has(before, root)) approved.add(git(["rev-parse", "HEAD"], root), root);
}

const samePath = (a, b) => realpathSync(a) === realpathSync(b);

/** After the push: brings the main checkout up to date, and removes the worktree and the branch. */
function tidy({ root, branch, keepWorktree, log }) {
  const mainRoot = git(["worktree", "list", "--porcelain"], root).split("\n")[0].replace(/^worktree /, "");
  if (samePath(mainRoot, root)) {
    log(`This is the main checkout, so it stays on ${branch}. To move it to main: git switch main && git merge --ff-only origin/main && git branch -d ${branch}`);
    return;
  }
  const mainBranch = git(["branch", "--show-current"], mainRoot);
  if (mainBranch === "main") {
    // Never stashes, resets or checks out over changes there: a fast-forward refuses instead.
    const ff = capture("git", ["merge", "--ff-only", "origin/main"], { cwd: mainRoot });
    log(ff.status === 0 ? `Brought the main checkout (${mainRoot}) up to date.` : `Couldn't fast-forward the main checkout (${mainRoot}), so it was left as it is:\n${(ff.stderr || ff.stdout).trim()}`);
  } else {
    log(`The main checkout (${mainRoot}) is on ${mainBranch || "no branch"}, not main, so it was left as it is.`);
  }
  if (keepWorktree || root.replace(/\\/g, "/").includes("/.claude/worktrees/")) {
    log("Left the worktree and the branch for whatever made them to remove.");
    return;
  }
  const removed = capture("git", ["worktree", "remove", root], { cwd: mainRoot });
  if (removed.status !== 0) return log(`Couldn't remove the worktree ${root}:\n${(removed.stderr || removed.stdout).trim()}`);
  const deleted = capture("git", ["branch", "-d", branch], { cwd: mainRoot });
  log(deleted.status === 0 ? `Removed the worktree and the branch ${branch}.` : `Removed the worktree, but not the branch ${branch}:\n${(deleted.stderr || deleted.stdout).trim()}`);
}

/**
 * Lands the branch checked out in `cwd`. `review` and `verify` are the review and the checks:
 * Claude and pnpm verify, unless a test swaps them. Throws Stop when it needs someone.
 */
export async function land({ cwd, task, note, keepWorktree = false, review = claudeReview, verify = runChecks, log = (m) => console.log(`\n[land] ${m}`) }) {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  const branch = git(["branch", "--show-current"], root);
  if (!branch) throw new Stop("Check out the branch you want to land first.");
  if (branch === "main") throw new Stop("This is main. Land a branch, made in a worktree of its own (AGENTS.md, Before you start).");

  // A dev server's launch.json entry is never part of a change.
  if (capture("git", ["diff", "--quiet", "HEAD", "--", ".claude/launch.json"], { cwd: root }).status === 1) {
    git(["restore", "--source=HEAD", "--staged", "--worktree", ".claude/launch.json"], root);
  }
  const status = git(["status", "--porcelain"], root);
  if (status) throw new Stop(`Commit or remove these changes first:\n${status}`);
  // pnpm install puts the pre-push hook in place, but a branch from before it moved there can undo
  // that, so make sure of it before pushing.
  setupHooks(root, log);

  log("Fetching origin");
  git(["fetch", "origin"], root);
  if (git(["rev-list", "--count", "origin/main..HEAD"], root) === "0") throw new Stop(`Nothing to land: ${branch} has no commits that aren't on main.`);
  const needsTask = () => new Stop(`${branch} needs a review, and the reviewer needs to know what it's for: pnpm land --task "<what you were asked to do>"`);
  // Before the checks, so they aren't run for nothing.
  if (!task && !approved.has(git(["rev-parse", "HEAD"], root), root)) throw needsTask();

  for (let attempt = 1; ; attempt++) {
    rebase(root, log);
    const head = git(["rev-parse", "HEAD"], root);

    const tree = git(["rev-parse", "HEAD^{tree}"], root);
    if (verified.has(tree, root)) {
      log("These files already passed the checks.");
    } else {
      log("Running the checks (pnpm verify)");
      if (!(await verify(root)) || !verified.has(tree, root)) throw new Stop("The checks didn't pass. Fix what failed in a new commit, and run pnpm land again.");
    }

    if (approved.has(head, root)) {
      log(`${head.slice(0, 7)} is already approved.`);
    } else {
      if (!task) throw needsTask();
      const last = lastReview.get(branch, root);
      const commits = git(["rev-list", "--count", "origin/main..HEAD"], root);
      log(`Reviewing ${branch} (${commits} commit${commits === "1" ? "" : "s"}). This takes a few minutes.`);
      const verdict = await review({ cwd: root, branch, task, note, previous: last && !last.approved ? last : undefined, log });
      // Its tools only read, but if something changed here anyway, landing it would skip the review.
      const changed = git(["status", "--porcelain"], root);
      if (changed || git(["rev-parse", "HEAD"], root) !== head) throw new Stop(`The reviewer changed the worktree, which it mustn't, so nothing was landed. Look at what it did:\n${changed || "HEAD moved"}`);
      // Approved only with no defects, counted here from the findings, whatever else the review says.
      const found = defects(verdict).length;
      lastReview.set(branch, { commit: head, ...verdict, approved: found === 0 }, root);
      log(`Review of ${head.slice(0, 7)}: ${found === 0 ? "approved" : "changes requested"}\n\n${verdict.report}`);
      if (found > 0) {
        throw new Stop(`${found} defect${found === 1 ? "" : "s"} must be fixed first. Fix them in a new commit, and run pnpm land again for a review of the whole branch. If you think a finding is wrong, say why with --note "...", and the reviewer decides.`);
      }
      approved.add(head, root);
    }

    log("Pushing to main");
    const push = capture("git", ["push", "origin", "HEAD:main"], { cwd: root });
    if (push.status === 0) {
      log(`Pushed ${head.slice(0, 7)} to main.`);
      break;
    }
    git(["fetch", "origin"], root);
    if (isAncestor("origin/main", "HEAD", root)) throw new Stop(`git push failed:\n${(push.stderr || push.stdout).trim()}`);
    if (attempt === ATTEMPTS) throw new Stop("main kept moving while this was being checked. Run pnpm land again.");
    log("main moved while this was being checked, so going round again.");
  }

  lastReview.delete(branch, root);
  tidy({ root, branch, keepWorktree, log });
}

if (isMain(import.meta.url)) {
  let values;
  try {
    ({ values } = parseArgs({ options: { task: { type: "string" }, note: { type: "string" }, "keep-worktree": { type: "boolean" }, help: { type: "boolean", short: "h" } } }));
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  land({ cwd: process.cwd(), task: values.task, note: values.note, keepWorktree: values["keep-worktree"] }).then(
    () => process.exit(0),
    (error) => {
      console.error(`\nopen-arch land: ${error instanceof Stop ? error.message : error.stack}`);
      process.exit(1);
    },
  );
}
