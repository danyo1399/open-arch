// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement, useState } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Canvas, type Selection } from "../src/canvas/Canvas.js";
import { DeploymentDiagram } from "../src/canvas/DeploymentDiagram.js";
import { StateDiagram } from "../src/canvas/StateDiagram.js";
import { mount } from "./dom.js";

/**
 * React Flow watches each node's size with a ResizeObserver, and starts watching a node again when
 * it's given one without `measured`. When that happens inside a resize callback, the browser reports
 * "ResizeObserver loop completed with undelivered notifications". So once the frame round a
 * diagram has been measured, it's watched from then on, not started again each time it's rebuilt.
 * The same goes for every node of a deployment diagram, which draws them all again on a click.
 *
 * This page has no layout, so a stand-in ResizeObserver keeps what it's asked to watch, and when
 * the test asks, says each node is 200 by 100 and anything else 1000 by 800.
 */
/** Each element observe() was called with, every time. */
const observed: Element[] = [];
/** How many times React Flow started watching the size of the node with this ID. */
const timesObserved = (id: string) => observed.filter((el) => el.getAttribute("data-id") === id).length;
const frameObserved = () => timesObserved("__frame");

const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  watching = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    observed.push(target);
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

/** Reports every watched element's size, as the browser does, and lets React finish what that starts. */
async function resized() {
  await act(async () => {
    for (const o of observers) {
      const entries = [...o.watching].map((target) => ({ target, contentRect: { x: 0, y: 0, ...size(target as HTMLElement) } }) as ResizeObserverEntry);
      if (entries.length) o.callback(entries, o as unknown as ResizeObserver);
    }
  });
  // The frame is fitted round the measured boxes a frame later.
  await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
}

const real = {
  ResizeObserver: globalThis.ResizeObserver,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
};
beforeAll(() => {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  // React Flow reads a node's size from these.
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
  openarch: 10,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api" }] },
    api: { kind: "container", name: "API", parent: "shop" },
    order: { kind: "system", name: "Orders" },
  },
  views: {
    containers: { title: "Containers", level: "container", scope: "shop", include: ["*"], layout: { web: [0, 0], api: [400, 0] } },
    "order-states": {
      title: "Order states",
      level: "state",
      scope: "order",
      initial: "placed",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", final: true, at: [0, 300] } },
      transitions: [{ from: "placed", to: "paid", event: "Payment taken" }],
    },
    production: {
      title: "Production",
      level: "deployment",
      nodes: { cloud: { name: "Cloud" }, cluster: { name: "Cluster", parent: "cloud", runs: ["web", "api"] } },
    },
  },
};

describe("the frame round a diagram", () => {
  it("is watched once on a box diagram, however often it's rebuilt", async () => {
    const ws = buildWorkspace(shop);
    let select: (s: Selection) => void = () => {};
    function Designer() {
      const [selection, setSelection] = useState<Selection>(null);
      select = setSelection;
      return createElement(Canvas, {
        ws,
        view: ws.views.get("containers")!,
        diagnostics: [],
        selection,
        onSelect: setSelection,
        edit: async () => true,
        onElementMenu() {},
        onArrowMenu() {},
        onError() {},
        renames: [],
        exportItems: [],
      });
    }
    observed.length = 0;
    const host = mount(createElement(ReactFlowProvider, null, createElement(Designer)));
    await act(async () => {});
    await resized();
    expect(host.querySelector(".frame-label")?.textContent).toContain("Shop");
    expect(frameObserved()).toBe(1);
    // Selecting a box, then the frame, draws the boxes and the frame again.
    await act(async () => select({ kind: "element", id: "web" }));
    await act(async () => select({ kind: "element", id: "shop" }));
    await resized();
    expect(host.querySelector(".frame.selected")).not.toBeNull();
    expect(frameObserved()).toBe(1);
  });

  it("is watched once on a state diagram, as the states are measured", async () => {
    const ws = buildWorkspace(shop);
    observed.length = 0;
    const host = mount(
      createElement(
        ReactFlowProvider,
        null,
        createElement(StateDiagram, {
          computed: computeView(ws, ws.views.get("order-states")!),
          selection: null,
          onSelect() {},
          edit: async () => true,
          onError() {},
          exportItems: [],
        }),
      ),
    );
    await act(async () => {});
    await resized();
    // Measuring the states moves the frame round them, which draws it again.
    await resized();
    expect(host.querySelector(".frame-label")?.textContent).toContain("Orders");
    expect(frameObserved()).toBe(1);
  });

  it("is watched once on a deployment diagram, as is each of its nodes, however often they're drawn", async () => {
    const ws = buildWorkspace(shop);
    let select: (s: Selection) => void = () => {};
    function Designer() {
      const [selection, setSelection] = useState<Selection>(null);
      select = setSelection;
      return createElement(DeploymentDiagram, {
        ws,
        computed: computeView(ws, ws.views.get("production")!),
        selection,
        onSelect: setSelection,
        edit: async () => true,
        onError() {},
        exportItems: [],
      });
    }
    observed.length = 0;
    const host = mount(createElement(ReactFlowProvider, null, createElement(Designer)));
    // ELK lays it out a moment later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await resized();
    const ids = [...host.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("data-id")!);
    // The cloud and the cluster are frames, each with its label, and the cluster runs two containers.
    expect(ids).toHaveLength(6);
    // Selecting a node, then another, draws them all again.
    await act(async () => select({ kind: "node", id: "cluster" }));
    await act(async () => select({ kind: "node", id: "cloud" }));
    await resized();
    expect(host.querySelector(".deployment-frame.selected")).not.toBeNull();
    expect(ids.map((id) => [id, timesObserved(id)])).toEqual(ids.map((id) => [id, 1]));
  });
});
