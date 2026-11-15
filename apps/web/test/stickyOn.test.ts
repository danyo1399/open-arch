import { applyOperations, buildWorkspace, computeView, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { NODE_W, placeStickies, STICKY } from "../src/canvas/autoLayout.js";
import { besideTargets } from "../src/canvas/Canvas.js";
import { edgePoint, midpoint, nearestOnOutline, stickyLine } from "../src/canvas/stickyLines.js";
import { followRenames, renamesBetween, stickyChoices, stickyTargetFor } from "../src/model.js";

const doc: OpenArchDocument = {
  openarch: 12,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "routes", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
    routes: { kind: "component", name: "Routes", parent: "api", uses: [{ to: "order", description: "Makes orders" }] },
    order: { kind: "class", name: "Order", parent: "routes", uses: [{ to: "entity", kind: "inheritance" }] },
    entity: { kind: "class", name: "Entity", parent: "routes" },
  },
  views: {
    containers: { title: "Containers", level: "container", scope: "shop" },
    classes: { title: "Classes", level: "class", scope: "routes" },
    order: { title: "Order", level: "sequence", steps: [{ from: "customer", to: "web" }] },
  },
};

const computed = (model: OpenArchDocument, id: string) => {
  const ws = buildWorkspace(model);
  return { ws, cv: computeView(ws, ws.views.get(id)!) };
};

describe("stickyTargetFor", () => {
  const { ws, cv } = computed(doc, "containers");

  it("puts a note on a box's element, the frame's, or an arrow's first relationship", () => {
    expect(stickyTargetFor(ws, cv, { kind: "element", id: "web" })).toEqual({ element: "web" });
    expect(stickyTargetFor(ws, cv, { kind: "element", id: "shop" })).toEqual({ element: "shop" });
    // The arrow from Web to API stands for Web's relationship to the routes inside it.
    expect(stickyTargetFor(ws, cv, { kind: "arrow", from: "web", to: "api" })).toEqual({ from: "web", to: "routes" });
  });

  it("gives a relationship's kind on a class view, when it isn't an association", () => {
    const classes = computed(doc, "classes");
    expect(stickyTargetFor(classes.ws, classes.cv, { kind: "arrow", from: "order", to: "entity", relation: "inheritance" })).toEqual({ from: "order", to: "entity", kind: "inheritance" });
  });

  it("offers nothing the view doesn't draw as itself, or on a view that isn't of boxes", () => {
    expect(stickyTargetFor(ws, cv, { kind: "element", id: "routes" })).toBeUndefined();
    expect(stickyTargetFor(ws, cv, { kind: "arrow", from: "web", to: "customer" })).toBeUndefined();
    expect(stickyTargetFor(ws, null, { kind: "element", id: "web" })).toBeUndefined();
    const order = computed(doc, "order");
    expect(stickyTargetFor(order.ws, order.cv, { kind: "element", id: "web" })).toBeUndefined();
  });
});

describe("stickyChoices", () => {
  const withNote = (on: NonNullable<NonNullable<OpenArchDocument["views"][string]["stickies"]>[string]["on"]>) => {
    const model = structuredClone(doc);
    model.views.containers!.stickies = { n: { text: "N", on } };
    const { ws, cv } = computed(model, "containers");
    return stickyChoices(ws, cv, cv.view.stickies[0]!).map((c) => `${c.group ?? "-"} ${c.label} = ${c.key.replaceAll("\u0000", "|")}`);
  };

  it("lists the boxes, the frame and the arrows", () => {
    expect(withNote({ element: "web" })).toEqual([
      "Boxes API = element:api",
      "Boxes Customer = element:customer",
      "Boxes Shop (the frame) = element:shop",
      "Boxes Web = element:web",
      "Arrows Customer → Web: Buys things = relationship:customer|web|association",
      "Arrows Web → API: Calls = relationship:web|routes|association",
    ]);
  });

  it("lists what the note is on when the view draws it as something else, or not at all", () => {
    expect(withNote({ element: "routes" })[0]).toBe("- Routes (drawn as API) = element:routes");
    expect(withNote({ from: "order", to: "entity", kind: "inheritance" })[0]).toBe("- Order → Entity (not in this view) = relationship:order|entity|inheritance");
  });
});

describe("renames and sticky notes", () => {
  const renames = [{ op: "rename" as const, id: "web", to: "website" }];

  it("follow a rename in what an edit puts a note on", () => {
    expect(followRenames([{ op: "add-sticky", view: "containers", id: "n", text: "N", on: { element: "web" } }], renames)).toEqual([
      { op: "add-sticky", view: "containers", id: "n", text: "N", on: { element: "website" } },
    ]);
    expect(followRenames([{ op: "update-sticky", view: "containers", id: "n", on: { from: "customer", to: "web" } }], renames)).toEqual([
      { op: "update-sticky", view: "containers", id: "n", on: { from: "customer", to: "website" } },
    ]);
    expect(followRenames([{ op: "update-sticky", view: "containers", id: "n", on: null }], renames)).toEqual([{ op: "update-sticky", view: "containers", id: "n", on: null }]);
  });

  it("are worked out from a file with an element renamed that a note is on", () => {
    const before = structuredClone(doc);
    before.views.containers!.stickies = { n: { text: "N", on: { element: "web" } }, m: { text: "M", on: { from: "customer", to: "web" } } };
    const after = applyOperations(before, renames).doc;
    expect(renamesBetween(buildWorkspace(before), buildWorkspace(after))).toEqual(renames);
  });
});

describe("placing notes on things", () => {
  it("puts a note that hasn't been moved beside what it's on, clear of the boxes", () => {
    const at = placeStickies(
      [
        { id: "beside", text: "On a box" },
        { id: "column", text: "On nothing" },
      ],
      [{ x: 0, y: 0 }],
      STICKY,
      { beside: { x: NODE_W + 60, y: 0 } },
    );
    expect(at.beside).toEqual({ x: NODE_W + 60, y: 0 });
    // The column of other notes starts right of it.
    expect(at.column).toEqual({ x: NODE_W + 60 + STICKY.width + 80, y: 0 });
  });

  it("keeps a moved note where it was put", () => {
    expect(placeStickies([{ id: "a", text: "A", at: [5, 6] }], [], STICKY, { a: { x: 100, y: 100 } }).a).toEqual({ x: 5, y: 6 });
  });

  it("works out where beside a box, the frame and an arrow is", () => {
    const model = structuredClone(doc);
    model.views.containers!.stickies = {
      box: { text: "Box", on: { element: "customer" } },
      frame: { text: "Frame", on: { element: "shop" } },
      arrow: { text: "Arrow", on: { from: "web", to: "routes" } },
      moved: { text: "Moved", on: { element: "web" }, at: [0, 0] },
      // Both classes are inside the API's box, so no arrow draws it.
      off: { text: "Off", on: { from: "order", to: "entity", kind: "inheritance" } },
    };
    const { ws, cv } = computed(model, "containers");
    const positions = { customer: { x: 0, y: 0 }, web: { x: 0, y: 300 }, api: { x: 400, y: 300 } };
    expect(besideTargets(ws, cv, positions)).toEqual({
      box: { x: NODE_W + 60, y: 0 },
      // Right of the frame round Web and API, level with its top.
      frame: { x: 400 + NODE_W + 40 + 60, y: 300 - 56 },
      arrow: { x: 200 + NODE_W / 2 + 30, y: 300 + 60 + 30 },
    });
  });
});

describe("the line from a note", () => {
  const note = { x: 0, y: 0, w: 100, h: 50 };

  it("runs between the edges of the note and the box or label", () => {
    expect(stickyLine(note, { rect: { x: 300, y: 0, w: 100, h: 50 } })).toEqual({ from: { x: 100, y: 25 }, to: { x: 300, y: 25 } });
    expect(stickyLine(note, { rect: { x: 50, y: 20, w: 100, h: 50 } })).toBeNull();
  });

  it("runs to the nearest point of the frame's outline, from inside it or out", () => {
    expect(stickyLine(note, { outline: { x: 200, y: -100, w: 400, h: 300 } })).toEqual({ from: { x: 100, y: 25 }, to: { x: 200, y: 25 } });
    expect(nearestOnOutline({ x: 0, y: 0, w: 400, h: 300 }, { x: 50, y: 150 })).toEqual({ x: 0, y: 150 });
    expect(stickyLine({ x: -10, y: 100, w: 100, h: 50 }, { outline: { x: 0, y: 0, w: 400, h: 300 } })).toBeNull();
  });

  it("runs to the middle of an arrow without a label", () => {
    const mid = midpoint([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    expect(mid).toEqual({ x: 100, y: 0 });
    expect(midpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    expect(stickyLine(note, { point: { x: 50, y: 200 } })).toEqual({ from: { x: 50, y: 50 }, to: { x: 50, y: 200 } });
    expect(edgePoint(note, { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });
});
