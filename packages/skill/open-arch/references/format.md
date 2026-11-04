# The open-arch workspace (format version 6)

A workspace is one `.openarch` file: JSON holding a [C4](https://c4model.com) model of people, software systems, containers, components and classes, the relationships between them, and views (diagrams) computed from the model. Change it only with `open-arch` commands (see `commands.md`); this page explains what it contains so you can read it.

```json
{
  "openarch": 6,
  "name": "Shop",
  "description": "An online shop.",
  "export": { "docs": "docs" },
  "elements": {
    "customer": {
      "kind": "person",
      "name": "Customer",
      "uses": [
        { "to": "web-app", "description": "Browses products and places orders", "technology": "HTTPS", "notes": "Over **HTTPS** only." }
      ]
    },
    "shop": { "kind": "system", "name": "Shop", "description": "Lets customers browse products and place orders." },
    "web-app": {
      "kind": "container",
      "name": "Web App",
      "parent": "shop",
      "technology": "React",
      "shape": "web-browser",
      "tags": { "owner": "storefront-team", "public": "" },
      "notes": "Single-page app served from a CDN.\n\nUses feature flags for the new checkout."
    },
    "cart": { "kind": "component", "name": "Cart", "parent": "web-app" },
    "cart-store": {
      "kind": "class",
      "name": "CartStore",
      "parent": "cart",
      "stereotype": "interface",
      "members": ["+load(id: CartId): Cart", "+save(cart: Cart): void"]
    },
    "local-cart-store": {
      "kind": "class",
      "name": "LocalCartStore",
      "parent": "cart",
      "members": ["-key: string", "+load(id: CartId): Cart", "+save(cart: Cart): void"],
      "uses": [
        { "to": "cart-store", "kind": "realization" }
      ]
    }
  },
  "views": {
    "shop-containers": {
      "title": "Shop containers",
      "description": "What runs inside the shop.",
      "level": "container",
      "scope": "shop",
      "include": ["*"],
      "notes": "Drawn for new starters. Start at the customer.",
      "stickies": {
        "how-orders-flow": { "text": "Every order goes through the web app.", "color": "blue", "at": [260, 0] }
      },
      "layout": { "customer": [0, 0], "web-app": [0, 160] }
    },
    "browse": {
      "title": "Browsing the shop",
      "level": "sequence",
      "steps": [
        { "from": "customer", "to": "web-app", "description": "Opens the shop" },
        { "from": "web-app", "to": "customer", "description": "Shows the products", "reply": true }
      ]
    }
  }
}
```

## Top level

| Field | Meaning |
|---|---|
| `openarch` | Format version, always `6` |
| `name` | Workspace name |
| `description` | Optional |
| `export.docs` | Folder, relative to the file, that tools keep filled with generated docs |
| `elements` | Elements keyed by ID |
| `views` | Views keyed by ID |

Tools read version 1 to 5 files too, and write them back as version 6. Version 5 is the same, but without classes, class views and kinds of relationship. Version 4 is version 5 without relationships that go both ways. Version 3 is version 4 without sequence views. Version 2 is version 3 without notes on views and relationships. In version 1, a `database` tag becomes `"shape": "database"`, other tags become tags without a value, and `properties` become tags.

IDs are lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) and unique across elements and views. Sticky note IDs use the same format and are unique within their view.

## Elements

| Field | Meaning |
|---|---|
| `kind` | `person`, `system`, `container`, `component` or `class` |
| `name` | Display name |
| `parent` | Containers: the system they belong to. Components: their container. Classes: their component. Not used on people and systems |
| `description` | One sentence, shown in the box |
| `technology` | e.g. `Node.js`, `PostgreSQL` |
| `external` | `true` for people and systems outside your organisation |
| `shape` | How the box is drawn (see below); without it, a box. Not used on people, who are always drawn as a person, or classes, drawn as a class |
| `stereotype` | Classes only: what sort of class it is, such as `interface`, `abstract` or `enum`. Drawn as «interface» above its name |
| `tags` | Free-form facts as names and string values, e.g. `{ "owner": "payments", "repository": "github.com/example/orders" }`. A tag with the value `""` is a plain label |
| `notes` | Longer documentation, as markdown |
| `members` | Classes only: its attributes and methods, a string each, in UML's notation, like `"+id: OrderId"` or `"+total(): Money"` (`+` public, `-` private, `#` protected, `~` package). A member with brackets is a method; the rest are attributes |
| `uses` | Relationships from this element: `to` (an element ID), `kind` (between classes, see below; without it, an association), `bidirectional` (`true` when `to` uses this element too), `description` (a short verb phrase, shown on the arrow), `technology`, `tags` (like an element's) and `notes` (longer documentation, as markdown) |

### Shapes

| `shape` | Drawn as | Use it for |
|---|---|---|
| `box` | A box (the default) | Anything else |
| `database` | A cylinder | Databases |
| `queue` | A pipe | Message queues and event streams |
| `folder` | A folder | File stores and buckets |
| `document` | A page with a folded corner | Documents, reports, spreadsheets and other files people read |
| `web-browser` | A browser window | Web apps and single-page apps |
| `mobile-app` | A phone | Mobile apps |
| `desktop-app` | A screen on a stand | Desktop apps |
| `terminal` | A terminal window | Command-line tools and scripts |
| `server` | A box with a drive bay | Servers, virtual machines and other hosts |
| `email` | An envelope | Email servers, mailboxes and email services |
| `scheduled-job` | A box with a clock | Scheduled jobs and batch jobs |

Mermaid has only some of these, so the generated docs draw a database as a cylinder, a queue as a box with double sides, a mobile app with rounded corners, and the rest as boxes.

### Choosing a kind

- **person**: a human role that uses a system ("Customer", "Support agent").
- **system**: something that delivers value to people and is owned by one team, e.g. "Shop", or a third-party service ("Payment Provider", external).
- **container**: something inside a system that runs or stores data on its own and is deployed separately: a web app, API, worker, database, queue, bucket.
- **component**: a major building block inside one container, such as a module, service class or controller. Only model components when they help explain the container.
- **class**: a class, interface or enum inside one component: C4's code level. Only model classes where a class diagram explains something tricky, as code changes far more often than the rest of the model.

### Relationships

A relationship can't join an element to its own parent, child or anything nested in it. Put each relationship on the most detailed element it's true for. Views at higher levels show it on the enclosing container or system ("implied relationships"), so don't repeat it on the parent.

When two elements call each other, either add a relationship each way, each with its own description, or give one relationship `"bidirectional": true` when one description fits both ways ("Syncs customers with"). A relationship that goes both ways is drawn with an arrowhead at each end. Where one joins two boxes, the view draws one such arrow for every relationship between them, in either direction, rather than an arrow each way.

A relationship between two classes can have a `kind`, which says what it means in UML's terms. Class views draw each kind in UML's notation, as a separate arrow from relationships of other kinds between the same two classes. Every other view draws them all as ordinary arrows.

| `kind` | Means | Drawn as |
|---|---|---|
| `association` (the default) | The element uses `to`, as every other relationship does | A line with an arrowhead |
| `dependency` | It depends on `to`, without keeping a reference to it | A dashed line with an open arrowhead |
| `inheritance` | It extends `to` | A line with a hollow triangle at `to` |
| `realization` | It implements `to`, an interface | A dashed line with a hollow triangle at `to` |
| `composition` | It's made of `to`, which can't exist without it | A line with a filled diamond at this element |
| `aggregation` | It holds `to`, which can exist on its own | A line with a hollow diamond at this element |

Only associations go both ways. A relationship with a kind needs no description, since its kind says what it is.

## Views

| Field | Meaning |
|---|---|
| `title` | Diagram title |
| `description` | One sentence, shown under the title on the diagram |
| `level` | `landscape`, `context`, `container`, `component`, `class` or `sequence` |
| `scope` | A system for context and container views, a container for component views, a component for class views, none for landscape and sequence |
| `include` | IDs to show, or `"*"` for the default selection. With `"*"`, elements added later appear on their own; without it, the view shows only the IDs listed. Not used on sequence views |
| `exclude` | IDs to hide. Not used on sequence views |
| `notes` | Longer documentation about the diagram, as markdown: what it's for, or how to read it |
| `stickies` | Sticky notes keyed by ID: `text` (plain text; line breaks are kept), `color` (`yellow`, the default, `pink`, `blue` or `green`) and `at` (`[x, y]`, the top-left corner; without it the designer puts the note beside the diagram) |
| `layout` | Box positions saved by the designer: `[x, y]` keyed by element ID. Not used on sequence views |
| `steps` | Sequence views only: what happens, in order (see below) |

| Level | Boxes | `"*"` includes |
|---|---|---|
| `landscape` | People and systems | Every person and system |
| `context` | People and systems | The scope system, plus every person and system connected to it |
| `container` | The scope's containers inside a frame; people and other systems outside it | The scope's containers, plus everything connected to them |
| `component` | The scope's components inside a frame; sibling containers; people and other systems | The scope's components, plus everything connected to them |
| `class` | The scope's classes inside a frame, drawn as UML classes with their members; classes elsewhere, as themselves; sibling components and containers; people and other systems | The scope's classes, plus everything connected to them |

A `sequence` view isn't a level of detail: it shows what happens, in order, like a UML sequence diagram. Each element in its steps gets a lifeline, left to right in the order it first appears, and each step is a numbered arrow, top to bottom. A step has:

| Field | Meaning |
|---|---|
| `from` | The element that acts |
| `to` | The element it calls, or answers |
| `description` | What's sent, e.g. "Submits the order". Without it, a call shows its relationship's description |
| `technology` | e.g. `JSON/HTTPS`. Without it, a call shows its relationship's technology |
| `reply` | `true` for an answer to an earlier call, drawn as a dashed arrow |

Steps go along the model's relationships: a call from A to B needs a relationship from A, or something inside A, to B, or something inside B, or one between them that goes both ways, and a reply from B to A goes back along one of those. Elements at any level of detail can be in the same sequence: a person, a container and a component. Commands refuse a step the model has no relationship for, and `check` warns when one loses its relationship, for example when the relationship is removed. Removing an element removes its steps.

Sticky notes belong to one view and explain that diagram to people: what to notice, or why it's drawn this way. They're drawn on the diagram, beside what they point at, while the view's `notes` are about the whole diagram and appear in its docs. They aren't part of the model, so they never become boxes, and no check looks inside them.

Each element is drawn at the level of detail the view allows: in a container view of `shop`, a component inside `checkout-api` appears as `checkout-api`, and a container of another system appears as that system. Relationships move up with their elements, and several relationships between the same two boxes become one arrow.

## Generated docs

When `export.docs` is set, every change made through `open-arch` (or the designer) rewrites that folder:

- `README.md`: the workspace, its views and the model tree.
- `views/<id>.md`: the view's description and notes, its Mermaid diagram, its sticky notes as quotes, and tables of its elements and relationships, with the notes of each relationship under them. A class view has a Mermaid class diagram, and its relationships table says each one's kind. A sequence view has a Mermaid sequence diagram, and a table of its steps in place of the relationships.
- `elements/<id>.md`: the element's details, notes, members (for a class), relationships (with their notes), contents and the views showing it.

Every page starts with `<!-- Generated by open-arch`. Tools only ever overwrite or delete pages with that marker, so other files in the folder are safe. Don't edit generated pages: the next change rewrites them.

## check rules

`open-arch check` prints `path: severity [rule] message`, where `path` is the place in the file, e.g. `elements.web-app.uses[0].to`.

| Rule | Severity | Meaning |
|---|---|---|
| `json-invalid` | error | The file isn't valid JSON |
| `version-unsupported` | error | `openarch` is missing, or not `6` (or `1` to `5`, which are upgraded) |
| `field-unknown` | error | A field the format doesn't have (often a typo) |
| `field-not-allowed` | error | A field this kind of view doesn't take: `include`, `exclude` or `layout` on a sequence view, or `steps` on another view |
| `field-type` | error | A field has the wrong type |
| `field-required` | error | A required field is missing |
| `id-format` | error | An ID isn't kebab-case |
| `id-duplicate` | error | An element and a view share an ID |
| `kind-invalid` | error | Unknown `kind` |
| `level-invalid` | error | Unknown view `level` |
| `color-invalid` | error | Unknown sticky note `color` |
| `shape-invalid` | error | Unknown element `shape` |
| `relationship-kind-invalid` | error | Unknown relationship `kind` |
| `parent-required` | error | A container, component or class has no parent |
| `parent-not-allowed` | error | A person or system has a parent |
| `parent-unknown` | error | `parent` isn't an element |
| `parent-kind` | error | The parent has the wrong kind |
| `external-ignored` | warning | `external` on a container, component or class |
| `shape-ignored` | warning | `shape` on a person or class |
| `members-ignored` | warning | `members` on something other than a class |
| `stereotype-ignored` | warning | `stereotype` on something other than a class |
| `relationship-unknown-target` | error | `to` isn't an element |
| `relationship-self` | error | An element uses itself |
| `relationship-parent-child` | error | A relationship between an element and something nested in it |
| `relationship-kind-classes` | error | A relationship with a `kind` other than association doesn't join two classes |
| `relationship-kind-bidirectional` | error | A relationship with a `kind` other than association goes both ways |
| `relationship-description` | warning | An association has no description |
| `relationship-duplicate` | warning | The same relationship is listed twice |
| `view-scope-required` | error | A context, container, component or class view has no scope |
| `view-scope-not-allowed` | error | A landscape view has a scope |
| `view-scope-unknown` | error | `scope` isn't an element |
| `view-scope-kind` | error | `scope` has the wrong kind for the level |
| `view-include-unknown` | error | An `include` entry isn't an element |
| `view-include-lifted` | warning | An `include` entry is too detailed for the level and is shown as its ancestor |
| `view-include-boundary` | warning | An `include` entry is the view's own scope |
| `view-exclude-unused` | warning | An `exclude` entry isn't in the view anyway |
| `step-unknown-element` | error | A step's `from` or `to` isn't an element |
| `step-self` | error | A step goes from an element to itself |
| `step-relationship-missing` | warning | The model has no relationship for a step to go along |
| `layout-stale` | warning | Saved positions for elements no longer in the view (`open-arch fmt` removes them) |

The first thirteen are problems with the file's structure. They only happen when someone edits the file by hand, and commands refuse to change a file that has them until it's fixed.
