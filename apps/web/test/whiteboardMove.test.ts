// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { WhiteboardDiagram } from "../src/canvas/WhiteboardDiagram.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
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
  openarch: 14,
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

/** The whiteboard, its shapes measured, with edits that are saved or refused as `saves` says. */
async function board(saves: boolean) {
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
        // Nothing snaps, so the shape goes exactly where it's dragged.
        snap: { settings: { ...SNAP_DEFAULTS, guides: false, grid: false }, set() {} },
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
  /** Drags a shape by this far on the screen, which is the board's scale, as nothing here zooms. */
  const drag = async (id: string, dx: number, dy: number) => {
    const viewport = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [x0, y0, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(viewport)!.slice(1).map(Number) as [number, number, number];
    const [x, y] = at(id) as [number, number];
    const start = { clientX: (x + 100) * zoom + x0, clientY: (y + 50) * zoom + y0 };
    const mouse = (target: EventTarget, type: string, p: { clientX: number; clientY: number }) =>
      act(async () => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, ...p })));
    await mouse(node(id), "mousedown", start);
    await mouse(document.body, "mousemove", { clientX: start.clientX + 5, clientY: start.clientY });
    // React Flow starts dragging when the mouse has moved a little, and moves the shape from there.
    const end = { clientX: start.clientX + 5 + dx * zoom, clientY: start.clientY + dy * zoom };
    await mouse(document.body, "mousemove", end);
    await mouse(document.body, "mouseup", end);
    await settle();
  };
  return { edits, at, drag };
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
