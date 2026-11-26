// @vitest-environment happy-dom
import { buildWorkspace, computeView, serializeDocument, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement, useState } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { boxedItems, FlowchartDiagram, laneAt } from "../src/canvas/FlowchartDiagram.js";
import { Designer, detailsName } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { flowchartDeleteOps, flowchartItemsOf, flowchartSelectionLeft, selectFlowchart, shownInProperties, toggleFlowchartItem } from "../src/model.js";
import { Properties } from "../src/panels/Properties.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, click, key, menusFor, mount } from "./dom.js";

/**
 * React Flow drags and box-selects nodes only once it has measured them, and this page has no
 * layout. So, as in whiteboardMove.test.ts, a stand-in ResizeObserver keeps what it's asked to
 * watch, and when the test asks, says each node is 200 by 100 and anything else 1000 by 800.
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
const size = (el: HTMLElement) => (el.classList.contains("react-flow__node") ? { width: 200, height: 100 } : { width: 1000, height: 800 });
const real = {
  ResizeObserver: globalThis.ResizeObserver,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
  getBoundingClientRect: Element.prototype.getBoundingClientRect,
};
beforeAll(() => {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  // The canvas is 1000 by 800 at the page's top left, or a selection box pans on and on, as
  // every point is at its edge.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.classList.contains("react-flow") ? new DOMRect(0, 0, 1000, 800) : real.getBoundingClientRect.call(this);
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: function (this: HTMLElement) { return size(this).width; } });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: function (this: HTMLElement) { return size(this).height; } });
});
afterAll(() => {
  globalThis.ResizeObserver = real.ResizeObserver;
  Element.prototype.getBoundingClientRect = real.getBoundingClientRect;
  for (const name of ["offsetWidth", "offsetHeight"] as const) {
    const was = real[name];
    if (was) Object.defineProperty(HTMLElement.prototype, name, was);
  }
});

/** A return, each block placed, with a note. */
const doc: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    returns: {
      title: "Returns",
      level: "flowchart",
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", at: [0, 0] },
        { id: "refund", text: "Refund the card", at: [0, 300] },
        { id: "refuse", text: "Say no", at: [300, 300] },
        { id: "done", kind: "end", text: "Done", at: [0, 600] },
      ],
      flows: [
        { from: "asked", to: "refund" },
        { from: "refund", to: "done" },
      ],
      stickies: { n1: { text: "Ask the customer why", on: { block: "refund" }, at: [600, 300] } },
    },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("returns")!;

/** The same return, in lanes: Return asked for in the customer's, the rest in the shop's. */
const lanedDoc: OpenArchDocument = {
  ...doc,
  views: {
    returns: {
      ...doc.views.returns!,
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "shop", name: "Shop" },
      ],
      blocks: doc.views.returns!.blocks!.map((b) => ({ ...b, lane: b.id === "asked" ? "customer" : "shop" })),
    },
  },
};

describe("blocks and notes selected together on a flowchart", () => {
  it("are one of them on its own, as a click selects it, two or more together, or nothing", () => {
    expect(selectFlowchart({ blocks: ["refund", "refuse"], stickies: ["n1"] })).toEqual({ kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] });
    expect(selectFlowchart({ blocks: ["refund"], stickies: [] })).toEqual({ kind: "block", id: "refund" });
    expect(selectFlowchart({ blocks: [], stickies: ["n1"] })).toEqual({ kind: "sticky", id: "n1" });
    expect(selectFlowchart({ blocks: [], stickies: [] })).toBeNull();
    expect(flowchartItemsOf({ kind: "block", id: "refund" })).toEqual({ blocks: ["refund"], stickies: [] });
    expect(flowchartItemsOf({ kind: "flow", number: 1 })).toEqual({ blocks: [], stickies: [] });
  });

  it("have a block or note added, or taken out when it's in already, by a Ctrl-click", () => {
    const two = toggleFlowchartItem({ kind: "block", id: "refund" }, "blocks", "refuse");
    expect(two).toEqual({ kind: "blocks", blocks: ["refund", "refuse"], stickies: [] });
    expect(toggleFlowchartItem(two, "stickies", "n1")).toEqual({ kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] });
    expect(toggleFlowchartItem(two, "blocks", "refund")).toEqual({ kind: "block", id: "refuse" });
    // A flow selected isn't kept: a click on a block with it selected starts again from the block.
    expect(toggleFlowchartItem({ kind: "flow", number: 1 }, "blocks", "refund")).toEqual({ kind: "block", id: "refund" });
  });

  it("are the blocks and notes a selection box has inside it, not the lanes or the frame", () => {
    const nodes = [
      { id: "refund", type: "block", position: { x: 0, y: 0 }, data: { block: view.blocks[1]! } },
      { id: "sticky:n1", type: "sticky", position: { x: 0, y: 0 }, data: { sticky: view.stickies[0]! } },
      { id: "lane:shop", type: "lane", position: { x: 0, y: 0 }, data: {} },
    ] as unknown as Parameters<typeof boxedItems>[0];
    expect(boxedItems(nodes)).toEqual({ blocks: ["refund"], stickies: ["n1"] });
  });

  it("are deleted together, the blocks with their flows, and nothing else is", () => {
    expect(flowchartDeleteOps(view, { kind: "blocks", blocks: ["refund", "gone"], stickies: ["n1"] })).toEqual([
      { op: "remove-block", view: "returns", id: "refund" },
      { op: "remove-sticky", view: "returns", id: "n1" },
    ]);
    // A block or note on its own is the designer's to delete, as it always was.
    expect(flowchartDeleteOps(view, { kind: "block", id: "refund" })).toEqual([]);
  });

  it("lose what leaves the flowchart, as after an Undo, down to one on its own or nothing", () => {
    const three: Selection = { kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] };
    expect(flowchartSelectionLeft(view, three)).toBe(three);
    expect(flowchartSelectionLeft(view, { kind: "blocks", blocks: ["refund", "gone"], stickies: ["n1"] })).toEqual({ kind: "blocks", blocks: ["refund"], stickies: ["n1"] });
    expect(flowchartSelectionLeft(view, { kind: "blocks", blocks: ["refund", "gone"], stickies: [] })).toEqual({ kind: "block", id: "refund" });
    expect(flowchartSelectionLeft(undefined, three)).toBeNull();
  });

  it("are shown in the details, and named, while two or more are there", () => {
    const shown = shownInProperties(ws, view, { kind: "blocks", blocks: ["refuse", "refund"], stickies: ["n1"] });
    expect(shown).toMatchObject({ kind: "blocks", blocks: [{ id: "refund" }, { id: "refuse" }], stickies: [{ id: "n1" }] });
    expect(shownInProperties(ws, view, { kind: "blocks", blocks: ["refund", "gone"], stickies: [] })).toMatchObject({ kind: "block", block: { id: "refund" } });
    expect(detailsName(ws, view, computeView(ws, view), { kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] })).toBe("2 blocks and 1 sticky note");
  });
});

describe("the details of blocks and notes selected together", () => {
  it("list them, each a click away, and delete them all", async () => {
    const edits: Operation[][] = [];
    const selected: Selection[] = [];
    const host = mount(
      createElement(Properties, {
        ws,
        view,
        computed: computeView(ws, view),
        selection: { kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] },
        isNew: false,
        syncsDocs: false,
        syncsSkill: false,
        docs: null,
        fileName: "shop.openarch",
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return true;
        },
        onSelect: (s: Selection) => void selected.push(s),
        onHide() {},
        onDelete() {},
        onFindUsages() {},
        onNewView() {},
        onNewLibrary: async () => {},
        onBuild() {},
        onAddSticky() {},
        onDeleteView() {},
        onEditNotes() {},
      }),
    );
    expect(host.querySelector(".props-header")?.textContent).toBe("2 blocks and 1 sticky note");
    expect([...host.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Blocks", "Sticky notes"]);
    await click(button(host, "Refund the card"));
    await click(button(host, "Ask the customer why"));
    await click(button(host, "Delete them"));
    expect(edits).toEqual([
      [
        { op: "remove-block", view: "returns", id: "refund" },
        { op: "remove-block", view: "returns", id: "refuse" },
        { op: "remove-sticky", view: "returns", id: "n1" },
      ],
    ]);
    expect(selected).toEqual([{ kind: "block", id: "refund" }, { kind: "sticky", id: "n1" }, null]);
  });
});

describe("a lane's column on a flowchart", () => {
  it("is found under a point on the diagram, as a click there takes no lane's own pointer events", () => {
    const lane = (x: number) => ({ position: { x, y: -40 }, data: { column: { x, w: 260 }, height: 500 } });
    const lanes = [lane(0), lane(260)] as unknown as Parameters<typeof laneAt>[0];
    expect(laneAt(lanes, { x: 100, y: 200 })).toBe(lanes[0]);
    expect(laneAt(lanes, { x: 300, y: 459 })).toBe(lanes[1]);
    expect(laneAt(lanes, { x: 300, y: 461 })).toBeUndefined();
    expect(laneAt(lanes, { x: 600, y: 0 })).toBeUndefined();
  });
});

/**
 * The flowchart, its blocks measured, keeping what it selects as the designer does, from `first`.
 * Nothing snaps, so a block goes exactly where it's dragged.
 */
async function flowchart(first: Selection, model: OpenArchDocument = doc) {
  const built = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  function Host() {
    const [selection, setSelection] = useState<Selection>(first);
    return createElement(FlowchartDiagram, {
      ws: built,
      computed: computeView(built, built.views.get("returns")!),
      selection,
      onSelect: (s: Selection) => {
        selected.push(s);
        setSelection(s);
      },
      edit: async (e: Edit) => {
        edits.push(typeof e === "function" ? e(built) : e);
        return true;
      },
      menus: menusFor("returns"),
      onError() {},
      exportItems: [],
      snap: { settings: { ...SNAP_DEFAULTS, guides: false, grid: false }, set() {} },
    });
  }
  const host = mount(createElement(ReactFlowProvider, null, createElement(Host)));
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
      await act(async () => {
        for (const o of observers) {
          const entries = [...o.watching].map((target) => ({ target, contentRect: { x: 0, y: 0, ...size(target as HTMLElement) } }) as ResizeObserverEntry);
          if (entries.length) o.callback(entries, o as unknown as ResizeObserver);
        }
      });
    }
  };
  await settle();
  const node = (id: string) => host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  const at = (id: string) => /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/.exec(node(id).style.transform)!.slice(1).map((v) => Math.round(Number(v))) as [number, number];
  /** Where a point on the diagram is on the screen. */
  const screen = (x: number, y: number) => {
    const viewport = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [x0, y0, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(viewport)!.slice(1).map(Number) as [number, number, number];
    return { clientX: x * zoom + x0, clientY: y * zoom + y0 };
  };
  const fire = (target: EventTarget, event: Event) => act(async () => void target.dispatchEvent(event));
  const mouse = (target: EventTarget, type: string, p: { clientX: number; clientY: number }, keys: MouseEventInit = {}) =>
    fire(target, new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, ...p, ...keys }));
  /** Drags a block by this far on the diagram. */
  const drag = async (id: string, dx: number, dy: number) => {
    const [x, y] = at(id);
    const start = screen(x + 100, y + 50);
    await mouse(node(id), "mousedown", start);
    await mouse(document.body, "mousemove", { clientX: start.clientX + 5, clientY: start.clientY });
    // React Flow starts dragging when the mouse has moved a little, and moves the block from there.
    const end = screen(x + 100 + dx, y + 50 + dy);
    await mouse(document.body, "mousemove", { clientX: end.clientX + 5, clientY: end.clientY });
    await mouse(document.body, "mouseup", end);
    await settle();
  };
  /** Drags across the background, from one point on the diagram to another. */
  const boxSelect = async (from: [number, number], to: [number, number]) => {
    const pane = host.querySelector(".react-flow__pane")!;
    const pointer = (type: string, [x, y]: [number, number]) => fire(pane, new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, isPrimary: true, ...screen(x, y) }));
    await pointer("pointerdown", from);
    await pointer("pointermove", [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
    await pointer("pointermove", to);
    await pointer("pointerup", to);
    await settle();
  };
  const selectedNodes = () => [...host.querySelectorAll<HTMLElement>(".react-flow__node.selected")].map((n) => n.dataset.id);
  return { host, edits, selected, node, at, screen, mouse, drag, boxSelect, selectedNodes };
}

describe("selecting several blocks and notes on a flowchart", () => {
  it("draws each of them selected", async () => {
    const f = await flowchart({ kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] });
    expect(f.selectedNodes()).toEqual(["refund", "refuse", "sticky:n1"]);
  });

  it("adds a block or note with a Ctrl-click (⌘-click on a Mac) or a Shift-click, and takes it out again, and a plain click selects just one", async () => {
    const f = await flowchart({ kind: "block", id: "refund" });
    const center = (id: string) => f.screen(f.at(id)[0] + 50, f.at(id)[1] + 30);
    await f.mouse(f.node("refuse"), "click", center("refuse"), { ctrlKey: true, metaKey: true });
    await f.mouse(f.node("sticky:n1"), "click", center("sticky:n1"), { shiftKey: true });
    await f.mouse(f.node("refund"), "click", center("refund"), { shiftKey: true });
    await f.mouse(f.node("done"), "click", center("done"));
    expect(f.selected).toEqual([
      { kind: "blocks", blocks: ["refund", "refuse"], stickies: [] },
      { kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] },
      { kind: "blocks", blocks: ["refuse"], stickies: ["n1"] },
      { kind: "block", id: "done" },
    ]);
  });

  it("selects the blocks and notes inside a box dragged across the background", async () => {
    const f = await flowchart(null);
    // Round Refund the card and Say no, at 0, 300 and 300, 300, each 200 by 100, and not the note at 600, 300.
    await f.boxSelect([-20, 280], [520, 420]);
    expect(f.selected.at(-1)).toEqual({ kind: "blocks", blocks: ["refund", "refuse"], stickies: [] });
    expect(f.selectedNodes()).toEqual(["refund", "refuse"]);
  });

  it("selects inside a lane too, as the lanes take no pointer events but on their names", async () => {
    const f = await flowchart(null, lanedDoc);
    expect(f.node("lane:shop").style.pointerEvents).toBe("none");
    const [x, y] = f.at("refund");
    await f.boxSelect([x - 20, y - 20], [x + 220, y + 120]);
    expect(f.selected.at(-1)).toEqual({ kind: "block", id: "refund" });
  });

  it("selects the lane a click on the background lands in, or nothing outside the lanes", async () => {
    const f = await flowchart({ kind: "block", id: "refund" }, lanedDoc);
    const pane = f.host.querySelector(".react-flow__pane")!;
    const [x, y] = f.at("refund");
    await f.mouse(pane, "click", f.screen(x - 5, y + 150));
    await f.mouse(pane, "click", f.screen(x + 5000, y));
    expect(f.selected).toEqual([{ kind: "lane", id: "shop" }, null]);
  });

  it("moves them all together when any of them is dragged, as one step for Undo, and keeps them selected", async () => {
    const f = await flowchart({ kind: "blocks", blocks: ["refund", "refuse"], stickies: ["n1"] });
    await f.drag("refuse", 40, 60);
    expect(f.edits).toEqual([
      [
        { op: "update-block", view: "returns", id: "refund", at: [40, 360] },
        { op: "update-block", view: "returns", id: "refuse", at: [340, 360] },
        { op: "update-sticky", view: "returns", id: "n1", at: [640, 360] },
      ],
    ]);
    expect(f.selected).toEqual([]);
    expect(f.selectedNodes()).toEqual(["refund", "refuse", "sticky:n1"]);
  });

  it("moves blocks dragged together each into the lane it's let go of over", async () => {
    const f = await flowchart({ kind: "blocks", blocks: ["asked", "refund"], stickies: [] }, lanedDoc);
    // Customer's lane is from 0 to 260 and Shop's from 260, and each block is kept from inside its lane's left.
    expect([f.at("lane:customer")[0], f.at("lane:shop")[0], f.at("asked")[0], f.at("refund")[0]]).toEqual([0, 260, 30, 290]);
    await f.drag("asked", 300, 0);
    expect(f.edits).toEqual([
      [
        { op: "update-block", view: "returns", id: "asked", lane: "shop", at: [40, 0] },
        { op: "update-block", view: "returns", id: "refund", at: [300, 300] },
      ],
    ]);
  });

  it("moves just a block that isn't selected, and selects it", async () => {
    const f = await flowchart({ kind: "blocks", blocks: ["refund", "refuse"], stickies: [] });
    await f.drag("done", 40, 60);
    expect(f.edits).toEqual([[{ op: "update-block", view: "returns", id: "done", at: [40, 660] }]]);
    expect(f.selected).toEqual([{ kind: "block", id: "done" }]);
  });
});

describe("the designer, with several blocks and notes of a flowchart selected", () => {
  it("shows them in the details, deletes them together with Delete, and Undo brings them all back", async () => {
    const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
    const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    await settle();
    const blocks = () => [...host.querySelectorAll<HTMLElement>(".react-flow__node-block")].map((n) => n.dataset.id);
    const shiftClick = (id: string) =>
      act(async () => void host.querySelector(`.react-flow__node[data-id="${id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true })));
    await shiftClick("refund");
    await shiftClick("refuse");
    await shiftClick("sticky:n1");
    expect(host.querySelector(".properties .props-header")?.textContent).toBe("2 blocks and 1 sticky note");
    await key(document.body, "Delete");
    await settle();
    expect(blocks()).toEqual(["asked", "done"]);
    expect(host.querySelector(".react-flow__node-sticky")).toBeNull();
    expect(host.querySelector(".properties .props-header")?.textContent).toBe("View");
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, metaKey: true, bubbles: true })));
    await settle();
    expect(blocks()).toEqual(["asked", "refund", "refuse", "done"]);
    expect(host.querySelector(".react-flow__node-sticky")).not.toBeNull();
  });
});
