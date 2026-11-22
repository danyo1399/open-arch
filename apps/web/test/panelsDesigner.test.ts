// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { panelMax } from "../src/panels/SidePanels.js";
import { PANEL_LIMITS, PANELS_WAIT, Settings, userSettings } from "../src/settings.js";
import { button, click, key, mount, type } from "./dom.js";

/**
 * React Flow draws the boxes once it has measured them, and this page has no layout. So, as in
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

/**
 * The app is 1280 by 800. A panel's edge is as big as the panel, which is the size the app's
 * style gives it, or its usual size: 260 pixels for the Views & model panel, 320 for the
 * details beside the diagram and 300 under it.
 */
const APP = { width: 1280, height: 800 };
function edgeRect(el: HTMLElement): DOMRect {
  const app = el.closest<HTMLElement>(".app");
  const dragged = (property: string, usual: number) => parseFloat(app?.style.getPropertyValue(property) ?? "") || usual;
  const width = el.matches(".panel-edge-left") ? dragged("--browse-width", 260) : el.matches(".panel-edge-right") ? dragged("--details-width", 320) : 0;
  const height = el.matches(".panel-edge-bottom") ? dragged("--details-height", 300) : 0;
  return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) };
}

const real = {
  ResizeObserver: globalThis.ResizeObserver,
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
  clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  getBoundingClientRect: Element.prototype.getBoundingClientRect,
};
beforeAll(() => {
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: function (this: HTMLElement) { return size(this).width; } });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: function (this: HTMLElement) { return size(this).height; } });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: function (this: HTMLElement) { return this.matches(".app") ? APP.width : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: function (this: HTMLElement) { return this.matches(".app") ? APP.height : 0; } });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.matches(".panel-edge") ? edgeRect(this as HTMLElement) : real.getBoundingClientRect.call(this);
  };
});
afterAll(() => {
  globalThis.ResizeObserver = real.ResizeObserver;
  for (const name of ["offsetWidth", "offsetHeight"] as const) {
    const was = real[name];
    if (was) Object.defineProperty(HTMLElement.prototype, name, was);
  }
  for (const name of ["clientWidth", "clientHeight"] as const) {
    const was = real[name];
    if (was) Object.defineProperty(HTMLElement.prototype, name, was);
  }
  Element.prototype.getBoundingClientRect = real.getBoundingClientRect;
});

/** The window's size, for the designer's media queries. */
const screen = (width: number, height: number) => (window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
// Each test starts as big as a laptop's window, so the panels are beside the diagram, with
// them open, at their usual size.
beforeEach(async () => {
  screen(1280, 800);
  await userSettings.setPanels({ browseCollapsed: false, detailsCollapsed: false, browseWidth: undefined, detailsWidth: undefined, detailsHeight: undefined });
});
afterEach(() => {
  screen(1024, 768);
  vi.restoreAllMocks();
});

const doc: OpenArchDocument = {
  openarch: 19,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop" },
  },
  views: { containers: { title: "Containers", level: "container", scope: "shop", layout: { customer: [0, 0], web: [0, 300] } } },
};

/** The whole designer, open on the container view, with its boxes measured. */
async function designer() {
  const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
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
  const app = () => host.querySelector<HTMLElement>(".app")!;
  const edge = (name: string) => host.querySelector<HTMLElement>(`[role="separator"][aria-label="Resize ${name}"]`)!;
  const labelled = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const pointer = (target: Element, type: string, at: { x: number; y: number }) =>
    act(async () => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: at.x, clientY: at.y }));
    });
  /** Drags an edge from one point on the screen to another, and lets go if `drop`. */
  const drag = async (target: Element, from: { x: number; y: number }, to: { x: number; y: number }, { drop = true } = {}) => {
    await pointer(target, "pointerdown", from);
    await pointer(target, "pointermove", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    await pointer(target, "pointermove", to);
    if (drop) await pointer(target, "pointerup", to);
    await settle();
  };
  return {
    host,
    settle,
    app,
    edge,
    drag,
    pointer,
    collapse: (name: string) => labelled(`Collapse ${name}`),
    rail: (place: string) => host.querySelector<HTMLButtonElement>(`.panel-rail-${place}`),
    /** What the app's style sizes the panels with. */
    style: (property: string) => app().style.getPropertyValue(property),
  };
}

describe("collapsing and expanding the side panels", () => {
  it("collapses each panel to a strip that says what's in it, and opens them as they were left", async () => {
    const d = await designer();
    expect(d.rail("left")).toBeNull();
    await click(d.collapse("Views & model")!);
    expect(d.app().classList.contains("browse-collapsed")).toBe(true);
    expect(d.rail("left")!.textContent).toBe("Views & model3 elements");
    expect(d.rail("left")!.getAttribute("aria-expanded")).toBe("false");
    // The panel's still there, hidden, so what's open in it stays open.
    expect(d.host.querySelector(".sidebar")).not.toBeNull();
    expect(d.edge("Views & model")).toBeNull();

    await click(d.collapse("Details")!);
    expect(d.app().classList.contains("details-collapsed")).toBe(true);
    expect(d.rail("right")!.textContent).toBe("DetailsThis view");
    // What takes the place of the button pressed has the focus, for the keyboard.
    expect(document.activeElement).toBe(d.rail("right"));
    expect(await userSettings.panels()).toEqual({ browseCollapsed: true, detailsCollapsed: true });

    const again = await designer();
    expect(again.app().classList.contains("browse-collapsed")).toBe(true);
    expect(again.app().classList.contains("details-collapsed")).toBe(true);
    // Opened like this, nothing in it takes the focus.
    expect(again.host.contains(document.activeElement)).toBe(false);
    await click(again.rail("left")!);
    expect(again.app().classList.contains("browse-collapsed")).toBe(false);
    expect(document.activeElement).toBe(again.collapse("Views & model"));
    expect(await userSettings.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: true });
    await click(again.rail("right")!);
    expect(again.app().className).toBe("app");
    expect(await userSettings.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: false });
  });

  it("expands the details to show what's picked in the model tree, or a box just added, but not a box picked on the diagram", async () => {
    const d = await designer();
    await click(d.collapse("Details")!);
    const row = [...d.host.querySelectorAll<HTMLElement>(".sidebar .row-main")].find((r) => r.textContent?.includes("Customer"))!;
    await click(row);
    expect(d.app().classList.contains("details-collapsed")).toBe(false);
    expect(d.host.querySelector<HTMLInputElement>(".properties input")!.value).toBe("Customer");
    expect((await userSettings.panels()).detailsCollapsed).toBe(false);

    await click(d.collapse("Details")!);
    await click(d.host.querySelector<HTMLElement>('.react-flow__node[data-id="web"]')!);
    expect(d.app().classList.contains("details-collapsed")).toBe(true);
    // The strip says what's selected.
    expect(d.rail("right")!.textContent).toBe("DetailsWeb");

    await click(button(d.host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Container in Shop")!);
    await d.settle();
    expect(d.app().classList.contains("details-collapsed")).toBe(false);
    // Its name is being typed.
    expect((document.activeElement as HTMLInputElement).value).toBe("New container");
  });
});

describe("adding one thing straight after another", () => {
  const add = async (d: Awaited<ReturnType<typeof designer>>, what: string) => {
    await click(button(d.host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === what)!);
    await d.settle();
  };
  const focused = () => document.activeElement as HTMLInputElement;
  const boxes = (d: Awaited<ReturnType<typeof designer>>) => [...d.host.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => `${n.dataset.id} ${n.style.transform}`);

  it("gives each one's name the focus: a container, then a shared library on the container view, which keeps its boxes", async () => {
    const d = await designer();
    await add(d, "Container in Shop");
    expect(focused().value).toBe("New container");
    const before = boxes(d);

    await add(d, "Shared library");
    expect(focused().getAttribute("aria-label")).toBe("Name");
    expect(focused().value).toBe("New library");
    // A container view draws no libraries: it's in the model, and its details are open.
    expect(boxes(d)).toEqual(before);
    expect([...d.host.querySelectorAll(".sidebar .tree .row-main")].map((r) => r.textContent)).toContain("New library");
    expect(d.host.querySelector(".properties .badge")!.textContent).toBe("Library");
    expect([...d.host.querySelectorAll(".properties fieldset .check")].map((c) => c.textContent)).toEqual(["New container", "Web"]);
  });

  it("gives a library's name the focus when it's made from the details of a container just added", async () => {
    const d = await designer();
    await add(d, "Container in Shop");
    // A press gives the button the focus, as a browser does, and it's gone once the library is open.
    const press = button(d.host, "+ New library");
    press.focus();
    await click(press);
    await d.settle();
    expect(focused().getAttribute("aria-label")).toBe("Name");
    expect(focused().value).toBe("New library");
    const built = [...d.host.querySelectorAll<HTMLInputElement>(".properties fieldset .check input")].map((c) => c.checked);
    expect(built).toEqual([true, false]);
  });
});

describe("adding a library from a container's details", () => {
  const add = async (d: Awaited<ReturnType<typeof designer>>, what: string) => {
    await click(button(d.host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === what)!);
    await d.settle();
  };
  /** The details' checkboxes: a library's containers, or a container's libraries. */
  const ticks = (d: Awaited<ReturnType<typeof designer>>) => [...d.host.querySelectorAll<HTMLLabelElement>(".properties fieldset .check")].map((c) => `${c.textContent}${c.querySelector("input")!.checked ? " ✓" : ""}`);
  const inTree = (d: Awaited<ReturnType<typeof designer>>, name: string) => [...d.host.querySelectorAll<HTMLElement>(".sidebar .tree .row-main")].find((r) => r.textContent === name)!;

  it("builds a container with it when the container's name was typed just before the press", async () => {
    const d = await designer();
    await add(d, "Container in Shop");
    const name = document.activeElement as HTMLInputElement;
    await type(name, "Basket");
    // Leaving the box saves the name, which renames the container, and the press comes with it:
    // its edit is made with the ID the container had, before a render shows the new one.
    const press = button(d.host, "+ New library");
    await act(async () => {
      name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      press.focus();
      press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(inTree(d, "Basket").title).toBe("basket");
    expect(d.host.querySelector(".properties .badge")!.textContent).toBe("Library");
    expect(ticks(d)).toEqual(["Basket ✓", "Web"]);
    // Its name is typed next.
    expect((document.activeElement as HTMLInputElement).value).toBe("New library");
    await type(document.activeElement as HTMLInputElement, "Metrics");
    await key(document.activeElement!, "Enter");
    await d.settle();
    expect(inTree(d, "Metrics").title).toBe("metrics");
  });

  it("keeps a library ticked just before the press", async () => {
    const d = await designer();
    await click(inTree(d, "Web"));
    await click(button(d.host, "+ New library"));
    await d.settle();
    await add(d, "Container in Shop");
    expect(ticks(d)).toEqual(["New library"]);
    const tick = d.host.querySelector<HTMLInputElement>(".properties fieldset .check input")!;
    const press = button(d.host, "+ New library");
    await act(async () => {
      tick.click();
      press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(ticks(d)).toEqual(["New container ✓", "Web"]);
    await click(inTree(d, "New container"));
    expect(ticks(d)).toEqual(["New library ✓", "New library ✓"]);
  });

  it("says so, and adds nothing, when the container is gone by the time it's added", async () => {
    const d = await designer();
    await add(d, "Container in Shop");
    const press = button(d.host, "+ New library");
    await act(async () => {
      button(d.host, "Undo").click();
      press.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.host.querySelector('[role="alert"]')!.textContent).toContain("so no library was added to it");
    expect([...d.host.querySelectorAll(".sidebar .tree .row-main")].map((r) => r.textContent)).toEqual(["Customer", "Shop", "Web"]);
  });
});

describe("resizing the side panels", () => {
  it("drags a panel's edge to resize it, keeps the size when it's let go, and puts it back with a double-click", async () => {
    const d = await designer();
    const edge = d.edge("Views & model");
    expect(edge.getAttribute("aria-orientation")).toBe("vertical");
    expect(edge.getAttribute("aria-valuenow")).toBe("260");
    await d.drag(edge, { x: 260, y: 300 }, { x: 330, y: 340 }, { drop: false });
    // While it's dragged, the panel changes size, but the size isn't kept yet.
    expect(d.style("--browse-width")).toBe("330px");
    expect(document.documentElement.dataset.resizing).toBe("across");
    expect((await userSettings.panels()).browseWidth).toBeUndefined();
    await d.pointer(edge, "pointerup", { x: 330, y: 340 });
    await d.settle();
    expect(document.documentElement.dataset.resizing).toBeUndefined();
    expect(d.style("--browse-width")).toBe("330px");
    expect(edge.getAttribute("aria-valuenow")).toBe("330");
    expect((await userSettings.panels()).browseWidth).toBe(330);

    // The details' edge is on their left, so dragging it left makes them wider.
    await d.drag(d.edge("Details"), { x: 960, y: 300 }, { x: 860, y: 300 });
    expect(d.style("--details-width")).toBe("420px");
    expect((await userSettings.panels()).detailsWidth).toBe(420);

    // It opens at the size it was left.
    const again = await designer();
    expect(again.style("--browse-width")).toBe("330px");
    expect(again.style("--details-width")).toBe("420px");

    await act(async () => {
      again.edge("Views & model").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(again.style("--browse-width")).toBe("");
    expect(await userSettings.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: false, detailsWidth: 420 });
  });

  it("stops at the smallest and largest a panel can be, leaving the diagram its room", async () => {
    const d = await designer();
    await d.drag(d.edge("Views & model"), { x: 260, y: 300 }, { x: 10, y: 300 });
    expect((await userSettings.panels()).browseWidth).toBe(PANEL_LIMITS.browseWidth.min);
    await d.drag(d.edge("Details"), { x: 960, y: 300 }, { x: 0, y: 300 });
    // Half of what the diagram leaves of 1280 pixels.
    expect((await userSettings.panels()).detailsWidth).toBe(480);
    expect(d.edge("Details").getAttribute("aria-valuemax")).toBe("480");
  });

  it("leaves a panel as it was when it's let go where it started, or the drag is cancelled", async () => {
    const d = await designer();
    const edge = d.edge("Views & model");
    await d.pointer(edge, "pointerdown", { x: 260, y: 300 });
    await d.pointer(edge, "pointermove", { x: 300, y: 300 });
    expect(d.style("--browse-width")).toBe("300px");
    await d.pointer(edge, "pointermove", { x: 260, y: 300 });
    await d.pointer(edge, "pointerup", { x: 260, y: 300 });
    // Still at its usual size, which a narrower screen makes smaller.
    expect(d.style("--browse-width")).toBe("");

    await d.drag(edge, { x: 260, y: 300 }, { x: 300, y: 300 });
    await d.drag(edge, { x: 300, y: 300 }, { x: 400, y: 300 }, { drop: false });
    expect(d.style("--browse-width")).toBe("400px");
    await d.pointer(edge, "pointercancel", { x: 400, y: 300 });
    expect(d.style("--browse-width")).toBe("300px");
    expect(document.documentElement.dataset.resizing).toBeUndefined();
    expect((await userSettings.panels()).browseWidth).toBe(300);
  });

  it("moves an edge with the arrow keys, and to the smallest or largest with Home and End", async () => {
    const d = await designer();
    await key(d.edge("Views & model"), "ArrowRight");
    expect((await userSettings.panels()).browseWidth).toBe(276);
    await key(d.edge("Views & model"), "ArrowLeft");
    await key(d.edge("Views & model"), "ArrowLeft");
    expect((await userSettings.panels()).browseWidth).toBe(244);
    await key(d.edge("Details"), "ArrowLeft");
    expect((await userSettings.panels()).detailsWidth).toBe(336);
    await key(d.edge("Details"), "End");
    expect((await userSettings.panels()).detailsWidth).toBe(480);
    await key(d.edge("Details"), "Home");
    expect((await userSettings.panels()).detailsWidth).toBe(PANEL_LIMITS.detailsWidth.min);
    expect(d.style("--details-width")).toBe(`${PANEL_LIMITS.detailsWidth.min}px`);
  });

  it("works out the largest a panel can be from the app's size", () => {
    // Beside the diagram, each takes half of what's left once the diagram is 320 pixels wide.
    expect(panelMax("browseWidth", false, { width: 1000, height: 800 })).toBe(340);
    expect(panelMax("detailsWidth", false, { width: 2400, height: 800 })).toBe(PANEL_LIMITS.detailsWidth.max);
    // With the details under the diagram, the Views & model panel has the width to itself.
    expect(panelMax("browseWidth", true, { width: 700, height: 800 })).toBe(380);
    // Under the diagram, the details leave the top bar, and the diagram 160 pixels down.
    expect(panelMax("detailsHeight", true, { width: 700, height: 600 })).toBe(394);
    // Never smaller than the smallest.
    expect(panelMax("detailsWidth", false, { width: 500, height: 800 })).toBe(PANEL_LIMITS.detailsWidth.min);
  });
});

describe("the side panels on smaller screens", () => {
  it("drags the details' height when they're under the diagram, and collapses them to a strip along the bottom", async () => {
    screen(800, 900);
    const d = await designer();
    const edge = d.edge("Details");
    expect(edge.getAttribute("aria-orientation")).toBe("horizontal");
    // Dragging up makes them taller.
    await d.drag(edge, { x: 400, y: 600 }, { x: 400, y: 500 });
    expect(d.style("--details-height")).toBe("400px");
    expect(await userSettings.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: false, detailsHeight: 400 });
    await key(d.edge("Details"), "ArrowUp");
    expect((await userSettings.panels()).detailsHeight).toBe(416);
    await click(d.collapse("Details")!);
    expect(d.rail("bottom")!.textContent).toBe("DetailsThis view");
  });

  it("has no edges or strips on a phone, where each panel fills the screen in turn", async () => {
    await userSettings.setPanels({ browseCollapsed: true, detailsCollapsed: true, browseWidth: 400 });
    // A phone on its side, which is narrow however a page reads the media query's list.
    screen(390, 450);
    const d = await designer();
    expect(d.app().className).toBe("app narrow pane-diagram");
    expect(d.host.querySelectorAll('.panel-edge, .panel-rail, [role="separator"]')).toHaveLength(0);
    await click(button(d.host, "Views & model3 elements"));
    expect(d.app().className).toBe("app narrow pane-browse");
  });
});

describe("when the panel settings can't be kept", () => {
  const blocked = () => new Error("This browser won't let open-arch keep your settings: blocked");

  it("opens the designer with the panels open, at their usual size, if they can't be read", async () => {
    await userSettings.setPanels({ detailsCollapsed: true, browseWidth: 400 });
    vi.spyOn(userSettings, "panels").mockRejectedValue(blocked());
    const d = await designer();
    expect(d.app().className).toBe("app");
    expect(d.style("--browse-width")).toBe("");
    expect(d.collapse("Details")).not.toBeNull();
  });

  it("opens the designer without them if they take too long to read", async () => {
    vi.spyOn(userSettings, "panels").mockReturnValue(new Promise(() => {}));
    const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(host.textContent).toBe("Loading…");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, PANELS_WAIT)));
    expect(host.querySelector(".app")!.className).toBe("app");
    expect(host.querySelector('button[aria-label="Collapse Details"]')).not.toBeNull();
  });

  /** The designer, opened while the panel settings are still being read: they come when the test says. */
  async function slowRead() {
    let arrive!: () => void;
    const stored = await userSettings.panels();
    vi.spyOn(userSettings, "panels").mockReturnValue(new Promise((resolve) => (arrive = () => resolve(stored))));
    const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, PANELS_WAIT + 50)));
    return { host, app: () => host.querySelector<HTMLElement>(".app")!, arrive: () => act(async () => arrive()) };
  }

  it("shows the panels as they were left once their settings are read, if that takes too long to wait for", async () => {
    await userSettings.setPanels({ detailsCollapsed: true, browseWidth: 400 });
    const d = await slowRead();
    expect(d.app().className).toBe("app");
    await d.arrive();
    expect(d.app().className).toBe("app details-collapsed");
    expect(d.app().style.getPropertyValue("--browse-width")).toBe("400px");
  });

  it("keeps a change made before the settings are read, rather than what the read says", async () => {
    await userSettings.setPanels({ detailsCollapsed: true });
    const d = await slowRead();
    await click(d.host.querySelector('button[aria-label="Collapse Views & model"]')!);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    // Keeping the change brought what was stored for the other panel with it.
    expect(d.app().className).toBe("app browse-collapsed details-collapsed");
    // The read, from before the change, says the Views & model panel is open: it's left as it is.
    await d.arrive();
    expect(d.app().className).toBe("app browse-collapsed details-collapsed");
    // As stored, read past the stand-in that's slow.
    expect(await new Settings().panels()).toEqual({ browseCollapsed: true, detailsCollapsed: true });
  });

  it("still collapses and resizes a panel, for as long as the designer is open, and says why it wasn't kept", async () => {
    vi.spyOn(userSettings, "setPanels").mockRejectedValue(blocked());
    const d = await designer();
    await click(d.collapse("Details")!);
    await d.settle();
    expect(d.app().classList.contains("details-collapsed")).toBe(true);
    expect(d.host.querySelector(".toast-error")!.textContent).toContain("This browser won't let open-arch keep your settings: blocked");
    await key(d.edge("Views & model"), "ArrowRight");
    await d.settle();
    expect(d.style("--browse-width")).toBe("276px");
    expect(d.app().classList.contains("details-collapsed")).toBe(true);
  });
});
