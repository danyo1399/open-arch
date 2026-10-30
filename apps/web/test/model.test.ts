import { buildWorkspace, computeView } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { followsName, idFromName, uniqueId, viewAction } from "../src/model.js";

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

  it("only shows, in a view that can't be drawn", () => {
    const view = shop.views.get("containers")!;
    expect(viewAction(shop, view, null, "web")).toBe("show");
    expect(viewAction(shop, view, null, "customer")).toBe("show");
    expect(viewAction(shop, view, null, "shop")).toBeNull();
  });
});
