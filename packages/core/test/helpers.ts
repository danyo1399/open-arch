import { applyChanges, loadWorkspace, type FileChange, type InputFile, type Workspace } from "../src/index.js";

/** A markdown file: frontmatter lines, then an optional body. */
export function md(frontmatter: string[], body = "\n# Title\n"): string {
  return `---\n${frontmatter.join("\n")}\n---\n${body}`;
}

export function files(map: Record<string, string>): InputFile[] {
  return Object.entries(map).map(([path, text]) => ({ path, text }));
}

export function ws(map: Record<string, string>): Workspace {
  return loadWorkspace(files(map));
}

export function apply(workspace: Workspace, changes: FileChange[]): Workspace {
  return loadWorkspace(applyChanges(workspace.inputs, changes), workspace.config);
}

/** A small model: a customer, a shop with two containers and a component, and an external system. */
export const SHOP: Record<string, string> = {
  "model/customer.md": md(["kind: person", "name: Customer", "uses:", "  - to: web-app", "    description: Buys things", "    technology: HTTPS"]),
  "model/shop.md": md(["kind: system", "name: Shop"]),
  "model/shop/web-app.md": md(["kind: container", "name: Web App", "parent: shop", "technology: React", "uses:", "  - to: controller", "    description: Places orders"]),
  "model/shop/api.md": md(["kind: container", "name: API", "parent: shop", "technology: Node.js"]),
  "model/shop/db.md": md(["kind: container", "name: DB", "parent: shop", "tags: [database]"]),
  "model/shop/api/controller.md": md([
    "kind: component",
    "name: Controller",
    "parent: api",
    "uses:",
    "  - to: db",
    "    description: Stores orders",
    "    technology: SQL",
    "  - to: payments",
    "    description: Charges cards",
  ]),
  "model/payments.md": md(["kind: system", "name: Payments", "external: true"]),
  "views/landscape.md": md(["kind: view", "title: Landscape", "level: landscape"]),
  "views/shop-containers.md": md(["kind: view", "title: Shop containers", "level: container", "scope: shop"]),
  "views/api-components.md": md(["kind: view", "title: API components", "level: component", "scope: api"]),
  "views/shop-context.md": md(["kind: view", "title: Shop context", "level: context", "scope: shop"]),
};
