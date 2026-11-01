import { applyOperations, buildWorkspace, computeView, modelTree, type ComputedView, type OpenArchDocument, type Operation, type TreeNode } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import {
  arrowRelationships,
  byName,
  followRenames,
  followsName,
  idFromName,
  renamedId,
  renamedSelection,
  renamesBetween,
  renamesIn,
  sameShapes,
  selectedShapes,
  selectShapes,
  shownInProperties,
  toggleShape,
  undoRenames,
  uniqueId,
  viewAction,
} from "../src/model.js";

const ws = buildWorkspace({
  openarch: 3,
  name: "Shop",
  elements: {
    api: { kind: "system", name: "API" },
    "api-2": { kind: "system", name: "API" },
    db: { kind: "system", name: "Orders DB" },
  },
  views: { landscape: { title: "Landscape", level: "landscape" } },
});

describe("idFromName", () => {
  it("makes a kebab-case ID", () => {
    expect(idFromName("Checkout API")).toBe("checkout-api");
    expect(idFromName("  Orders / DB (v2) ")).toBe("orders-db-v2");
    expect(idFromName("!!!")).toBe("");
  });
});

describe("uniqueId", () => {
  it("numbers an ID that's taken", () => {
    expect(uniqueId(ws, "shop")).toBe("shop");
    expect(uniqueId(ws, "api")).toBe("api-3");
    expect(uniqueId(ws, "landscape")).toBe("landscape-2");
  });

  it("doesn't count the element's own ID as taken", () => {
    expect(uniqueId(ws, "api", "api-2")).toBe("api-2");
    expect(uniqueId(ws, "api", "api")).toBe("api");
  });
});

describe("followsName", () => {
  it("is true for the ID made from the name, numbered or not", () => {
    expect(followsName("checkout-api", "Checkout API")).toBe(true);
    expect(followsName("checkout-api-2", "Checkout API")).toBe(true);
  });

  it("is true for a placeholder whatever the name", () => {
    expect(followsName("new-container", "Checkout API")).toBe(true);
    expect(followsName("new-component-3", "Checkout API")).toBe(true);
  });

  it("is false for an ID chosen apart from the name", () => {
    expect(followsName("db", "Orders DB")).toBe(false);
    expect(followsName("checkout-api-v", "Checkout API")).toBe(false);
    expect(followsName("checkout", "Checkout API")).toBe(false);
    expect(followsName("element", "!!!")).toBe(false);
  });
});

describe("byName", () => {
  const names = (nodes: TreeNode[]): unknown[] => nodes.flatMap((n) => [n.element.name, ...(n.children.length ? [names(n.children)] : [])]);

  it("puts the model tree in alphabetical order at every level, whatever the kinds and IDs", () => {
    const site = buildWorkspace({
      openarch: 3,
      name: "Site",
      elements: {
        customer: { kind: "person", name: "Customer" },
        whatsapp: { kind: "system", name: "WhatsApp", external: true },
        s3: { kind: "system", name: "AWS S3 Storage", external: true },
        cognito: { kind: "system", name: "AWS Cognito", external: true },
        portal: { kind: "system", name: "Agent Portal" },
        website: { kind: "system", name: "Client Website" },
        spa: { kind: "container", name: "Browser", parent: "website" },
        api: { kind: "container", name: "Backend", parent: "website" },
        payments: { kind: "component", name: "Payments", parent: "api" },
        accounts: { kind: "component", name: "accounts", parent: "api" },
        bookings: { kind: "component", name: "Bookings", parent: "api" },
      },
      views: {},
    });
    expect(names(modelTree(site, byName))).toEqual([
      "Agent Portal",
      "AWS Cognito",
      "AWS S3 Storage",
      "Client Website",
      ["Backend", ["accounts", "Bookings", "Payments"], "Browser"],
      "Customer",
      "WhatsApp",
    ]);
  });

  it("orders elements with the same name by ID", () => {
    expect(names(modelTree(ws, byName))).toEqual(["API", "API", "Orders DB"]);
    expect(modelTree(ws, byName).map((n) => n.element.id)).toEqual(["api", "api-2", "db"]);
  });
});

describe("viewAction", () => {
  const shop = buildWorkspace({
    openarch: 3,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "web" }] },
      shop: { kind: "system", name: "Shop" },
      web: { kind: "container", name: "Web app", parent: "shop", uses: [{ to: "db" }] },
      db: { kind: "container", name: "Orders DB", parent: "shop" },
      cart: { kind: "component", name: "Cart", parent: "web" },
    },
    views: {
      landscape: { title: "Landscape", level: "landscape" },
      context: { title: "Context", level: "context", scope: "shop" },
      containers: { title: "Containers", level: "container", scope: "shop", exclude: ["db"] },
      components: { title: "Components", level: "component", scope: "web" },
    },
  });
  const action = (viewId: string | null, id: string) => {
    const view = viewId ? shop.views.get(viewId)! : null;
    return viewAction(shop, view, view && computeView(shop, view), id);
  };

  it("hides a box the view draws", () => {
    expect(action("landscape", "customer")).toBe("hide");
    expect(action("containers", "web")).toBe("hide");
  });

  it("hides a context view's own system, which is a box there, not a frame", () => {
    expect(action("context", "shop")).toBe("hide");
  });

  it("shows an element the view could draw but doesn't", () => {
    expect(action("containers", "db")).toBe("show");
    expect(action("components", "db")).toBe("show");
  });

  it("does neither for the frame, or an element the view can't draw as a box", () => {
    expect(action("containers", "shop")).toBeNull();
    expect(action("components", "web")).toBeNull();
    expect(action("components", "shop")).toBeNull();
    expect(action("landscape", "web")).toBeNull();
    expect(action("containers", "cart")).toBeNull();
  });

  it("does neither with no view open", () => {
    expect(action(null, "customer")).toBeNull();
  });

  it("does neither in a view that can't be drawn, whose operations would be refused", () => {
    const view = shop.views.get("containers")!;
    expect(viewAction(shop, view, null, "web")).toBeNull();
    expect(viewAction(shop, view, null, "customer")).toBeNull();
  });
});

describe("arrowRelationships", () => {
  const shop = buildWorkspace({
    openarch: 3,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Browses" }, { to: "web" }, { to: "shop", description: "Pays" }] },
      shop: { kind: "system", name: "Shop" },
      web: { kind: "container", name: "Web app", parent: "shop", uses: [{ to: "mail" }] },
      mail: { kind: "system", name: "Mail" },
    },
    views: { landscape: { title: "Landscape", level: "landscape" } },
  });
  const computed = computeView(shop, shop.views.get("landscape")!);
  const rels = (from: string, to: string, cv: ComputedView | null = computed) => arrowRelationships(shop, cv, from, to).map((r) => ({ on: r.element.id, description: r.rel.description, ref: r.ref }));

  it("lists every relationship an arrow draws, with how operations name it", () => {
    expect(rels("customer", "shop")).toEqual([
      { on: "customer", description: "Browses", ref: { from: "customer", to: "shop", index: 0 } },
      // The customer's use of the web app, inside the shop, is drawn by the same arrow.
      { on: "customer", description: undefined, ref: { from: "customer", to: "web", index: 0 } },
      { on: "customer", description: "Pays", ref: { from: "customer", to: "shop", index: 1 } },
    ]);
  });

  it("lists the relationships an implied arrow stands for", () => {
    expect(rels("shop", "mail")).toEqual([{ on: "web", description: undefined, ref: { from: "web", to: "mail", index: 0 } }]);
  });

  it("lists nothing for an arrow the view doesn't draw, or a view that can't be drawn", () => {
    expect(rels("mail", "customer")).toEqual([]);
    expect(rels("customer", "shop", null)).toEqual([]);
  });
});

describe("shownInProperties", () => {
  const noted = buildWorkspace({
    openarch: 3,
    name: "Shop",
    elements: { api: { kind: "system", name: "API" } },
    views: { landscape: { title: "Landscape", level: "landscape", stickies: { note: { text: "Read me" } } } },
  });
  const view = noted.views.get("landscape")!;

  it("shows the selection while it's still there", () => {
    expect(shownInProperties(noted, view, { kind: "element", id: "api" })).toEqual({ kind: "element", element: noted.elements.get("api") });
    expect(shownInProperties(noted, view, { kind: "sticky", id: "note" })).toEqual({ kind: "sticky", view, sticky: view.stickies[0] });
    expect(shownInProperties(noted, view, { kind: "arrow", from: "api", to: "db" })).toEqual({ kind: "arrow", from: "api", to: "db" });
  });

  it("shows the view when the selection is gone, or nothing is selected", () => {
    expect(shownInProperties(noted, view, { kind: "element", id: "gone" })).toEqual({ kind: "view", view });
    expect(shownInProperties(noted, view, { kind: "sticky", id: "gone" })).toEqual({ kind: "view", view });
    expect(shownInProperties(noted, view, null)).toEqual({ kind: "view", view });
  });

  it("shows several boxes and notes selected together, as long as more than one is still there", () => {
    const two = noted.views.get("landscape")!;
    expect(shownInProperties(noted, two, { kind: "several", elements: ["api"], stickies: ["note"] })).toEqual({
      kind: "several",
      view: two,
      elements: [noted.elements.get("api")],
      stickies: [two.stickies[0]],
    });
    // One left is shown on its own; none left, the view.
    expect(shownInProperties(noted, two, { kind: "several", elements: ["api", "gone"], stickies: [] })).toEqual({ kind: "element", element: noted.elements.get("api") });
    expect(shownInProperties(noted, two, { kind: "several", elements: ["gone"], stickies: ["gone"] })).toEqual({ kind: "view", view: two });
  });

  it("shows the workspace when it's selected, or no view is open", () => {
    expect(shownInProperties(noted, view, { kind: "workspace" })).toEqual({ kind: "workspace" });
    expect(shownInProperties(noted, null, { kind: "element", id: "gone" })).toEqual({ kind: "workspace" });
    expect(shownInProperties(noted, null, null)).toEqual({ kind: "workspace" });
  });
});

describe("selecting several boxes and notes", () => {
  // The diagram's boxes; "shop" is the frame round them, which isn't one.
  const boxes = new Set(["web", "db", "cart"]);

  it("reads the boxes and notes a selection picks", () => {
    expect(selectedShapes({ kind: "element", id: "web" }, boxes)).toEqual({ elements: ["web"], stickies: [] });
    expect(selectedShapes({ kind: "sticky", id: "note" }, boxes)).toEqual({ elements: [], stickies: ["note"] });
    expect(selectedShapes({ kind: "several", elements: ["web", "db"], stickies: ["note"] }, boxes)).toEqual({ elements: ["web", "db"], stickies: ["note"] });
    expect(selectedShapes({ kind: "element", id: "shop" }, boxes)).toEqual({ elements: [], stickies: [] });
    expect(selectedShapes({ kind: "arrow", from: "web", to: "db" }, boxes)).toEqual({ elements: [], stickies: [] });
    expect(selectedShapes(null, boxes)).toEqual({ elements: [], stickies: [] });
  });

  it("leaves out elements that aren't boxes on the diagram", () => {
    expect(selectedShapes({ kind: "several", elements: ["web", "gone"], stickies: [] }, boxes)).toEqual({ elements: ["web"], stickies: [] });
  });

  it("selects one box or note as a click would, and more than one together", () => {
    expect(selectShapes({ elements: [], stickies: [] })).toBeNull();
    expect(selectShapes({ elements: ["web"], stickies: [] })).toEqual({ kind: "element", id: "web" });
    expect(selectShapes({ elements: [], stickies: ["note"] })).toEqual({ kind: "sticky", id: "note" });
    expect(selectShapes({ elements: ["web"], stickies: ["note"] })).toEqual({ kind: "several", elements: ["web"], stickies: ["note"] });
  });

  it("adds a box or note with a Ctrl-click, and takes it out with another", () => {
    const one = toggleShape({ kind: "element", id: "web" }, boxes, { kind: "element", id: "db" });
    expect(one).toEqual({ kind: "several", elements: ["web", "db"], stickies: [] });
    const three = toggleShape(one, boxes, { kind: "sticky", id: "note" });
    expect(three).toEqual({ kind: "several", elements: ["web", "db"], stickies: ["note"] });
    const two = toggleShape(three, boxes, { kind: "element", id: "web" });
    expect(two).toEqual({ kind: "several", elements: ["db"], stickies: ["note"] });
    // Down to one, it's selected on its own; down to none, nothing is.
    expect(toggleShape(two, boxes, { kind: "sticky", id: "note" })).toEqual({ kind: "element", id: "db" });
    expect(toggleShape({ kind: "element", id: "db" }, boxes, { kind: "element", id: "db" })).toBeNull();
  });

  it("starts afresh from an arrow, the frame or nothing", () => {
    expect(toggleShape({ kind: "arrow", from: "web", to: "db" }, boxes, { kind: "element", id: "db" })).toEqual({ kind: "element", id: "db" });
    expect(toggleShape({ kind: "element", id: "shop" }, boxes, { kind: "element", id: "db" })).toEqual({ kind: "element", id: "db" });
    expect(toggleShape(null, boxes, { kind: "sticky", id: "note" })).toEqual({ kind: "sticky", id: "note" });
  });

  it("compares shapes in any order", () => {
    expect(sameShapes({ elements: ["web", "db"], stickies: ["note"] }, { elements: ["db", "web"], stickies: ["note"] })).toBe(true);
    expect(sameShapes({ elements: ["web"], stickies: [] }, { elements: ["web", "db"], stickies: [] })).toBe(false);
    expect(sameShapes({ elements: ["web"], stickies: [] }, { elements: [], stickies: ["web"] })).toBe(false);
  });
});

describe("renames", () => {
  const renames = renamesIn([
    { op: "update-element", id: "new-system", name: "Payments" },
    { op: "rename", id: "new-system", to: "payments" },
    { op: "rename", id: "payments", to: "billing" },
    { op: "rename", id: "orders", to: "checkout" },
  ]);

  it("picks the renames out of a batch, in order", () => {
    expect(renames.map((r) => `${r.id}>${r.to}`)).toEqual(["new-system>payments", "payments>billing", "orders>checkout"]);
  });

  it("follows an element, or both ends of an arrow, through them", () => {
    const to = (id: string) => renamedId(renames, id);
    expect(renamedSelection({ kind: "element", id: "orders" }, to)).toEqual({ kind: "element", id: "checkout" });
    expect(renamedSelection({ kind: "arrow", from: "new-system", to: "orders" }, to)).toEqual({ kind: "arrow", from: "billing", to: "checkout" });
    expect(renamedSelection({ kind: "arrow", from: "db", to: "orders", x: 10, y: 20 }, to)).toEqual({ kind: "arrow", from: "db", to: "checkout", x: 10, y: 20 });
  });

  it("follows the boxes in a selection of several through them, but not its notes", () => {
    const to = (id: string) => renamedId(renames, id);
    expect(renamedSelection({ kind: "several", elements: ["orders", "db"], stickies: ["orders"] }, to)).toEqual({ kind: "several", elements: ["checkout", "db"], stickies: ["orders"] });
  });

  it("keeps a selection none of them touch, and anything else selected, as it is", () => {
    const to = (id: string) => renamedId(renames, id);
    const element = { kind: "element" as const, id: "db" };
    expect(renamedSelection(element, to)).toBe(element);
    const arrow = { kind: "arrow" as const, from: "db", to: "web" };
    expect(renamedSelection(arrow, to)).toBe(arrow);
    const several = { kind: "several" as const, elements: ["db", "web"], stickies: [] };
    expect(renamedSelection(several, to)).toBe(several);
    expect(renamedSelection({ kind: "sticky", id: "orders" }, to)).toEqual({ kind: "sticky", id: "orders" });
    expect(renamedSelection(null, to)).toBeNull();
  });

  it("follows an ID through them in order", () => {
    expect(renamedId(renames, "new-system")).toBe("billing");
    expect(renamedId(renames, "orders")).toBe("checkout");
    expect(renamedId(renames, "db")).toBe("db");
    // Without the first rename, new-system stays put, though a later one moves payments.
    expect(renamedId(renames.slice(1), "new-system")).toBe("new-system");
    expect(renamedId(renames.slice(1), "payments")).toBe("billing");
  });

  it("moves the IDs in operations made before them, but not new IDs or sticky notes'", () => {
    const later = renamesIn([
      { op: "rename", id: "api", to: "checkout-api" },
      { op: "rename", id: "orders", to: "order-flow" },
    ]);
    expect(
      followRenames(
        [
          { op: "update-element", id: "api", external: true },
          { op: "add-element", id: "api-2", kind: "container", parent: "api" },
          { op: "rename", id: "api", to: "payments-api" },
          { op: "remove-relationship", from: "web", to: "api" },
          { op: "update-relationship", from: "web", to: "db", index: 1, newFrom: "api", newTo: "orders" },
          { op: "add-view", id: "api", level: "container", scope: "api", include: ["*", "api"] },
          { op: "update-view", id: "orders", exclude: ["api"] },
          { op: "hide-in-view", view: "orders", id: "api" },
          { op: "set-layout", view: "orders", positions: { api: [1, 2], web: null } },
          { op: "update-sticky", view: "orders", id: "api", text: "Read me" },
          { op: "update-workspace", name: "Shop" },
        ],
        later,
      ),
    ).toEqual([
      { op: "update-element", id: "checkout-api", external: true },
      { op: "add-element", id: "api-2", kind: "container", parent: "checkout-api" },
      { op: "rename", id: "checkout-api", to: "payments-api" },
      { op: "remove-relationship", from: "web", to: "checkout-api" },
      { op: "update-relationship", from: "web", to: "db", index: 1, newFrom: "checkout-api", newTo: "order-flow" },
      { op: "add-view", id: "api", level: "container", scope: "checkout-api", include: ["*", "checkout-api"] },
      { op: "update-view", id: "order-flow", exclude: ["checkout-api"] },
      { op: "hide-in-view", view: "order-flow", id: "checkout-api" },
      { op: "set-layout", view: "order-flow", positions: { "checkout-api": [1, 2], web: null } },
      { op: "update-sticky", view: "order-flow", id: "api", text: "Read me" },
      { op: "update-workspace", name: "Shop" },
    ]);
  });

  it("drops a rename they have already made", () => {
    // The name was saved twice, with Enter and then on leaving the box, before the first save landed.
    const saved = [
      { op: "update-element", id: "new-system", name: "Payments" },
      { op: "rename", id: "new-system", to: "payments" },
    ] as const;
    expect(followRenames([...saved], renamesIn([...saved]))).toEqual([{ op: "update-element", id: "payments", name: "Payments" }]);
  });

  it("takes them back, last first", () => {
    expect(undoRenames(renames).map((r) => `${r.id}>${r.to}`)).toEqual(["checkout>orders", "billing>payments", "payments>new-system"]);
    expect(renamedId(undoRenames(renames), renamedId(renames, "new-system"))).toBe("new-system");
  });

  it("adds no fields an operation didn't have", () => {
    const later = renamesIn([{ op: "rename", id: "api", to: "checkout-api" }]);
    expect(followRenames([{ op: "update-element", id: "api", name: "Checkout API" }], later)).toEqual([{ op: "update-element", id: "checkout-api", name: "Checkout API" }]);
    expect(Object.keys(followRenames([{ op: "update-view", id: "v", title: "V" }], later)[0]!)).toEqual(["op", "id", "title"]);
    expect(Object.keys(followRenames([{ op: "update-relationship", from: "api", to: "db", description: "Reads" }], later)[0]!)).toEqual(["op", "from", "to", "description"]);
  });
});

describe("renamesBetween", () => {
  const shop: OpenArchDocument = {
    openarch: 3,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things" }] },
      shop: { kind: "system", name: "Shop", description: "Sells things" },
      web: { kind: "container", name: "Web App", parent: "shop", technology: "React", uses: [{ to: "api" }] },
      api: { kind: "container", name: "API", parent: "shop", technology: "Go" },
      "api-2": { kind: "container", name: "API", parent: "shop", technology: "Go" },
      "api-3": { kind: "container", name: "API", parent: "shop", technology: "Go" },
    },
    views: {
      landscape: { title: "Landscape", level: "landscape", layout: { customer: [0, 0], shop: [0, 200] } },
      "shop-containers": { title: "Shop containers", level: "container", scope: "shop", layout: { web: [0, 0], api: [300, 0] } },
    },
  };
  const before = buildWorkspace(shop);
  /** The renames worked out from the file before and after these operations. */
  const between = (ops: Operation[]) => renamesBetween(before, buildWorkspace(applyOperations(shop, ops).doc)).map((r) => `${r.id}>${r.to}`);

  it("finds an element's rename, with its new name, and a view's, with its new title", () => {
    expect(between([{ op: "update-element", id: "web", name: "Storefront" }, { op: "rename", id: "web", to: "storefront" }])).toEqual(["web>storefront"]);
    expect(between([{ op: "update-view", id: "shop-containers", title: "Shop surroundings" }, { op: "rename", id: "shop-containers", to: "shop-surroundings" }])).toEqual([
      "shop-containers>shop-surroundings",
    ]);
  });

  it("finds an element's rename once that of the element it's in, or uses, is known", () => {
    expect(
      between([
        { op: "rename", id: "shop", to: "store" },
        { op: "rename", id: "web", to: "storefront" },
        { op: "rename", id: "customer", to: "shopper" },
        { op: "rename", id: "shop-containers", to: "store-containers" },
      ]),
    ).toEqual(["shop>store", "customer>shopper", "web>storefront", "shop-containers>store-containers"]);
  });

  it("finds nothing where nothing was renamed", () => {
    expect(between([{ op: "update-element", id: "web", name: "Storefront" }])).toEqual([]);
    expect(between([{ op: "remove-element", id: "web" }])).toEqual([]);
  });

  it("leaves out an element deleted as another is added, unless they're the same but for the name", () => {
    expect(between([{ op: "remove-element", id: "web" }, { op: "add-element", id: "mobile", kind: "container", parent: "shop", name: "Mobile App", technology: "Swift" }])).toEqual([]);
    // Moved as well: its box isn't where the old one was.
    expect(between([{ op: "rename", id: "api", to: "orders" }, { op: "set-layout", view: "shop-containers", positions: { orders: [300, 300] } }])).toEqual([]);
  });

  it("leaves out a rename it can't tell apart from another", () => {
    // api-2 and api-3 are the same apart from their IDs, so either could be the one renamed.
    expect(between([{ op: "remove-element", id: "api-3" }, { op: "rename", id: "api-2", to: "orders" }])).toEqual([]);
    // api is placed in a view, and api-2 isn't, like the new one.
    expect(between([{ op: "remove-element", id: "api" }, { op: "rename", id: "api-2", to: "orders" }])).toEqual(["api-2>orders"]);
  });
});
