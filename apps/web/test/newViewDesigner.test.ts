// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, mount } from "./dom.js";

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
  openarch: 15,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "Orders API", parent: "shop" },
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
  /** The items of the menu or submenu open last. */
  const items = () => {
    const lists = document.querySelectorAll(".context-menu");
    return [...(lists[lists.length - 1]?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  };
  const item = (label: string) => {
    const found = items().find((b) => b.textContent?.replace("›", "").trim() === label);
    if (!found) throw new Error(`The menu has no ${label}. It has: ${items().map((b) => b.textContent).join(", ")}`);
    return found;
  };
  return {
    host,
    settle,
    item,
    /** Right-clicks this, and opens the New view submenu of the menu it opens. Returns that submenu's items. */
    newViewMenu: async (target: Element) => {
      await act(async () => {
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      });
      await click(item("New view"));
      return items().map((b) => b.textContent);
    },
    node: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`),
    /** The row in the model tree for this element. */
    row: (name: string) => [...host.querySelectorAll(".sidebar .row")].find((r) => r.querySelector(".row-main .grow")?.textContent === name)!,
    /** The title and level of the view that's open, as the Views list shows it. */
    open: () => [...host.querySelectorAll(".sidebar .row.active .row-main span")].map((s) => s.textContent).filter(Boolean),
  };
}

describe("making a view of an element from its right-click menu", () => {
  it("makes a component view of a container's box, and opens it", async () => {
    const d = await designer();
    expect(await d.newViewMenu(d.node("api")!)).toEqual(["Component view", "State view", "Wireframe view"]);
    await click(d.item("Component view"));
    await d.settle();
    expect(d.open()).toEqual(["Orders API components", "component"]);
    // Its details are showing, to retitle it.
    expect([...d.host.querySelectorAll<HTMLInputElement>(".properties input")].map((i) => i.value)).toContain("Orders API components");
    // Undo takes it back.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect([...d.host.querySelectorAll(".sidebar .row-main .grow")].map((s) => s.textContent)).not.toContain("Orders API components");
  });

  it("makes a view of a system from the model tree, numbering its ID if one is taken", async () => {
    const taken = structuredClone(doc);
    taken.views["shop-context"] = { title: "Shop context", level: "context", scope: "shop" };
    const d = await designer(taken);
    expect(await d.newViewMenu(d.row("Shop"))).toEqual(["Context view", "Container view", "State view", "Wireframe view"]);
    await click(d.item("Context view"));
    await d.settle();
    expect(d.open()).toEqual(["Shop context", "context"]);
    expect(d.host.querySelector(".sidebar .row.active .row-main")?.getAttribute("title")).toBe("shop-context-2");
  });
});
