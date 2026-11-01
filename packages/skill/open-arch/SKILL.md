---
name: open-arch
description: Read and change this project's architecture model, an open-arch workspace (a .openarch file holding a C4 model of people, systems, containers, components, their relationships and diagrams, with generated markdown docs). Use when asked about the system's architecture, components, dependencies or diagrams, or when adding, changing, moving, renaming or removing any of them.
---

# open-arch

The architecture is one C4 model stored in a `.openarch` file (JSON). Diagrams ("views") are computed from the model, and a docs folder of markdown pages with Mermaid diagrams is generated from it for people to read.

**Never edit the `.openarch` file or the generated docs by hand.** Change the model only with `open-arch` commands. Each command is checked before anything is saved; if it would break the model, nothing changes and you get an error saying why, often with a suggested fix. Saving also refreshes the docs folder.

Run commands from anywhere in the project; the CLI finds the `.openarch` file (or pass `--file <path>`). If `open-arch` isn't installed, run `npx -y open-arch@{{version}}` in its place.

## Workflow

1. **Look first.** `open-arch show` prints the whole model as a tree and lists the views. `open-arch show <id>` prints one element (fields, notes, what it uses, what uses it, which views show it) or one view (its description, notes, boxes and arrows). Add `--json` for structured output.
2. **Change it with commands**, using the recipes below. For several related changes, prefer one `open-arch apply` batch: it's all or nothing.
3. **Read the result.** Each command prints what it changed, plus any warnings (for example, a relationship without a description). Fix warnings your change caused. If a command fails, read the message, fix the command, and run it again; nothing was saved.
4. **Confirm** with `open-arch check` when you're done, and report what you changed.

## Recipes

- **Add an element:**
  `open-arch add-element checkout-api --kind container --parent shop --name "Checkout API" --technology Node.js --description "Validates carts and takes payment."`
  Containers need a system as `--parent`; components need a container. People and systems are top-level; add `--external` for ones outside your organisation. Longer documentation goes in `--notes` (markdown).
  Give databases, queues, web apps, mobile apps and file stores a `--shape`: `database`, `queue`, `web-browser`, `mobile-app` or `folder`. Facts like the owner or repository go in tags: `--tag owner=payments` (repeatable).
- **Add a relationship** ("from uses to"):
  `open-arch add-relationship checkout-api orders-db --description "Reads and writes orders" --technology SQL`
  Describe it from the user's side as a short verb phrase. Put it on the most detailed element that's true: if a component makes the call, use the component; views at higher levels show it on the container or system automatically. Longer documentation, such as how retries or authentication work, goes in `--notes` (markdown).
- **Change fields:** `open-arch update-element <id> --description "..." --technology ""` (an empty value removes a field). `--tag name=value` sets one tag and leaves the rest; `--remove-tag name` removes one. Change a relationship with `update-relationship <from> <to>`.
- **Point a relationship elsewhere:** `open-arch update-relationship <from> <to> --new-to <id>` (or `--new-from <id>`). It keeps its description, technology, tags and notes, so there's no need to remove it and add it again.
- **Move an element** to another parent: `open-arch update-element <id> --parent <new-parent>`.
- **Rename an ID:** `open-arch rename <old-id> <new-id>` updates every reference. To change only the display name, use `update-element <id> --name "..."`.
- **Remove:** `open-arch remove-element <id>` also removes what's inside it, views scoped to them, and every reference. `remove-relationship <from> <to>` and `remove-view <id>` remove one thing.
- **Add a diagram:** `open-arch add-view <id> --level <landscape|context|container|component> --scope <id>`. Context and container views take a system as scope; component views take a container; landscape views take none. Give it a one-sentence `--description`, and `--notes` (markdown) for longer documentation about the diagram.
- **Show or hide something in one diagram:** `open-arch show-in-view <view> <id>...` / `hide-in-view <view> <id>...`.
- **Explain a diagram with a sticky note:** `open-arch add-sticky <view> <id> --text "Orders are paid before they're saved."` (`--color yellow|pink|blue|green`). Notes are for people reading that diagram, not part of the model; leave out `--at` and the designer places them beside it. Change or remove one with `update-sticky` / `remove-sticky <view> <id>`.
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
- Nesting: container → system, component → container. People and systems are top-level.
- Keep `description` to one sentence: it's shown inside the box, on the arrow, or under the view's title. Longer documentation goes in notes, which the docs show as markdown.
- Don't set box positions; people arrange diagrams in the designer.
- What an element or relationship *is* goes in its description and notes, which every view shows. What one diagram is for goes in the view's description and notes; a sticky note points at something on the diagram itself.

## Reference

- `references/commands.md`: every command and its options, and every operation for `apply`.
- `references/format.md`: what the `.openarch` file and the generated docs contain, how views decide what they show, and every `check` rule.
