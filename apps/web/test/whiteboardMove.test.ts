// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { WhiteboardDiagram } from "../src/canvas/WhiteboardDiagram.js";
import { SNAP_DEFAULTS, type SnapSettings } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { mount } from "./dom.js";

/**
 * React Flow drags nodes only once it has measured them, and this page has no layout. So, as in
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

const shop: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {},
  views: {
    ideas: {
      title: "Ideas",
      level: "whiteboard",
      shapes: [
        { id: "cache", kind: "rectangle", text: "Cache", at: [0, 0, 200, 100] },
        { id: "db", kind: "ellipse", text: "DB", at: [600, 600, 200, 100] },
      ],
      arrows: [],
    },
  },
};

/**
 * The whiteboard, its shapes measured, with edits that are saved or refused as `saves` says. Nothing
 * snaps, so a shape goes exactly where it's dragged, unless `snap` says it does.
 */
async function board(saves: boolean, snap: SnapSettings = { ...SNAP_DEFAULTS, guides: false, grid: false }) {
  const ws = buildWorkspace(shop);
  const edits: Operation[][] = [];
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(WhiteboardDiagram, {
        computed: computeView(ws, ws.views.get("ideas")!),
        selection: { kind: "shape", id: "cache" } as Selection,
        onSelect() {},
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return saves;
        },
        exportItems: [],
        snap: { settings: snap, set() {} },
      }),
    ),
  );
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
  const at = (id: string) => /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/.exec(node(id).style.transform)!.slice(1).map((v) => Math.round(Number(v)));
  /** How the board is moved and scaled on the screen. */
  const zoom_ = () => {
    const viewport = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    return /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(viewport)!.slice(1).map(Number) as [number, number, number];
  };
  const mouse = (target: EventTarget, type: string, p: { clientX: number; clientY: number }, { alt = false } = {}) =>
    act(async () => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, altKey: alt, ...p })));
  /** Drags a shape by this far on the screen, which is the board's scale, as nothing here zooms. */
  const drag = async (id: string, dx: number, dy: number) => {
    const [x0, y0, zoom] = zoom_();
    const [x, y] = at(id) as [number, number];
    const start = { clientX: (x + 100) * zoom + x0, clientY: (y + 50) * zoom + y0 };
    await mouse(node(id), "mousedown", start);
    await mouse(document.body, "mousemove", { clientX: start.clientX + 5, clientY: start.clientY });
    // React Flow starts dragging when the mouse has moved a little, and moves the shape from there.
    const end = { clientX: start.clientX + 5 + dx * zoom, clientY: start.clientY + dy * zoom };
    await mouse(document.body, "mousemove", end);
    await mouse(document.body, "mouseup", end);
    await settle();
  };
  /**
   * Drags a selected shape's grip, at one of its corners, by this far on the board, with Alt held
   * or not. `drop` lets go, and `settle` lets the edits settle, with every shape measured again
   * as 200 by 100.
   */
  const resize = async (id: string, corner: "top left" | "bottom right", dx: number, dy: number, { alt = false } = {}) => {
    const [, , zoom] = zoom_();
    const grip = node(id).querySelector<HTMLElement>(`.react-flow__resize-control.handle.${corner.replace(" ", ".")}`)!;
    const start = { clientX: 500, clientY: 400 };
    await mouse(grip, "mousedown", start, { alt });
    await mouse(document.body, "mousemove", { clientX: start.clientX + dx * zoom, clientY: start.clientY + dy * zoom }, { alt });
    return {
      drop: () => mouse(document.body, "mouseup", { clientX: start.clientX + dx * zoom, clientY: start.clientY + dy * zoom }, { alt }),
      settle,
    };
  };
  /** A shape's size, as it's drawn. */
  const drawn = (id: string) => {
    const style = node(id).querySelector<HTMLElement>(".wb-shape")!.style;
    return [style.width, style.height].map((v) => Math.round(parseFloat(v)));
  };
  const guides = () => [...host.querySelectorAll(".snap-guides line")].map((g) => ["x1", "y1", "x2", "y2"].map((a) => Math.round(Number(g.getAttribute(a)))));
  return { edits, at, drag, resize, drawn, guides };
}

describe("moving a shape on a whiteboard", () => {
  it("saves where it's dropped, and leaves it there", async () => {
    const b = await board(true);
    expect(b.at("cache")).toEqual([0, 0]);
    await b.drag("cache", 300, 120);
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [300, 120] }]]);
    expect(b.at("cache")).toEqual([300, 120]);
  });

  it("puts it back where the file has it when the move can't be saved", async () => {
    const b = await board(false);
    await b.drag("cache", 300, 120);
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [300, 120] }]]);
    expect(b.at("cache")).toEqual([0, 0]);
  });
});

describe("resizing a shape on a whiteboard", () => {
  // Cache is at 0, 0 and DB at 600, 600, each 200 by 100.
  it("lines the edge being dragged up with another shape's, with a guide along it, and saves it as drawn", async () => {
    const b = await board(true, { guides: true, grid: false });
    // Its right edge goes to 597, 3 short of DB's left edge. Its bottom, at 102, is near nothing.
    const resizing = await b.resize("cache", "bottom right", 397, 2);
    expect(b.drawn("cache")).toEqual([600, 102]);
    expect(b.guides()).toEqual([[600, 0, 600, 700]]);
    await resizing.drop();
    expect(b.guides()).toEqual([]);
    expect(b.drawn("cache")).toEqual([600, 102]);
    await resizing.settle();
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [0, 0, 600, 102] }]]);
  });

  it("snaps the edges a top left grip moves to the grid, and keeps the others where they are", async () => {
    const b = await board(true, { guides: false, grid: true });
    const resizing = await b.resize("cache", "top left", 13, -7);
    expect(b.guides()).toEqual([]);
    await resizing.drop();
    expect([b.at("cache"), b.drawn("cache")]).toEqual([[20, 0], [180, 100]]);
    await resizing.settle();
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [20, 0, 180, 100] }]]);
  });

  it("sizes it exactly as it's dragged with Alt held, or with snapping off", async () => {
    let b = await board(true, { guides: true, grid: true });
    let resizing = await b.resize("cache", "bottom right", 397, 2, { alt: true });
    expect(b.guides()).toEqual([]);
    await resizing.drop();
    await resizing.settle();
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [0, 0, 597, 102] }]]);

    b = await board(true);
    resizing = await b.resize("cache", "bottom right", 397, 2);
    await resizing.drop();
    await resizing.settle();
    expect(b.edits).toEqual([[{ op: "update-shape", view: "ideas", id: "cache", at: [0, 0, 597, 102] }]]);
  });
});
