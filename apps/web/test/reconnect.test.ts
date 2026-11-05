import { applyOperations, buildWorkspace, computeView, type ArchElement, type OpenArchDocument, type Sticky } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { boxAt, reconnectOps, withFrame } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, StickyFlowNode } from "../src/canvas/nodes.js";

describe("boxAt", () => {
  const box = (id: string, x: number, y = 0): ElementFlowNode => ({
    id,
    type: "element",
    position: { x, y },
    measured: { width: 220, height: 100 },
    data: { element: { id, kind: "container", name: id, parent: "shop" } as ArchElement, problems: 0 },
  });
  const note: StickyFlowNode = { id: "sticky:a", type: "sticky", position: { x: 0, y: 0 }, data: { sticky: { id: "a" } as Sticky, editing: false, onEdit() {}, onDone() {} } };

  it("finds the box under a point, edges included", () => {
    const nodes = [box("web", 0), box("api", 300)];
    expect(boxAt(nodes, { x: 10, y: 10 })?.id).toBe("web");
    expect(boxAt(nodes, { x: 300, y: 100 })?.id).toBe("api");
    expect(boxAt(nodes, { x: 260, y: 50 })).toBeUndefined();
    expect(boxAt(nodes, { x: 10, y: 101 })).toBeUndefined();
  });

  it("finds the box drawn on top, and not the frame round the boxes or a sticky note", () => {
    const system = { id: "shop", kind: "system", name: "Shop" } as ArchElement;
    const nodes = [...withFrame([box("web", 0), box("api", 100)], system), note];
    expect(boxAt(nodes, { x: 150, y: 50 })?.id).toBe("api");
    expect(boxAt(nodes, { x: -20, y: -20 })).toBeUndefined();
    // Under the note there's still the box.
    expect(boxAt(nodes, { x: 5, y: 5 })?.id).toBe("web");
  });
});

describe("reconnectOps", () => {
  // The controller inside the API calls the DB twice, so the shop's container view draws one arrow, API → DB, for both.
  const doc: OpenArchDocument = {
    openarch: 9,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things" }] },
      shop: { kind: "system", name: "Shop" },
      web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "warehouse", description: "Checks stock" }] },
      api: { kind: "container", name: "API", parent: "shop" },
      db: { kind: "container", name: "DB", parent: "shop" },
      controller: {
        kind: "component",
        name: "Controller",
        parent: "api",
        uses: [
          { to: "db", description: "Stores orders", technology: "SQL" },
          { to: "payments", description: "Charges cards" },
          { to: "db", description: "Reads reports", tags: { owner: "reports" } },
        ],
      },
      payments: { kind: "system", name: "Payments", external: true },
      warehouse: { kind: "system", name: "Warehouse" },
    },
    views: {
      landscape: { title: "Landscape", level: "landscape" },
      containers: { title: "Shop containers", level: "container", scope: "shop" },
    },
  };
  const ws = buildWorkspace(doc);
  const arrow = (view: string, from: string, to: string) => computeView(ws, ws.views.get(view)!).edges.find((e) => e.from === from && e.to === to)!;

  it("points an arrow's relationship at the box its end is dropped on", () => {
    const ops = reconnectOps(ws, arrow("landscape", "customer", "shop"), "to", "warehouse");
    expect(ops).toEqual([{ op: "update-relationship", from: "customer", to: "shop", index: 0, newTo: "warehouse" }]);
    expect(applyOperations(doc, ops).doc.elements.customer!.uses).toEqual([{ to: "warehouse", description: "Buys things" }]);
  });

  it("moves every relationship an arrow stands for, keeping the elements at the other end and what each says", () => {
    const ops = reconnectOps(ws, arrow("containers", "api", "db"), "to", "warehouse");
    expect(ops).toEqual([
      { op: "update-relationship", from: "controller", to: "db", index: 0, newTo: "warehouse" },
      { op: "update-relationship", from: "controller", to: "db", index: 0, newTo: "warehouse" },
    ]);
    const after = buildWorkspace(applyOperations(doc, ops).doc);
    expect(after.doc.elements.controller!.uses).toEqual([
      { to: "warehouse", description: "Stores orders", technology: "SQL" },
      { to: "payments", description: "Charges cards" },
      { to: "warehouse", description: "Reads reports", tags: { owner: "reports" } },
    ]);
    const edges = computeView(after, after.views.get("containers")!).edges.map((e) => `${e.from}>${e.to}`);
    expect(edges).toContain("api>warehouse");
    expect(edges).not.toContain("api>db");
  });

  it("starts them at the box the arrow's start is dropped on, in the order they were in", () => {
    const ops = reconnectOps(ws, arrow("containers", "api", "db"), "from", "web");
    expect(ops).toEqual([
      { op: "update-relationship", from: "controller", to: "db", index: 0, newFrom: "web" },
      { op: "update-relationship", from: "controller", to: "db", index: 0, newFrom: "web" },
    ]);
    const after = applyOperations(doc, ops).doc;
    expect(after.elements.controller!.uses).toEqual([{ to: "payments", description: "Charges cards" }]);
    expect(after.elements.web!.uses!.map((r) => `${r.to}: ${r.description}`)).toEqual(["warehouse: Checks stock", "db: Stores orders", "db: Reads reports"]);
  });

  it("is refused, changing nothing, when the box already has one of them", () => {
    const has = structuredClone(doc);
    has.elements.web!.uses!.push({ to: "db", description: "Reads reports" });
    expect(() => applyOperations(has, reconnectOps(buildWorkspace(has), arrow("containers", "api", "db"), "from", "web"))).toThrow('"web" already has this relationship to "db".');
  });
});

describe("reconnectOps for an arrow that goes both ways", () => {
  // The web app and the API call each other: one relationship goes both ways, and one goes back.
  const doc: OpenArchDocument = {
    openarch: 9,
    name: "Shop",
    elements: {
      shop: { kind: "system", name: "Shop" },
      web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", bidirectional: true, description: "Syncs carts with" }] },
      api: { kind: "container", name: "API", parent: "shop", uses: [{ to: "web", description: "Pushes prices to" }] },
      admin: { kind: "container", name: "Admin", parent: "shop" },
    },
    views: { containers: { title: "Containers", level: "container", scope: "shop" } },
  };
  const ws = buildWorkspace(doc);
  const edge = computeView(ws, ws.views.get("containers")!).edges.find((e) => e.bidirectional)!;

  it("moves each relationship's own end at that end of the arrow", () => {
    expect(edge).toMatchObject({ from: "web", to: "api" });
    expect(reconnectOps(ws, edge, "from", "admin")).toEqual([
      { op: "update-relationship", from: "web", to: "api", index: 0, newFrom: "admin" },
      { op: "update-relationship", from: "api", to: "web", index: 0, newTo: "admin" },
    ]);
    const moved = applyOperations(doc, reconnectOps(ws, edge, "to", "admin")).doc;
    expect(moved.elements.web!.uses).toEqual([{ to: "admin", bidirectional: true, description: "Syncs carts with" }]);
    expect(moved.elements.admin!.uses).toEqual([{ to: "web", description: "Pushes prices to" }]);
  });
});
