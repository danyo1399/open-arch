---
name: open-arch
description: Read and change this project's architecture model, an open-arch workspace (a folder with open-arch.yaml, element files in model/ and diagram files in views/). Use when asked about the system's architecture, components, dependencies or diagrams, or when adding, changing, moving, renaming or removing people, systems, containers, components, relationships or views.
---

# open-arch

The architecture is one shared C4 model stored as markdown. Each person, system, container and component is one file in `model/`, and each diagram is one file in `views/` that picks elements from the model. Diagrams are never drawn by hand in text: they are computed from the model.

Run every command below from anywhere in the project; the CLI finds the workspace. If `open-arch` isn't installed, run `npx -y open-arch@{{version}}` in its place.

## Workflow

1. **Look before editing.** `open-arch show` prints the whole model as a tree and lists the views. `open-arch show <id>` prints one element (what it uses, what uses it, which views show it) or one view (its boxes and arrows). Read the element files you'll change.
2. **Make the change** using the recipes below.
3. **Validate.** Run `open-arch fmt`, then `open-arch check`. Fix every error and run both again until `check` reports no errors. Fix warnings that your change caused. `open-arch check --json` gives the same results as JSON.
4. **Report** which files you changed, and anything `check` still warns about.

## Recipes

- **Add an element:** `open-arch new element <id> --kind <kind> --parent <id> --name "<Name>" --technology "<tech>" --description "<one sentence>"`. Containers need a system as `--parent`, components need a container; people and systems take no parent (add `--external` for ones outside your organisation). Then edit the new file to add its relationships.
- **Add a relationship:** add an entry to the `uses` list of the element the arrow starts from:
  ```yaml
  uses:
    - to: orders-db
      description: Reads and writes orders
      technology: SQL
  ```
  Write `description` as a short verb phrase from the user's side ("Reads and writes orders", "Sends emails using"). Point at the most detailed element that's true: if a component makes the call, put the relationship on the component; views at higher levels show it on the container or system automatically.
- **Move an element** to another parent: change its `parent` field. Optionally move the file to the matching folder; the folder doesn't affect the model.
- **Change a display name, description or technology:** edit the field. Nothing else needs to change.
- **Change an ID:** `open-arch rename <old-id> <new-id>`. Never rename an element file by hand: references, views and saved layouts would break. Then update any prose the command lists.
- **Remove an element:** delete its file and the files of anything inside it, then remove every `uses`, `include` and `exclude` entry that pointed at it (`check` lists them as errors).
- **Add a diagram:** `open-arch new view <id> --level <landscape|context|container|component> --scope <id>`. Context and container views take a system as scope; component views take a container; landscape views take none.
- **Hide something in one diagram:** add its ID to the view's `exclude` list. To show only chosen elements, replace `include: ["*"]` with a list of IDs.

## Rules

- An element's ID is its file name: lowercase kebab-case, unique across the workspace, like `checkout-api`. References use IDs, never names.
- Nesting is set by `parent` only: container → system, component → container. People and systems are top-level.
- **Never edit** the block between `<!-- open-arch:preview ... -->` and `<!-- /open-arch:preview -->`, or the `<!-- open-arch:layout ... -->` comment. `fmt` regenerates the preview from the model, and the layout holds box positions saved by the designer app.
- Keep `description` to one sentence; it's shown inside the box. Longer documentation goes in the markdown body below the frontmatter.
- Extra frontmatter fields (like `owner` or `repo`) are allowed and kept.

## Reference

Read `references/format.md` for the full file format, how views decide what they show, and every `check` rule with its fix.
