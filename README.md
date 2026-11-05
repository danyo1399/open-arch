# open-arch

An architecture model (C4) that people and AI agents can both read and change safely.

- **One file:** the whole model lives in a `.openarch` file, JSON with a canonical layout: people, systems, containers, components, shared libraries and classes, keyed by ID, each with its relationships (one way, or both ways), notes, shape and tags (name/value facts like an owner), plus views (diagrams) with their saved box positions. Elements, relationships and views each have a one-line description, shown on the diagram, and markdown notes for longer documentation.
- **Views are computed:** a view picks elements from the shared model, and the boxes and arrows are worked out from it, including relationships implied by nested elements. A class view draws the classes inside one component or shared library as a UML class diagram, with their attributes and methods. A sequence view shows what happens in order instead: numbered steps between elements, each going along a relationship in the model. A state view shows the states something can be in, and the transitions between them. A view can also carry sticky notes: text for the people reading that diagram, which isn't part of the model.
- **Docs are generated:** markdown pages with Mermaid diagrams (an index, a page per element and per view) are generated from the model for people to read, on GitHub or anywhere else.
- **Changes are checked:** people change the model in the designer and agents change it with `open-arch` commands. Both go through the same validated operations, so a change that would break the model is refused and nothing is saved.

Try the designer in your browser at <https://danyo1399.github.io/open-arch/>, with nothing to install.

See [`examples/shop`](examples/shop): [`shop.openarch`](examples/shop/shop.openarch) and the [docs generated from it](examples/shop/docs/README.md), including a [sequence view](examples/shop/docs/views/place-order.md) of an order being placed, a [class view](examples/shop/docs/views/order-repository-classes.md) of the code that stores orders, a [logging library](examples/shop/docs/elements/logging.md) built into two containers, and a [state view](examples/shop/docs/views/order-states.md) of an order's lifecycle. New to architecture diagrams? [`examples/food-delivery`](examples/food-delivery) is a guided tour of the C4 model: views of a made-up food delivery business that zoom in one step at a time, from the whole business down to the code, with sticky notes explaining what each one shows ([docs](examples/food-delivery/docs/README.md)). The designer opens it with **Take the tour**. The [skill](packages/skill/open-arch/SKILL.md) explains the commands and the [format reference](packages/skill/open-arch/references/format.md) the file.

## Packages

| Package | What it is |
|---|---|
| [`packages/core`](packages/core) (`@open-arch/core`) | Parses, checks, edits (through validated operations) and exports workspaces. No dependencies and no Node.js APIs, so the designer runs it in the browser. |
| [`packages/cli`](packages/cli) (`open-arch`) | The `open-arch` command: `show`, `check`, `export`, an edit command for every operation, `apply` for JSON batches, `init` and `fmt`. |
| [`packages/skill`](packages/skill) (`@open-arch/skill`) | Agent skill that `open-arch init` installs into `.agents/skills/` and `.claude/skills/`: agents read with `show` and change the model only with commands. |
| [`apps/web`](apps/web) | The designer as a static web app (React, React Flow, ELK). |
| [`apps/desktop`](apps/desktop) | The same designer in Electron, for Windows, macOS and Linux. |
| [`apps/server`](apps/server) (`@open-arch/server`) | The share server, which keeps workspaces shared as links. They're encrypted before they're uploaded, so it can't read them. In Go: one executable for Linux, or a container. |

## The designer

One UI, two ways to run it.

| | Web app | Desktop app |
|---|---|---|
| Where workspaces live | In the browser's storage (IndexedDB), as many as you like, saved as you work. **Import file…** and **Export file…** copy .openarch files in and out; nothing stays linked to a file | In a .openarch file, saved as you work |
| Docs | **Export docs** downloads them as a .zip | Every save rewrites the docs folder the workspace names |
| Notices outside edits | Edits to the same workspace in another tab, and deleting it there: it stays open, and **Save** keeps it again | Watches the file, so an agent's or editor's changes show up |
| Try without a file | The bundled examples (the tour and the shop); **Save** keeps a copy in the browser | The bundled examples |
| Share a link | **Share** makes a link that opens a copy; clicking it opens the workspace | The same, and links open in the web designer; **Open link…** opens one |
| Ask AI | | Sends a request to a local [OpenCode 2](https://opencode.ai) agent |
| Install | Installable as an app (Chrome, Edge, Safari's **Add to Dock** or **Add to Home Screen**) that opens offline | An installer per OS |

The web app's workspaces are only in that browser, on that device, and clearing the site's data deletes them, so export a copy of anything you want to keep. The URL names the open workspace, so reloading the page reopens it. Import and export go through a `FileProvider` ([`apps/web/src/providers.ts`](apps/web/src/providers.ts)): files on this device are the only one so far, and cloud storage such as Dropbox or iCloud Drive can be added as another.

The web build is plain static files (`apps/web/dist`) with relative paths, so it can be hosted anywhere. The [Pages workflow](.github/workflows/pages.yml) publishes it to GitHub Pages, at <https://danyo1399.github.io/open-arch/>, each time `main` changes. Served over HTTPS (or from localhost), it has a service worker that caches the build, so it can be installed and opened offline; opening it online always loads the latest build. Where the browser can install it, the start page offers to: **Install** opens the browser's own dialog in Chrome, Edge and other Chromium browsers, and on an iPhone or iPad, or in Safari on a Mac, it says where the browser's command is. **Not now** hides the offer in that browser for good. The app icons in `apps/web/public` are rendered from `apps/web/icons` by `sh icons/render.sh`.

### Moving round the diagram

With a mouse, drag across the diagram's background to select the boxes and sticky notes inside, or Ctrl-click them (⌘-click on a Mac) to add one or take it out. Drag any of them to move them all together; Undo takes the move back in one step. The scroll wheel pans, as do Space and drag and the middle button, and Ctrl-scroll (⌘-scroll on a Mac) or a pinch zooms. On a touch screen, drag to pan and pinch to zoom.

Drag from the dot under a box to another box to add a relationship. To move one, select its arrow and drag the dot at either end to another box: the relationship keeps its description, technology, tags and notes. An arrow that stands for several relationships moves them all. When two elements call each other, select the relationship and tick **Goes both ways**: its arrow gets a head at each end, and stands for every relationship between the two boxes.

### What a view shows

A new view shows everything in its scope, and elements added to the model later turn up in it on their own. To keep one view to the boxes you chose, select its background and set **New elements** to **Show only when added here**. It keeps the boxes it has now, and nothing new appears in it unless you add it on that diagram or choose **Show in this view**. Set it back to **Show here automatically** for a view that should always show everything, such as an overview. Either way, **Hide from this view** takes a box out of just that view.

### Sequence views

A sequence view shows what happens, in order: a lifeline for each element in it, and each step as a numbered arrow from one to another. Make one with **+ New view** and the **Sequence** level, and give it a title. Drag from one lifeline to another to add a step where you drop it, or use **+ Add step** to pick any element and one it uses. A step has to go along a relationship in the model, from the element or something inside it, or one that goes both ways. When there isn't one, dropping the step offers to add it, one way or both ways, or to make a relationship the other way go both ways. Or the step can be a reply back along that relationship, drawn dashed. **+ Add step** can add the relationship too. Select a step to describe it, move it up or down, or delete it. A call without a description shows its relationship's.

### Class views

A class view draws the code inside one component, C4's fourth level, as a UML class diagram. Make one with **+ New view** and the **Class** level, and pick the component. **+ Add** adds a class to it. Each class box shows its stereotype, such as «interface», its name, its attributes, and then its methods: in its details, type its **Members** one per line, in UML's notation (`+id: OrderId`, `+total(): Money`). A line with brackets is a method.

Drag from the dot under a class to another to relate them, then pick the relationship's **Kind**: an association (uses, the default), a dependency (a dashed open arrow), inheritance (a hollow triangle), realization of an interface (a dashed hollow triangle), composition (a filled diamond at the whole) or aggregation (a hollow diamond). Each kind is its own arrow. So it is on a component view of a library, which draws the classes the library holds directly as themselves. Other views draw a class as the component it's in, and its relationships as ordinary arrows.

### Shared libraries

A library is code built into several containers, such as a logging library. Add one to a component view with **+ Add** and **Library built into …**, or tick the containers built with it under **Built into** in its details (a container's details list its **Libraries** too). Each of those containers' component views draws the library inside its frame, with a dashed outline. Its code is kept in one place. A small library holds classes; a bigger one, like an SDK, can hold components, each with its own classes. Make a component view of the library to draw its components, and a class view of the library or of one of its components to draw their classes. What the library's code uses is drawn from every container built with it.

### State views

A state view shows the states something can be in, and how it moves between them: an order that's placed, paid, shipped and delivered, say. Make one with **+ New view** and the **State** level, and pick what the states are of, such as a class, or nothing in particular. **+ Add** adds a state; drag from the dot under a state to another to add a transition. Select a state to rename it, describe it, or mark it as where the view starts (drawn with a dot pointing into it) or where it can end (an arrow out to a bullseye), and to add a transition back to itself. Select a transition to give it an event, a guard and an action, labelled as UML writes them: `event [guard] / action`. States and transitions belong to the view, not the model.

### Exporting one view

**Export**, on the diagram's toolbar, takes the open view somewhere else, in a file named after the view's ID. On a phone, it's under **Export this view** in the top bar's menu.

- **Copy as Mermaid** puts the diagram's Mermaid text on the clipboard, to paste into a `mermaid` code block in markdown or into a Mermaid editor.
- **Save as Markdown…** saves a markdown file with the view's title, its description and the diagram in Mermaid. Unlike the pages in the generated docs, it links to no other page, so it reads the same wherever you put it.
- **Save as PNG…**, **Save as SVG…** and **Save as PDF…** save a picture of the diagram as the designer draws it: all of it, not just the part on the screen, without the selection, and in light colours on white even in dark mode, to suit a document or a slide. The PNG and the PDF are drawn at twice the screen's resolution, so they stay sharp in print. The SVG draws the boxes as web page content inside the SVG, which browsers show but some drawing programs can't edit. The PDF is one page the size of the diagram, holding the PNG picture, so its text can't be selected.

### Sharing a link

**Share**, in the top bar, makes a link to the open workspace, for anyone to open. On a phone, it's **Share a link…** in the top bar's menu. An example is only in its tab until it's saved, so save it first. Whoever clicks the link sees the workspace in the designer, in their browser, with nothing to install. Their edits stay in that tab until they choose **Save**, which keeps a copy in their browser. In the desktop app, **Save as…** saves it as a file. To open a link in the desktop app, or in the installed web app, paste it into **Open link…** on the start page.

The workspace is compressed and encrypted on your device before it's uploaded, with a new random key. The key is in the link, after the `#`, which browsers never send to a server, so the share server only has a file it can't read. Nobody signs in: anyone with the link can open the workspace.

Only you can change what you shared, from the browser or the computer you shared it from, which keeps the link with a token from the server. Changes you make aren't in the link until you choose **Update link**. Links you already sent open the latest version. **Stop sharing** deletes the copy on the server, and the links stop working. Do that before deleting the workspace: deleting it leaves its link working.

Sharing needs a [share server](#the-share-server). The designer only offers it when it was built with one.

### The Views and Model lists

The Model list has every element in alphabetical order, with the contents of each system and container below it, in alphabetical order too. The menu beside **+ New view** sorts the Views list by name, or by level from landscape down to class, with sequence and state views last. To keep a view at the top of the list, select the pin by its name; select it again to unpin the view. The designer opens the first view in the list. The order and the pins are yours: they're kept in the browser's storage on this computer, in the desktop app too, not in the .openarch file.

### Ask AI (desktop)

**Ask AI** sends a request, with the open view and the selection, to OpenCode's local background service, starting it if needed (`opencode serve --service`). Each request gets its own OpenCode session in the file's folder, with the project's `open-arch` skill if `open-arch init` installed it, or else the app's copy.

The agent changes the model only by running the CLI bundled with the app, which checks every change. It asks before running any other command or editing any other file, and it can't edit the .openarch file directly. Approve or deny its requests in the panel. **Undo AI change** puts the file back as it was before the request.

OpenCode's default model is used. To use another, start the app with `OPEN_ARCH_AGENT_MODEL=<provider>/<model>`.

## The share server

[`apps/server`](apps/server) keeps the workspaces shared as links. It never has their keys, so it can't read them.

A link looks like `https://<designer>/?share=<ID>&v=<hash>#key=<key>`. The ID names the shared workspace, and the hash names one version of it: the first 128 bits of the SHA-256 of its encrypted file. So a new version has a new URL, and each version's file is served with `Cache-Control: public, max-age=31536000, immutable`, for browsers and proxies to cache for good. Opening a link first asks which version is the latest, a small answer that's checked each time (`no-cache`, with an ETag), so old links open new versions. Offline, the link's own version opens, if the browser cached it.

| Request | Does |
|---|---|
| `POST /v1/workspaces` | Uploads a new workspace. Answers with its `id`, the `hash` of the version, and the `token` that changes it |
| `PUT /v1/workspaces/<id>` | Uploads a new version, with `Authorization: Bearer <token>` |
| `DELETE /v1/workspaces/<id>` | Stops sharing it, with the token. Its files are deleted |
| `GET /v1/workspaces/<id>` | Its latest version's `hash` |
| `GET /v1/workspaces/<id>/<hash>` | That version's encrypted file |

An uploaded file is one byte for the format (`1`), AES-GCM's 12-byte IV, then the ciphertext of `{"name", "text"}`, the file name and the `.openarch` text, as JSON compressed with DEFLATE. The key is 256 random bits. The server only checks the format byte and the size: at most 1 MB.

To find and stop abuse, the server keeps a record of every upload: the workspace, the version's hash and size, the time, and what the request said about who sent it. That's the IP address, the user agent, the `Origin` and `Referer` headers, and, behind Cloudflare's proxy, the country and Cloudflare's request ID. It keeps only a hash of each token. One IP address can upload 60 files an hour.

The server is written in Go, and builds to one static executable with nothing to install where it runs, not even a C library: its SQLite is pure Go. It keeps its records in SQLite, in `<data>/shares.db`, and each version's encrypted file in `<data>/files/`. It brings the database's tables ([`migrations/`](apps/server/migrations)) up to date as it opens it.

Build the designer with the server's address in `VITE_SHARE_SERVER`. The Pages and CI workflows take it from the repository's `SHARE_SERVER` variable (**Settings**, **Secrets and variables**, **Actions**, **Variables**), and the Cloudflare build of the designer from its build variables. Links made in the desktop app open in the web designer at `VITE_SHARE_APP_URL`, <https://danyo1399.github.io/open-arch/> unless it's set.

The designer is served over HTTPS, and browsers only let it talk to a server over HTTPS too. So put a reverse proxy that does HTTPS in front, such as Caddy, nginx, Cloudflare's, or a hosting platform's own, and tell the server to believe the address the proxy passes on (`TRUST_PROXY`, below). Caddy, for example, gets a certificate for the domain by itself:

```bash
caddy reverse-proxy --from share.example.com --to localhost:8787
```

### Settings

Each is a flag or an environment variable; the flag wins. `open-arch-share help` lists them, with the commands.

| Flag | Variable | Does |
|---|---|---|
| `--port` | `PORT` | The port to listen on: 8787 unless it's set |
| `--host` | `HOST` | The address to listen on: all of them unless it's set |
| `--data` | `DATA_DIR` | The folder for records and files: `./data` unless it's set (`/data` in the container) |
| `--memory` | `DATA_DIR=:memory:` | Keeps everything in memory instead, and forgets it when the server stops |
| `--trust-proxy` | `TRUST_PROXY` | Whose word to take for a request's IP address. `none`, the default: the connection's. `forwarded`: the last address in `X-Forwarded-For`, which a reverse proxy adds. `cloudflare`: `CF-Connecting-IP`, and the country from `CF-IPCountry`, behind Cloudflare's proxy. Only set it when that proxy is really in front: otherwise anyone can choose the address they're recorded with |
| `--max-bytes` | `MAX_BYTES` | The largest encrypted workspace: 1000000 bytes unless it's set |
| `--uploads-per-hour` | `UPLOADS_PER_HOUR` | How many files one IP address can upload in an hour: 60 unless it's set |
| `--quiet` | `LOG=off` | Doesn't print a line for each request |

### As a Linux executable

The executable runs on any Linux on x64 or arm64, Alpine and other musl ones too, and is about 11 MB. The [CI workflow](#ci) builds both and uploads each as an artifact of the run. To build them yourself, with Go 1.26+ on any system, into `apps/server/release/`:

```bash
pnpm --filter @open-arch/server executable
```

That writes `open-arch-share-linux-x64` and `open-arch-share-linux-arm64`, and on Linux runs the one for the machine to check it works. Run it with a data folder:

```bash
./open-arch-share-linux-x64 --data /var/lib/open-arch-share --port 8787
```

Stop it with Ctrl+C or SIGTERM: it finishes the requests under way first.

To run it as a service, [`apps/server/linux/open-arch-share.service`](apps/server/linux/open-arch-share.service) is a systemd unit. It runs as its own user, keeps its data in `/var/lib/open-arch-share`, and listens only on the machine, for a reverse proxy that does HTTPS in front:

```bash
sudo cp open-arch-share-linux-x64 /usr/local/bin/open-arch-share
sudo useradd --system --no-create-home --shell /usr/sbin/nologin open-arch-share
sudo cp apps/server/linux/open-arch-share.service /etc/systemd/system/
sudo systemctl enable --now open-arch-share
```

`journalctl -u open-arch-share` shows its log. To update it, replace the file and `sudo systemctl restart open-arch-share`.

### In a container

[`apps/server/Dockerfile`](apps/server/Dockerfile) builds an image with the executable and nothing else, about 17 MB. Run it with a volume for `/data`, so what's shared outlives the container:

```bash
docker build -t open-arch-share apps/server
docker run -d --name open-arch-share -p 8787:8787 -v open-arch-share:/data open-arch-share
```

Or with Compose, from [`apps/server/compose.yaml`](apps/server/compose.yaml):

```bash
docker compose -f apps/server/compose.yaml up -d
```

Settings are environment variables (`-e TRUST_PROXY=forwarded`). The image runs as an unprivileged user, checks its own health, and stops cleanly when the container is stopped. A hosting platform that runs containers runs it too, as long as it keeps `/data` on a disk that lasts: one without, such as a serverless container, forgets what's shared when it restarts.

### Taking down abuse

Find a workspace by its ID (the `share` in its link), or by who uploaded it, then block it. Its files are kept, but no longer served. To stop an address uploading, block it too. They work while the server runs, on the same data folder: add `--data <folder>` if it isn't `./data`.

```bash
open-arch-share uploads --workspace <id>
open-arch-share uploads --ip <address>
open-arch-share block <id> --reason "<why>"
open-arch-share block-ip <address> --reason "<why>"
```

`unblock` and `unblock-ip` undo them. As the systemd service, run them as its user: `sudo -u open-arch-share open-arch-share block <id> --data /var/lib/open-arch-share --reason "<why>"`. In a container, `docker exec open-arch-share open-arch-share …`, or with Compose, `docker compose -f apps/server/compose.yaml exec share open-arch-share …`.

A browser that cached a version's file can still open it offline. Online, opening a link asks the server first, so it won't open.

### Trying it locally

Run the share server from its source, with everything in memory, on <http://localhost:8787>:

```bash
pnpm --filter @open-arch/server dev
```

Then run the designer against it:

```bash
VITE_SHARE_SERVER=http://localhost:8787 pnpm --filter @open-arch/web dev
```

`pnpm --filter @open-arch/server start` keeps what's shared in `apps/server/data` instead, and `pnpm --filter @open-arch/server test` runs its tests.

## Using it in a project

```bash
open-arch init
```

This creates `architecture.openarch`, generates its docs into `docs/architecture/`, installs the agent skill, and adds a section to `AGENTS.md` telling agents to use it. Then open the file in the desktop app, or ask an agent to model the system. The web app can't change the file itself: import it there, then export it back over the file when you're done.

## Development

Needs Node.js 22+, pnpm, and Go 1.26+ for the share server. The designer's tests run its sharing against the share server, so `pnpm test` builds it too.

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

Run either way, or with Electron on `apps/desktop`, the app keeps the file it last opened, and Electron's other data, in the checkout's own `apps/desktop/user-data/`. So it never reopens a file that a copy in another worktree, or the installed app, last opened.

Check the desktop app end to end against a temporary copy of the example; screenshots go to `apps/desktop/smoke/`. With no display on Linux, it runs the app under `xvfb-run`:

```bash
pnpm --filter @open-arch/desktop smoke
```

Package installers for the current platform into `apps/desktop/release/`:

```bash
pnpm --filter @open-arch/desktop dist
```

Run every check a change must pass before it's merged, the same ones as CI (see [AGENTS.md](AGENTS.md#checks)):

```bash
pnpm verify
```

Have a branch reviewed by Claude, checked, and merged into `main`, from its worktree (see [AGENTS.md](AGENTS.md#review-and-merge)):

```bash
pnpm land --task "<what the branch is for>"
```

Build and use the CLI:

```bash
pnpm build
```

```bash
pnpm open-arch show --file examples/shop/shop.openarch
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs when a release is published, or when you start it from the Actions tab (**CI**, then **Run workflow**). It doesn't run on pushes or pull requests: `pnpm verify` runs the same checks before merging. They test the desktop app only on your own system, so start a run on `main` by hand to check macOS and Windows before a release.

It has three jobs:

- **lint** (Ubuntu): typecheck, tests, the share server's Go tests, the CLI build, then `open-arch check`, `fmt --check` and `export --check` on the example.
- **desktop** (macOS, Windows and Linux): the smoke test (under `xvfb-run` on Linux), then unsigned installers built with `dist`. The smoke screenshots and the installers (`.dmg`/`.zip`, `.exe`, `.AppImage`/`.deb`) are uploaded as artifacts of the run.
- **share server** (Linux on x64 and arm64): builds the [share server's executables](#as-a-linux-executable), runs the one for each, and uploads it as a `.tar.gz` artifact of the run.
