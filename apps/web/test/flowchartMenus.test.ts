// @vitest-environment happy-dom
import { applyOperations, buildWorkspace, loadWorkspace, serializeDocument, type Lane, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import { blockPlaceAt, canFlow, menuFor } from "../src/canvas/FlowchartDiagram.js";
import type { LaneColumn } from "../src/canvas/flowchartLayout.js";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, key, mount } from "./dom.js";

/**
 * React Flow draws arrows once it has measured the blocks, and this page has no layout. So, as in
 * stickyDesigner.test.ts, a stand-in ResizeObserver keeps what it's asked to watch, and when the
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
const size = (el: HTMLElement) => (el.classList.contains("react-flow__node") ? { width: 200, height: 100 } : { width: 1000, height: 800 });

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

/** A return, each block placed, so nothing waits for ELK, with a note beside it. */
const doc: OpenArchDocument = {
  openarch: 19,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    returns: {
      title: "Returns",
      level: "flowchart",
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", at: [0, 0] },
        { id: "in-time", kind: "decision", text: "Within 30 days?", at: [0, 200] },
        { id: "refund", text: "Refund the card", at: [0, 500] },
        { id: "say-no", text: "Say no", at: [400, 500] },
        { id: "done", kind: "end", text: "Done", at: [0, 800] },
      ],
      flows: [
        { from: "asked", to: "in-time" },
        { from: "in-time", to: "refund", text: "Yes" },
        { from: "in-time", to: "say-no", text: "No" },
        { from: "refund", to: "done" },
      ],
      stickies: { note: { text: "Read me", at: [800, 0] } },
    },
  },
};

/**
 * The same return in two lanes, each block's x from the inside of its lane's left. The customer's
 * lane is 260 wide, from 0, and the shop's 490, from 260.
 */
const laned = structuredClone(doc);
laned.views.returns!.lanes = [
  { id: "customer", name: "Customer" },
  { id: "shop", name: "Shop" },
];
laned.views.returns!.blocks = [
  { id: "asked", kind: "start", text: "Return asked for", lane: "customer", at: [0, 0] },
  { id: "in-time", kind: "decision", text: "Within 30 days?", lane: "shop", at: [0, 200] },
  { id: "refund", text: "Refund the card", lane: "shop", at: [0, 500] },
  { id: "say-no", text: "Say no", lane: "shop", at: [250, 500] },
  { id: "done", kind: "end", text: "Done", lane: "customer", at: [0, 800] },
];

/** A file whose saves wait until they're let through, as a slow disk's do. */
class SlowHost extends MemoryHost {
  private waiting: (() => void)[] = [];
  hold = false;
  override async save(text: string): Promise<void> {
    if (this.hold) await new Promise<void>((resolve) => this.waiting.push(resolve));
    await super.save(text);
  }
  release() {
    this.hold = false;
    for (const go of this.waiting.splice(0)) go();
  }
}

/** The whole designer, open on the flowchart, with its blocks measured. */
async function designer(model: OpenArchDocument = doc, file: MemoryHost = new MemoryHost("shop.openarch", serializeDocument(model))) {
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  /** Lets the edits and the drawing settle, with every block measured. */
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
  /** Where a point on the diagram is on the screen. The canvas is at the page's top left, as nothing here has a size. */
  const onScreen = (at: { x: number; y: number }) => {
    const transform = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [x, y, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform)!.slice(1).map(Number) as [number, number, number];
    return { clientX: at.x * zoom + x, clientY: at.y * zoom + y };
  };
  /** The items of the menu, or of the submenu open last. */
  const items = () => {
    const lists = document.querySelectorAll(".context-menu");
    return [...(lists[lists.length - 1]?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  };
  const label = (item: Element) => item.textContent!.replace("›", "").trim();
  const labels = () => items().map(label);
  const node = (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`);
  return {
    host,
    file,
    settle,
    labels,
    node,
    onScreen,
    /**
     * Right-clicks this, at a point on the diagram when it matters where, and returns the event
     * that asks for a menu. The press comes first, as it does from a mouse: it closes a menu
     * that's open. The menu opens once the edits made before have landed, so this waits a moment.
     */
    rightClick: async (target: Element, at?: { x: number; y: number }) => {
      const point = at ? onScreen(at) : { clientX: 20, clientY: 20 };
      await act(async () => {
        target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2, pointerId: 1, ...point }));
      });
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...point });
      await act(async () => {
        target.dispatchEvent(event);
        await new Promise<void>((resolve) => setTimeout(resolve));
      });
      return event;
    },
    /** Asks for this one's menu with the keyboard, as the Menu key does: the event has no point. */
    menuKey: async (target: Element) => {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
        await new Promise<void>((resolve) => setTimeout(resolve));
      });
    },
    /** Picks these from the open menu, one after another: a submenu, then an item in it. */
    pick: async (...path: string[]) => {
      for (const wanted of path) {
        const found = items().find((item) => label(item) === wanted);
        if (!found) throw new Error(`The menu has no ${wanted}. It has: ${labels().join(", ")}`);
        await click(found);
      }
      await settle();
    },
    /** Whether a right-click menu is open. */
    menuOpen: () => document.querySelector(".context-menu") !== null,
    flow: (number: number) => host.querySelector(`.react-flow__edge[data-id="flow:${number}"]`),
    pane: () => host.querySelector(".react-flow__pane")!,
    /** What the details panel is showing, as its heading says. */
    details: () => host.querySelector(".props-header")!.textContent,
    /** The flowchart as the file now has it. */
    saved: async () => loadWorkspace(await file.load()).views.get("returns")!,
  };
}

describe("adding a block where the diagram was right-clicked", () => {
  const lane = (id: string, number: number): Lane => ({ id, number, name: id, path: `views.returns.lanes[${number - 1}]` });
  const columns: LaneColumn[] = [
    { lane: lane("customer", 1), x: 0, w: 260 },
    { lane: lane("shop", 2), x: 260, w: 300 },
  ];

  it("puts its middle there, or in the nearest free spot", () => {
    // A process is 180 wide, and 52 tall with a line of text.
    expect(blockPlaceAt("process", { x: 500, y: 300 }, { occupied: [] })).toEqual({ at: [410, 274] });
    const moved = blockPlaceAt("process", { x: 500, y: 300 }, { occupied: [{ x: 410, y: 274 }] }).at;
    expect(moved).not.toEqual([410, 274]);
    expect(Math.hypot(moved[0] - 410, moved[1] - 274)).toBeLessThan(300);
  });

  it("puts it in the lane it lands in, its place from the inside of that lane's left", () => {
    expect(blockPlaceAt("process", { x: 400, y: 100 }, { columns, occupied: [] })).toEqual({ lane: "shop", at: [20, 74] });
    expect(blockPlaceAt("process", { x: 130, y: 100 }, { columns, occupied: [] })).toEqual({ lane: "customer", at: [10, 74] });
    // The column for blocks in no lane is no lane.
    expect(blockPlaceAt("process", { x: 130, y: 100 }, { columns: [{ x: 0, w: 260 }, { lane: lane("shop", 1), x: 260, w: 300 }], occupied: [] })).toEqual({ lane: undefined, at: [10, 74] });
  });

  it("keeps it in the lane that was clicked when the nearest free spot is over another", () => {
    // Its spot in the customer's lane is taken, so it goes beside it, further left than the lane starts.
    const beside = blockPlaceAt("process", { x: 130, y: 100 }, { columns, occupied: [{ x: 40, y: 74 }, { x: 40, y: 274 }, { x: 40, y: -126 }, { x: 340, y: 74 }] }, "customer");
    expect(beside.lane).toBe("customer");
    expect(beside.at[0]).toBeGreaterThanOrEqual(0);
    // Asked for a lane the flowchart doesn't have, it's in the lane it lands in.
    expect(blockPlaceAt("process", { x: 400, y: 100 }, { columns, occupied: [] }, "gone")).toEqual({ lane: "shop", at: [20, 74] });
  });
});

describe("the flows a flowchart can have", () => {
  const view = buildWorkspace(doc).views.get("returns")!;

  it("go from one block to another, and aren't ones it has already, with the same ends and text", () => {
    expect(canFlow(view, "refund", "asked")).toBe(true);
    expect(canFlow(view, "asked", "asked")).toBe(false);
    expect(canFlow(view, "asked", "in-time")).toBe(false);
    expect(canFlow(view, "asked", "in-time", "Again")).toBe(true);
    // The one from the decision to the refund says Yes, so another can say something else, or nothing.
    expect(canFlow(view, "in-time", "refund")).toBe(true);
    expect(canFlow(view, "in-time", "refund", "Yes")).toBe(false);
  });

  it("can be the flow that's being changed", () => {
    expect(canFlow(view, "in-time", "refund", "Yes", view.flows[1])).toBe(true);
    expect(canFlow(view, "in-time", "refund", "Yes", view.flows[2])).toBe(false);
  });
});

describe("what a right-click menu is for, once the edits made before the click have landed", () => {
  const was = buildWorkspace(doc).views.get("returns")!;
  /** The flowchart after these edits. */
  const after = (ops: Operation[], from: OpenArchDocument = doc) => buildWorkspace(applyOperations(buildWorkspace(from).doc, ops).doc).views.get("returns")!;
  const flow = (number: number, from: string, to: string, text?: string) => ({ kind: "flow", flow: expect.objectContaining({ number, from, to, text }) });

  it("is what was clicked, while it's there, or the diagram for the background", () => {
    expect(menuFor(was, was, { kind: "block", id: "refund" })).toEqual({ kind: "block", id: "refund" });
    expect(menuFor(was, was, { kind: "sticky", id: "note" })).toEqual({ kind: "sticky", id: "note" });
    expect(menuFor(was, was, { kind: "flow", number: 2 })).toEqual(flow(2, "in-time", "refund", "Yes"));
    expect(menuFor(was, was, null)).toEqual({ kind: "diagram" });
    const lanes = buildWorkspace(laned).views.get("returns")!;
    expect(menuFor(lanes, lanes, { kind: "lane", id: "shop" })).toEqual({ kind: "lane", id: "shop" });
    // Whatever else changed, a block that's there under its ID is that block.
    expect(menuFor(was, after([{ op: "remove-block", view: "returns", id: "asked" }, { op: "update-block", view: "returns", id: "refund", position: 1 }]), { kind: "block", id: "refund" })).toEqual({ kind: "block", id: "refund" });
  });

  it("follows a block or a lane given a new ID, when nothing else came or went", () => {
    const renamed = after([{ op: "update-block", view: "returns", id: "say-no", text: "Turn it down", newId: "turn-it-down" }]);
    expect(menuFor(was, renamed, { kind: "block", id: "say-no" })).toEqual({ kind: "block", id: "turn-it-down" });
    expect(menuFor(was, renamed, { kind: "block", id: "refund" })).toEqual({ kind: "block", id: "refund" });
    const lanes = buildWorkspace(laned).views.get("returns")!;
    const staff = after([{ op: "update-lane", view: "returns", id: "shop", name: "Shop staff", newId: "shop-staff" }], laned);
    expect(menuFor(lanes, staff, { kind: "lane", id: "shop" })).toEqual({ kind: "lane", id: "shop-staff" });
  });

  it("is nothing when what was clicked is gone, or there's no telling which it is now", () => {
    expect(menuFor(was, after([{ op: "remove-block", view: "returns", id: "say-no" }]), { kind: "block", id: "say-no" })).toBeNull();
    expect(menuFor(was, after([{ op: "remove-sticky", view: "returns", id: "note" }]), { kind: "sticky", id: "note" })).toBeNull();
    expect(menuFor(was, after([{ op: "remove-flow", view: "returns", flow: 2 }]), { kind: "flow", number: 2 })).toBeNull();
    // A block went and another came, but not in its place: they aren't taken for the same block.
    const replaced = after([
      { op: "remove-block", view: "returns", id: "say-no" },
      { op: "add-block", view: "returns", id: "escalate", text: "Escalate" },
    ]);
    expect(menuFor(was, replaced, { kind: "block", id: "say-no" })).toBeNull();
    // A new ID and a new block at once: it could be either.
    const both = after([
      { op: "update-block", view: "returns", id: "say-no", newId: "turn-it-down" },
      { op: "add-block", view: "returns", id: "escalate", text: "Escalate" },
    ]);
    expect(menuFor(was, both, { kind: "block", id: "say-no" })).toBeNull();
    const lanes = buildWorkspace(laned).views.get("returns")!;
    expect(menuFor(lanes, after([{ op: "remove-lane", view: "returns", id: "shop" }], laned), { kind: "lane", id: "shop" })).toBeNull();
    // What's selected on another kind of view has no menu here.
    expect(menuFor(was, was, { kind: "element", id: "shop" })).toBeNull();
  });

  it("follows a flow to its new number, through new text, and through a block's new ID", () => {
    const moved = after([{ op: "update-flow", view: "returns", flow: 2, newFlow: 4 }]);
    expect(menuFor(was, moved, { kind: "flow", number: 2 })).toEqual(flow(4, "in-time", "refund", "Yes"));
    // The flow that took its number isn't it.
    expect(menuFor(was, moved, { kind: "flow", number: 3 })).toEqual(flow(2, "in-time", "say-no", "No"));
    expect(menuFor(was, after([{ op: "remove-flow", view: "returns", flow: 1 }]), { kind: "flow", number: 2 })).toEqual(flow(1, "in-time", "refund", "Yes"));
    // Its own text or ends changed, and no other flow did: it's the one in its place.
    expect(menuFor(was, after([{ op: "update-flow", view: "returns", flow: 2, text: "Sure" }]), { kind: "flow", number: 2 })).toEqual(flow(2, "in-time", "refund", "Sure"));
    expect(menuFor(was, after([{ op: "update-flow", view: "returns", flow: 4, to: "asked" }]), { kind: "flow", number: 4 })).toEqual(flow(4, "refund", "asked"));
    // Every flow of a block given a new ID has a new end, and each is still told from the others.
    const renamed = after([{ op: "update-block", view: "returns", id: "in-time", newId: "on-time" }]);
    expect(menuFor(was, renamed, { kind: "flow", number: 2 })).toEqual(flow(2, "on-time", "refund", "Yes"));
    expect(menuFor(was, renamed, { kind: "flow", number: 3 })).toEqual(flow(3, "on-time", "say-no", "No"));
    // Its text changed and another flow went: there's no telling which it is.
    expect(
      menuFor(
        was,
        after([
          { op: "update-flow", view: "returns", flow: 2, text: "Sure" },
          { op: "remove-flow", view: "returns", flow: 4 },
        ]),
        { kind: "flow", number: 2 },
      ),
    ).toBeNull();
    expect(menuFor(was, was, { kind: "flow", number: 9 })).toBeNull();
  });
});

describe("a block's right-click menu", () => {
  it("selects the block, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("in-time")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Decision");
    // The flowchart has no lanes to move it to.
    expect(d.labels()).toEqual(["Add after", "Add flow to", "Change kind", "Lay out again", "Delete block"]);
  });

  it("adds a block after it, with a flow to it, and selects it to give it text", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    await d.pick("Add after");
    expect(d.labels()).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database"]);
    await d.pick("Decision");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.id)).toEqual(["asked", "in-time", "refund", "new-decision", "say-no", "done"]);
    expect(view.flows.at(-1)).toMatchObject({ from: "refund", to: "new-decision" });
    expect(d.details()).toBe("Decision");
    expect(document.activeElement).toBe(d.host.querySelector('textarea[aria-label="Text"]'));
    expect(d.menuOpen()).toBe(false);
  });

  it("adds a flow to a block it has none to yet, and selects the flow", async () => {
    const d = await designer();
    await d.rightClick(d.node("asked")!);
    await d.pick("Add flow to");
    // Not to itself, or to the decision, which it flows to already.
    expect(d.labels()).toEqual(["Refund the card", "Say no", "Done"]);
    await d.pick("Done");
    expect((await d.saved()).flows.at(-1)).toMatchObject({ number: 5, from: "asked", to: "done" });
    expect(d.details()).toBe("Flow 5of 5");
  });

  it("changes its kind, lays it out again and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("asked")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(["Process", "End", "Decision", "Input or output", "Subprocess", "Document", "Database"]);
    await d.pick("Document");
    expect((await d.saved()).blocks[0]).toMatchObject({ id: "asked", kind: "document", at: [0, 0] });

    await d.rightClick(d.node("asked")!);
    await d.pick("Lay out again");
    expect((await d.saved()).blocks[0]!.at).toBeUndefined();
    // The designer places it now, so there's nothing to lay out again.
    await d.rightClick(d.node("asked")!);
    expect(d.labels()).not.toContain("Lay out again");

    await d.pick("Delete block");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.id)).toEqual(["in-time", "refund", "say-no", "done"]);
    expect(view.flows.map((f) => f.from)).not.toContain("asked");
    expect(d.details()).toBe("View");
  });

  it("moves it to another lane, or out of its lane, and lays it out again there", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "No lane"]);
    await d.pick("Customer");
    const moved = (await d.saved()).blocks.find((b) => b.id === "refund")!;
    expect(moved.lane).toBe("customer");
    expect(moved.at).toBeUndefined();

    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane", "No lane");
    expect((await d.saved()).blocks.find((b) => b.id === "refund")!.lane).toBeUndefined();
    // In no lane, it has none to leave.
    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "Shop"]);
  });
});

describe("a flow's right-click menu", () => {
  it("selects the flow, from its line or its text, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.flow(2)!);
    expect(d.details()).toBe("Flow 2of 4");
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to flow 1", "Move down, to flow 3", "Delete flow"]);
    await key(document.activeElement!, "Escape");
    expect(d.menuOpen()).toBe(false);

    const text = [...d.host.querySelectorAll(".arrow-label")].find((l) => l.textContent === "No")!;
    await d.rightClick(text);
    expect(d.details()).toBe("Flow 3of 4");
    expect(d.labels()).toContain("Delete flow");
  });

  it("has no way up for the first flow, or down for the last", async () => {
    const d = await designer();
    await d.rightClick(d.flow(1)!);
    expect(d.labels()).toEqual(["Change from", "Change to", "Move down, to flow 2", "Delete flow"]);
    await d.rightClick(d.flow(4)!);
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to flow 3", "Delete flow"]);
  });

  it("moves either end to another block, but not to make a flow the flowchart has already", async () => {
    const d = await designer();
    // Not to the decision it comes from, or to the refund, where it goes already.
    await d.rightClick(d.flow(2)!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Return asked for", "Say no", "Done"]);
    await d.pick("Done");
    expect((await d.saved()).flows[1]).toMatchObject({ from: "in-time", to: "done", text: "Yes" });
    expect(d.details()).toBe("Flow 2of 4");

    await d.rightClick(d.flow(1)!);
    await d.pick("Change from");
    expect(d.labels()).toEqual(["Refund the card", "Say no", "Done"]);
    await d.pick("Refund the card");
    expect((await d.saved()).flows[0]).toMatchObject({ from: "refund", to: "in-time" });

    // The refund now flows to the decision with no text, so its flow to Done can't go there too.
    await d.rightClick(d.flow(4)!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Return asked for", "Say no"]);
  });

  it("moves it up or down the list, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.flow(2)!);
    await d.pick("Move down, to flow 3");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "No", "Yes", undefined]);
    expect(d.details()).toBe("Flow 3of 4");

    await d.rightClick(d.flow(3)!);
    await d.pick("Delete flow");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "No", undefined]);
    expect(d.details()).toBe("View");
  });
});

describe("a lane's right-click menu", () => {
  it("selects the lane, and lists what can be done with it", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    expect(d.details()).toBe("Lane 1of 2");
    expect(d.labels()).toEqual(["Add", "Move right", "Delete lane"]);
    await d.rightClick(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    expect(d.labels()).toEqual(["Add", "Move left", "Delete lane"]);
  });

  it("adds a block where it was clicked, in that lane, on its own", async () => {
    const d = await designer(laned);
    // A spot in the shop's lane with nothing near it.
    await d.rightClick(d.node("lane:shop")!, { x: 700, y: 300 });
    await d.pick("Add");
    expect(d.labels()).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database", "Lane", "Sticky note"]);
    await d.pick("Process");
    const view = await d.saved();
    // Its middle is where the click was: 700 less half its width, from the inside of the lane's left, at 290.
    expect(view.blocks.at(-1)).toMatchObject({ id: "new-process", lane: "shop", at: [320, 274] });
    expect(view.flows).toHaveLength(4);
    expect(d.details()).toBe("Process");
  });

  it("adds a lane after it, and a sticky note where it was clicked", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "new-lane", "shop"]);

    await d.rightClick(d.node("lane:shop")!, { x: 900, y: 1200 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [900 - STICKY.width / 2, 1150] });
    // Its text is being typed, in place.
    expect(document.activeElement).toBe(d.host.querySelector(".sticky textarea"));
  });

  it("moves it left or right, and deletes it, leaving its blocks in no lane", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move right");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["shop", "customer"]);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move left");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop"]);

    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Delete lane");
    const view = await d.saved();
    expect(view.lanes.map((l) => l.id)).toEqual(["shop"]);
    expect(view.blocks.filter((b) => b.lane === undefined).map((b) => b.id)).toEqual(["asked", "done"]);
    expect(d.details()).toBe("View");
  });

  it("is the diagram's on the column for blocks in no lane", async () => {
    const loose = structuredClone(laned);
    delete loose.views.returns!.blocks![3]!.lane;
    const d = await designer(loose);
    await d.rightClick(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    await d.rightClick(d.node("lane:")!);
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });
});

describe("a sticky note's right-click menu on a flowchart", () => {
  it("selects the note, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
  });

  it("edits its text in place, where a right-click is left to the browser, to paste", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
  });

  it("changes its colour, opens its notes, moves it back beside the diagram and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Colour");
    expect(d.labels()).toEqual(["Pink", "Blue", "Green"]);
    await d.pick("Blue");
    expect((await d.saved()).stickies[0]!.color).toBe("blue");

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit notes…");
    const editor = d.host.querySelector("dialog.notes-editor")!;
    expect(editor.querySelector("h2")!.textContent).toContain("Read me");
    await click(button(editor as HTMLElement, "Cancel"));

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Move beside the diagram");
    expect((await d.saved()).stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.labels()).not.toContain("Move beside the diagram");

    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of a flowchart's background", () => {
  it("selects nothing, and has what the toolbar has", async () => {
    const d = await designer();
    await click(d.node("refund")!);
    expect(d.details()).toBe("Process");
    const event = await d.rightClick(d.pane());
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…", "Save as PNG…"]));
  });

  it("is the menu for the frame too, which takes no clicks", async () => {
    const scoped = structuredClone(doc);
    scoped.views.returns!.scope = "shop";
    const d = await designer(scoped);
    const frame = d.node("__frame") as HTMLElement;
    expect(frame.querySelector(".frame-label")!.textContent).toContain("Shop");
    // A right-click on it lands on the background behind it.
    expect(frame.style.pointerEvents).toBe("none");
    await d.rightClick(d.pane());
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("adds a block where it was clicked, on its own, and selects it to give it text", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    await d.pick("Add", "Decision");
    const view = await d.saved();
    // A decision is 220 wide and 100 tall, and its middle is where the click was.
    expect(view.blocks.at(-1)).toMatchObject({ id: "new-decision", kind: "decision", at: [1390, 550] });
    expect(view.blocks.at(-1)!.lane).toBeUndefined();
    expect(view.flows).toHaveLength(4);
    expect(d.details()).toBe("Decision");
    expect(document.activeElement).toBe(d.host.querySelector('textarea[aria-label="Text"]'));
  });

  it("adds a block in the lane it lands in, a lane at the right, and a sticky note where it was clicked", async () => {
    const d = await designer(laned);
    // Right of the lanes, level with nothing: the shop's lane, from 260, is the nearest.
    await d.rightClick(d.pane(), { x: 1500, y: 300 });
    await d.pick("Add", "Process");
    expect((await d.saved()).blocks.at(-1)).toMatchObject({ id: "new-process", lane: "shop", at: [1120, 274] });

    await d.rightClick(d.pane());
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop", "new-lane"]);

    await d.rightClick(d.pane(), { x: 3000, y: 1200 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1150] });
  });

  it("lays the flowchart out again, and has no Auto layout when there's nothing to lay out", async () => {
    const d = await designer();
    await d.rightClick(d.pane());
    await d.pick("Auto layout");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.at)).not.toEqual(doc.views.returns!.blocks!.map((b) => b.at));
    // The note goes back beside the diagram.
    expect(view.stickies[0]!.at).toBeUndefined();

    const empty = structuredClone(doc);
    empty.views.returns = { title: "Returns", level: "flowchart" };
    const none = await designer(empty);
    await none.rightClick(none.pane());
    expect(none.labels()).toEqual(["Add", "Export"]);
  });
});

describe("a flowchart's right-click menu, opened with the keyboard", () => {
  /** Says where this is on the screen, as the page here has no layout: its left edge and its bottom. */
  const put = (target: Element, left: number, bottom: number) => {
    target.getBoundingClientRect = () => ({ left, bottom, top: bottom - 100, right: left + 200, x: left, y: bottom - 100, width: 200, height: 100, toJSON() {} }) as DOMRect;
  };

  it("opens under what it's for, which it selects", async () => {
    const d = await designer();
    put(d.node("refund")!, 300, 420);
    await d.menuKey(d.node("refund")!);
    expect(d.details()).toBe("Process");
    expect(d.labels()).toContain("Delete block");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);

    put(d.flow(2)!, 520, 260);
    await key(document.activeElement!, "Escape");
    await d.menuKey(d.flow(2)!);
    expect(d.details()).toBe("Flow 2of 4");
    const flowMenu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([flowMenu.style.left, flowMenu.style.top]).toEqual(["520px", "260px"]);
  });

  it("adds from a lane's menu at the point it opened at, under the lane", async () => {
    const d = await designer(laned);
    // The lane's bottom left corner is at this point on the diagram, with nothing near it.
    const corner = d.onScreen({ x: 900, y: 1200 });
    put(d.node("lane:shop")!, corner.clientX, corner.clientY);
    await d.menuKey(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [900 - STICKY.width / 2, 1150] });
  });
});

describe("a flowchart's right-click menu, as the flowchart changes under it", () => {
  /** Types into a text area and leaves it, which saves it. */
  const write = async (box: HTMLTextAreaElement, text: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, text);
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  };
  /** The flowchart in a file whose saves wait, with this block selected and new text typed for it: the save that gives it a new ID is on its way. */
  const renaming = async (id: string, text: string) => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node(id)!);
    file.hold = true;
    await write(d.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!, text);
    return { d, file };
  };
  const text = (d: Awaited<ReturnType<typeof designer>>) => d.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!.value;

  it("waits for a slow save, then opens on the block under the new ID its text gave it", async () => {
    // Its ID follows its text, and the save that renames it hasn't landed when it's right-clicked.
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("say-no")!);
    // No menu yet: an item picked now would name an ID that's about to change.
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("say-no")).toBeNull();
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.labels()).toContain("Delete block");
    expect(text(d)).toBe("Turn it down");
    await d.pick("Delete block");
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "refund", "done"]);
  });

  it("is for the block that was right-clicked, not one whose new ID lands meanwhile and selects it", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    // The save selected the renamed block as it landed; the menu's block is selected again.
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.menuOpen()).toBe(true);
    expect(text(d)).toBe("Refund the card");
    await d.pick("Delete block");
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "turn-it-down", "done"]);
  });

  it("doesn't open when what was right-clicked is gone once the edits before it have landed", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("refund")!);
    file.hold = true;
    await click(button(d.host, "Delete block"));
    // Still drawn, as its delete hasn't landed.
    await d.rightClick(d.node("refund")!);
    file.release();
    await d.settle();
    expect(d.node("refund")).toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("is called off by a press while it waits", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    await act(async () => {
      d.pane().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    });
    file.release();
    await d.settle();
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("opens only the last one asked for", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    await d.rightClick(d.flow(1)!);
    file.release();
    await d.settle();
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    expect(d.details()).toBe("Flow 1of 4");
    expect(d.labels()).toContain("Delete flow");
  });

  it("closes when what it's for is gone", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    await d.pick("Add", "Process");
    await d.rightClick(d.node("new-process")!);
    expect(d.menuOpen()).toBe(true);
    // As when the file changes outside the designer: Undo takes the block away under the menu.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.node("new-process")).toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("closes when a flow's number goes to another flow", async () => {
    const d = await designer();
    await d.rightClick(d.flow(2)!);
    await d.pick("Move down, to flow 3");
    await d.rightClick(d.flow(3)!);
    expect(d.labels()).toContain("Delete flow");
    // Undo puts it back at 2 under the menu, so flow 3 is another flow now.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "Yes", "No", undefined]);
    expect(d.menuOpen()).toBe(false);
  });

  it("closes when something else is selected", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    expect(d.menuOpen()).toBe(true);
    // Selected without a press, which would have closed the menu itself.
    await click(d.node("asked")!);
    expect(d.details()).toBe("Start");
    expect(d.menuOpen()).toBe(false);
    // The background's menu is for nothing that's selected, so it stays.
    await d.rightClick(d.pane());
    await click(d.node("asked")!);
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });
});
