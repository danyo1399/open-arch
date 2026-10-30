import { buildWorkspace } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { findUsages } from "../src/model.js";

const ws = buildWorkspace({
  openarch: 1,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web app", parent: "shop", uses: [{ to: "db", description: "Reads" }] },
    db: { kind: "container", name: "Orders DB", parent: "shop" },
  },
  views: {
    landscape: { title: "Landscape", level: "landscape" },
    "shop-containers": { title: "Shop containers", level: "container", scope: "shop" },
  },
});

const summary = (id: string, preferView?: string) => {
  const u = findUsages(ws, id, preferView)!;
  return {
    relationships: u.relationships.map((r) => `${r.from.id} -> ${r.rel.to}${r.arrow ? ` drawn in ${r.arrow.view} as ${r.arrow.from} -> ${r.arrow.to}` : ""}`),
    views: u.views.map((v) => `${v.view.id} (${v.as})`),
  };
};

describe("findUsages", () => {
  it("lists relationships to the element and the views that draw it", () => {
    expect(summary("db")).toEqual({
      relationships: ["web -> db drawn in shop-containers as web -> db"],
      views: ["shop-containers (box)"],
    });
  });

  it("includes relationships to what's inside it, and views that draw it as the frame", () => {
    expect(summary("shop")).toEqual({
      relationships: ["customer -> web drawn in landscape as customer -> shop"],
      views: ["landscape (box)", "shop-containers (frame)"],
    });
  });

  it("finds the arrow in the preferred view when that view draws it", () => {
    expect(summary("shop", "shop-containers").relationships).toEqual(["customer -> web drawn in shop-containers as customer -> web"]);
  });

  it("is undefined for an element that doesn't exist", () => {
    expect(findUsages(ws, "nope")).toBeUndefined();
  });
});
