# open-arch

An architecture model (C4) kept as markdown files, readable and editable by people and AI agents.

- **Model:** one markdown file per person, system, container and component, with YAML frontmatter (`kind`, `name`, `parent`, `technology`, `uses`, ...) and free-form documentation below it.
- **Views:** one markdown file per diagram. A view picks elements from the shared model; the boxes and arrows are computed, including relationships implied by nested elements. Each view carries a generated Mermaid preview, so GitHub shows the diagram, and a layout comment for box positions saved by the designer.

People edit the files in the designer (web or desktop), agents edit them directly using the skill, and the `open-arch` CLI checks the result. See [`examples/shop`](examples/shop) for a small workspace, and [the format reference](packages/skill/open-arch/references/format.md) for the details.

## Packages

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) (`@open-arch/core`) | Reads, validates, formats and edits workspaces. No Node.js APIs, so the designer runs it in the browser. |
| [`packages/cli`](packages/cli) (`open-arch`) | The `open-arch` command: `init`, `check`, `fmt`, `show`, `new`, `rename`. |
| [`packages/skill`](packages/skill) (`@open-arch/skill`) | Agent skill (`SKILL.md` + reference) that `open-arch init` installs into `.agents/skills/` and `.claude/skills/`. |
| [`apps/web`](apps/web) | The designer as a static web app (React, React Flow, ELK). |
| [`apps/desktop`](apps/desktop) | The same designer in Electron, for Windows, macOS and Linux. |

## The designer

One UI, two ways to run it. Both read and write the same files, and both reload when an agent or editor changes them.

| | Web app | Desktop app |
|---|---|---|
| Open a folder and save as you edit | Chrome and Edge (File System Access API) | Yes |
| Other browsers | Open a folder read-only; edits stay in the tab, download them as a .zip | n/a |
| Notices outside edits | Checks every 2 seconds while the tab is visible | Watches the folder |
| Try without files | Bundled example, or an empty workspace in the tab | Bundled example |

The web build is plain static files (`apps/web/dist`) with relative paths, so it can be hosted anywhere, including GitHub Pages.

## Development

Needs Node.js 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm test
```

Run the web designer with live reload on http://localhost:5173:

```bash
pnpm --filter @open-arch/web dev
```

Build the static web app into `apps/web/dist`:

```bash
pnpm --filter @open-arch/web build
```

Run the desktop app (builds the web app first):

```bash
pnpm --filter @open-arch/desktop start
```

Run the desktop app against the web dev server, so UI changes reload live (start the web dev server first):

```bash
pnpm --filter @open-arch/desktop dev
```

Check the desktop app end to end against a temporary copy of the example; screenshots go to `apps/desktop/smoke/`:

```bash
pnpm --filter @open-arch/desktop smoke
```

Package installers for the current platform into `apps/desktop/release/`:

```bash
pnpm --filter @open-arch/desktop dist
```

Build and use the CLI:

```bash
pnpm build
```

```bash
pnpm open-arch check --root examples/shop
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request:

- **lint** (Ubuntu): typecheck, tests, the CLI build, then `open-arch check` and `fmt --check` on `examples/shop`.
- **desktop** (macOS, Windows and Linux): the smoke test (under `xvfb-run` on Linux), then unsigned installers built with `dist`. The smoke screenshots and the installers (`.dmg`/`.zip`, `.exe`, `.AppImage`/`.deb`) are uploaded as artifacts of the run.
