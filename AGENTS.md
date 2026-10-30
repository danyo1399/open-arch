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
5. Run the checks below, then [review and merge](#review-and-merge).

## Fixing a bug

1. Reproduce it. Where the code is testable (core, the CLI, the designer's model, layout and routing), write a test that fails because of the bug. For a bug that only shows in the UI, reproduce it in the designer.
2. Find the cause, not just the place it shows up. Look for the same mistake on the other paths: the CLI, the designer, `show`, the docs and Mermaid often each handle the same data.
3. Fix it, and keep the test.
4. Run the checks below, then [review and merge](#review-and-merge).

## Checks

The same as [CI](.github/workflows/ci.yml). Every one must pass before a branch is merged into `main`.

```bash
pnpm typecheck && pnpm test && pnpm build
```

```bash
(for f in examples/*/*.openarch; do pnpm open-arch check --file "$f" && pnpm open-arch fmt --check --file "$f" && pnpm open-arch export --check --file "$f" || exit 1; done)
```

If `export --check` fails because the docs were meant to change, regenerate them with `pnpm open-arch export --file <example>` and include them in the change.

Unless the change only touches Markdown, also run the desktop smoke test. The desktop app bundles the designer, core, the CLI and the skill, so most changes reach it.

```bash
pnpm --filter @open-arch/desktop smoke
```

Done means: the checks pass, new behaviour has tests, everything that describes the behaviour (CLI help, skill, README, the tour's notes) says what it now does, nothing unrelated changed, a reviewer approved it, and it's merged into `main` and pushed.

## Review and merge

Every change is reviewed by a subagent before it reaches `main`.

1. Commit your work on the branch.
2. Ask a subagent to review the branch. Give it the task and how to see the change: `git fetch origin`, then `git diff origin/main...HEAD` and `git log origin/main..HEAD` in the worktree. Point it at this file, and ask for its findings and a verdict: **approved** or **changes requested**. Don't give it your own view of the change; let it read the code fresh. It reviews only: it doesn't edit files.
3. If it approves, go on to step 4: an approval on the first review is enough. If it requests changes, fix them, commit, and go back to step 2 for a review of the whole branch. If you think a finding is wrong, don't skip it quietly: say why in the next request, and let the reviewer decide.
4. Bring the branch up to date: undo any change to `.claude/launch.json` (`git restore .claude/launch.json`), then `git fetch origin`, then `git rebase origin/main` in the worktree. If the rebase had conflicts, go back to step 2 once they're resolved.
5. Run all the [checks](#checks) on the result. Nothing is merged until every one passes. If one fails, fix it and go back to step 2.
6. Push from the worktree: `git push origin HEAD:main`. Git refuses unless it's a fast-forward; if it does, `main` moved: go back to step 4.
7. Update the main checkout (the first path in `git worktree list`), but only if `git -C <main> branch --show-current` prints `main`: `git -C <main> merge --ff-only origin/main`. If it prints anything else, or the merge refuses because of local commits or another session's uncommitted changes, leave it and tell the user. Never stash, reset or check out over changes there.
8. Remove the worktree and the branch, from the main checkout in one command: `git -C <main> worktree remove <path> && git -C <main> branch -d <branch>`. If a tool created the worktree, let the tool remove it.

## Commits

- Each commit is one complete feature or fix, with a full message. Commits land on `main` as they are, so squash work in progress before the first review. Fixes for a review's findings go in their own commit: "Fix review findings in the phone layout".
- The subject says what changed, in plain words: "Pick a box's shape from a list, and give tags values". The body explains what and why, with a bullet per layer (Format, Operations, CLI, Designer, Docs, the skill), wrapped at 72 columns. See `git log` for examples.

## Writing

The README, the skill, CLI help and the designer's text use short, plain sentences, and say what something does for the person using it. Write docs, messages and comments the same way.
