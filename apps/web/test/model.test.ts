import { buildWorkspace } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { followsName, idFromName, uniqueId } from "../src/model.js";

const ws = buildWorkspace({
  openarch: 1,
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
