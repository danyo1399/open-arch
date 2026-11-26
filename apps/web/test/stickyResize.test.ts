// @vitest-environment happy-dom
import { buildWorkspace, computeView, serializeDocument, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { WhiteboardDiagram } from "../src/canvas/WhiteboardDiagram.js";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { SNAP_DEFAULTS, type SnapSettings } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, click, menusFor, mount } from "./dom.js";

/**
 * React Flow resizes nodes only once it has measured them, and this page has no layout. So, as in
 * whiteboardMove.test.ts, a stand-in ResizeObserver keeps what it's asked to watch, and when the
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

/** Lets the edits and the drawing settle, with every node measured. */
async function settle() {
  for (let i = 0; i < 3; i++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    await act(async () => {
      for (const o of observers) {
        const entries = [...o.watching].map((target) => ({ target, contentRect: { x: 0, y: 0, ...size(target as HTMLElement) } }) as ResizeObserverEntry);
        if (entries.length) o.callback(entries, o as unknown as ResizeObserver);
      }
    });
  }
}

const mouse = (target: EventTarget, type: string, p: { clientX: number; clientY: number }) =>
  act(async () => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, ...p })));

/** How the diagram is scaled on the screen. */
function zoomOf(host: HTMLElement): number {
  const transform = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
  return Number(/scale\(([-\d.]+)\)/.exec(transform)![1]);
}

/** Drags a selected node's grip, at one of its corners, by this far on the diagram, and lets go. */
async function resize(host: HTMLElement, id: string, corner: "top left" | "bottom right", dx: number, dy: number) {
  const zoom = zoomOf(host);
  const grip = host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .react-flow__resize-control.handle.${corner.replace(" ", ".")}`);
  if (!grip) throw new Error(`${id} has no grip at its ${corner}.`);
  const start = { clientX: 500, clientY: 400 };
  const end = { clientX: start.clientX + dx * zoom, clientY: start.clientY + dy * zoom };
  await mouse(grip, "mousedown", start);
  await mouse(document.body, "mousemove", end);
  await mouse(document.body, "mouseup", end);
  await settle();
}

const at = (host: HTMLElement, id: string) =>
  /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/.exec(host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!.style.transform)!.slice(1).map((v) => Math.round(Number(v)));
/** How big a note is drawn: its width and the height it's at least. */
const drawn = (host: HTMLElement, id: string) => {
  const style = host.querySelector<HTMLElement>(`.react-flow__node[data-id="sticky:${id}"] .sticky`)!.style;
  return [style.width, style.minHeight];
};

const doc: OpenArchDocument = {
  openarch: 22,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
  },
  views: {
    containers: {
      title: "Containers",
      level: "container",
      scope: "shop",
      layout: { web: [0, 0], api: [0, 300] },
      stickies: { look: { text: "Look here", at: [600, 0] }, big: { text: "Big", at: [600, 300], size: [320, 140] }, beside: { text: "Beside", on: { element: "api" } } },
    },
  },
};

/** The whole designer, open on the first view, and the file it saves to. */
async function designer(model = doc) {
  const file = new MemoryHost("shop.openarch", serializeDocument(model));
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  await settle();
  const saved = async () => {
    await click(button(host, "Save"));
    return JSON.parse(await file.load()) as OpenArchDocument;
  };
  return { host, saved };
}

describe("resizing a sticky note in the designer", () => {
  it("draws a note at its size, and the rest at the usual size", async () => {
    const { host } = await designer();
    expect(drawn(host, "big")).toEqual(["320px", "140px"]);
    expect(drawn(host, "look")).toEqual(["", ""]);
  });

  it("shows the selected note's grips, and saves the size it's dragged to", async () => {
    const { host, saved } = await designer();
    expect(host.querySelector('.react-flow__node[data-id="sticky:look"] .react-flow__resize-control')).toBeNull();
    await click(host.querySelector('.react-flow__node[data-id="sticky:look"]')!);
    // It's measured 200 by 100 here.
    await resize(host, "sticky:look", "bottom right", 60, 40);
    // The diagram is scaled to fit, so the pointer's move on the screen comes back to within a pixel.
    const [w, h] = drawn(host, "look").map((v) => Math.round(parseFloat(v!))) as [number, number];
    expect([Math.abs(w - 260) <= 1, Math.abs(h - 140) <= 1]).toEqual([true, true]);
    expect((await saved()).views.containers!.stickies!.look).toEqual({ text: "Look here", at: [600, 0], size: [w, h] });
  });

  it("moves the corner a top left grip is dragged by, and keeps the far edges where they were", async () => {
    const { host, saved } = await designer();
    await click(host.querySelector('.react-flow__node[data-id="sticky:big"]')!);
    // It's measured 200 by 100 here, though it's drawn bigger.
    await resize(host, "sticky:big", "top left", -40, -20);
    expect(at(host, "sticky:big")).toEqual([560, 280]);
    expect((await saved()).views.containers!.stickies!.big).toEqual({ text: "Big", at: [560, 280], size: [240, 120] });
  });

  it("leaves a note the designer placed beside what it's on when its right or bottom edge is dragged, and saves where one dragged by its corner goes", async () => {
    const { host, saved } = await designer();
    const before = at(host, "sticky:beside");
    await click(host.querySelector('.react-flow__node[data-id="sticky:beside"]')!);
    await resize(host, "sticky:beside", "bottom right", 60, 40);
    const note = (await saved()).views.containers!.stickies!.beside!;
    expect(note).not.toHaveProperty("at");
    expect(note.on).toEqual({ element: "api" });
    expect(note.size).toBeDefined();

    await resize(host, "sticky:beside", "top left", -40, -20);
    expect((await saved()).views.containers!.stickies!.beside!.at).toEqual([before[0]! - 40, before[1]! - 20]);
  });

  it("gives a resized note the usual size back from its details and its menu", async () => {
    const { host, saved } = await designer();
    await click(host.querySelector('.react-flow__node[data-id="sticky:big"]')!);
    await click(button(host, "Usual size"));
    await settle();
    expect(drawn(host, "big")).toEqual(["", ""]);
    expect((await saved()).views.containers!.stickies!.big).toEqual({ text: "Big", at: [600, 300] });
    expect(() => button(host, "Usual size")).toThrow();

    await resize(host, "sticky:big", "bottom right", 100, 0);
    await act(async () => {
      host.querySelector('.react-flow__node[data-id="sticky:big"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    const item = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Usual size");
    expect(item).toBeDefined();
    await click(item!);
    await settle();
    expect((await saved()).views.containers!.stickies!.big).toEqual({ text: "Big", at: [600, 300] });
  });
});

describe("resizing a sticky note on a whiteboard", () => {
  const board: OpenArchDocument = {
    openarch: 22,
    name: "Shop",
    elements: {},
    views: { ideas: { title: "Ideas", level: "whiteboard", shapes: [
          { id: "db", kind: "ellipse", text: "DB", at: [600, 600, 200, 100] },
          { id: "tick", kind: "rectangle", text: "Tick", at: [56, 400, 200, 100] },
        ], stickies: { idea: { text: "Idea", at: [0, 0] } } } },
  };

  /** The whiteboard with its note selected, and the edits it makes. */
  async function whiteboard(snap: SnapSettings) {
    const ws = buildWorkspace(board);
    const edits: Operation[][] = [];
    const host = mount(
      createElement(
        ReactFlowProvider,
        null,
        createElement(WhiteboardDiagram, {
          computed: computeView(ws, ws.views.get("ideas")!),
          selection: { kind: "sticky", id: "idea" } as Selection,
          onSelect() {},
          edit: async (e: Edit) => {
            edits.push(typeof e === "function" ? e(ws) : e);
            return true;
          },
          menus: menusFor("ideas"),
          exportItems: [],
          snap: { settings: snap, set() {} },
        }),
      ),
    );
    await settle();
    return { host, edits };
  }

  it("lines the edge being dragged up with a shape's, and saves the note as it's drawn", async () => {
    const { host, edits } = await whiteboard({ ...SNAP_DEFAULTS, guides: true, grid: false });
    // Its right edge goes to 597, 3 short of DB's left edge.
    await resize(host, "sticky:idea", "bottom right", 397, 2);
    expect(edits).toEqual([[{ op: "update-sticky", view: "ideas", id: "idea", at: [0, 0], size: [600, 102] }]]);
  });

  it("isn't made smaller than a note can be to line up with a shape, as a shape can", async () => {
    const { host, edits } = await whiteboard({ ...SNAP_DEFAULTS, guides: true, grid: false });
    // Its resizer stops at 60 across, and Tick's left edge, at 56, is within reach.
    await resize(host, "sticky:idea", "bottom right", -150, 0);
    expect(edits).toEqual([[{ op: "update-sticky", view: "ideas", id: "idea", at: [0, 0], size: [60, 100] }]]);
  });
});

describe("resizing a sticky note on the other kinds of view", () => {
  // The shop example has a view of each kind. Each gets a note, placed well away from the rest.
  const shop = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../examples/shop/shop.openarch"), "utf8")) as OpenArchDocument;
  const kinds = { "order-states": "state", production: "deployment", "order-events": "event", "checkout-screens": "wireframe", "checking-out": "flowchart", "orders-data": "entity" };

  it.each(Object.entries(kinds))("resizes one on the %s view, a %s view, and saves its size", async (id) => {
    const model = structuredClone(shop);
    model.views = { [id]: { ...model.views[id]!, stickies: { tip: { text: "Tip", at: [3000, 0] } } } };
    const { host, saved } = await designer(model);
    // Nothing to line up with, so it's as big as it's dragged.
    await click(host.querySelector('[aria-label="Line up with other boxes"]')!);
    await click(host.querySelector('.react-flow__node[data-id="sticky:tip"]')!);
    await resize(host, "sticky:tip", "bottom right", 60, 40);
    // These views are scaled down to fit, so the pointer's move on the screen comes back to within a pixel of the screen.
    const [w, h] = drawn(host, "tip").map((v) => Math.round(parseFloat(v!))) as [number, number];
    const near = 1 / zoomOf(host) + 1;
    expect([Math.abs(w - 260) <= near, Math.abs(h - 140) <= near]).toEqual([true, true]);
    expect((await saved()).views[id]!.stickies!.tip).toEqual({ text: "Tip", at: [3000, 0], size: [w, h] });
  });
});
