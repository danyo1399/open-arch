import { applyOperations, buildWorkspace, computeView, type ArchElement, type OpenArchDocument, type Sticky } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { NODE_H, NODE_W, placeStickies, STICKY } from "../src/canvas/autoLayout.js";
import { besideTargets, noteDropAt, noteDropOps, withFrame, type DrawnArrow } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, StickyFlowNode } from "../src/canvas/nodes.js";
import { distanceToRoute, edgePoint, midpoint, nearestOnOutline, stickyLine } from "../src/canvas/stickyLines.js";
import { blockNow, followBlocks, followRenames, renamesBetween, stickyChoices, stickyTargetFor } from "../src/model.js";

const doc: OpenArchDocument = {
  openarch: 20,
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

  it("offers no note on an arrow whose relationships another arrow draws first, as a library's", () => {
    // Logging's writer is drawn in each container built with it, so its relationship to the log
    // service is an arrow from each. A note on that relationship has its line to the first.
    const model: OpenArchDocument = {
      openarch: 20,
      name: "Logs",
      elements: {
        shop: { kind: "system", name: "Shop" },
        api: { kind: "container", name: "API", parent: "shop", libraries: ["logging"] },
        web: { kind: "container", name: "Web", parent: "shop", libraries: ["logging"], uses: [{ to: "logs", description: "Pings" }] },
        logging: { kind: "library", name: "Logging" },
        writer: { kind: "component", name: "Writer", parent: "logging", uses: [{ to: "logs", description: "Sends logs" }] },
        logs: { kind: "system", name: "Logs" },
      },
      views: { containers: { title: "Containers", level: "container", scope: "shop", stickies: { n: { text: "N" } } } },
    };
    const { ws, cv } = computed(model, "containers");
    expect(cv.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["api->logs", "web->logs"]);
    expect(stickyTargetFor(ws, cv, { kind: "arrow", from: "api", to: "logs" })).toEqual({ from: "writer", to: "logs" });
    // Web's arrow draws the writer's relationship second, so a note goes on Web's own one.
    expect(stickyTargetFor(ws, cv, { kind: "arrow", from: "web", to: "logs" })).toEqual({ from: "web", to: "logs" });
    delete model.elements.web!.uses;
    const without = computed(model, "containers");
    expect(stickyTargetFor(without.ws, without.cv, { kind: "arrow", from: "web", to: "logs" })).toBeUndefined();
    const keys = stickyChoices(without.ws, without.cv, without.cv.view.stickies[0]!).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
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

describe("stickyChoices on a flowchart", () => {
  const flow = (on?: { block: string }): OpenArchDocument => ({
    ...doc,
    views: {
      returns: {
        title: "Returns",
        level: "flowchart",
        blocks: [
          { id: "asked", kind: "start", text: "Return asked for" },
          { id: "in-time", kind: "decision", text: "\nWithin 30 days?\nOf delivery" },
          { id: "refund", text: "Refund the card" },
        ],
        flows: [{ from: "asked", to: "in-time" }],
        stickies: { n: { text: "N", ...(on && { on }) } },
      },
    },
  });
  const choices = (on?: { block: string }) => {
    const { ws, cv } = computed(flow(on), "returns");
    return stickyChoices(ws, cv, cv.view.stickies[0]!).map((c) => `${c.group ?? "-"} ${c.label} = ${c.key}`);
  };

  it("lists the blocks in their order, each by the first line of its text", () => {
    const blocks = ["Blocks Return asked for = block:asked", "Blocks Within 30 days? = block:in-time", "Blocks Refund the card = block:refund"];
    expect(choices()).toEqual(blocks);
    expect(choices({ block: "refund" })).toEqual(blocks);
  });

  it("lists the block the note is on when the view doesn't have it", () => {
    expect(choices({ block: "gone" })[0]).toBe("- gone (not in this view) = block:gone");
    expect(choices({ block: "gone" })).toHaveLength(4);
  });
});

describe("a note put on a block that has a new ID by the time the edit runs", () => {
  type BlockData = NonNullable<OpenArchDocument["views"][string]["blocks"]>[number];
  type FlowData = NonNullable<OpenArchDocument["views"][string]["flows"]>[number];
  /** A flowchart with these blocks, in order, each by its ID or in full, and these flows. */
  const flowchart = (blocks: (string | BlockData)[], flows: FlowData[] = []): OpenArchDocument => ({
    ...doc,
    views: { returns: { title: "Returns", level: "flowchart", blocks: blocks.map((b) => (typeof b === "string" ? { id: b, text: b } : b)), flows, stickies: { n: { text: "N" } } } },
  });
  const blocksOf = (model: OpenArchDocument) => buildWorkspace(model).views.get("returns")!;
  const was = flowchart(["asked", "new-process", "done"]);
  /** The block a person pressed, with all a block can have, and the flows to and from it. */
  const pressed: BlockData = { id: "new-process", kind: "subprocess", text: "New process", description: "By hand", lane: "shop", at: [10, 20] };
  const flows = (id: string): FlowData[] => [
    { from: "asked", to: id },
    { from: id, to: "done", text: "Packed" },
  ];
  const full = flowchart(["asked", pressed, "done"], flows("new-process"));
  /** What became of the pressed block, when `full` is followed by a view with this block in its place and these flows. */
  const became = (block: BlockData, between = flows(block.id)) => blockNow(blocksOf(full), blocksOf(flowchart(["asked", block, "done"], between)), "new-process");

  it("finds the block under its own ID, or the new one it was given with its text", () => {
    expect(blockNow(blocksOf(was), blocksOf(was), "new-process")).toBe("new-process");
    // Its ID followed the text it was given.
    expect(blockNow(blocksOf(was), blocksOf(flowchart(["asked", "pack-it", "done"])), "new-process")).toBe("pack-it");
    // Everything else about it is as it was, and so are its flows, which follow it.
    expect(became({ ...pressed, id: "pack-it", text: "Pack it" })).toBe("pack-it");
    // Others added or moved since leave it under its own ID.
    expect(blockNow(blocksOf(was), blocksOf(flowchart(["new-process", "asked", "done", "more"])), "new-process")).toBe("new-process");
  });

  it("finds none for a block that's gone, or when it can't be told which it became", () => {
    expect(blockNow(blocksOf(was), blocksOf(flowchart(["asked", "done"])), "new-process")).toBeUndefined();
    // One came, but at another place: another block, added as this one went.
    expect(blockNow(blocksOf(was), blocksOf(flowchart(["asked", "done", "pack-it"])), "new-process")).toBeUndefined();
    // Two went and two came.
    expect(blockNow(blocksOf(was), blocksOf(flowchart(["asked", "pack-it", "finished"])), "new-process")).toBeUndefined();
    expect(blockNow(blocksOf(was), blocksOf(was), "never")).toBeUndefined();
  });

  it("finds none when another block took its place: one that differs in more than its ID and text", () => {
    const other = { ...pressed, id: "store-credit", text: "Give store credit" };
    expect(became(other)).toBe("store-credit");
    expect(became({ ...other, kind: "process" })).toBeUndefined();
    expect(became({ ...other, description: "As a voucher" })).toBeUndefined();
    expect(became({ ...other, description: undefined })).toBeUndefined();
    expect(became({ ...other, lane: "customer" })).toBeUndefined();
    expect(became({ ...other, at: [10, 300] })).toBeUndefined();
    // Its flows are others: one fewer, one that says something else, and one the other way.
    expect(became(other, [{ from: "asked", to: "store-credit" }])).toBeUndefined();
    expect(became(other, [{ from: "asked", to: "store-credit" }, { from: "store-credit", to: "done", text: "Sent" }])).toBeUndefined();
    expect(became(other, [{ from: "store-credit", to: "asked" }, { from: "store-credit", to: "done", text: "Packed" }])).toBeUndefined();
    // A flow between other blocks, added since, makes no difference.
    expect(became(other, [{ from: "asked", to: "done" }, ...flows("store-credit")])).toBe("store-credit");
  });

  it("moves the edits that put a note on it to its new ID, and leaves the rest as they are", () => {
    const [before, now] = [buildWorkspace(was), buildWorkspace(flowchart(["asked", "pack-it", "done"]))];
    const same = (id: string) => id;
    const ops = [
      { op: "add-sticky" as const, view: "returns", id: "note", text: "New note", on: { block: "new-process" } },
      { op: "update-sticky" as const, view: "returns", id: "n", on: { block: "new-process" }, at: [1, 2] as [number, number] },
      { op: "update-sticky" as const, view: "returns", id: "n", on: { block: "done" } },
      { op: "update-sticky" as const, view: "returns", id: "n", on: null },
      { op: "update-block" as const, view: "returns", id: "new-process", text: "Pack it" },
    ];
    expect(followBlocks(ops, before, now, same)).toEqual([
      { op: "add-sticky", view: "returns", id: "note", text: "New note", on: { block: "pack-it" } },
      { op: "update-sticky", view: "returns", id: "n", on: { block: "pack-it" }, at: [1, 2] },
      ops[2],
      ops[3],
      ops[4],
    ]);
    // With nothing changed since, they're as they were.
    expect(followBlocks(ops, before, before, same)).toEqual(ops);
    // A block the view never had is left for the edit to refuse, as is a view that's gone.
    const never = [{ op: "update-sticky" as const, view: "returns", id: "n", on: { block: "never" } }];
    expect(followBlocks(never, before, now, same)).toEqual(never);
    expect(followBlocks(ops, before, now, () => "gone")).toEqual(ops);
  });

  it("finds the view under the ID it has by then", () => {
    const renamed = flowchart(["asked", "pack-it", "done"]);
    renamed.views = { "handling-returns": renamed.views.returns! };
    const ops = [{ op: "update-sticky" as const, view: "returns", id: "n", on: { block: "new-process" } }];
    expect(followBlocks(ops, buildWorkspace(was), buildWorkspace(renamed), () => "handling-returns")).toEqual([{ op: "update-sticky", view: "returns", id: "n", on: { block: "pack-it" } }]);
  });

  it("refuses to put a note on a block that's gone by then, or that another took the place of, and says why", () => {
    const ops = [{ op: "add-sticky" as const, view: "returns", id: "note", text: "New note", on: { block: "new-process" } }];
    const why = "The block was changed or deleted, so no note was put on it.";
    expect(() => followBlocks(ops, buildWorkspace(was), buildWorkspace(flowchart(["asked", "done"])), (id) => id)).toThrow(why);
    expect(() => followBlocks(ops, buildWorkspace(was), buildWorkspace(flowchart(["asked", { id: "refund", kind: "end", text: "Refund" }, "done"])), (id) => id)).toThrow(why);
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
    // A flowchart's block is its view's own, even one with the ID of an element that's renamed.
    expect(followRenames([{ op: "update-sticky", view: "returns", id: "n", on: { block: "web" } }], renames)).toEqual([{ op: "update-sticky", view: "returns", id: "n", on: { block: "web" } }]);
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

describe("how far a point is from an arrow", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("measures to the nearest point along any of its runs, ends included", () => {
    expect(distanceToRoute(route, { x: 50, y: 5 })).toBe(5);
    expect(distanceToRoute(route, { x: 90, y: 60 })).toBe(10);
    expect(distanceToRoute(route, { x: -3, y: -4 })).toBe(5);
    expect(distanceToRoute(route, { x: 100, y: 110 })).toBe(10);
  });

  it("measures to the one point of a route with no runs, and finds none with no points", () => {
    expect(distanceToRoute([{ x: 3, y: 4 }], { x: 0, y: 0 })).toBe(5);
    expect(distanceToRoute([], { x: 0, y: 0 })).toBe(Infinity);
  });
});

describe("what a note's dot is let go on", () => {
  // Customer above Web, and API right of Web, with the shop's frame round Web and API.
  const { ws, cv } = computed(doc, "containers");
  const box = (id: string, x: number, y: number): ElementFlowNode => ({
    id,
    type: "element",
    position: { x, y },
    measured: { width: NODE_W, height: NODE_H },
    data: { element: ws.elements.get(id) as ArchElement, problems: 0 },
  });
  const note = (id: string, x: number, y: number): StickyFlowNode => ({
    id: `sticky:${id}`,
    type: "sticky",
    position: { x, y },
    measured: { width: 200, height: 80 },
    data: { sticky: { id, text: id } as Sticky, editing: false, onEdit() {}, onDone() {} },
  });
  const nodes = [...withFrame([box("customer", 0, 0), box("web", 0, 300), box("api", 400, 300)], ws.elements.get("shop")), note("loose", 700, 0), note("over", 10, 10)];
  const edge = (from: string, to: string) => cv.edges.find((e) => e.from === from && e.to === to)!;
  const arrows: DrawnArrow[] = [
    { id: "customer->web", edge: edge("customer", "web"), points: [{ x: 110, y: 100 }, { x: 110, y: 300 }] },
    { id: "web->api", edge: edge("web", "api"), points: [{ x: 220, y: 350 }, { x: 400, y: 350 }], label: { x: 280, y: 360, w: 60, h: 20 } },
  ];
  const dropAt = (x: number, y: number) => noteDropAt(ws, cv, nodes, arrows, { x, y }, { reach: 9, noteSize: STICKY });

  it("puts the note on the box there", () => {
    expect(dropAt(150, 110)).toEqual({ on: { element: "customer" }, anchor: { kind: "box", id: "customer" }, node: "customer" });
    expect(dropAt(450, 320)).toMatchObject({ on: { element: "api" }, node: "api" });
  });

  it("puts the note on an arrow whose line is near enough, or whose label is there", () => {
    expect(dropAt(118, 200)).toEqual({ on: { from: "customer", to: "web" }, anchor: { kind: "arrow", edge: edge("customer", "web") }, arrow: "customer->web" });
    expect(dropAt(125, 200)).toBeUndefined();
    // The arrow from Web to API stands for Web's relationship to the routes inside the API.
    expect(dropAt(330, 375)).toMatchObject({ on: { from: "web", to: "routes" }, arrow: "web->api" });
  });

  it("puts the note on the frame, inside it and off its boxes and arrows", () => {
    expect(dropAt(300, 420)).toEqual({ on: { element: "shop" }, anchor: { kind: "frame", id: "shop" }, node: "__frame" });
  });

  it("puts the note on nothing over a note, even one over a box, or off the diagram", () => {
    expect(dropAt(750, 40)).toBeUndefined();
    expect(dropAt(20, 20)).toBeUndefined();
    expect(dropAt(2000, 2000)).toBeUndefined();
  });

  it("passes over an arrow a note can't be on", () => {
    // Logging's writer is drawn in each container built with it, and a note on its relationship has its line to the first arrow.
    const model: OpenArchDocument = {
      openarch: 20,
      name: "Logs",
      elements: {
        shop: { kind: "system", name: "Shop" },
        api: { kind: "container", name: "API", parent: "shop", libraries: ["logging"] },
        web: { kind: "container", name: "Web", parent: "shop", libraries: ["logging"] },
        logging: { kind: "library", name: "Logging" },
        writer: { kind: "component", name: "Writer", parent: "logging", uses: [{ to: "logs", description: "Sends logs" }] },
        logs: { kind: "system", name: "Logs" },
      },
      views: { containers: { title: "Containers", level: "container", scope: "shop" } },
    };
    const logs = computed(model, "containers");
    // The two arrows run side by side, 4 apart.
    const drawn = logs.cv.edges.map((e, k): DrawnArrow => ({ id: `${e.from}->${e.to}`, edge: e, points: [{ x: 0, y: 1000 + k * 4 }, { x: 500, y: 1000 + k * 4 }] }));
    expect(drawn.map((a) => a.id)).toEqual(["api->logs", "web->logs"]);
    const at = (y: number) => noteDropAt(logs.ws, logs.cv, [], drawn, { x: 250, y }, { reach: 9, noteSize: STICKY });
    expect(at(1000)).toMatchObject({ on: { from: "writer", to: "logs" }, arrow: "api->logs" });
    // Nearer Web's arrow, which a note can't be on, so on the API's.
    expect(at(1005)).toMatchObject({ on: { from: "writer", to: "logs" }, arrow: "api->logs" });
    expect(at(1012)).toBeUndefined();
  });
});

describe("the edit a note's dot let go makes", () => {
  // Web's relationships to the routes inside the API and to the API itself are drawn as one arrow.
  const model = structuredClone(doc);
  model.elements.web!.uses = [
    { to: "routes", description: "Calls" },
    { to: "api", description: "Checks it's up" },
  ];
  model.views.containers!.stickies = {
    second: { text: "Second", on: { from: "web", to: "api" } },
    inside: { text: "Inside", on: { element: "routes" } },
    placed: { text: "Placed", on: { element: "web" }, at: [10, 20] },
    loose: { text: "Loose" },
  };
  const { ws, cv } = computed(model, "containers");
  const note = (id: string) => cv.view.stickies.find((s) => s.id === id)!;
  const arrow = cv.edges.find((e) => e.from === "web" && e.to === "api")!;
  const onArrow = { on: { from: "web", to: "routes" }, anchor: { kind: "arrow" as const, edge: arrow }, arrow: "web->api" };
  const onBox = (id: string) => ({ on: { element: id }, anchor: { kind: "box" as const, id }, node: id });

  it("changes nothing when the note's line goes there already", () => {
    expect(arrow.sources.length).toBe(2);
    expect(noteDropOps(ws, cv, note("second"), onArrow, { x: 0, y: 0 })).toEqual([]);
    // Routes is drawn as the API's box.
    expect(noteDropOps(ws, cv, note("inside"), onBox("api"), { x: 0, y: 0 })).toEqual([]);
  });

  it("puts the note on it, where it's drawn, or where it was put", () => {
    expect(noteDropOps(ws, cv, note("second"), onBox("customer"), { x: 0, y: 0 })).toEqual([{ op: "update-sticky", view: "containers", id: "second", on: { element: "customer" }, at: [0, 0] }]);
    expect(noteDropOps(ws, cv, note("loose"), onArrow, { x: 300.4, y: 19.6 })).toEqual([{ op: "update-sticky", view: "containers", id: "loose", on: { from: "web", to: "routes" }, at: [300, 20] }]);
    expect(noteDropOps(ws, cv, note("placed"), onBox("customer"), { x: 10, y: 20 })).toEqual([{ op: "update-sticky", view: "containers", id: "placed", on: { element: "customer" } }]);
  });
});
