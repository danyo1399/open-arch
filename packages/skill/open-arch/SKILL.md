---
name: open-arch
description: Read and change this project's architecture model, an open-arch workspace (a .openarch file holding a C4 model of people, systems, containers, components, shared libraries, classes, their relationships and diagrams, with generated markdown docs). Use when asked about the system's architecture, components, dependencies or diagrams, or when adding, changing, moving, renaming or removing any of them.
---

# open-arch

The architecture is one C4 model stored in a `.openarch` file (JSON). Diagrams ("views") are computed from the model, and a docs folder of markdown pages with Mermaid diagrams is generated from it for people to read.

**Never edit the `.openarch` file or the generated docs by hand.** Change the model only with `open-arch` commands. Each command is checked before anything is saved; if it would break the model, nothing changes and you get an error saying why, often with a suggested fix. Saving also refreshes the docs folder.

Run commands from anywhere in the project; the CLI finds the `.openarch` file (or pass `--file <path>`).

## Without the `open-arch` command

First check that `open-arch --version` runs. If it doesn't, the model was made in the open-arch designer, and there's no command to change it with here: don't look for one, and don't try to install one. Read the generated docs instead: the docs folder's `README.md` lists every view, and its `views/` and `elements/` pages describe each diagram and element, with their relationships. The `.openarch` file has the rest, and `references/format.md` says what's in it. Never edit either by hand. When asked to change the architecture, say what to change in the designer: which element, relationship or view, and what to set on it. Saving it there rewrites the docs.

## Workflow

1. **Look first.** `open-arch show` prints the whole model as a tree and lists the views. `open-arch show <id>` prints one element (fields, notes, what it uses, what uses it, which views show it) or one view (its description, notes, boxes and arrows, a sequence view's steps, a deployment view's nodes and what runs in them, an event view's lanes and cards, a wireframe view's screens and what's on them, a whiteboard view's shapes and arrows, a flowchart view's blocks and flows, or an entity view's entities, with their attributes, and its links). Add `--json` for structured output.
2. **Change it with commands**, using the recipes below. For several related changes, prefer one `open-arch apply` batch: it's all or nothing.
3. **Read the result.** Each command prints what it changed, plus any warnings (for example, a relationship without a description). Fix warnings your change caused. If a command fails, read the message, fix the command, and run it again; nothing was saved.
4. **Confirm** with `open-arch check` when you're done, and report what you changed.

## Recipes

- **Add an element:**
  `open-arch add-element checkout-api --kind container --parent shop --name "Checkout API" --technology Node.js --description "Validates carts and takes payment."`
  Containers need a system as `--parent`; components need a container or a library; classes need a component or a library. People, systems and libraries are top-level; add `--external` for ones outside your organisation. Longer documentation goes in `--notes` (markdown).
  Give databases, queues, file stores, documents, web, mobile and desktop apps, command-line tools, servers, email servers and scheduled jobs a `--shape`: `database`, `queue`, `folder`, `document`, `web-browser`, `mobile-app`, `desktop-app`, `terminal`, `server`, `email` or `scheduled-job`. Facts like the owner or repository go in tags: `--tag owner=payments` (repeatable).
- **Add a relationship** ("from uses to"):
  `open-arch add-relationship checkout-api orders-db --description "Reads and writes orders" --technology SQL`
  Describe it from the user's side as a short verb phrase. Put it on the most detailed element that's true: if a component makes the call, use the component; views at higher levels show it on the container or system automatically, and `check` warns when it's repeated there. Longer documentation, such as how retries or authentication work, goes in `--notes` (markdown).
  When both elements call each other, add `--bidirectional` if one description fits both ways ("Syncs customers with"), or add a second relationship the other way when each way is different ("Sends webhooks to"). Make an existing one go both ways with `update-relationship <from> <to> --bidirectional` (`--one-way` undoes it).
- **Add a class** (code inside a component, for class diagrams): `open-arch add-element order --kind class --parent order-repository --name Order --stereotype entity --member "+id: OrderId" --member "+total(): Money"`. Write members in UML's notation, one `--member` each: `+` public, `-` private, `#` protected; a member with brackets is a method. `--stereotype` says what sort of class it is, like `interface`, `abstract` or `enum`. Model classes only where a class diagram explains something: code changes more often than the rest of the model.
  Relate two classes with `add-relationship <from> <to> --kind <kind>`: `inheritance` (from extends to), `realization` (from implements the interface to), `composition` (from is made of to), `aggregation` (from holds to), or `dependency` (from depends on to). Without `--kind`, it's an association: from uses to, like every other relationship. A relationship with a kind needs no description, though one can help ("Is made of"). Only associations go both ways.
- **Add a shared library** (code built into several containers, like a logging library): `open-arch add-element logging --kind library --name Logging --technology "npm package"`, then build each container with it: `open-arch update-element checkout-api --library logging`. `--library` replaces the container's list, so repeat it for every library the container has (`show <container>` lists them). Don't copy the library into each container as a component: put its code in it once. A small library holds classes directly (`add-element logger --kind class --parent logging`); a bigger one, like an SDK, holds components (`add-element sdk-http --kind component --parent sdk`), each with its classes. A component view of a container built with it draws the library inside its frame, as one box. A component view of the library itself (`add-view sdk-components --level component --scope sdk`) draws its components, and a class view of one of them its classes. Relationships from the library's code, say to a log service, are drawn from every container built with it. Something that uses the library's code uses the copy in its own container, so that container must be built with it: `check` warns when it isn't.
- **Change fields:** `open-arch update-element <id> --description "..." --technology ""` (an empty value removes a field). `--member` replaces all of a class's members (`--member ""` removes them). `--tag name=value` sets one tag and leaves the rest; `--remove-tag name` removes one. Change a relationship with `update-relationship <from> <to>`.
- **Point a relationship elsewhere:** `open-arch update-relationship <from> <to> --new-to <id>` (or `--new-from <id>`). It keeps its description, technology, tags and notes, so there's no need to remove it and add it again.
- **Move an element** to another parent: `open-arch update-element <id> --parent <new-parent>`.
- **Rename an ID:** `open-arch rename <old-id> <new-id>` updates every reference. To change only the display name, use `update-element <id> --name "..."`.
- **Remove:** `open-arch remove-element <id>` also removes what's inside it, views scoped to them, and every reference. `remove-relationship <from> <to>` and `remove-view <id>` remove one thing.
- **Add a diagram:** `open-arch add-view <id> --level <landscape|context|container|component|class|sequence|state|deployment|event|wireframe|whiteboard|flowchart|entity> --scope <id>`. Context and container views take a system as scope; component views take a container or library; class views take a component or library, and draw its classes as a UML class diagram; state views can take the element of any kind whose states they show; wireframe views can take the system or container whose screens they show; flowchart views can take the element of any kind whose process they show; entity views can take the system, container, component or library whose data they show; landscape, sequence, deployment, event and whiteboard views take none. Give it a one-sentence `--description`, and `--notes` (markdown) for longer documentation about the diagram.
- **Show what happens in order** (a sequence diagram): `open-arch add-view place-order --level sequence --title "Placing an order"`, then a step for each call, in order:
  `open-arch add-step place-order customer web-app --description "Places an order"`
  `open-arch add-step place-order checkout-api web-app --reply --description "Order number"`
  A step from A to B needs a relationship from A (or something inside A) to B (or something inside B), or one between them that goes both ways; a `--reply` goes back along one from B to A. Add missing relationships first. Without `--description`, a call shows its relationship's description. The view shows the elements in its steps, in the order they first appear, so it takes no scope, include or exclude. `--step <n>` inserts a step at number n; change or move one with `update-step <view> <n>` (`--move-to <n>`), and remove one with `remove-step <view> <n>`. Steps are numbered from 1, as `show <view>` prints them.
- **Show the states something goes through** (a state diagram): `open-arch add-view order-states --level state --scope order --title "Order states"` (the scope, optional, is the element whose states they are), then a state each, and a transition for each way between them:
  `open-arch add-state order-states placed --initial`
  `open-arch add-state order-states paid --description "The card was charged."`
  `open-arch add-state order-states delivered --final`
  `open-arch add-transition order-states placed paid --event "Payment taken" --guard "paid in full" --action "Send a receipt"`
  States and transitions belong to the view, not the model. A transition can go back to the state it leaves. Change one with `update-state <view> <id>` or `update-transition <view> <n>`, and remove one with `remove-state` or `remove-transition`. Transitions are numbered from 1, as `show <view>` prints them.
- **Show where things run** (a deployment diagram, usually one per environment): `open-arch add-view production --level deployment --title Production`, then its nodes, nested with `--parent`, each listing the containers and systems that run in it with `--run` (repeatable):
  `open-arch add-node production aws --name "Amazon Web Services"`
  `open-arch add-node production api-servers --parent aws --technology "Amazon ECS" --instances 3 --run checkout-api`
  `open-arch add-node production database --parent aws --technology "Amazon RDS" --run orders-db`
  `open-arch add-node production load-balancer --parent aws --infrastructure --technology "Application Load Balancer"`
  `open-arch add-connection production load-balancer checkout-api --description "Forwards requests to" --technology HTTPS`
  Nodes and connections belong to the view, not the model. Arrows between the containers come from the model's relationships, so add those with `add-relationship`, not connections: a connection is for an arrow to or from a node, such as infrastructure like a load balancer, DNS or a firewall, which runs nothing. Where a container runs in several nodes, each copy is joined to the nearest copies of what it uses: those in the deepest node they share. `--run` on `update-node` replaces what the node runs, so repeat it for each (`show <view>` lists them). Change a node with `update-node <view> <id>` and a connection with `update-connection <view> <n>`; remove them with `remove-node` (it takes the nodes inside too) and `remove-connection`. A deployment view is laid out automatically, and takes no scope, include or exclude.
- **Show what happens in the business** (an event storm, or event model): `open-arch add-view placing-an-order --level event --title "Placing an order"`, then a lane for each actor, team or system, from the top down, and a card for each thing that happens, in order:
  `open-arch add-lane placing-an-order customer`
  `open-arch add-lane placing-an-order shop`
  `open-arch add-card placing-an-order place-order --kind command --name "Place order" --lane customer`
  `open-arch add-card placing-an-order order-placed --kind event --name "Order placed" --lane shop --from place-order`
  `open-arch add-card placing-an-order pay-when-placed --kind policy --name "Whenever an order is placed, take payment" --lane shop --from order-placed`
  A card's `--kind` is one of event storming's notes: `event` (the default: something that happened, in the past tense), `command` (a decision or request to do something), `actor` (the person who gives a command), `policy` (a rule that reacts to an event), `read-model` (what someone looks at to decide), `external-system`, `aggregate` (the thing a command changes) or `hotspot` (a question or problem to come back to). Cards are drawn left to right in the order they're added, each in its `--lane`, or above the lanes without one. `--from` (repeatable) names the cards that lead to it, each drawn as an arrow, so add those first. `--position <n>` puts a card or a lane at place n; `update-card <view> <id> --position <n>` moves one, and `--from` on `update-card` replaces the cards it comes from. Remove them with `remove-card` and `remove-lane` (a removed lane's cards stay, in no lane). Lanes and cards belong to the view, not the model. An event view is laid out automatically, and takes no scope, include or exclude.
- **Sketch an app's screens** (UX wireframes): `open-arch add-view checkout-screens --level wireframe --scope web-app --title "Checkout screens"` (the scope, optional, is the system or container whose screens they are), then a screen for each page, in order, and the widgets on each, top to bottom:
  `open-arch add-screen checkout-screens cart --device phone`
  `open-arch add-screen checkout-screens payment --device phone`
  `open-arch add-widget checkout-screens cart-title --kind heading --screen cart --text "Your cart"`
  `open-arch add-widget checkout-screens items --kind list --screen cart --text $'Red shoes\nWool hat'`
  `open-arch add-widget checkout-screens actions --kind row --screen cart`
  `open-arch add-widget checkout-screens check-out --kind button --in actions --text "Check out" --to payment`
  A widget's `--kind` is `heading`, `text`, `button`, `link`, `input` (a box to type in, its text its label), `checkbox`, `select` (a drop-down), `image`, `list`, `table`, `tabs`, `divider`, `panel` or `row`. A list's items, a table's rows (cells split by `|`, the first row its headings) and tabs go one to a line of `--text`. A `panel` holds widgets top to bottom in a box, and a `row` holds them side by side: put a widget in one with `--in <row or panel>` instead of `--screen`. `--to <screen>` says which screen a widget leads to, like the one a button opens, drawn as an arrow; add that screen first. `--device` is `desktop` (the default), `tablet` or `phone`. Widget IDs are unique across the view's screens. `--position <n>` puts a screen or widget at place n; `update-widget <view> <id>` changes or moves one (`--screen`, `--in`, `--in ""` to take it out of a row or panel, `--position`), and `update-screen` changes a screen. Remove them with `remove-widget` (it takes what's inside too) and `remove-screen` (it takes what's on it, and the widgets that led to it lead nowhere). Screens and widgets belong to the view, not the model. A wireframe view is laid out automatically, and takes no include or exclude.
- **Sketch an idea on a whiteboard** (freehand, to share it before it's decided): `open-arch add-view ideas --level whiteboard --title "Faster checkout"`, then shapes where you want them and arrows between them:
  `open-arch add-shape ideas title --kind text --text "Faster checkout" --at 0,-100 --size large`
  `open-arch add-shape ideas cache --kind rectangle --text "Cache the menus" --at 0,0,180,90 --fill yellow`
  `open-arch add-shape ideas db --kind ellipse --text "Orders DB" --at 300,0`
  `open-arch add-arrow ideas reads --from cache --to db --text "reads"`
  A shape's `--kind` is `rectangle`, `ellipse` or `diamond` (an outline with its text inside), `text` (just its text, which it needs) or `pen` (a line through `--points "x,y x,y ..."`, from its corner). `--at x,y` is its top-left corner, and `--at x,y,width,height` sizes it too: without a size, a rectangle, ellipse or diamond is 160 by 80, and text is as big as what it says. Leave out `--at` and it goes under the shapes there are. `--color` is `black` (the default), `grey`, `red`, `orange`, `green`, `blue` or `purple`; `--fill` is `white`, `grey`, `red`, `orange`, `yellow`, `green`, `blue` or `purple` (none, the default, is see-through); `--size` is how big its text is: `small`, `medium` (the default), `large` or `huge`; `--dashed` dashes its outline. Shapes are drawn from the back to the front in the order they're added; `--position <n>` puts one at place n from the back. An arrow's `--from` and `--to` are each a shape, which it's drawn to the edge of and follows as the shape moves, or a point, `x,y`. `--from-side` and `--to-side` (`top`, `right`, `bottom` or `left`) keep an end on that side of its shape, the middle of that edge, wherever the other end is: for a decision diamond, `open-arch add-arrow ideas yes --from paid --from-side right --to ship --text yes` leaves from its right tip. Without a side, an end faces the other end, and moves round the shape's edge as they move. `--heads` is `end` (the default), `both`, or `none` for a line. `update-shape` and `update-arrow` change them (`--new-id` keeps the arrows on a renamed shape), and `remove-shape` (it takes the arrows to and from it) and `remove-arrow` remove them. None of it is part of the model, so a whiteboard takes no scope, include or exclude: to show the model, use another kind of view.
- **Draw a process as a flowchart** (its steps and decisions, from start to end): `open-arch add-view returns --level flowchart --scope checkout-api --title "Handling a return"` (the scope, optional, is the element whose process it is), then a block for each step, in order, and a flow for each arrow between them:
  `open-arch add-block returns asked --kind start --text "Return asked for"`
  `open-arch add-block returns in-time --kind decision --text "Within 30 days?"`
  `open-arch add-block returns refund --text "Refund the card"`
  `open-arch add-block returns refuse --text "Say no, and why"`
  `open-arch add-block returns done --kind end --text "Done"`
  `open-arch add-flow returns asked in-time`
  `open-arch add-flow returns in-time refund --text Yes`
  `open-arch add-flow returns in-time refuse --text No`
  `open-arch add-flow returns refund done`
  `open-arch add-flow returns refuse done`
  A block's `--kind` is `process` (the default: a step, something that's done), `start` or `end` (where the process starts or ends), `decision` (a question with more than one way on), `input-output` (something that comes in or goes out), `subprocess` (a process drawn in full somewhere else), `document` or `database` (data that's kept). Give each flow out of a decision `--text` saying which answer it's for, like `Yes` or `No`: check warns when one doesn't, when a decision has fewer than two ways out, and when a flowchart has no start. A flow is named by its number, as `show <view>` prints it. Without `--at`, the designer lays blocks out from the first down. `update-block <view> <id>` changes or moves one (`--new-id` keeps its flows on it), and `update-flow <view> <n>` changes a flow; remove them with `remove-block` (it takes the flows to and from it) and `remove-flow`. Blocks and flows belong to the view, not the model. A flowchart takes no include or exclude.
  To show who does each step, give the flowchart lanes, columns from left to right, one for each actor, team or system, and put each block in one with `--lane`:
  `open-arch add-lane returns customer --element customer`
  `open-arch add-lane returns shop --name "Shop staff"`
  `open-arch update-block returns asked --lane customer`
  `open-arch add-block returns refund --text "Refund the card" --lane shop`
  `--element` makes a lane for an element of the model, like the person or container that does its steps, and the lane takes its name unless given one; the element's page in the docs then lists the flowchart. `update-lane --element ""` takes a lane off its element. `update-block --lane ""` takes a block out of its lane; `update-lane` renames or moves a lane (`--position`), and its blocks follow a new ID; `remove-lane` leaves its blocks in no lane, laid out again. In a flowchart with lanes, a block's `--at` x is from the inside of its lane's left, and 0 or more, so a flowchart's first lane moves its placed blocks right together, if need be, and says so.
- **Show what data is kept** (an entity-relationship diagram, or ERD): `open-arch add-view orders-data --level entity --scope orders-db --title "Orders data"` (the scope, optional, is the system, container, component or library whose data it is, like a database), then an entity for each thing that's kept, like a table, with its attributes, and a link for each relationship between two entities:
  `open-arch add-entity orders-data customer`
  `open-arch add-attribute orders-data customer id --type uuid --key pk`
  `open-arch add-attribute orders-data customer email --type text --key uk`
  `open-arch add-entity orders-data order`
  `open-arch add-attribute orders-data order id --type uuid --key pk`
  `open-arch add-attribute orders-data order customer_id --type uuid --key fk`
  `open-arch add-entity orders-data payment`
  `open-arch add-attribute orders-data payment order_id --type uuid --key fk,uk`
  `open-arch add-link orders-data customer order --text places`
  `open-arch add-link orders-data order payment --cardinality one,zero-or-one --text "is paid by"`
  An attribute is named by its entity and its name, which is unique in that entity. `--key` is `pk` (the primary key, or part of it), `fk` (a foreign key, which names one of another entity) or `uk` (unique), or several, like `--key pk,fk`. A link's `--cardinality` says how many of each end there can be, its `<from>`'s then its `<to>`'s, each `one` (exactly one), `zero-or-one`, `one-or-more` or `zero-or-more`, drawn in crow's foot notation. Read `--cardinality a,b` as "each `<to>` has a `<from>`, and each `<from>` has b `<to>`": `customer order` with `one,zero-or-more`, the default, is one customer to each order, and zero or more orders to each customer. A link can go from an entity to itself, like an employee and their manager. A link is named by its number, as `show <view>` prints it. Without `--at`, the designer lays entities out. `update-entity <view> <id>` changes or moves one (`--new-id` keeps its links on it), `update-attribute <view> <entity> <name>` changes an attribute (`--new-name`, `--key ""` for no key, `--position` to move it), and `update-link <view> <n>` changes a link; remove them with `remove-entity` (it takes its attributes, and the links to and from it), `remove-attribute` and `remove-link`. Entities, attributes and links belong to the view, not the model. An entity view takes no include or exclude.
- **Show or hide something in one diagram:** `open-arch show-in-view <view> <id>...` / `hide-in-view <view> <id>...`.
- **Link a view to another element:** `open-arch update-view <view> --scope <id>` on a state, wireframe, flowchart or entity view links it to the element it's of, keeping its states, screens, blocks or entities; `--scope ""` links it to nothing in particular. Change its `--title` too if it named the old element. A context, container, component or class view draws what's inside its scope, so for another element, add a new view.
- **Keep elements added later out of a view:** `open-arch update-view <view> --new-elements hide`. The view keeps its boxes, and new elements stay out of it until you `show-in-view` them. `--new-elements show` lets them in again. A new view shows them; check `show <view>` before adding an element, so you know which views it lands in.
- **Explain a diagram with a sticky note:** `open-arch add-sticky <view> <id> --text "Orders are paid before they're saved."` (`--color yellow|pink|blue|green`). Notes are for people reading that diagram, not part of the model; leave out `--at` and the designer places them beside it. Change or remove one with `update-sticky` / `remove-sticky <view> <id>`. Keep its text short; `--notes <markdown>` gives it longer notes, which the designer opens from the note and the docs show after its text.
- **Point a sticky note at a box, an arrow or a flowchart's block:** on a landscape, context, container, component or class view, `--element <id>` puts the note on an element, and `--from <id> --to <id>` on the relationship where `<from>` uses `<to>` (add `--kind` when it isn't an association). The designer draws a line from the note to the box or arrow that shows it, even an implied one. On a flowchart view, `--block <id>` puts the note on a block, with a line to it. `update-sticky <view> <id> --detach` takes it off. `show <view>` says what each note is on, and whether the view draws it.
- **Several changes at once:** write a JSON list of operations and run `open-arch apply changes.json` (or pipe it to `open-arch apply -`):
  ```json
  [
    { "op": "add-element", "id": "cart-cache", "kind": "container", "parent": "shop", "name": "Cart Cache", "technology": "Redis" },
    { "op": "add-relationship", "from": "checkout-api", "to": "cart-cache", "description": "Reads and writes carts" }
  ]
  ```
  Add `--dry-run` to any command to check a change without saving it.

## Rules

- IDs are lowercase kebab-case, like `checkout-api`, unique across elements and views. Commands refer to things by ID, never by name.
- Nesting: container → system, component → container or library, class → component or library. People, systems and libraries are top-level; containers list the libraries built into them.
- Keep `description` to one sentence: it's shown inside the box, on the arrow, or under the view's title. Longer documentation goes in notes, which the docs show as markdown.
- Don't set box positions; people arrange diagrams in the designer.
- What an element or relationship *is* goes in its description and notes, which every view shows. What one diagram is for goes in the view's description and notes; a sticky note points at something on the diagram itself.

## Reference

- `references/commands.md`: every command and its options, and every operation for `apply`.
- `references/format.md`: what the `.openarch` file and the generated docs contain, how views decide what they show, and every `check` rule.
