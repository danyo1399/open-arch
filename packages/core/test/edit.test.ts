import { describe, expect, it } from "vitest";
import {
  addRelationship,
  checkWorkspace,
  computeView,
  deleteElement,
  formatWorkspace,
  hideInView,
  planDeleteElement,
  removeRelationship,
  setLayout,
  showInView,
  updateElement,
  updateRelationship,
  updateView,
} from "../src/index.js";
import { apply, md, SHOP, ws } from "./helpers.js";

function cleanShop(extra: Record<string, string> = {}) {
  const first = ws({ ...SHOP, ...extra });
  return apply(first, formatWorkspace(first).changes);
}
const text = (workspace: ReturnType<typeof ws>, path: string) => workspace.inputs.find((f) => f.path === path)!.text;
const errors = (workspace: ReturnType<typeof ws>) => checkWorkspace(workspace).filter((d) => d.severity === "error");
const boxes = (workspace: ReturnType<typeof ws>, view: string) => computeView(workspace, workspace.views.get(view)!).nodes.map((n) => n.id);

describe("updateElement", () => {
  it("sets and removes fields, keeping comments, and refreshes previews", () => {
    const base = cleanShop({ "model/shop/api.md": md(["kind: container", "name: API # short name", "parent: shop", "technology: Node.js"]) });
    const changes = updateElement(base, "api", { name: "Orders API", description: "Takes orders.", technology: null, tags: ["critical"] });
    const after = apply(base, changes);
    expect(text(after, "model/shop/api.md")).toBe(md(["kind: container", "name: Orders API # short name", "parent: shop", "description: Takes orders.", "tags: [critical]"]));
    expect(changes.map((c) => c.path)).toContain("views/shop-containers.md");
    expect(errors(after)).toEqual([]);
  });

  it("moves an element to another parent of the right kind", () => {
    const base = cleanShop({ "model/other.md": md(["kind: system", "name: Other"]) });
    expect(apply(base, updateElement(base, "db", { parent: "other" })).elements.get("db")!.parent).toBe("other");
    expect(() => updateElement(base, "db", { parent: "api" })).toThrow(/must be a system/);
  });

  it("returns nothing when nothing changes", () => {
    expect(updateElement(cleanShop(), "api", { name: "API" })).toEqual([]);
  });
});

describe("relationships", () => {
  it("adds a relationship, creating the list when needed", () => {
    const base = cleanShop();
    const after = apply(base, addRelationship(base, "api", "db", { description: "Reads stock", technology: "SQL" }));
    expect(text(after, "model/shop/api.md")).toContain("uses:\n  - to: db\n    description: Reads stock\n    technology: SQL\n");
    expect(errors(after)).toEqual([]);
    expect(() => addRelationship(base, "api", "controller")).toThrow(/contain one another/);
    expect(() => addRelationship(base, "api", "api")).toThrow(/itself/);
  });

  it("updates and removes by position, including the shorthand form", () => {
    const base = cleanShop({ "model/customer.md": md(["kind: person", "name: Customer", "uses:", "  - web-app", "  - to: payments", "    description: Pays"]) });
    const updated = apply(base, updateRelationship(base, "customer", 0, { description: "Buys", technology: "HTTPS" }));
    expect(updated.elements.get("customer")!.uses[0]).toMatchObject({ to: "web-app", description: "Buys", technology: "HTTPS" });
    const removed = apply(updated, removeRelationship(updated, "customer", 1));
    expect(removed.elements.get("customer")!.uses.map((u) => u.to)).toEqual(["web-app"]);
    const empty = apply(removed, removeRelationship(removed, "customer", 0));
    expect(text(empty, "model/customer.md")).not.toContain("uses");
  });
});

describe("deleteElement", () => {
  it("deletes the element, its contents, scoped views and every reference", () => {
    const base = cleanShop({ "views/shop-containers.md": md(["kind: view", "title: S", "level: container", "scope: shop", "include: ['*', api]"]) });
    const plan = planDeleteElement(base, "api");
    expect(plan.elements.map((e) => e.id).sort()).toEqual(["api", "controller"]);
    expect(plan.views.map((v) => v.id)).toEqual(["api-components"]);
    expect(plan.affected.map((e) => e.id)).toEqual(["web-app"]);

    const after = apply(base, deleteElement(base, "api"));
    expect([...after.elements.keys()].sort()).toEqual(["customer", "db", "payments", "shop", "web-app"]);
    expect(after.views.has("api-components")).toBe(false);
    expect(after.views.get("shop-containers")!.include).toEqual(["*"]);
    expect(text(after, "model/shop/web-app.md")).not.toContain("uses");
    expect(errors(after)).toEqual([]);
  });
});

describe("views", () => {
  it("saves positions in the layout comment, rounded", () => {
    const base = cleanShop();
    const after = apply(base, setLayout(base, "landscape", { shop: { x: 10.4, y: 20.6 }, customer: { x: 0, y: 0, w: 200 } }));
    expect(text(after, "views/landscape.md")).toContain('<!-- open-arch:layout\n{\n  "nodes": {\n    "customer": {"x": 0, "y": 0, "w": 200},\n    "shop": {"x": 10, "y": 21}\n  }\n}\n-->\n');
    expect(setLayout(after, "landscape", { shop: { x: 10, y: 21 }, customer: { x: 0, y: 0, w: 200 } })).toEqual([]);
    expect(errors(after)).toEqual([]);
  });

  it("hides and shows elements with include and exclude", () => {
    const base = cleanShop();
    const hidden = apply(base, hideInView(base, "shop-containers", "customer"));
    expect(hidden.views.get("shop-containers")!.exclude).toEqual(["customer"]);
    expect(boxes(hidden, "shop-containers")).not.toContain("customer");

    const shown = apply(hidden, showInView(hidden, "shop-containers", "customer"));
    expect(shown.views.get("shop-containers")!.exclude).toEqual([]);
    expect(text(shown, "views/shop-containers.md")).not.toContain("exclude");

    const explicit = cleanShop({ "views/landscape.md": md(["kind: view", "title: L", "level: landscape", "include: [shop]"]) });
    const added = apply(explicit, showInView(explicit, "landscape", "payments"));
    expect(added.views.get("landscape")!.include).toEqual(["shop", "payments"]);
    const dropped = apply(added, hideInView(added, "landscape", "shop"));
    expect(dropped.views.get("landscape")!.include).toEqual(["payments"]);
    expect(errors(dropped)).toEqual([]);
  });

  it("updates a view's title", () => {
    const base = cleanShop();
    expect(apply(base, updateView(base, "landscape", { title: "Everything" })).views.get("landscape")!.title).toBe("Everything");
  });
});
