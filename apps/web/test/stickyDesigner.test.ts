// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, choose, click, key, mount, select } from "./dom.js";

/**
 * React Flow draws arrows once it has measured the boxes, and this page has no layout. So, as in
 * frameMeasured.test.ts, a stand-in ResizeObserver keeps what it's asked to watch, and when the
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

const doc: OpenArchDocument = {
  openarch: 17,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
  },
  views: { containers: { title: "Containers", level: "container", scope: "shop", layout: { customer: [0, 0], web: [0, 300], api: [500, 300] } } },
};

/** The whole designer, open on the container view, with its boxes measured. */
async function designer(model = doc) {
  const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(model)), onClose() {}, onHostChange() {} }));
  /** Lets the edits and the drawing settle, with every box measured. */
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
  /** Right-clicks this, and picks Add sticky note from the menu it opens. */
  const addNoteFrom = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    const item = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Add sticky note");
    if (!item) throw new Error("The menu has no Add sticky note.");
    await click(item);
    await settle();
  };
  /** Where a point on the diagram is on the screen. The canvas is at the page's top left, as nothing here has a size. */
  const onScreen = (at: { x: number; y: number }) => {
    const transform = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [x, y, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform)!.slice(1).map(Number) as [number, number, number];
    return { clientX: at.x * zoom + x, clientY: at.y * zoom + y };
  };
  /** Drags a note's dot to this point on the diagram, and lets go. */
  const dragDot = async (id: string, to: { x: number; y: number }) => {
    const grip = host.querySelector(`.react-flow__node[data-id="sticky:${id}"] .sticky-grip`);
    if (!grip) throw new Error(`Note ${id} has no dot to drag.`);
    const start = { clientX: 0, clientY: 0 };
    for (const [type, at] of [["pointerdown", start], ["pointermove", onScreen(to)], ["pointerup", onScreen(to)]] as const) {
      await act(async () => {
        grip.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, ...at }));
      });
    }
    await settle();
  };
  return {
    host,
    addNoteFrom,
    dragDot,
    node: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`),
    lines: () => host.querySelectorAll(".sticky-lines line").length,
    /** Stops editing a note in place, keeping its text. */
    stopEditing: async () => {
      await key(host.querySelector(".sticky textarea")!, "Escape");
      await settle();
    },
  };
}

describe("putting a sticky note on something in the designer", () => {
  it("adds one from a box's, an arrow's and the frame's menus, edited in place, with a line to it", async () => {
    const d = await designer();
    expect(d.lines()).toBe(0);

    await d.addNoteFrom(d.node("web")!);
    const note = d.node("sticky:note")!;
    expect(note.querySelector("textarea")).not.toBeNull();
    expect(document.activeElement).toBe(note.querySelector("textarea"));
    expect(select(d.host, "On").value).toBe("element:web");
    await d.stopEditing();
    expect(d.lines()).toBe(1);

    const arrow = d.host.querySelector('.react-flow__edge[data-id="web->api"]');
    expect(arrow).not.toBeNull();
    await d.addNoteFrom(arrow!);
    expect(d.node("sticky:note-2")!.querySelector("textarea")).not.toBeNull();
    expect(select(d.host, "On").value).toBe("relationship:web\u0000api\u0000association");
    await d.stopEditing();
    expect(d.lines()).toBe(2);

    // The frame is the view's scope, which the model tree lists.
    const shop = [...d.host.querySelectorAll(".sidebar .row")].find((r) => r.textContent?.includes("Shop") && !r.textContent.includes("Customer"))!;
    await d.addNoteFrom(shop);
    expect(d.node("sticky:note-3")!.querySelector("textarea")).not.toBeNull();
    expect(select(d.host, "On").value).toBe("element:shop");
    await d.stopEditing();
    expect(d.lines()).toBe(3);
  });

  it("takes the line away with the note's choice of nothing", async () => {
    const d = await designer();
    await d.addNoteFrom(d.node("customer")!);
    await d.stopEditing();
    expect(d.lines()).toBe(1);
    await choose(select(d.host, "On"), "");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    expect(d.lines()).toBe(0);
    expect(d.node("sticky:note")).not.toBeNull();
  });
});

describe("dragging from a note's dot", () => {
  // A note on nothing, placed beside the diagram, as it hasn't been moved.
  const withNote = structuredClone(doc);
  withNote.views.containers!.stickies = { loose: { text: "Look here" } };
  /** Where a note is drawn on the diagram. */
  const at = (note: Element) => /translate\(([-\d.]+)px, ?([-\d.]+)px\)/.exec((note as HTMLElement).style.transform)!.slice(1).map(Number);
  /** The middle of the first run of an arrow's line, on the diagram. */
  const alongArrow = (arrow: Element) => {
    const [x1, y1, x2, y2] = /^M ?([-\d.]+)[ ,]([-\d.]+) ?L ?([-\d.]+)[ ,]([-\d.]+)/.exec(arrow.querySelector(".react-flow__edge-path")!.getAttribute("d")!)!.slice(1).map(Number) as [number, number, number, number];
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  };

  it("puts the note on the box it's let go on, keeps the note where it is, and selects it", async () => {
    const d = await designer(withNote);
    const before = at(d.node("sticky:loose")!);
    // API's box is at 500, 300, and 200 by 100.
    await d.dragDot("loose", { x: 600, y: 350 });
    expect(select(d.host, "On").value).toBe("element:api");
    expect(d.lines()).toBe(1);
    // It's kept where it was put, rather than beside the API.
    expect(at(d.node("sticky:loose")!)).toEqual(before);
    expect(button(d.host, "Move next to what it's on")).toBeDefined();
  });

  it("puts the note on the arrow it's let go on", async () => {
    const d = await designer(withNote);
    await d.dragDot("loose", alongArrow(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!));
    expect(select(d.host, "On").value).toBe("relationship:web\u0000api\u0000association");
    expect(d.lines()).toBe(1);
  });

  it("only selects a note let go on what it's on, and keeps where one was put", async () => {
    const placed = structuredClone(doc);
    placed.views.containers!.stickies = { placed: { text: "Look here", on: { element: "api" }, at: [700, 0] } };
    const d = await designer(placed);
    expect(button(d.host, "Undo").disabled).toBe(true);
    await d.dragDot("placed", { x: 600, y: 350 });
    expect(select(d.host, "On").value).toBe("element:api");
    expect(button(d.host, "Undo").disabled).toBe(true);
    // Customer's box is at 0, 0.
    await d.dragDot("placed", { x: 100, y: 50 });
    expect(select(d.host, "On").value).toBe("element:customer");
    expect(at(d.node("sticky:placed")!)).toEqual([700, 0]);
    expect(button(d.host, "Undo").disabled).toBe(false);
  });

  it("leaves the note as it was when it's let go on nothing", async () => {
    const d = await designer(withNote);
    await d.dragDot("loose", { x: -2000, y: -2000 });
    expect(d.lines()).toBe(0);
    await click(d.node("sticky:loose")!);
    expect(select(d.host, "On").value).toBe("");
    expect(d.host.textContent).not.toContain("Move beside the diagram");
  });
});
