import { describe, expect, it } from "vitest";
import { applyOperations, OpError, parseOperations, type OpenArchDocument } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

const fails = (doc: OpenArchDocument, ...ops: Parameters<typeof applyOperations>[1]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("expected the operations to be refused");
};

describe("elements", () => {
  it("adds an element with a name from its ID when none is given", () => {
    const doc = apply(shop(), { op: "add-element", id: "cart-cache", kind: "container", parent: "shop", technology: "Redis", tags: ["cache"] });
    expect(doc.elements["cart-cache"]).toEqual({ kind: "container", name: "Cart Cache", parent: "shop", technology: "Redis", tags: ["cache"] });
  });

  it("refuses elements that break the rules, with a suggestion for typos", () => {
    expect(fails(shop(), { op: "add-element", id: "Cache", kind: "container", parent: "shop" })).toMatch(/kebab-case/);
    expect(fails(shop(), { op: "add-element", id: "api", kind: "container", parent: "shop" })).toMatch(/already used/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container" })).toMatch(/needs a parent system/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "component", parent: "shop" })).toMatch(/must be a container/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container", parent: "shpo" })).toBe('No element has the ID "shpo". Did you mean "shop"?');
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container", parent: "shop", external: true })).toMatch(/Only people and systems/);
  });

  it("updates and removes fields, and merges properties", () => {
    const doc = apply(
      shop(),
      { op: "update-element", id: "api", name: "Orders API", technology: null, notes: "Runs on **Fargate**.", properties: { owner: "checkout", repo: "orders" } },
      { op: "update-element", id: "api", properties: { repo: null } },
    );
    expect(doc.elements.api).toEqual({ kind: "container", name: "Orders API", parent: "shop", notes: "Runs on **Fargate**.", properties: { owner: "checkout" } });
    expect(fails(shop(), { op: "update-element", id: "api" })).toMatch(/Say what to change/);
  });

  it("removes an element, what's inside it, views scoped to it, and every reference to it", () => {
    const doc = shop();
    doc.views["shop-containers"]!.include = ["*", "api"];
    doc.views["shop-containers"]!.layout = { api: [0, 0], db: [10, 10] };
    const after = applyOperations(doc, [{ op: "remove-element", id: "api" }]);
    expect(Object.keys(after.doc.elements).sort()).toEqual(["customer", "db", "payments", "shop", "web-app"]);
    expect(after.doc.views["api-components"]).toBeUndefined();
    expect(after.doc.views["shop-containers"]).toMatchObject({ include: ["*"], layout: { db: [10, 10] } });
    expect(after.doc.elements["web-app"]!.uses).toBeUndefined();
    expect(after.summary).toEqual(["removed api and 1 element inside it and view api-components"]);
    expect(rules(after.doc)).toEqual([]);
  });

  it("renames an element everywhere it's referenced", () => {
    const doc = shop();
    doc.views["shop-containers"]!.layout = { api: [1, 2] };
    doc.views.landscape!.exclude = ["payments"];
    const after = apply(doc, { op: "rename", id: "api", to: "orders-api" }, { op: "rename", id: "payments", to: "psp" });
    expect(after.elements.controller!.parent).toBe("orders-api");
    expect(after.views["api-components"]!.scope).toBe("orders-api");
    expect(after.views["shop-containers"]!.layout).toEqual({ "orders-api": [1, 2] });
    expect(after.elements.controller!.uses![1]!.to).toBe("psp");
    expect(after.views.landscape!.exclude).toEqual(["psp"]);
    expect(rules(after)).toEqual([]);
  });
});

describe("relationships", () => {
  it("adds, updates and removes relationships", () => {
    let doc = apply(shop(), { op: "add-relationship", from: "api", to: "db", description: "Reads stock", technology: "SQL" });
    expect(doc.elements.api!.uses).toEqual([{ to: "db", description: "Reads stock", technology: "SQL" }]);
    doc = apply(doc, { op: "update-relationship", from: "api", to: "db", technology: null });
    expect(doc.elements.api!.uses).toEqual([{ to: "db", description: "Reads stock" }]);
    doc = apply(doc, { op: "remove-relationship", from: "api", to: "db" });
    expect(doc.elements.api!.uses).toBeUndefined();
  });

  it("refuses relationships no view could draw, and duplicates", () => {
    expect(fails(shop(), { op: "add-relationship", from: "api", to: "controller" })).toMatch(/contain one another/);
    expect(fails(shop(), { op: "add-relationship", from: "api", to: "api" })).toMatch(/itself/);
    expect(fails(shop(), { op: "add-relationship", from: "controller", to: "db", description: "Stores orders" })).toMatch(/already has/);
  });

  it("asks which relationship when there's more than one to the same element", () => {
    const doc = apply(shop(), { op: "add-relationship", from: "controller", to: "db", description: "Reads reports" });
    expect(fails(doc, { op: "remove-relationship", from: "controller", to: "db" })).toBe(
      '"controller" has 2 relationships to "db" (0: Stores orders; 1: Reads reports). Say which with "index".',
    );
    const after = apply(doc, { op: "remove-relationship", from: "controller", to: "db", index: 1 });
    expect(after.elements.controller!.uses!.map((u) => u.description)).toEqual(["Stores orders", "Charges cards"]);
  });
});

describe("views", () => {
  it("adds a view with a default title, and checks its scope", () => {
    const doc = apply(shop(), { op: "add-view", id: "web-components", level: "component", scope: "web-app" });
    expect(doc.views["web-components"]).toEqual({ title: "Web App components", level: "component", scope: "web-app", include: ["*"] });
    expect(fails(shop(), { op: "add-view", id: "v", level: "container", scope: "api" })).toMatch(/must be a system/);
    expect(fails(shop(), { op: "add-view", id: "v", level: "landscape", include: ["shpo"] })).toMatch(/Did you mean "shop"/);
  });

  it("hides and shows elements, and refuses ones the view can't draw", () => {
    let doc = apply(shop(), { op: "hide-in-view", view: "shop-containers", id: "customer" });
    expect(doc.views["shop-containers"]!.exclude).toEqual(["customer"]);
    doc = apply(doc, { op: "show-in-view", view: "shop-containers", id: "customer" });
    expect(doc.views["shop-containers"]!.exclude).toBeUndefined();
    expect(fails(shop(), { op: "show-in-view", view: "shop-containers", id: "controller" })).toMatch(/can't draw "controller"/);
    expect(fails(shop(), { op: "hide-in-view", view: "landscape", id: "api" })).toMatch(/isn't a box/);
  });

  it("saves positions, rounded, and drops positions of elements that leave the view", () => {
    let doc = apply(shop(), { op: "set-layout", view: "landscape", positions: { shop: [10.4, 20.6], customer: [0, 0] } });
    expect(doc.views.landscape!.layout).toEqual({ shop: [10, 21], customer: [0, 0] });
    doc = apply(doc, { op: "hide-in-view", view: "landscape", id: "customer" });
    expect(doc.views.landscape!.layout).toEqual({ shop: [10, 21] });
  });
});

describe("batches", () => {
  it("applies all or nothing, naming the operation that failed", () => {
    const doc = shop();
    const message = fails(doc, { op: "add-element", id: "cache", kind: "container", parent: "shop" }, { op: "add-relationship", from: "cache", to: "dbb" });
    expect(message).toBe('Operation 2 (add-relationship): No element has the ID "dbb". Did you mean "db"?');
    expect(doc.elements.cache).toBeUndefined();
  });

  it("refuses changes that leave the model with new errors, but tolerates old ones", () => {
    const broken = shop();
    broken.elements.api!.uses = [{ to: "gone", description: "x" }];
    expect(rules(broken)).toEqual(["relationship-unknown-target"]);
    const ok = applyOperations(broken, [{ op: "add-element", id: "cache", kind: "container", parent: "shop" }]);
    expect(ok.summary).toEqual(["added container cache"]);
  });

  it("reports warnings a change introduces without refusing it", () => {
    const result = applyOperations(shop(), [{ op: "add-relationship", from: "api", to: "db" }]);
    expect(result.warnings.map((w) => w.rule)).toEqual(["relationship-description"]);
  });
});

describe("parseOperations", () => {
  it("accepts one operation or a list", () => {
    expect(parseOperations({ op: "remove-view", id: "x" })).toEqual([{ op: "remove-view", id: "x" }]);
  });

  it("explains malformed operations", () => {
    const bad = (raw: unknown) => {
      try {
        parseOperations(raw);
      } catch (e) {
        return (e as Error).message;
      }
      return "ok";
    };
    expect(bad([])).toBe("There are no operations to apply.");
    expect(bad({ op: "add-elemnt" })).toMatch(/^unknown "op" "add-elemnt". Did you mean "add-element"\?/);
    expect(bad({ op: "add-element", id: "x", kind: "system", desc: "y" })).toMatch(/^add-element has no field "desc"\./);
    expect(bad({ op: "add-element", id: "x" })).toBe('add-element needs "kind".');
    expect(bad([{ op: "remove-view", id: "a" }, { op: "update-element", id: "x", tags: "a" }])).toBe('Operation 2: update-element: "tags" must be a list of strings.');
  });
});
