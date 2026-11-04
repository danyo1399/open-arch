import { applyOperations, buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { dropNumber, lifelineAt, SEQ, sequenceLayout, stepChoices, stepTargets } from "../src/canvas/sequenceLayout.js";
import { followRenames, renamesBetween, shownInProperties, viewAction } from "../src/model.js";

/** A shop whose web app calls an API, which has a controller inside it that uses a database. */
function shop(): OpenArchDocument {
  return {
    openarch: 6,
    name: "Shop",
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "web-app", description: "Buys things" }] },
      shop: { kind: "system", name: "Shop" },
      "web-app": { kind: "container", name: "Web App", parent: "shop", uses: [{ to: "controller", description: "Places orders" }] },
      api: { kind: "container", name: "API", parent: "shop" },
      controller: { kind: "component", name: "Controller", parent: "api", uses: [{ to: "db", description: "Saves orders" }] },
      db: { kind: "container", name: "DB", parent: "shop" },
    },
    views: {
      order: {
        title: "Order",
        level: "sequence",
        steps: [
          { from: "customer", to: "web-app" },
          { from: "web-app", to: "api" },
          { from: "api", to: "db" },
          { from: "api", to: "web-app", reply: true },
        ],
      },
      containers: { title: "Containers", level: "container", scope: "shop" },
    },
  };
}

const ws = buildWorkspace(shop());
const order = computeView(ws, ws.views.get("order")!);

describe("sequenceLayout", () => {
  const layout = sequenceLayout(order);

  it("puts a lifeline per element across, in the order they first appear, and a row per step down", () => {
    expect([...layout.x.entries()]).toEqual([
      ["customer", SEQ.pad + SEQ.column / 2],
      ["web-app", SEQ.pad + SEQ.column * 1.5],
      ["api", SEQ.pad + SEQ.column * 2.5],
      ["db", SEQ.pad + SEQ.column * 3.5],
    ]);
    const rows = [...layout.y.values()];
    expect(rows.map((y) => y - rows[0]!)).toEqual([0, SEQ.row, SEQ.row * 2, SEQ.row * 3]);
    expect(rows[0]).toBeGreaterThan(SEQ.pad + SEQ.headHeight);
    expect(layout.bottom).toBeGreaterThan(rows[3]!);
    expect(layout.width).toBe(SEQ.pad * 2 + SEQ.column * 4);
  });

  it("finds the lifeline under a point, within its column", () => {
    expect(lifelineAt(layout, layout.x.get("api")! + 30)).toBe("api");
    expect(lifelineAt(layout, layout.x.get("api")! - SEQ.column / 2 + 1)).toBe("api");
    expect(lifelineAt(layout, 0)).toBeUndefined();
    expect(lifelineAt(layout, layout.width + 50)).toBeUndefined();
  });

  it("numbers a dropped step by the first arrow below it", () => {
    expect(dropNumber(layout, 0)).toBe(1);
    expect(dropNumber(layout, layout.y.get(2)! - 1)).toBe(2);
    expect(dropNumber(layout, layout.y.get(2)! + 1)).toBe(3);
    expect(dropNumber(layout, layout.bottom)).toBe(5);
  });

  it("keeps room for a first step in an empty view", () => {
    const empty = buildWorkspace({ ...shop(), views: { s: { title: "S", level: "sequence", steps: [] } } });
    const cv = computeView(empty, empty.views.get("s")!);
    const room = sequenceLayout(cv);
    expect(room.bottom).toBeGreaterThan(SEQ.pad + SEQ.headHeight);
    expect(dropNumber(room, 100)).toBe(1);
  });
});

describe("adding steps", () => {
  it("offers the elements the model connects an element to, through what's inside them, or back from for a reply", () => {
    expect(stepTargets(ws, "web-app", false).map((e) => e.id)).toEqual(["api", "controller"]);
    expect(stepTargets(ws, "api", false).map((e) => e.id)).toEqual(["db"]);
    expect(stepTargets(ws, "api", true).map((e) => e.id)).toEqual(["web-app"]);
    expect(stepTargets(ws, "customer", true)).toEqual([]);
  });

  it("adds a call the model has straight away", () => {
    expect(stepChoices(ws, "order", "web-app", "api", 2)).toEqual([{ label: "Call API", ops: [{ op: "add-step", view: "order", from: "web-app", to: "api", step: 2 }], changesModel: false }]);
  });

  it("offers a reply, or a call that adds a relationship, when the model only has one the other way", () => {
    expect(stepChoices(ws, "order", "db", "api").map((c) => [c.label, c.ops.map((op) => op.op)])).toEqual([
      ["Reply to API", ["add-step"]],
      ["Call API, adding a relationship from DB to API", ["add-relationship", "add-step"]],
      ["Call API, adding a relationship both ways", ["add-relationship", "add-step"]],
    ]);
    // The customer uses the web app directly, so that relationship can go both ways instead.
    const choices = stepChoices(ws, "order", "web-app", "customer");
    expect(choices.map((c) => c.label)).toEqual(["Reply to Customer", "Call Customer, making Customer → Web App go both ways", "Call Customer, adding a relationship from Web App to Customer"]);
    const doc = applyOperations(shop(), choices[1]!.ops).doc;
    expect(doc.elements.customer!.uses).toEqual([{ to: "web-app", bidirectional: true, description: "Buys things" }]);
    expect(doc.views.order!.steps![4]).toEqual({ from: "web-app", to: "customer" });
  });

  it("offers a relationship one way or both ways when the model has none, and nothing between nested elements", () => {
    const choices = stepChoices(ws, "order", "customer", "db");
    expect(choices.map((c) => c.ops[0])).toEqual([
      { op: "add-relationship", from: "customer", to: "db" },
      { op: "add-relationship", from: "customer", to: "db", bidirectional: true },
    ]);
    expect(applyOperations(shop(), choices[1]!.ops).doc.views.order!.steps).toHaveLength(5);
    expect(stepChoices(ws, "order", "api", "api")).toEqual([]);
    expect(stepChoices(ws, "order", "web-app", "shop")).toEqual([]);
    expect(stepChoices(ws, "order", "controller", "api")).toEqual([]);
  });
});

describe("the designer's model with sequence views", () => {
  it("shows a step in the details while it's there", () => {
    const view = ws.views.get("order")!;
    expect(shownInProperties(ws, view, { kind: "step", number: 2 })).toMatchObject({ kind: "step", step: { number: 2, from: "web-app", to: "api" } });
    expect(shownInProperties(ws, view, { kind: "step", number: 9 })).toEqual({ kind: "view", view });
  });

  it("neither shows nor hides elements in a sequence view, whose steps decide what's in it", () => {
    const view = ws.views.get("order")!;
    expect(viewAction(ws, view, order, "api")).toBeNull();
    expect(viewAction(ws, view, order, "shop")).toBeNull();
  });

  it("follows renames in step operations made before them", () => {
    const renames: Extract<Operation, { op: "rename" }>[] = [
      { op: "rename", id: "api", to: "orders-api" },
      { op: "rename", id: "order", to: "place-order" },
    ];
    expect(
      followRenames(
        [
          { op: "add-step", view: "order", from: "web-app", to: "api" },
          { op: "update-step", view: "order", step: 1, to: "api" },
          { op: "update-step", view: "order", step: 1, description: "x" },
          { op: "remove-step", view: "order", step: 1 },
        ],
        renames,
      ),
    ).toEqual([
      { op: "add-step", view: "place-order", from: "web-app", to: "orders-api" },
      { op: "update-step", view: "place-order", step: 1, to: "orders-api" },
      { op: "update-step", view: "place-order", step: 1, description: "x" },
      { op: "remove-step", view: "place-order", step: 1 },
    ]);
  });

  it("finds a sequence view's rename, with its steps' elements renamed", () => {
    const after = applyOperations(shop(), [
      { op: "rename", id: "api", to: "orders-api" },
      { op: "rename", id: "order", to: "place-order" },
    ]).doc;
    expect(renamesBetween(ws, buildWorkspace(after)).map((r) => `${r.id}>${r.to}`)).toEqual(["api>orders-api", "order>place-order"]);
  });
});
