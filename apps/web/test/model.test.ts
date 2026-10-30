import { buildWorkspace, computeView } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { followsName, idFromName, renamedId, renamesIn, shownInProperties, uniqueId, viewAction } from "../src/model.js";

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
    // A later rename doesn't reach back to an ID that only an earlier one made.
    expect(renamedId(renames.slice(2), "new-system")).toBe("new-system");
  });
});
