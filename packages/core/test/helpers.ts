import { applyOperations, buildWorkspace, checkWorkspace, type OpenArchDocument, type Operation, type Workspace } from "../src/index.js";

/** A small model: a customer, a shop with three containers and a component, and an external system. */
export function shop(): OpenArchDocument {
  return {
    openarch: 9,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "web-app", description: "Buys things", technology: "HTTPS" }] },
      shop: { kind: "system", name: "Shop" },
      "web-app": { kind: "container", name: "Web App", parent: "shop", technology: "React", uses: [{ to: "controller", description: "Places orders" }] },
      api: { kind: "container", name: "API", parent: "shop", technology: "Node.js" },
      db: { kind: "container", name: "DB", parent: "shop", shape: "database" },
      controller: {
        kind: "component",
        name: "Controller",
        parent: "api",
        uses: [
          { to: "db", description: "Stores orders", technology: "SQL" },
          { to: "payments", description: "Charges cards" },
        ],
      },
      payments: { kind: "system", name: "Payments", external: true },
    },
    views: {
      landscape: { title: "Landscape", level: "landscape" },
      "shop-containers": { title: "Shop containers", level: "container", scope: "shop" },
      "api-components": { title: "API components", level: "component", scope: "api" },
      "shop-context": { title: "Shop context", level: "context", scope: "shop" },
    },
  };
}

export function ws(doc: OpenArchDocument = shop()): Workspace {
  return buildWorkspace(doc);
}

export function rules(doc: OpenArchDocument): string[] {
  return checkWorkspace(buildWorkspace(doc)).map((d) => d.rule);
}

export function apply(doc: OpenArchDocument, ...ops: Operation[]): OpenArchDocument {
  return applyOperations(doc, ops).doc;
}
