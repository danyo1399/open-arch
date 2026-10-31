import { applyOperations, buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { followRenames, followsName, idFromName, renamedId, renamesBetween, renamesIn, shownInProperties, undoRenames, uniqueId, viewAction } from "../src/model.js";

const ws = buildWorkspace({
  openarch: 2,
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

describe("viewAction", () => {
  const shop = buildWorkspace({
    openarch: 2,
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

describe("shownInProperties", () => {
  const noted = buildWorkspace({
    openarch: 2,
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

  it("shows the workspace when it's selected, or no view is open", () => {
    expect(shownInProperties(noted, view, { kind: "workspace" })).toEqual({ kind: "workspace" });
    expect(shownInProperties(noted, null, { kind: "element", id: "gone" })).toEqual({ kind: "workspace" });
    expect(shownInProperties(noted, null, null)).toEqual({ kind: "workspace" });
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
  });
});

describe("renamesBetween", () => {
  const shop: OpenArchDocument = {
    openarch: 2,
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
