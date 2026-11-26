// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { applyOperations, buildWorkspace, computeView, loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_H, NODE_W, ROW_GAP, type Point } from "../src/canvas/autoLayout.js";
import { AutoLayoutButton, autoLayoutOps, canAutoLayout, layoutEdges, layoutNodes, useAutoLayout } from "../src/canvas/Canvas.js";
import { autoLayoutBlockOps } from "../src/canvas/FlowchartDiagram.js";
import { entityWidth } from "../src/canvas/entityLayout.js";
import { blockWidth, LANE } from "../src/canvas/flowchartLayout.js";
import { classHeight } from "../src/canvas/nodes.js";
import { forgetLabelSizes } from "../src/canvas/RoutedEdge.js";
import { autoLayoutStateOps } from "../src/canvas/StateDiagram.js";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import type { Edit } from "../src/state.js";
import { button, click, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 22,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
    orders: { kind: "component", name: "Orders", parent: "api" },
    order: { kind: "class", name: "Order", parent: "orders", members: ["+id: OrderId", "+total(): Money"] },
  },
  views: {
    // Every box piled on the others, and two notes with places: one on a box, and one on nothing.
    containers: {
      title: "Containers",
      level: "container",
      scope: "shop",
      layout: { customer: [0, 0], web: [10, 10], api: [20, 20] },
      stickies: { "on-web": { text: "The storefront", on: { element: "web" }, at: [15, 15] }, loose: { text: "Read me", at: [5, 5] }, placed: { text: "Already beside the diagram" } },
    },
    "order-states": {
      title: "Order states",
      level: "state",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", at: [5, 5] }, shipped: { name: "Shipped", at: [10, 10] } },
      transitions: [
        { from: "placed", to: "paid" },
        { from: "paid", to: "shipped" },
      ],
      stickies: { note: { text: "Look here", at: [0, 0] } },
    },
    returns: {
      title: "Returns",
      level: "flowchart",
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "shop", name: "Shop" },
      ],
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", lane: "customer", at: [0, 0] },
        { id: "check", kind: "decision", text: "Within 30 days?", lane: "shop", at: [0, 0] },
        { id: "refund", text: "Refund the card", lane: "shop", at: [0, 0] },
        { id: "done", kind: "end", text: "Done", lane: "customer", at: [0, 0] },
      ],
      flows: [
        { from: "asked", to: "check" },
        { from: "check", to: "refund", text: "Yes" },
        { from: "refund", to: "done" },
      ],
    },
    empty: { title: "Nothing yet", level: "state" },
  },
};

describe("layoutNodes", () => {
  it("lays each box out at the height it's drawn, once it has been, and a class at the height its text needs before then", () => {
    const ws = buildWorkspace({ ...shop, views: { ...shop.views, classes: { title: "Classes", level: "class", scope: "orders" } } });
    const cv = computeView(ws, ws.views.get("classes")!);
    expect(layoutNodes(cv)).toEqual([{ id: "order", inside: true, height: classHeight(ws.elements.get("order")!) }]);
    expect(layoutNodes(cv, new Map([["order", 180]]))).toEqual([{ id: "order", inside: true, height: 180 }]);
    const containers = computeView(ws, ws.views.get("containers")!);
    expect(layoutNodes(containers, new Map([["web", 150]]))).toEqual([
      { id: "customer", inside: false, height: undefined },
      { id: "api", inside: true, height: undefined },
      { id: "web", inside: true, height: 150 },
    ]);
  });
});

describe("canAutoLayout", () => {
  it("is for views of boxes, state views and flowcharts with something on them, not views always laid out automatically", () => {
    const ws = buildWorkspace({
      ...shop,
      views: {
        ...shop.views,
        nothing: { title: "Nothing", level: "flowchart", blocks: [] },
        production: { title: "Production", level: "deployment", nodes: { server: { name: "Server", runs: ["web"] } } },
      },
    });
    const can = (id: string) => canAutoLayout(computeView(ws, ws.views.get(id)!));
    expect(["containers", "order-states", "returns"].map(can)).toEqual([true, true, true]);
    expect(["empty", "nothing", "production"].map(can)).toEqual([false, false, false]);
  });
});

describe("autoLayoutOps", () => {
  const ws = buildWorkspace(shop);

  it("puts every box where ELK did, and the notes back where the designer puts notes, as one edit", () => {
    const positions = { customer: { x: 0.4, y: 0 }, web: { x: 10.6, y: 230 }, api: { x: 10, y: 460.5 } };
    const ops = autoLayoutOps(ws, "containers", positions);
    expect(ops).toEqual([
      { op: "set-layout", view: "containers", positions: { customer: [0, 0], web: [11, 230], api: [10, 461] } },
      { op: "update-sticky", view: "containers", id: "loose", at: null },
      { op: "update-sticky", view: "containers", id: "on-web", at: null },
    ]);
    const view = loadWorkspace(serializeDocument(applyOperations(ws.doc, ops).doc)).views.get("containers")!;
    expect(view.layout).toEqual({ customer: [0, 0], web: [11, 230], api: [10, 461] });
    expect(view.stickies.map((s) => s.at)).toEqual([undefined, undefined, undefined]);
  });

  it("leaves out a box deleted while ELK worked, and a view that's gone", () => {
    const at: Record<string, Point> = { customer: { x: 0, y: 0 }, gone: { x: 300, y: 0 } };
    expect(autoLayoutOps(ws, "containers", at)[0]).toEqual({ op: "set-layout", view: "containers", positions: { customer: [0, 0] } });
    expect(autoLayoutOps(ws, "deleted", at)).toEqual([]);
  });
});

describe("autoLayoutStateOps", () => {
  const ws = buildWorkspace(shop);

  it("puts every state where ELK did, and the notes back beside the diagram", () => {
    const ops = autoLayoutStateOps(ws, "order-states", { placed: { x: 0, y: 0 }, paid: { x: 0, y: 200.4 }, shipped: { x: 0, y: 400 }, gone: { x: 9, y: 9 } });
    expect(ops).toEqual([
      { op: "update-state", view: "order-states", id: "paid", at: [0, 200] },
      { op: "update-state", view: "order-states", id: "placed", at: [0, 0] },
      { op: "update-state", view: "order-states", id: "shipped", at: [0, 400] },
      { op: "update-sticky", view: "order-states", id: "note", at: null },
    ]);
    expect(() => applyOperations(ws.doc, ops)).not.toThrow();
  });

  it("changes nothing on a view that isn't a state view", () => {
    expect(autoLayoutStateOps(ws, "containers", { customer: { x: 0, y: 0 } })).toEqual([]);
  });
});

describe("autoLayoutBlockOps", () => {
  const ws = buildWorkspace(shop);

  it("puts each block at the height ELK gave it, down the middle of its lane, from the inside of the lane's left", () => {
    const auto = { asked: { x: 20, y: 0 }, check: { x: 0, y: 150 }, refund: { x: 20, y: 330 }, done: { x: 30, y: 480 } };
    const ops = autoLayoutBlockOps(ws, "returns", auto);
    const middle = (kind: "start" | "decision" | "process" | "end") => Math.max(0, LANE.centre - blockWidth(kind) / 2);
    expect(ops).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [middle("start"), 0] },
      { op: "update-block", view: "returns", id: "check", at: [middle("decision"), 150] },
      { op: "update-block", view: "returns", id: "refund", at: [middle("process"), 330] },
      { op: "update-block", view: "returns", id: "done", at: [middle("end"), 480] },
    ]);
    expect(() => applyOperations(ws.doc, ops)).not.toThrow();
  });

  it("keeps ELK's places in a flowchart without lanes, and leaves out a block ELK didn't lay out", () => {
    const noLanes = buildWorkspace({ ...shop, views: { returns: { ...shop.views.returns!, lanes: undefined } } });
    expect(autoLayoutBlockOps(noLanes, "returns", { asked: { x: 30, y: 0 }, check: { x: 0.6, y: 150 } })).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [30, 0] },
      { op: "update-block", view: "returns", id: "check", at: [1, 150] },
    ]);
  });
});

describe("useAutoLayout", () => {
  /** The toolbar's button, working with these stand-ins. */
  function Harness(props: { layOutAll(): Promise<Edit>; edit(edit: Edit): Promise<boolean>; onError(text: string): void; fit(): void }) {
    const layout = useAutoLayout(props.layOutAll, props.edit, props.onError, props.fit);
    return createElement(AutoLayoutButton, { layout, empty: false });
  }
  const frames = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

  it("makes the edit once ELK has worked out where everything goes, then fits the diagram, and ignores clicks meanwhile", async () => {
    let done!: (edit: Edit) => void;
    const layOutAll = vi.fn(() => new Promise<Edit>((resolve) => (done = resolve)));
    const edit = vi.fn(async () => true);
    const fit = vi.fn();
    const host = mount(createElement(Harness, { layOutAll, edit, onError: () => {}, fit }));
    await click(button(host, "Auto layout"));
    expect(button(host, "Auto layout").disabled).toBe(true);
    await click(button(host, "Auto layout"));
    expect(layOutAll).toHaveBeenCalledTimes(1);
    const ops = [{ op: "set-layout" as const, view: "containers", positions: { customer: [0, 0] as [number, number] } }];
    await act(async () => done(ops));
    await frames();
    expect(edit).toHaveBeenCalledWith(ops);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(button(host, "Auto layout").disabled).toBe(false);
  });

  it("says so, and moves nothing, when ELK can't lay the diagram out", async () => {
    const edit = vi.fn(async () => true);
    const onError = vi.fn();
    const fit = vi.fn();
    // As when the app was updated after the page was opened, and ELK's file is gone.
    const host = mount(createElement(Harness, { layOutAll: () => Promise.reject(new TypeError("Failed to fetch dynamically imported module")), edit, onError, fit }));
    await click(button(host, "Auto layout"));
    await frames();
    expect(onError).toHaveBeenCalledWith("Couldn't lay out the diagram automatically, so nothing moved. Reload the page to try again.");
    expect(edit).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
    expect(button(host, "Auto layout").disabled).toBe(false);
  });

  it("moves nothing when the diagram is closed before ELK is done, as when another view is opened", async () => {
    let done!: (edit: Edit) => void;
    const edit = vi.fn(async () => true);
    const fit = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Harness, { layOutAll: () => new Promise<Edit>((resolve) => (done = resolve)), edit, onError: () => {}, fit })));
    await click(button(host, "Auto layout"));
    act(() => root.unmount());
    host.remove();
    await act(async () => done([]));
    await frames();
    expect(edit).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });

  it("doesn't fit the diagram when the edit was refused", async () => {
    const fit = vi.fn();
    const host = mount(createElement(Harness, { layOutAll: async () => [], edit: async () => false, onError: () => {}, fit }));
    await click(button(host, "Auto layout"));
    await frames();
    expect(fit).not.toHaveBeenCalled();
  });
});

/**
 * React Flow draws boxes once it has measured them, and this page has no layout. So, as in
 * snapDesigner.test.ts, a stand-in ResizeObserver keeps what it's asked to watch, and when the
 * test asks, says each node is 200 by 100 and anything else 1000 by 800.
 */
const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  watching = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.watching.add(target);
  }
  unobserve(target: Element) {
    this.watching.delete(target);
  }
  disconnect() {
    this.watching.clear();
  }
}
const NODE = { width: 200, height: 100 };
const size = (el: HTMLElement) => (el.classList.contains("react-flow__node") ? NODE : { width: 1000, height: 800 });
const real = {
  ResizeObserver: globalThis.ResizeObserver,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
};
beforeAll(() => {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: function (this: HTMLElement) { return size(this).width; } });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: function (this: HTMLElement) { return size(this).height; } });
});
afterAll(() => {
  globalThis.ResizeObserver = real.ResizeObserver;
  for (const name of ["offsetWidth", "offsetHeight"] as const) {
    const was = real[name];
    if (was) Object.defineProperty(HTMLElement.prototype, name, was);
  }
});

/** The whole designer, open on one view of the shop, or of `doc`, with its boxes measured. */
async function designer(view: string, doc: OpenArchDocument = shop) {
  const file = new MemoryHost("shop.openarch", serializeDocument({ ...doc, views: { [view]: doc.views[view]! } }));
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  /** Lets the edits, ELK and the drawing settle, with every box measured. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
      await act(async () => {
        for (const o of observers) {
          const entries = [...o.watching].map((target) => ({ target, contentRect: { x: 0, y: 0, ...size(target as HTMLElement) } }) as ResizeObserverEntry);
          if (entries.length) o.callback(entries, o as unknown as ResizeObserver);
        }
      });
    }
  };
  await settle();
  /** The view as the file now has it. */
  const saved = async () => loadWorkspace(await file.load()).views.get(view)!;
  return { host, file, settle, saved };
}

/** Whether no two of these boxes, each `w` wide and `h` tall, overlap. */
function apart(boxes: readonly (readonly number[])[], w: number, h: number): boolean {
  return boxes.every(([x = 0, y = 0], i) => boxes.slice(i + 1).every(([x2 = 0, y2 = 0]) => Math.abs(x - x2) >= w || Math.abs(y - y2) >= h));
}

describe("the Auto layout button", () => {
  it("lays a view of boxes out again, with the notes beside what they're on or the diagram, and Undo takes it back in one step", async () => {
    const d = await designer("containers");
    const before = await d.file.load();
    await click(button(d.host, "Auto layout"));
    await d.settle();
    const view = await d.saved();
    const at = view.layout;
    expect(Object.keys(at).sort()).toEqual(["api", "customer", "web"]);
    expect(apart(Object.values(at), NODE_W, NODE.height)).toBe(true);
    // The arrows go down: the customer uses the web app, which calls the API.
    expect(at.customer![1]).toBeLessThan(at.web![1]);
    expect(at.web![1]).toBeLessThan(at.api![1]);
    expect(view.stickies.map((s) => s.at)).toEqual([undefined, undefined, undefined]);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(await d.file.load()).toBe(before);
  });

  it("lays a state view out again", async () => {
    const d = await designer("order-states");
    await click(button(d.host, "Auto layout"));
    await d.settle();
    const view = await d.saved();
    const at = Object.fromEntries(view.states.map((s) => [s.id, s.at!]));
    expect(apart(Object.values(at), NODE_W, NODE.height)).toBe(true);
    expect(at.placed![1]).toBeLessThan(at.paid![1]);
    expect(at.paid![1]).toBeLessThan(at.shipped![1]);
    expect(view.stickies[0]!.at).toBeUndefined();
  });

  it("lays a flowchart out again, from its first block down, each block in its own lane", async () => {
    const d = await designer("returns");
    await click(button(d.host, "Auto layout"));
    await d.settle();
    const view = await d.saved();
    const y = (id: string) => view.blocks.find((b) => b.id === id)!.at![1];
    expect(y("asked")).toBeLessThan(y("check"));
    expect(y("check")).toBeLessThan(y("refund"));
    expect(y("refund")).toBeLessThan(y("done"));
    expect(view.blocks.map((b) => [b.id, b.lane])).toEqual([
      ["asked", "customer"],
      ["check", "shop"],
      ["refund", "shop"],
      ["done", "customer"],
    ]);
  });

  it("can't be clicked on a view with nothing to lay out", async () => {
    const d = await designer("empty");
    expect(button(d.host, "Auto layout").disabled).toBe(true);
  });
});

describe("Auto layout on a narrow screen", () => {
  const real = window.matchMedia;
  beforeAll(() => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterAll(() => {
    window.matchMedia = real;
  });
  /** The top bar's More menu's items. */
  const more = async (host: HTMLElement) => {
    await click(host.querySelector('button[aria-label="More"]')!);
    return [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')];
  };

  it("is in the top bar's More menu, as the diagram's toolbar has no room for it", async () => {
    const d = await designer("order-states");
    const item = (await more(d.host)).find((i) => i.textContent?.trim() === "Auto layout");
    expect(item).toBeDefined();
    await click(item!);
    await d.settle();
    const at = (await d.saved()).states.map((s) => s.at!);
    expect(apart(at, NODE_W, NODE.height)).toBe(true);
  });

  it("isn't offered on a view with nothing to lay out", async () => {
    const d = await designer("empty");
    expect((await more(d.host)).map((i) => i.textContent?.trim())).not.toContain("Auto layout");
  });
});

/**
 * Three labelled arrows from one box, in each kind of view with Auto layout: a web app that
 * uses three containers, a state with three ways out, a decision with three answers, and an
 * entity with links to three others.
 */
const hub: OpenArchDocument = {
  openarch: 22,
  name: "Hub",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: {
      kind: "container",
      name: "Web",
      parent: "shop",
      uses: [
        { to: "api", description: "Places orders" },
        { to: "search", description: "Finds products" },
        { to: "accounts", description: "Signs customers in" },
      ],
    },
    api: { kind: "container", name: "API", parent: "shop" },
    search: { kind: "container", name: "Search", parent: "shop" },
    accounts: { kind: "container", name: "Accounts", parent: "shop" },
  },
  views: {
    // Nothing has a place yet, so the designer lays it out as it opens.
    fresh: { title: "Fresh", level: "container", scope: "shop" },
    containers: { title: "Containers", level: "container", scope: "shop", layout: { web: [0, 0], api: [10, 10], search: [20, 20], accounts: [30, 30] } },
    states: {
      title: "States",
      level: "state",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", at: [5, 5] }, cancelled: { name: "Cancelled", at: [10, 10] }, held: { name: "Held", at: [15, 15] } },
      transitions: [
        { from: "placed", to: "paid", event: "Payment taken" },
        { from: "placed", to: "cancelled", event: "Customer cancels" },
        { from: "placed", to: "held", event: "Card needs checking" },
      ],
    },
    flow: {
      title: "Flow",
      level: "flowchart",
      blocks: [
        { id: "check", kind: "decision", text: "How old?", at: [0, 0] },
        { id: "refund", text: "Refund", at: [0, 0] },
        { id: "credit", text: "Give credit", at: [0, 0] },
        { id: "refuse", text: "Refuse", at: [0, 0] },
      ],
      flows: [
        { from: "check", to: "refund", text: "Under 30 days" },
        { from: "check", to: "credit", text: "Under 90 days" },
        { from: "check", to: "refuse", text: "Older" },
      ],
    },
    data: {
      title: "Data",
      level: "entity",
      entities: [
        { id: "order", name: "Order", at: [0, 0] },
        { id: "line", name: "Line", at: [0, 0] },
        { id: "payment", name: "Payment", at: [0, 0] },
        { id: "parcel", name: "Parcel", at: [0, 0] },
      ],
      links: [
        { from: "order", to: "line", text: "lists" },
        { from: "order", to: "payment", text: "is paid by" },
        { from: "order", to: "parcel", text: "is sent in" },
      ],
    },
  },
};

describe("Auto layout and the arrows' labels", () => {
  /**
   * This page has no layout, so every label would measure nothing. Here each measures 120 wide and
   * 24 a line, much as a label of a few words does in a browser. Three of one line, one above the
   * other, need 168px: the three, 24px between each two, and 24px clear at each end of the arrows.
   */
  const LABEL = { width: 120, height: 24 };
  const THREE = 3 * 24 + 2 * 24 + 2 * 24;
  const measure = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    forgetLabelSizes();
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return this.matches(".arrow-label") ? ({ width: LABEL.width, height: LABEL.height * this.children.length } as DOMRect) : measure.call(this);
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = measure;
    forgetLabelSizes();
  });

  it("gives ELK each arrow with its label's size, and none for an arrow that's drawn without a label", () => {
    const ws = buildWorkspace(shop);
    const edges = computeView(ws, ws.views.get("containers")!).edges;
    expect(layoutEdges(edges)).toEqual([
      { from: "customer", to: "web", label: { w: 120, h: 24, maxWidth: 190 } },
      { from: "web", to: "api", label: { w: 120, h: 24, maxWidth: 190 } },
    ]);
    // With a technology, a label has a second line.
    expect(layoutEdges(edges.map((e) => ({ ...e, technology: "HTTPS" }))).map((e) => e.label?.h)).toEqual([48, 48]);
    // An arrow standing for relationships between what's inside its boxes says nothing when they don't.
    expect(layoutEdges(edges.map((e) => ({ ...e, description: undefined, implied: true })))).toEqual([
      { from: "customer", to: "web", label: undefined },
      { from: "web", to: "api", label: undefined },
    ]);
  });

  it("puts a view of boxes' rows far enough apart for three labels one above the other", async () => {
    const d = await designer("containers", hub);
    await click(button(d.host, "Auto layout"));
    await d.settle();
    const at = (await d.saved()).layout;
    for (const id of ["api", "search", "accounts"]) expect(at[id]![1] - at.web![1]).toBe(NODE.height + THREE);
  });

  it("does the same for a state view, a flowchart, and, for its columns, an entity view", async () => {
    const states = await designer("states", hub);
    await click(button(states.host, "Auto layout"));
    await states.settle();
    const state = Object.fromEntries((await states.saved()).states.map((s) => [s.id, s.at!]));
    for (const id of ["paid", "cancelled", "held"]) expect(state[id]![1] - state.placed![1]).toBe(NODE.height + THREE);

    const flow = await designer("flow", hub);
    await click(button(flow.host, "Auto layout"));
    await flow.settle();
    const block = Object.fromEntries((await flow.saved()).blocks.map((b) => [b.id, b.at!]));
    for (const id of ["refund", "credit", "refuse"]) expect(block[id]![1] - block.check![1]).toBe(NODE.height + THREE);

    const data = await designer("data", hub);
    await click(button(data.host, "Auto layout"));
    await data.settle();
    const view = await data.saved();
    const entity = Object.fromEntries(view.entities.map((e) => [e.id, e.at!]));
    // Links run across, so the columns are a label's width apart, and the room at each end of it.
    for (const id of ["line", "payment", "parcel"]) expect(entity[id]![0] - entity.order![0]).toBe(entityWidth(view.entities[0]!) + LABEL.width + 2 * 24);
  });

  it("lays a view with no places out with room for its labels, and again when a label needs more", async () => {
    const d = await designer("fresh", hub);
    const y = (id: string) => Number(/translate\(([-\d.]+)px, ?([-\d.]+)px\)/.exec(d.host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!.style.transform)![2]);
    // Before a box is drawn, ELK takes it to be NODE_H tall.
    expect(y("api") - y("web")).toBe(NODE_H + THREE);
    expect(THREE).toBeGreaterThan(ROW_GAP);
    // A technology gives one of the labels a second line.
    await click(d.host.querySelector('.react-flow__edge[data-id="web->accounts"]')!);
    const technology = d.host.querySelector<HTMLInputElement>('.properties input[aria-label="Technology"]')!;
    await type(technology, "HTTPS");
    await act(async () => {
      technology.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await d.settle();
    // Still laid out by the designer: nothing has a saved place.
    expect((await d.saved()).layout).toEqual({});
    expect(y("api") - y("web")).toBe(NODE_H + THREE + 24);
  });
});
