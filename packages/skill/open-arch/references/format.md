# The open-arch workspace (format version 1)

A workspace is one `.openarch` file: JSON holding a [C4](https://c4model.com) model of people, software systems, containers and components, the relationships between them, and views (diagrams) computed from the model. Change it only with `open-arch` commands (see `commands.md`); this page explains what it contains so you can read it.

```json
{
  "openarch": 1,
  "name": "Shop",
  "description": "An online shop.",
  "export": { "docs": "docs" },
  "elements": {
    "customer": {
      "kind": "person",
      "name": "Customer",
      "uses": [
        { "to": "web-app", "description": "Browses products and places orders", "technology": "HTTPS" }
      ]
    },
    "shop": { "kind": "system", "name": "Shop", "description": "Lets customers browse products and place orders." },
    "web-app": {
      "kind": "container",
      "name": "Web App",
      "parent": "shop",
      "technology": "React",
      "properties": { "owner": "storefront-team" },
      "notes": "Single-page app served from a CDN.\n\nUses feature flags for the new checkout."
    }
  },
  "views": {
    "shop-containers": {
      "title": "Shop containers",
      "level": "container",
      "scope": "shop",
      "include": ["*"],
      "stickies": {
        "how-orders-flow": { "text": "Every order goes through the web app.", "color": "blue", "at": [260, 0] }
      },
      "layout": { "customer": [0, 0], "web-app": [0, 160] }
    }
  }
}
```

## Top level

| Field | Meaning |
|---|---|
| `openarch` | Format version, always `1` |
| `name` | Workspace name |
| `description` | Optional |
| `export.docs` | Folder, relative to the file, that tools keep filled with generated docs |
| `elements` | Elements keyed by ID |
| `views` | Views keyed by ID |

IDs are lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique across elements and views. Sticky note IDs use the same format and are unique within their view.

## Elements

| Field | Meaning |
|---|---|
| `kind` | `person`, `system`, `container` or `component` |
| `name` | Display name |
| `parent` | Containers: the system they belong to. Components: their container. Not used on people and systems |
| `description` | One sentence, shown in the box |
| `technology` | e.g. `Node.js`, `PostgreSQL` |
| `external` | `true` for people and systems outside your organisation |
| `tags` | List of strings; `database` draws a cylinder |
| `properties` | Free-form string facts, e.g. owner or repository |
| `notes` | Longer documentation, as markdown |
| `uses` | Relationships from this element: `to` (an element ID), `description`, `technology`, `tags` |

### Choosing a kind

- **person**: a human role that uses a system ("Customer", "Support agent").
- **system**: something that delivers value to people and is owned by one team, e.g. "Shop", or a third-party service ("Payment Provider", external).
- **container**: something inside a system that runs or stores data on its own and is deployed separately: a web app, API, worker, database, queue, bucket.
- **component**: a major building block inside one container, such as a module, service class or controller. Only model components when they help explain the container.

### Relationships

A relationship can't join an element to its own parent, child or anything nested in it. Put each relationship on the most detailed element it's true for. Views at higher levels show it on the enclosing container or system ("implied relationships"), so don't repeat it on the parent.

## Views

| Field | Meaning |
|---|---|
| `title` | Diagram title |
| `description` | Optional |
| `level` | `landscape`, `context`, `container` or `component` |
| `scope` | A system for context and container views, a container for component views, none for landscape |
| `include` | IDs to show, or `"*"` for the default selection |
| `exclude` | IDs to hide |
| `stickies` | Sticky notes keyed by ID: `text` (plain text; line breaks are kept), `color` (`yellow`, the default, `pink`, `blue` or `green`) and `at` (`[x, y]`, the top-left corner; without it the designer puts the note beside the diagram) |
| `layout` | Box positions saved by the designer: `[x, y]` keyed by element ID |

| Level | Boxes | `"*"` includes |
|---|---|---|
| `landscape` | People and systems | Every person and system |
| `context` | People and systems | The scope system, plus every person and system connected to it |
| `container` | The scope's containers inside a frame; people and other systems outside it | The scope's containers, plus everything connected to them |
| `component` | The scope's components inside a frame; sibling containers; people and other systems | The scope's components, plus everything connected to them |

Sticky notes belong to one view and explain that diagram to people: what to notice, or why it's drawn this way. They aren't part of the model, so they never become boxes, and no check looks inside them.

Each element is drawn at the level of detail the view allows: in a container view of `shop`, a component inside `checkout-api` appears as `checkout-api`, and a container of another system appears as that system. Relationships move up with their elements, and several relationships between the same two boxes become one arrow.

## Generated docs

When `export.docs` is set, every change made through `open-arch` (or the designer) rewrites that folder:

- `README.md`: the workspace, its views and the model tree.
- `views/<id>.md`: the view's Mermaid diagram, its sticky notes as quotes, and tables of its elements and relationships.
- `elements/<id>.md`: the element's details, notes, relationships, contents and the views showing it.

Every page starts with `<!-- Generated by open-arch`. Tools only ever overwrite or delete pages with that marker, so other files in the folder are safe. Don't edit generated pages: the next change rewrites them.

## check rules

`open-arch check` prints `path: severity [rule] message`, where `path` is the place in the file, e.g. `elements.web-app.uses[0].to`.

| Rule | Severity | Meaning |
|---|---|---|
| `json-invalid` | error | The file isn't valid JSON |
| `version-unsupported` | error | `openarch` is missing or not `1` |
| `field-unknown` | error | A field the format doesn't have (often a typo) |
| `field-type` | error | A field has the wrong type |
| `field-required` | error | A required field is missing |
| `id-format` | error | An ID isn't kebab-case |
| `id-duplicate` | error | An element and a view share an ID |
| `kind-invalid` | error | Unknown `kind` |
| `level-invalid` | error | Unknown view `level` |
| `color-invalid` | error | Unknown sticky note `color` |
| `parent-required` | error | A container or component has no parent |
| `parent-not-allowed` | error | A person or system has a parent |
| `parent-unknown` | error | `parent` isn't an element |
| `parent-kind` | error | The parent has the wrong kind |
| `external-ignored` | warning | `external` on a container or component |
| `relationship-unknown-target` | error | `to` isn't an element |
| `relationship-self` | error | An element uses itself |
| `relationship-parent-child` | error | A relationship between an element and something nested in it |
| `relationship-description` | warning | A relationship has no description |
| `relationship-duplicate` | warning | The same relationship is listed twice |
| `view-scope-required` | error | A context, container or component view has no scope |
| `view-scope-not-allowed` | error | A landscape view has a scope |
| `view-scope-unknown` | error | `scope` isn't an element |
| `view-scope-kind` | error | `scope` has the wrong kind for the level |
| `view-include-unknown` | error | An `include` entry isn't an element |
| `view-include-lifted` | warning | An `include` entry is too detailed for the level and is shown as its ancestor |
| `view-include-boundary` | warning | An `include` entry is the view's own scope |
| `view-exclude-unused` | warning | An `exclude` entry isn't in the view anyway |
| `layout-stale` | warning | Saved positions for elements no longer in the view (`open-arch fmt` removes them) |

The first ten are problems with the file's shape. They only happen when someone edits the file by hand, and commands refuse to change a file that has them until it's fixed.
