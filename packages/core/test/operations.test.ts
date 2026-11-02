import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, computeView, OpError, parseOperations, serializeDocument, type OpenArchDocument } from "../src/index.js";
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
    const doc = apply(shop(), { op: "add-element", id: "cart-cache", kind: "container", parent: "shop", technology: "Redis", shape: "database", tags: { " owner ": " checkout ", cache: "" } });
    expect(doc.elements["cart-cache"]).toEqual({ kind: "container", name: "Cart Cache", parent: "shop", technology: "Redis", shape: "database", tags: { owner: "checkout", cache: "" } });
  });

  it("refuses elements that break the rules, with a suggestion for typos", () => {
    expect(fails(shop(), { op: "add-element", id: "Cache", kind: "container", parent: "shop" })).toMatch(/kebab-case/);
    expect(fails(shop(), { op: "add-element", id: "api", kind: "container", parent: "shop" })).toMatch(/already used/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container" })).toMatch(/needs a parent system/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "component", parent: "shop" })).toMatch(/must be a container/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container", parent: "shpo" })).toBe('No element has the ID "shpo". Did you mean "shop"?');
    expect(fails(shop(), { op: "add-element", id: "x", kind: "container", parent: "shop", external: true })).toMatch(/Only people and systems/);
    expect(fails(shop(), { op: "add-element", id: "x", kind: "system", tags: { " ": "y" } })).toBe("A tag needs a name.");
  });

  it("sets and clears shapes, and refuses unknown ones and shapes for people", () => {
    let doc = apply(shop(), { op: "update-element", id: "api", shape: "queue" });
    expect(doc.elements.api!.shape).toBe("queue");
    doc = apply(doc, { op: "update-element", id: "api", shape: "box" }, { op: "update-element", id: "db", shape: null });
    expect(doc.elements.api).not.toHaveProperty("shape");
    expect(doc.elements.db).not.toHaveProperty("shape");
    expect(fails(shop(), { op: "update-element", id: "api", shape: "databse" as never })).toBe('Unknown shape "databse". Did you mean "database"? Use one of: box, database, queue, web-browser, mobile-app, folder.');
    expect(fails(shop(), { op: "add-element", id: "bot", kind: "person", shape: "folder" })).toMatch(/People are always drawn as a person/);
    expect(apply(shop(), { op: "add-element", id: "x", kind: "system", shape: "box" }).elements.x).toEqual({ kind: "system", name: "X" });
  });

  it("updates and removes fields, and merges tags", () => {
    const doc = apply(
      shop(),
      { op: "update-element", id: "api", name: "Orders API", technology: null, notes: "Runs on **Fargate**.", tags: { owner: "checkout", repo: "orders", pii: "" } },
      { op: "update-element", id: "api", tags: { repo: null, owner: "payments" } },
    );
    expect(doc.elements.api).toEqual({ kind: "container", name: "Orders API", parent: "shop", notes: "Runs on **Fargate**.", tags: { owner: "payments", pii: "" } });
    expect(apply(doc, { op: "update-element", id: "api", tags: { owner: null, pii: null } }).elements.api).not.toHaveProperty("tags");
  });

  it("removes tags by their exact name, and treats any name as a tag", () => {
    const doc = shop();
    doc.elements.api!.tags = { " owner": "x", "": "y", keep: "z" };
    expect(apply(doc, { op: "update-element", id: "api", tags: { " owner": null, "": null } }).elements.api!.tags).toEqual({ keep: "z" });
    const proto = apply(shop(), { op: "update-element", id: "api", tags: { ["__proto__"]: "v" } }).elements.api!.tags!;
    expect(Object.keys(proto)).toEqual(["__proto__"]);
    expect(serializeDocument({ ...shop(), elements: { ...shop().elements, api: { ...shop().elements.api!, tags: proto } } })).toContain('"__proto__": "v"');
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

  it("adds, changes and removes a relationship's notes", () => {
    let doc = apply(shop(), { op: "add-relationship", from: "api", to: "db", description: "Reads stock", notes: "  Read-only.\n\n- Uses a **replica**.  " });
    expect(doc.elements.api!.uses).toEqual([{ to: "db", description: "Reads stock", notes: "Read-only.\n\n- Uses a **replica**." }]);
    doc = apply(doc, { op: "update-relationship", from: "api", to: "db", notes: "Cached for a minute." });
    expect(doc.elements.api!.uses![0]!.notes).toBe("Cached for a minute.");
    doc = apply(doc, { op: "update-relationship", from: "api", to: "db", notes: null });
    expect(doc.elements.api!.uses).toEqual([{ to: "db", description: "Reads stock" }]);
    expect(apply(doc, { op: "update-relationship", from: "api", to: "db", notes: " " }).elements.api!.uses).toEqual([{ to: "db", description: "Reads stock" }]);
    expect(fails(doc, { op: "update-relationship", from: "api", to: "db" })).toBe("Say what to change: newFrom, newTo, bidirectional, description, technology, tags or notes.");
  });

  it("merges a relationship's tags", () => {
    let doc = apply(shop(), { op: "add-relationship", from: "api", to: "db", description: "Reads stock", tags: { async: "" } });
    doc = apply(doc, { op: "update-relationship", from: "api", to: "db", tags: { async: null, protocol: "postgres" } });
    expect(doc.elements.api!.uses).toEqual([{ to: "db", description: "Reads stock", tags: { protocol: "postgres" } }]);
  });

  it("refuses relationships no view could draw, and duplicates", () => {
    expect(fails(shop(), { op: "add-relationship", from: "api", to: "controller" })).toMatch(/contain one another/);
    expect(fails(shop(), { op: "add-relationship", from: "api", to: "api" })).toMatch(/itself/);
    expect(fails(shop(), { op: "add-relationship", from: "controller", to: "db", description: "Stores orders" })).toMatch(/already has/);
  });

  it("points a relationship at another element, keeping its place and its fields", () => {
    const doc = shop();
    doc.elements.controller!.uses![0]!.tags = { owner: "orders" };
    doc.elements.controller!.uses![0]!.notes = "Writes in one transaction.";
    const after = applyOperations(doc, [{ op: "update-relationship", from: "controller", to: "db", newTo: "web-app" }]);
    expect(after.doc.elements.controller!.uses).toEqual([
      { to: "web-app", description: "Stores orders", technology: "SQL", tags: { owner: "orders" }, notes: "Writes in one transaction." },
      { to: "payments", description: "Charges cards" },
    ]);
    expect(after.summary).toEqual(["moved relationship controller -> db to controller -> web-app"]);
  });

  it("moves a relationship to another element, after the ones it has, and can change its fields too", () => {
    const after = apply(shop(), { op: "update-relationship", from: "controller", to: "payments", newFrom: "web-app", technology: "HTTPS" });
    expect(after.elements.controller!.uses).toEqual([{ to: "db", description: "Stores orders", technology: "SQL" }]);
    expect(after.elements["web-app"]!.uses).toEqual([
      { to: "controller", description: "Places orders" },
      { to: "payments", description: "Charges cards", technology: "HTTPS" },
    ]);
    // Both ends at once, and the last one an element had.
    const both = apply(shop(), { op: "update-relationship", from: "customer", to: "web-app", newFrom: "payments", newTo: "api" });
    expect(both.elements.customer).not.toHaveProperty("uses");
    expect(both.elements.payments!.uses).toEqual([{ to: "api", description: "Buys things", technology: "HTTPS" }]);
    // Ends it already has are no change.
    expect(apply(shop(), { op: "update-relationship", from: "customer", to: "web-app", newFrom: "customer", newTo: "web-app" })).toEqual(shop());
  });

  it("moves the relationship it's told to when there's more than one to the same element", () => {
    let doc = apply(shop(), { op: "add-relationship", from: "controller", to: "db", description: "Reads reports" });
    doc = apply(doc, { op: "update-relationship", from: "controller", to: "db", index: 1, newTo: "web-app" });
    expect(doc.elements.controller!.uses!.map((u) => `${u.to}: ${u.description}`)).toEqual(["db: Stores orders", "payments: Charges cards", "web-app: Reads reports"]);
  });

  it("refuses new ends no view could draw, ones that aren't elements, and duplicates", () => {
    expect(fails(shop(), { op: "update-relationship", from: "controller", to: "db", newTo: "api" })).toMatch(/contain one another/);
    expect(fails(shop(), { op: "update-relationship", from: "controller", to: "db", newTo: "controller" })).toMatch(/itself/);
    expect(fails(shop(), { op: "update-relationship", from: "customer", to: "web-app", newFrom: "web-app" })).toMatch(/itself/);
    expect(fails(shop(), { op: "update-relationship", from: "controller", to: "db", newTo: "dbb" })).toBe('No element has the ID "dbb". Did you mean "db"?');
    expect(fails(shop(), { op: "update-relationship", from: "controller", to: "db", newFrom: "paymnts" })).toMatch(/Did you mean "payments"/);
    const doc = apply(shop(), { op: "add-relationship", from: "api", to: "db", description: "Stores orders" });
    expect(fails(doc, { op: "update-relationship", from: "api", to: "db", newFrom: "controller" })).toBe('"controller" already has this relationship to "db".');
    // A different description makes it a different relationship.
    expect(apply(doc, { op: "update-relationship", from: "api", to: "db", newFrom: "controller", description: "Reads stock" }).elements.controller!.uses).toHaveLength(3);
  });

  it("checks new ends sent as JSON", () => {
    expect(parseOperations({ op: "update-relationship", from: "a", to: "b", newTo: "c" })).toEqual([{ op: "update-relationship", from: "a", to: "b", newTo: "c" }]);
    expect(() => parseOperations({ op: "update-relationship", from: "a", to: "b", newTo: null })).toThrow('update-relationship: "newTo" must be a string.');
    expect(() => parseOperations({ op: "update-relationship", from: "a", to: "b", newto: "c" })).toThrow(/Did you mean "newTo"/);
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

  it("adds, changes and removes a view's description and notes", () => {
    let doc = apply(shop(), { op: "add-view", id: "web-components", level: "component", scope: "web-app", description: " The storefront. ", notes: " ## Why\n\nTo show the **storefront**. " });
    expect(doc.views["web-components"]).toEqual({
      title: "Web App components",
      description: "The storefront.",
      level: "component",
      scope: "web-app",
      include: ["*"],
      notes: "## Why\n\nTo show the **storefront**.",
    });
    doc = apply(doc, { op: "update-view", id: "web-components", notes: "Only the storefront." });
    expect(doc.views["web-components"]!.notes).toBe("Only the storefront.");
    doc = apply(doc, { op: "update-view", id: "web-components", description: null, notes: "" });
    expect(doc.views["web-components"]).toEqual({ title: "Web App components", level: "component", scope: "web-app", include: ["*"] });
    expect(fails(doc, { op: "update-view", id: "web-components" })).toBe("Say what to change: title, description, include, exclude, new elements or notes.");
  });

  it("hides and shows elements, and refuses ones the view can't draw", () => {
    let doc = apply(shop(), { op: "hide-in-view", view: "shop-containers", id: "customer" });
    expect(doc.views["shop-containers"]!.exclude).toEqual(["customer"]);
    doc = apply(doc, { op: "show-in-view", view: "shop-containers", id: "customer" });
    expect(doc.views["shop-containers"]!.exclude).toBeUndefined();
    expect(fails(shop(), { op: "show-in-view", view: "shop-containers", id: "controller" })).toMatch(/can't draw "controller"/);
    expect(fails(shop(), { op: "hide-in-view", view: "landscape", id: "api" })).toMatch(/isn't a box/);
  });

  it("stops showing new elements in a view, and shows them again, keeping the view's boxes", () => {
    const boxes = (doc: OpenArchDocument, view: string) => computeView(buildWorkspace(doc), buildWorkspace(doc).views.get(view)!).nodes.map((n) => n.id).sort();
    let doc = apply(shop(), { op: "hide-in-view", view: "shop-containers", id: "customer" });
    const before = boxes(doc, "shop-containers");
    doc = apply(doc, { op: "update-view", id: "shop-containers", newElements: "hide" });
    expect([...doc.views["shop-containers"]!.include!].sort()).toEqual(before);
    expect(doc.views["shop-containers"]!.exclude).toBeUndefined();
    expect(boxes(doc, "shop-containers")).toEqual(before);

    // A container added later stays out of this view, until it's shown here.
    doc = apply(doc, { op: "add-element", id: "cache", kind: "container", parent: "shop" });
    expect(boxes(doc, "shop-containers")).toEqual(before);
    doc = apply(doc, { op: "show-in-view", view: "shop-containers", id: "cache" });
    expect(boxes(doc, "shop-containers")).toEqual([...before, "cache"].sort());
    doc = apply(doc, { op: "hide-in-view", view: "shop-containers", id: "cache" });
    expect(boxes(doc, "shop-containers")).toEqual(before);

    // Back to showing new elements: what * would add is excluded, so the boxes stay the same.
    doc = apply(doc, { op: "update-view", id: "shop-containers", newElements: "show" });
    expect(doc.views["shop-containers"]!.include).toEqual(["*"]);
    expect([...doc.views["shop-containers"]!.exclude!].sort()).toEqual(["cache", "customer"]);
    expect(boxes(doc, "shop-containers")).toEqual(before);
    doc = apply(doc, { op: "add-element", id: "queue", kind: "container", parent: "shop" });
    expect(boxes(doc, "shop-containers")).toContain("queue");
  });

  it("keeps boxes * doesn't cover when a view shows new elements again", () => {
    let doc = apply(shop(), { op: "add-element", id: "crm", kind: "system" }, { op: "update-view", id: "shop-context", include: ["shop", "crm"] });
    doc = apply(doc, { op: "update-view", id: "shop-context", newElements: "show" });
    expect(doc.views["shop-context"]!.include).toEqual(["*", "crm"]);
    expect([...doc.views["shop-context"]!.exclude!].sort()).toEqual(["customer", "payments"]);
    // Asking for the setting a view already has changes nothing.
    expect(apply(doc, { op: "update-view", id: "shop-context", newElements: "show" }).views["shop-context"]).toEqual(doc.views["shop-context"]);
  });

  it("refuses a new-elements setting it can't use", () => {
    expect(fails(shop(), { op: "update-view", id: "shop-containers", newElements: "never" as never })).toBe('Unknown new-elements setting "never". Use show or hide.');
    expect(fails(shop(), { op: "update-view", id: "shop-containers", newElements: "hide", include: ["api"] })).toMatch(/but not both/);
    const seq = apply(shop(), { op: "add-view", id: "order", level: "sequence" });
    expect(fails(seq, { op: "update-view", id: "order", newElements: "hide" })).toMatch(/takes no include or exclude/);
    expect(parseOperations({ op: "update-view", id: "shop-containers", newElements: "hide" })).toEqual([{ op: "update-view", id: "shop-containers", newElements: "hide" }]);
  });

  it("saves positions, rounded, and drops positions of elements that leave the view", () => {
    let doc = apply(shop(), { op: "set-layout", view: "landscape", positions: { shop: [10.4, 20.6], customer: [0, 0] } });
    expect(doc.views.landscape!.layout).toEqual({ shop: [10, 21], customer: [0, 0] });
    doc = apply(doc, { op: "hide-in-view", view: "landscape", id: "customer" });
    expect(doc.views.landscape!.layout).toEqual({ shop: [10, 21] });
  });
});

describe("sticky notes", () => {
  it("adds, updates and removes sticky notes, keeping yellow as the default", () => {
    let doc = apply(
      shop(),
      { op: "add-sticky", view: "landscape", id: "start-here", text: " Read me first. ", at: [10.4, -20.6] },
      { op: "add-sticky", view: "landscape", id: "tip", text: "Try it.", color: "green" },
    );
    expect(doc.views.landscape!.stickies).toEqual({ "start-here": { text: "Read me first.", at: [10, -21] }, tip: { text: "Try it.", color: "green" } });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "start-here", text: "Read me.", color: "pink", at: null }, { op: "update-sticky", view: "landscape", id: "tip", color: "yellow", at: [5, 5] });
    expect(doc.views.landscape!.stickies).toEqual({ "start-here": { text: "Read me.", color: "pink" }, tip: { text: "Try it.", at: [5, 5] } });
    doc = apply(doc, { op: "remove-sticky", view: "landscape", id: "start-here" }, { op: "remove-sticky", view: "landscape", id: "tip" });
    expect(doc.views.landscape!.stickies).toBeUndefined();
  });

  it("refuses notes without text, unknown colors and missing notes", () => {
    const doc = apply(shop(), { op: "add-sticky", view: "landscape", id: "note", text: "Hi" });
    expect(fails(doc, { op: "add-sticky", view: "landscape", id: "note", text: "Again" })).toMatch(/already has a sticky note "note"/);
    expect(fails(doc, { op: "add-sticky", view: "landscape", id: "Note", text: "x" })).toMatch(/kebab-case/);
    expect(fails(doc, { op: "add-sticky", view: "landscape", id: "other", text: "  " })).toMatch(/needs some text/);
    expect(fails(doc, { op: "add-sticky", view: "landscape", id: "other", text: "x", color: "red" as never })).toMatch(/Unknown color "red"/);
    expect(fails(doc, { op: "update-sticky", view: "landscape", id: "note", text: "" })).toMatch(/remove-sticky/);
    expect(fails(doc, { op: "update-sticky", view: "landscape", id: "nots", text: "x" })).toBe('View "landscape" has no sticky note "nots". Did you mean "note"?');
    expect(fails(doc, { op: "remove-sticky", view: "shop-context", id: "note" })).toBe('View "shop-context" has no sticky note "note".');
  });

  it("keeps a view's notes when the view is renamed", () => {
    const doc = apply(shop(), { op: "add-sticky", view: "landscape", id: "note", text: "Hi" }, { op: "rename", id: "landscape", to: "everything" });
    expect(doc.views.everything!.stickies).toEqual({ note: { text: "Hi" } });
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
    expect(bad([{ op: "remove-view", id: "a" }, { op: "update-element", id: "x", tags: ["a"] }])).toBe(
      'Operation 2: update-element: "tags" must be an object of tag names and string values, like { "owner": "payments" } (null removes a tag).',
    );
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", at: [1, 2, 3] })).toBe('add-sticky: "at" must be a position, [x, y].');
    expect(bad({ op: "update-sticky", view: "v", id: "n", at: null })).toBe("ok");
  });
});
