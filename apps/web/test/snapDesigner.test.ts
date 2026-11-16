// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { SNAP_DEFAULTS, userSettings } from "../src/settings.js";
import { click, mount } from "./dom.js";

/**
 * React Flow lays boxes out once it has measured them, and this page has no layout. So, as in
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
// Each test starts with the setting as it is until it's changed.
beforeEach(() => userSettings.setSnap(SNAP_DEFAULTS));

const doc: OpenArchDocument = {
  openarch: 13,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
  },
  views: { containers: { title: "Containers", level: "container", scope: "shop", layout: { customer: [0, 0], web: [0, 300], api: [500, 300] } } },
};

/** A state view, with a note: the states and the note snap too. */
const states: OpenArchDocument = {
  openarch: 13,
  name: "Shop",
  elements: {},
  views: {
    "order-states": {
      title: "Order states",
      level: "state",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", at: [400, 0] } },
      transitions: [{ from: "placed", to: "paid" }],
      stickies: { note: { text: "Look here", at: [400, 300] } },
    },
  },
};

/** Views laid out automatically, each with a note: there, only the note snaps. */
const deployment: OpenArchDocument = {
  openarch: 13,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, web: { kind: "container", name: "Web", parent: "shop" } },
  views: {
    production: {
      title: "Production",
      level: "deployment",
      nodes: { server: { name: "Server", runs: ["web"] }, lb: { name: "Load balancer", infrastructure: true } },
      stickies: { note: { text: "Look here", at: [600, 600] } },
    },
  },
};
const events: OpenArchDocument = {
  openarch: 13,
  name: "Shop",
  elements: {},
  views: {
    order: {
      title: "Order",
      level: "event",
      lanes: [{ id: "shop", name: "Shop" }],
      cards: [
        { id: "place", kind: "command", name: "Place order", lane: "shop" },
        { id: "placed", kind: "event", name: "Order placed", lane: "shop", from: ["place"] },
      ],
      stickies: { note: { text: "Look here", at: [600, 600] } },
    },
  },
};
const screens: OpenArchDocument = {
  openarch: 13,
  name: "Shop",
  elements: {},
  views: {
    checkout: {
      title: "Checkout",
      level: "wireframe",
      screens: [
        { id: "cart", name: "Cart", widgets: [{ id: "title", kind: "heading", text: "Your cart" }, { id: "pay", kind: "button", text: "Pay", to: "done" }] },
        { id: "done", name: "Done" },
      ],
      stickies: { note: { text: "Look here", at: [600, 900] } },
    },
  },
};

/** The whole designer, open on the model's only view, with its boxes measured. */
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
  const node = (id: string) => host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  /** Where a point on the diagram is on the screen. The canvas is at the page's top left, as nothing here has a size. */
  const onScreen = (at: { x: number; y: number }) => {
    const transform = host.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform;
    const [x, y, zoom] = /translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(transform)!.slice(1).map(Number) as [number, number, number];
    return { clientX: at.x * zoom + x, clientY: at.y * zoom + y };
  };
  /** Where a box is drawn on the diagram, to a hundredth: while it's dragged, it can be a hair off a whole number. */
  const at = (id: string) =>
    /translate\(([-\d.e]+)px, ?([-\d.e]+)px\)/
      .exec(node(id).style.transform)!
      .slice(1)
      .map((v) => Math.round(Number(v) * 100) / 100 + 0);
  /**
   * Presses the mouse on a box's middle and moves it so the box's top left is at `to` on the
   * diagram, as React Flow would put it, with Alt held or not. `drop` lets go.
   */
  const drag = async (id: string, to: { x: number; y: number }, { alt = false } = {}) => {
    const [x, y] = at(id) as [number, number];
    const start = onScreen({ x: x + 100, y: y + 50 });
    const end = onScreen({ x: to.x + 100, y: to.y + 50 });
    const mouse = (target: EventTarget, type: string, point: { clientX: number; clientY: number }) =>
      act(async () => {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, altKey: alt, ...point }));
      });
    // React Flow starts dragging when the mouse has moved a little, and moves the box from there.
    const nudge = (p: { clientX: number; clientY: number }) => ({ clientX: p.clientX + 5, clientY: p.clientY });
    await mouse(node(id), "mousedown", start);
    await mouse(document.body, "mousemove", nudge(start));
    await mouse(document.body, "mousemove", nudge(end));
    return {
      drop: async () => {
        await mouse(document.body, "mouseup", nudge(end));
        await settle();
      },
    };
  };
  return { host, at, drag, guides: () => [...host.querySelectorAll(".snap-guides line")] };
}

describe("snapping a box as it's dragged", () => {
  it("lines it up with the boxes around it, with a guide down each line they share, and keeps it there", async () => {
    const d = await designer();
    // Customer and Web are at the left, 0 across, and are as wide as API.
    const moving = await d.drag("api", { x: 3, y: 150 });
    expect(d.at("api")).toEqual([0, 150]);
    expect(d.guides().map((g) => g.getAttribute("x1"))).toEqual(["0", "100", "200"]);
    // Down from Customer's top to Web's bottom.
    expect([d.guides()[0]!.getAttribute("y1"), d.guides()[0]!.getAttribute("y2")]).toEqual(["0", "400"]);
    await moving.drop();
    expect(d.guides()).toEqual([]);
    expect(d.at("api")).toEqual([0, 150]);
  });

  it("puts it exactly where it's dragged with Alt held", async () => {
    const d = await designer();
    const moving = await d.drag("api", { x: 3, y: 150 }, { alt: true });
    expect(d.guides()).toEqual([]);
    await moving.drop();
    expect(d.at("api")).toEqual([3, 150]);
  });

  it("snaps to the grid instead, and leaves it where it's dragged with both off, as the buttons choose", async () => {
    const d = await designer();
    const lineUp = d.host.querySelector<HTMLButtonElement>('button[aria-label="Line up with other boxes"]')!;
    const grid = d.host.querySelector<HTMLButtonElement>('button[aria-label="Snap to the grid"]')!;
    expect([lineUp.getAttribute("aria-pressed"), grid.getAttribute("aria-pressed")]).toEqual(["true", "false"]);

    await click(lineUp);
    await click(grid);
    expect([lineUp.getAttribute("aria-pressed"), grid.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    expect(await userSettings.snap()).toEqual({ guides: false, grid: true });
    let moving = await d.drag("api", { x: 3, y: 157 });
    expect(d.guides()).toEqual([]);
    await moving.drop();
    expect(d.at("api")).toEqual([0, 160]);

    await click(grid);
    moving = await d.drag("api", { x: 13, y: 157 });
    await moving.drop();
    expect(d.at("api")).toEqual([13, 157]);
  });

  it("lines up states and notes on a state view", async () => {
    const d = await designer(states);
    let moving = await d.drag("paid", { x: 404, y: 196 });
    expect(d.guides().length).toBeGreaterThan(0);
    await moving.drop();
    // Its left lines up with the note's left, and its bottom with the note's top.
    expect(d.at("paid")).toEqual([400, 200]);

    // The note's left lines up with Placed's.
    moving = await d.drag("sticky:note", { x: 3, y: 300 });
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([0, 300]);
  });

  // Laid out automatically, each box here is 200 by 100, as the stand-in ResizeObserver says.
  it("lines up a note with the boxes on a deployment view, and keeps it there", async () => {
    const d = await designer(deployment);
    // The load balancer's box is at 12, 59.
    expect(d.at("lb")).toEqual([12, 59]);
    const moving = await d.drag("sticky:note", { x: 15, y: 400 });
    expect(d.guides().length).toBeGreaterThan(0);
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([12, 400]);
  });

  it("lines up a note with the cards on an event view, but not with the lanes, and leaves the cards to go where they're let go", async () => {
    const d = await designer(events);
    // The lane's row is at 0, 0, and the cards at 175, 26 and 375, 26.
    expect([d.at("lane:shop"), d.at("place"), d.at("placed")]).toEqual([[0, 0], [175, 26], [375, 26]]);
    let moving = await d.drag("sticky:note", { x: 378, y: 600 });
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([375, 600]);

    // 2 below the top of the lane's row, which isn't something to line up with.
    moving = await d.drag("sticky:note", { x: 800, y: 2 });
    expect(d.guides()).toEqual([]);
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([800, 2]);

    // A card 3 right of the other's left edge is drawn where it's dragged.
    moving = await d.drag("placed", { x: 178, y: 300 });
    expect(d.at("placed")).toEqual([178, 300]);
    expect(d.guides()).toEqual([]);
    await moving.drop();
  });

  it("lines up a note with the screens on a wireframe view, but not with the widgets, and leaves the screens to go where they're let go", async () => {
    const d = await designer(screens);
    // The screens are at 0, 0 and 680, 0, and the Cart's widgets start at 14 across.
    expect([d.at("screen:cart"), d.at("screen:done"), d.at("widget:title")]).toEqual([[0, 0], [680, 0], [14, 46]]);
    let moving = await d.drag("sticky:note", { x: 683, y: 900 });
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([680, 900]);

    // 2 right of the widgets' left edges.
    moving = await d.drag("sticky:note", { x: 16, y: 900 });
    expect(d.guides()).toEqual([]);
    await moving.drop();
    expect(d.at("sticky:note")).toEqual([16, 900]);

    // A screen 3 right of the other's right edge is drawn where it's dragged.
    moving = await d.drag("screen:done", { x: 203, y: 400 });
    expect(d.at("screen:done")).toEqual([203, 400]);
    expect(d.guides()).toEqual([]);
    await moving.drop();
  });

  it("opens with the setting it was left with", async () => {
    await userSettings.setSnap({ guides: false, grid: true });
    const d = await designer();
    expect(d.host.querySelector('button[aria-label="Line up with other boxes"]')!.getAttribute("aria-pressed")).toBe("false");
    expect(d.host.querySelector('button[aria-label="Snap to the grid"]')!.getAttribute("aria-pressed")).toBe("true");
  });
});
