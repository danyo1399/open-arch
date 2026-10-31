# open-arch

An architecture model (C4) that people and AI agents can both read and change safely.

- **One file:** the whole model lives in a `.openarch` file, JSON with a canonical layout: people, systems, containers and components, keyed by ID, each with its relationships, notes, shape and tags (name/value facts like an owner), plus views (diagrams) with their saved box positions.
- **Views are computed:** a view picks elements from the shared model, and the boxes and arrows are worked out from it, including relationships implied by nested elements. A view can also carry sticky notes: text for the people reading that diagram, which isn't part of the model.
- **Docs are generated:** markdown pages with Mermaid diagrams (an index, a page per element and per view) are generated from the model for people to read, on GitHub or anywhere else.
- **Changes are checked:** people change the model in the designer and agents change it with `open-arch` commands. Both go through the same validated operations, so a change that would break the model is refused and nothing is saved.

See [`examples/shop`](examples/shop): [`shop.openarch`](examples/shop/shop.openarch) and the [docs generated from it](examples/shop/docs/README.md). New to architecture diagrams? [`examples/food-delivery`](examples/food-delivery) is a guided tour of the C4 model: five views of a made-up food delivery business that zoom in one step at a time, with sticky notes explaining what each one shows ([docs](examples/food-delivery/docs/README.md)). The designer opens it with **Take the tour**. The [skill](packages/skill/open-arch/SKILL.md) explains the commands and the [format reference](packages/skill/open-arch/references/format.md) the file.

## Packages

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) (`@open-arch/core`) | Parses, checks, edits (through validated operations) and exports workspaces. No dependencies and no Node.js APIs, so the designer runs it in the browser. |
| [`packages/cli`](packages/cli) (`open-arch`) | The `open-arch` command: `show`, `check`, `export`, an edit command for every operation, `apply` for JSON batches, `init` and `fmt`. |
| [`packages/skill`](packages/skill) (`@open-arch/skill`) | Agent skill that `open-arch init` installs into `.agents/skills/` and `.claude/skills/`: agents read with `show` and change the model only with commands. |
| [`apps/web`](apps/web) | The designer as a static web app (React, React Flow, ELK). |
| [`apps/desktop`](apps/desktop) | The same designer in Electron, for Windows, macOS and Linux. |

## The designer

One UI, two ways to run it. Both reload when an agent or editor changes the file.

| | Web app | Desktop app |
|---|---|---|
| Open and save a .openarch file | Chrome and Edge save to the file as you work; other browsers open it and **Download** a copy | Saves to the file as you work |
| Docs | **Export docs** downloads them as a .zip | Every save rewrites the docs folder the workspace names |
| Notices outside edits | Checks every 2 seconds while the tab is visible | Watches the file |
| Try without a file | The bundled examples (the tour and the shop), or a new workspace in the tab | The bundled examples |
| Ask AI | | Sends a request to a local [OpenCode 2](https://opencode.ai) agent |
| Install | Installable as an app (Chrome, Edge, Safari's **Add to Dock** or **Add to Home Screen**) that opens offline | An installer per OS |

The web build is plain static files (`apps/web/dist`) with relative paths, so it can be hosted anywhere, including GitHub Pages. Served over HTTPS (or from localhost), it has a service worker that caches the build, so it can be installed and opened offline; opening it online always loads the latest build. The app icons in `apps/web/public` are rendered from `apps/web/icons` by `sh icons/render.sh`.

### Ask AI (desktop)

**Ask AI** sends a request, with the open view and the selection, to OpenCode's local background service, starting it if needed (`opencode serve --service`). Each request gets its own OpenCode session in the file's folder, with the project's `open-arch` skill if `open-arch init` installed it, or else the app's copy.

The agent changes the model only by running the CLI bundled with the app, which checks every change. It asks before running any other command or editing any other file, and it can't edit the .openarch file directly. Approve or deny its requests in the panel. **Undo AI change** puts the file back as it was before the request.

OpenCode's default model is used. To use another, start the app with `OPEN_ARCH_AGENT_MODEL=<provider>/<model>`.

## Using it in a project

```bash
open-arch init
```

This creates `architecture.openarch`, generates its docs into `docs/architecture/`, installs the agent skill, and adds a section to `AGENTS.md` telling agents to use it. Then open the file in the designer, or ask an agent to model the system.

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
pnpm open-arch show --file examples/shop/shop.openarch
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs when a release is published, or when you start it from the Actions tab (**CI**, then **Run workflow**). It doesn't run on pushes or pull requests: run the [checks](AGENTS.md#checks) yourself before merging. They test the desktop app only on your own system, so start a run on `main` by hand to check macOS and Windows before a release.

It has two jobs:

- **lint** (Ubuntu): typecheck, tests, the CLI build, then `open-arch check`, `fmt --check` and `export --check` on the example.
- **desktop** (macOS, Windows and Linux): the smoke test (under `xvfb-run` on Linux), then unsigned installers built with `dist`. The smoke screenshots and the installers (`.dmg`/`.zip`, `.exe`, `.AppImage`/`.deb`) are uploaded as artifacts of the run.
