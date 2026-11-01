# Working on open-arch

How agents (and people) build features and fix bugs in this repo. What open-arch is, and every command for running it, is in the [README](README.md). `CLAUDE.md` is a link to this file, so Claude Code reads the same instructions as other agents.

## Before you start

- Several agents often work in this repo at once. Do each feature or fix on its own branch, in its own git worktree, started from `origin/main`: `git fetch origin && git worktree add -b <branch> <path> origin/main`. Never commit straight to `main`: a branch reaches it only through [review and merge](#review-and-merge). Questions that only read code don't need a branch.
- A new worktree has no `node_modules`: run `pnpm install` first.
- Port 5173 may already be another worktree's web dev server, and the dev server won't move off it (`strictPort`). Start yours on another port, `pnpm --filter @open-arch/web dev --port 5174`, and point the desktop dev app at it, as it loads 5173 otherwise: `OPEN_ARCH_DEV_URL=http://localhost:5174 pnpm --filter @open-arch/desktop dev`. Before trusting what the browser or the app shows, make sure that server was started from your worktree. Don't commit a `.claude/launch.json` entry for it.
- Read the code around the change before writing any, and match its naming, comments and style.

## How the code fits together

- **One edit path.** Every change to a model goes through `applyOperations` in [`packages/core/src/operations.ts`](packages/core/src/operations.ts), which applies a batch all-or-nothing: CLI commands, `apply` batches, the designer and Ask AI all use it. Add an operation rather than a second way to edit.
- **Core runs in the browser.** `packages/core` has no dependencies and uses no Node.js APIs. File access belongs in the CLI or the app hosts.
- **The `.openarch` file is the source of truth.** Docs are generated from it. Never edit `examples/*/docs/` by hand: change the model or the exporter, then regenerate.
- **The skill is shipped to users.** [`packages/skill`](packages/skill) teaches *their* agents the format and commands. Keep this repo's development process out of it.

## Building a feature

1. Work out which layers it touches. A change to the model usually runs through all of them:
   - format and parsing: `packages/core/src/types.ts`, `packages/core/src/document.ts`
   - checks: `packages/core/src/check.ts`
   - operations: `packages/core/src/operations.ts`
   - CLI commands and their help: `packages/cli/src/main.ts`, `packages/cli/src/commands/`
   - the designer: `apps/web`
   - generated docs and Mermaid: `packages/core/src/export.ts`, `packages/core/src/mermaid.ts`
   - the skill: `packages/skill/open-arch/SKILL.md`, `packages/skill/open-arch/references/commands.md`, `packages/skill/open-arch/references/format.md`
   - the examples and the README
2. If the file format changes, raise `FORMAT_VERSION` and upgrade older files as they're read, as `document.ts` does for version 1, so existing files keep opening. The next save writes the new version.
3. Add tests beside the existing ones (`packages/*/test`, `apps/*/test`, Vitest).
4. For a change you can see, run the designer and check it in the browser.
5. Run the [checks](#checks), then [review and merge](#review-and-merge): run `pnpm land` yourself.

## Fixing a bug

1. Reproduce it. Where the code is testable (core, the CLI, the designer's model, layout and routing), write a test that fails because of the bug. For a bug that only shows in the UI, reproduce it in the designer.
2. Find the cause, not just the place it shows up. Look for the same mistake on the other paths: the CLI, the designer, `show`, the docs and Mermaid often each handle the same data.
3. Fix it, and keep the test.
4. Run the [checks](#checks), then [review and merge](#review-and-merge): run `pnpm land` yourself.

## Checks

`pnpm verify` runs every check a branch must pass before it's merged into `main`, in order, and stops at the first that fails:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`, `pnpm test` and `pnpm build`
3. `open-arch check`, `fmt --check` and `export --check` on every example
4. the desktop smoke test, `pnpm --filter @open-arch/desktop smoke`. It's skipped when only Markdown changed since `main`. The desktop app bundles the designer, core, the CLI and the skill, so most changes reach it. With no display on Linux, it runs the app under `xvfb-run`.

```bash
pnpm verify
```

They're the same as [CI](.github/workflows/ci.yml)'s, but CI doesn't run on pushes, only for a release or when started by hand. `pnpm land` runs them for you; run `pnpm verify` yourself to see where a branch stands. When every check passes on committed work, it records that, and only work it recorded can be pushed to `main`.

If `export --check` fails because the docs were meant to change, regenerate them with `pnpm open-arch export --file <example>` and include them in the change.

Done means: the checks pass, new behaviour has tests, everything that describes the behaviour (CLI help, skill, README, the tour's notes) says what it now does, nothing unrelated changed, a reviewer approved it, and `pnpm land` merged it into `main`.

## Review and merge

`pnpm land` takes a branch from finished to merged. Once a feature or fix is finished and there's nothing left to do, run it yourself: don't hand the command to the person you're working with, or wait for them to ask. If something is still open, such as a question for them or a choice that's theirs to make, settle it first. Then tell them what landed.

Commit your work, then, in the branch's worktree:

```bash
pnpm land --task "<what you were asked to do, in a sentence or two>"
```

It stops at anything that needs you, and says what to do. In order, it:

1. Undoes any change to `.claude/launch.json`, then refuses other uncommitted changes, `main`, and a branch with nothing to land. It makes sure the pre-push hook below is in place.
2. Fetches, and rebases the branch onto `origin/main`. If the rebase hits conflicts, it undoes it and stops: run `git rebase origin/main`, resolve them, and run `pnpm land` again.
3. Runs `pnpm verify` on the result, unless these files already passed. If a check fails, fix it in a new commit and run `pnpm land` again.
4. Has Claude review the branch, unless this commit was already approved. The reviewer gets the task, the diff and the commits, and reads the code fresh. It can read files, but not change them or run anything. A rebase without conflicts keeps an approval. If the reviewer requests changes, `pnpm land` prints the findings and stops. Fix them in a new commit and run `pnpm land` again, for a review of the whole branch. If you think a finding is wrong, don't skip it quietly: say why with `--note "..."`, and the reviewer decides.
5. Pushes to `main`. If `main` moved meanwhile, it goes back to step 2.
6. Updates the main checkout (the first path in `git worktree list`) with a fast-forward, if it's on `main`. Otherwise, or if the fast-forward refuses because of local commits or another session's uncommitted changes, it leaves it as it is and says so. Tell the user.
7. Removes the worktree and the branch, unless you're in the main checkout. If a tool created the worktree (one under `.claude/worktrees/`, or pass `--keep-worktree`), it leaves them for the tool to remove.

The checks take a few minutes, and a review several more. If your shell gives commands a time limit, allow 30 minutes or run it in the background. The review needs the `claude` CLI, signed in.

Don't push to `main` any other way. `pnpm install` puts a pre-push hook in the clone's hooks folder, which every worktree shares, and it refuses a push to `main` of work `pnpm verify` hasn't passed in this clone. If the clone already has a pre-push hook, or git's hooks folder is set with `core.hooksPath`, it says so and leaves them alone.

Never force-push to `main`, whatever the reason: not with `--force`, `--force-with-lease`, a `+` refspec, or any other way. It throws away commits that other agents have landed. The pre-push hook doesn't stop it, so it's up to you. If something on `main` is wrong, fix it or `git revert` it in a new commit, and land that with `pnpm land` like any other change.

## Commits

- Each commit is one complete feature or fix, with a full message. Commits land on `main` as they are, so squash work in progress before the first review. Fixes for a review's findings go in their own commit: "Fix review findings in the phone layout".
- The subject says what changed, in plain words: "Pick a box's shape from a list, and give tags values". The body explains what and why, with a bullet per layer (Format, Operations, CLI, Designer, Docs, the skill), wrapped at 72 columns. See `git log` for examples.

## Writing

The README, the skill, CLI help and the designer's text use short, plain sentences, and say what something does for the person using it. Write docs, messages and comments the same way.
