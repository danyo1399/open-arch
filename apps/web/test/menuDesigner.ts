/**
 * The whole designer, for tests that right-click a diagram and pick from the menu it opens. A
 * test file that uses this starts with `// @vitest-environment happy-dom`.
 *
 * React Flow draws arrows once it has measured the boxes, and this page has no layout. So, as in
 * stickyDesigner.test.ts, a stand-in ResizeObserver keeps what it's asked to watch, and when a
 * test asks, says each node is 200 by 100 and anything else 1000 by 800.
 */
import { loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { click, mount } from "./dom.js";

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

/** A file whose saves wait until they're let through, as a slow disk's do. */
export class SlowHost extends MemoryHost {
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

/** The whole designer, open on the model's first view, `view`, with what's on its diagram measured. */
export async function designer(model: OpenArchDocument, view: string, file: MemoryHost = new MemoryHost("shop.openarch", serializeDocument(model))) {
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  /** Lets the edits and the drawing settle, with everything measured. */
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
  return {
    host,
    file,
    settle,
    labels,
    onScreen,
    /** The node drawn for this, by its ID on the diagram. */
    node: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`),
    /** The arrow drawn for this, by its ID on the diagram. */
    edge: (id: string) => host.querySelector(`.react-flow__edge[data-id="${id}"]`),
    pane: () => host.querySelector(".react-flow__pane")!,
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
    /** What the details panel is showing, as its heading says. */
    details: () => host.querySelector(".props-header")!.textContent,
    /** The view as the file now has it, under this ID. */
    saved: async (id = view) => loadWorkspace(await file.load()).views.get(id)!,
  };
}

export type MenuDesigner = Awaited<ReturnType<typeof designer>>;

/** Types into a box in the details and leaves it, which saves it. */
export async function write(box: HTMLTextAreaElement | HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, text);
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/** Says where this is on the screen, as the page here has no layout: its left edge and its bottom, where a menu opened with the keyboard goes. */
export function put(target: Element, left: number, bottom: number): void {
  target.getBoundingClientRect = () => ({ left, bottom, top: bottom - 100, right: left + 200, x: left, y: bottom - 100, width: 200, height: 100, toJSON() {} }) as DOMRect;
}
