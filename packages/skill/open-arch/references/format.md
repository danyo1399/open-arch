# open-arch file format (version 1)

An open-arch workspace is a folder containing `open-arch.yaml`. It holds one shared architecture model in the [C4 style](https://c4model.com): people, software systems, containers and components, and the relationships between them. Diagrams ("views") are computed from that model.

```
architecture/
  open-arch.yaml
  model/
    customer.md
    shop.md
    shop/
      web-app.md
      checkout-api.md
      checkout-api/
        payment-client.md
  views/
    shop-containers.md
```

## open-arch.yaml

```yaml
version: 1
model: model       # folder of element files
views: views       # folder of view files
preview: mermaid   # mermaid | none: whether view files carry a generated Mermaid diagram
```

## Which files count

- Every `.md` file under the model folder is an element, and every `.md` file under the views folder is a view, at any depth.
- `README.md` files are ignored, as are files and folders whose names start with `.` or `_` (use `_drafts/` for work in progress).
- A file's **ID** is its name without `.md`. IDs are lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique across all elements and views.
- Folders are only for tidiness. By convention an element's children live in a folder named after it (`shop.md` and `shop/`), and `open-arch new` and `open-arch rename` keep to that, but the model only uses `parent`.

Every file starts with YAML frontmatter between `---` lines, followed by free markdown. The body is documentation for people and agents: purpose, ownership, decisions, known issues.

## Element files

```markdown
---
kind: container
name: Checkout API
parent: shop
description: Validates carts, reserves stock and takes payment.
technology: Node.js
tags: [critical]
owner: team-checkout
uses:
  - to: orders-db
    description: Reads and writes orders
    technology: SQL
  - to: payment-provider
    description: Charges cards
    technology: HTTPS
---

# Checkout API

Longer notes go here.
```

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `person`, `system`, `container` or `component` |
| `name` | yes | Display name shown in diagrams. Can change freely; references use the ID. |
| `parent` | containers and components | ID of the system (for a container) or container (for a component) it belongs to. Not allowed on people and systems. |
| `description` | no | One sentence, shown in the box. |
| `technology` | no | E.g. `Node.js`, `PostgreSQL`, `React`. Usually set on containers and components. |
| `external` | no | `true` for people and systems outside your organisation. Only on people and systems. |
| `tags` | no | List of strings. `database` draws the element as a cylinder in previews. |
| `uses` | no | Outgoing relationships, see below. |

Any other field (`owner`, `repo`, `links`, ...) is allowed and kept as it is.

### Choosing a kind

- **person**: a human role that uses a system ("Customer", "Support agent").
- **system**: something that delivers value to people, owned by one team, e.g. "Shop", or a third-party service ("Payment Provider", `external: true`).
- **container**: something inside a system that runs or stores data on its own and is deployed separately: a web app, API, worker, database, queue, bucket. Not a Docker container necessarily.
- **component**: a major building block inside one container, e.g. a module, service class or controller. Only model components when they help explain the container.

### Relationships (`uses`)

Each entry is a relationship from this element to another:

| Field | Required | Meaning |
|---|---|---|
| `to` | yes | ID of the element used |
| `description` | recommended | Short verb phrase from this element's side: "Reads and writes orders", "Sends emails using" |
| `technology` | no | Protocol or mechanism: `HTTPS/JSON`, `gRPC`, `SQL`, `AMQP` |
| `tags` | no | List of strings |

A bare ID (`- orders-db`) is accepted as shorthand for `- to: orders-db`.

Relationships can't join an element to its own parent, child or anything nested in it. Put each relationship on the most detailed element it's true for. Views at higher levels show it on the enclosing container or system ("implied relationships"), so don't also repeat it on the parent.

## View files

````markdown
---
kind: view
title: Shop containers
description: What runs inside the shop.
level: container
scope: shop
include: ["*"]
exclude: [legacy-admin]
---

# Shop containers

Prose about this diagram.

<!-- open-arch:preview hash=1a2b3c4d — generated ... -->
```mermaid
...
```
<!-- /open-arch:preview -->

<!-- open-arch:layout
{
  "nodes": {
    "web-app": {"x": 0, "y": 160}
  }
}
-->
````

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | Always `view` |
| `title` | yes | Diagram title |
| `description` | no | One sentence |
| `level` | yes | `landscape`, `context`, `container` or `component` |
| `scope` | depends on level | See the table below |
| `include` | no | IDs to show, or `"*"` for the default selection. Default `["*"]`. |
| `exclude` | no | IDs to hide. Default `[]`. |

### Levels

| Level | `scope` | Boxes | `"*"` includes |
|---|---|---|---|
| `landscape` | none | People and systems | Every person and system |
| `context` | a system | People and systems | The scope system, plus every person and system connected to it |
| `container` | a system | The scope's containers inside a frame; people and other systems outside it | The scope's containers, plus everything connected to them |
| `component` | a container | The scope's components inside a frame; sibling containers; people and other systems | The scope's components, plus everything connected to them |

Each element is drawn at the level of detail the view allows. In a container view of `shop`, a component inside `shop/checkout-api` appears as `checkout-api`, and a container of another system appears as that system. Relationships move up with their elements, so `payment-client -> payment-provider` is drawn as `checkout-api -> payment-provider` in the shop's container view. Several relationships between the same two boxes become one arrow.

`include` entries are added after `"*"`. An entry more detailed than the view allows is shown as its ancestor (with a warning). `exclude` removes boxes by ID.

### Generated preview

When `preview: mermaid`, every view file holds a Mermaid flowchart between `<!-- open-arch:preview hash=... -->` and `<!-- /open-arch:preview -->`, so GitHub, GitLab and other markdown viewers show the diagram. `open-arch fmt` writes it from the model. The hash lets `check` tell a stale preview (the model changed: run `fmt`) from a hand-edited one (the edit would be lost: change the model instead). Never edit it.

### Layout comment

The `<!-- open-arch:layout ... -->` comment holds box positions saved by the open-arch designer, as JSON keyed by element ID. It's a hint: elements without a position are placed automatically, and `fmt` removes positions of elements that left the view. Don't edit it by hand; if it's broken, delete it and the designer lays the view out again.

## check rules

`open-arch check` reports `path:line: severity [rule] message`, with a `fix:` line when there's a known fix. Errors make it exit with code 1; warnings don't (unless `--strict`).

| Rule | Severity | Meaning |
|---|---|---|
| `config-invalid` | error | `open-arch.yaml` has a bad value |
| `frontmatter-missing` | error | The file doesn't start with `---` frontmatter |
| `frontmatter-invalid` | error | The frontmatter isn't valid YAML, isn't a map, or isn't closed |
| `id-format` | error | The file name isn't a kebab-case ID |
| `id-duplicate` | error | Two files have the same name |
| `field-required` | error | A required field is missing |
| `field-type` | error | A field has the wrong type (e.g. `tags` isn't a list) |
| `kind-invalid` | error | Unknown `kind` |
| `level-invalid` | error | Unknown view `level` |
| `wrong-folder` | error | A view in the model folder, or an element in the views folder |
| `parent-required` | error | A container or component has no `parent` |
| `parent-not-allowed` | error | A person or system has a `parent` |
| `parent-unknown` | error | `parent` isn't an element (the fix suggests the closest ID) |
| `parent-kind` | error | The parent has the wrong kind (container needs a system, component needs a container) |
| `external-ignored` | warning | `external` on a container or component |
| `relationship-unknown-target` | error | `uses[].to` isn't an element (the fix suggests the closest ID) |
| `relationship-self` | error | An element uses itself |
| `relationship-parent-child` | error | A relationship between an element and something nested in it |
| `relationship-description` | warning | A relationship has no `description` |
| `relationship-duplicate` | warning | The same relationship is listed twice |
| `view-scope-required` | error | A context, container or component view has no `scope` |
| `view-scope-not-allowed` | error | A landscape view has a `scope` |
| `view-scope-unknown` | error | `scope` isn't an element |
| `view-scope-kind` | error | `scope` has the wrong kind for the level |
| `view-include-unknown` | error | An `include` entry isn't an element |
| `view-include-lifted` | warning | An `include` entry is too detailed for the level and is shown as its ancestor |
| `view-include-boundary` | warning | An `include` entry is the view's own scope (it's the frame) |
| `view-exclude-unused` | warning | An `exclude` entry isn't in the view anyway |
| `preview-missing` | error | No generated preview. Run `open-arch fmt`. |
| `preview-stale` | error | The preview doesn't match the model. Run `open-arch fmt`. |
| `preview-edited` | error | The preview was edited by hand. Make the change in the model, then run `open-arch fmt`. |
| `preview-malformed` | error | The preview markers or fence are broken. Delete the block and run `open-arch fmt`. |
| `preview-duplicate` | error | More than one preview block |
| `preview-disabled` | warning | A preview exists but `preview: none` is set. Run `open-arch fmt`. |
| `layout-invalid` | error | The layout comment isn't valid JSON or isn't closed |
| `layout-duplicate` | error | More than one layout comment |
| `layout-stale` | warning | Positions for elements no longer in the view. Run `open-arch fmt`. |
| `block-in-element` | warning | A preview or layout block in an element file |

## Commands

| Command | What it does |
|---|---|
| `open-arch init [dir]` | Create a workspace; install this skill into `.agents/skills/` and `.claude/skills/`; add a section to `AGENTS.md` |
| `open-arch check [files...] [--json] [--strict]` | Validate |
| `open-arch fmt [files...] [--check]` | Canonical formatting, regenerate previews, prune layouts |
| `open-arch show [id] [--json]` | Print the model tree, an element, or a view |
| `open-arch new element <id> --kind <kind> [--parent <id>] [--name ...] [--description ...] [--technology ...] [--external] [--tag ...] [--dir ...]` | Create an element file |
| `open-arch new view <id> --level <level> [--scope <id>] [--title ...] [--description ...]` | Create a view file |
| `open-arch rename <old> <new> [--dry-run]` | Change an ID everywhere |

All commands accept `--root <dir>` to pick the workspace explicitly.
