// @vitest-environment happy-dom
import { applyOperations, loadWorkspace, serializeDocument, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import type { WorkspaceHost } from "../src/hosts.js";
import { button, click, mount } from "./dom.js";

/**
 * React Flow draws arrows once it has measured the boxes, and this page has no layout. So, as in
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

/** A file the designer saves every edit to, which the test can change outside it, as an agent would. */
class FileHost implements WorkspaceHost {
  readonly storage = "file";
  name = "shop.openarch";
  key = "test/shop";
  private changed = () => {};
  /** How long a save takes, in milliseconds. */
  delay = 0;
  constructor(public text: string) {}
  async load() {
    return this.text;
  }
  async save(text: string) {
    if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
    this.text = text;
  }
  watch(onChange: () => void) {
    this.changed = onChange;
    return () => {};
  }
  /** The model as the file has it now. */
  get doc(): OpenArchDocument {
    return loadWorkspace(this.text).doc;
  }
  /** Changes the file outside the designer, which sees it and reloads. */
  change(ops: Operation[]) {
    this.put(serializeDocument(applyOperations(this.doc, ops).doc));
  }
  /** Writes the file outside the designer, which sees it and reloads. */
  put(text: string) {
    this.text = text;
    this.changed();
  }
}

const doc: OpenArchDocument = {
  openarch: 16,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: {
      kind: "container",
      name: "Web",
      parent: "shop",
      uses: [
        { to: "api", description: "Calls" },
        { to: "api", description: "Sends events to", notes: "Over a queue." },
      ],
    },
    api: { kind: "container", name: "API", parent: "shop", notes: "Takes orders." },
  },
  views: { containers: { title: "Containers", level: "container", scope: "shop", layout: { web: [0, 0], api: [0, 300] } } },
};

/** The whole designer, open on the container view, with its boxes measured. */
async function designer(text = serializeDocument(doc)) {
  const file = new FileHost(text);
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  /** Lets the edits, reloads and the drawing settle, with every box measured. */
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
  const panel = () => host.querySelector<HTMLElement>(".properties")!;
  return {
    file,
    host,
    settle,
    panel,
    /** Selects an element in the model list. */
    select: async (name: string) => {
      const row = [...host.querySelectorAll<HTMLButtonElement>(".sidebar .row-main")].find((b) => b.querySelector(".grow")?.textContent === name);
      if (!row) throw new Error(`No element ${name} in the model list.`);
      await click(row);
    },
    /** The notes editor, when it's open. */
    editor: () => host.querySelector<HTMLDialogElement>("dialog.notes-editor"),
    /** What the editor says, and its box. */
    title: () => host.querySelector("dialog.notes-editor h2")?.textContent,
    box: () => host.querySelector<HTMLTextAreaElement>("dialog.notes-editor textarea")!,
  };
}

describe("writing notes in the bigger editor", () => {
  it("opens an element's notes, saves them as one step for Undo, and shows them in the panel", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    expect(d.editor()?.open).toBe(true);
    expect(d.title()).toBe("Notes on API");
    expect(d.box().value).toBe("Takes orders.");

    d.box().value = "Takes orders.\n\n## Refunds\n\nAnd gives refunds.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.api!.notes).toBe("Takes orders.\n\n## Refunds\n\nAnd gives refunds.");
    expect(d.panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!.value).toBe("Takes orders.\n\n## Refunds\n\nAnd gives refunds.");

    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.file.doc.elements.api!.notes).toBe("Takes orders.");
    expect(button(d.host, "Undo").disabled).toBe(true);
  });

  it("follows a rename that lands after Expand, and saves to the element by its new ID", async () => {
    const d = await designer();
    await d.select("API");
    const name = d.panel().querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    const expand = button(d.panel(), "Expand");
    // Leaving the Name box saves the new name; Expand is pressed before that lands.
    await act(async () => {
      name.value = "Orders API";
      name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(Object.keys(d.file.doc.elements)).toContain("orders-api");
    expect(d.title()).toBe("Notes on Orders API");

    d.box().value = "Takes orders, now by its new name.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements["orders-api"]!.notes).toBe("Takes orders, now by its new name.");
  });

  it("follows a rename made elsewhere while it's open", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    d.box().value = "Takes orders, whatever it's called.";
    d.file.change([
      { op: "update-element", id: "api", name: "Orders API" },
      { op: "rename", id: "api", to: "orders-api" },
    ]);
    await d.settle();
    expect(d.title()).toBe("Notes on Orders API");
    expect(d.editor()!.textContent).not.toContain("changed or deleted elsewhere");
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements["orders-api"]!.notes).toBe("Takes orders, whatever it's called.");
  });

  it("keeps the name it had, and the text, without saving, when the element is deleted elsewhere", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    d.box().value = "Long notes, half written.";
    d.file.change([{ op: "remove-element", id: "api" }]);
    await d.settle();
    expect(d.title()).toBe("Notes on API");
    expect(d.editor()!.textContent).toContain("API was changed or deleted elsewhere, so these notes can't be saved. Copy them to keep them.");

    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.box().value).toBe("Long notes, half written.");
    expect(d.file.doc.elements.api).toBeUndefined();
  });

  it("takes how a relationship looks once its description, typed just before Expand, is saved", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    const description = d.panel().querySelectorAll<HTMLInputElement>('input[aria-label="Description"]')[0]!;
    const expand = [...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!;
    // Leaving the Description box saves it; Expand is pressed before that lands.
    await act(async () => {
      description.value = "Calls over REST";
      description.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.file.doc.elements.web!.uses![0]!.description).toBe("Calls over REST");
    expect(d.editor()!.textContent).not.toContain("changed or deleted elsewhere");

    d.box().value = "Every call is authenticated.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.web!.uses![0]).toEqual({ to: "api", description: "Calls over REST", notes: "Every call is authenticated." });
  });

  it("checks again as the save runs, for an edit elsewhere that lands just before it", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    await click([...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!);
    d.box().value = "Uses REST.";
    // The reload is queued before the save, and Done is pressed before the editor hears of it.
    await act(async () => {
      d.file.change([{ op: "remove-relationship", from: "web", to: "api", index: 0 }]);
      button(d.editor()!, "Done").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.box().value).toBe("Uses REST.");
    expect(d.host.textContent).toContain("Web → API was changed or deleted elsewhere, so its notes weren't saved.");
    expect(d.file.doc.elements.web!.uses).toEqual([{ to: "api", description: "Sends events to", notes: "Over a queue." }]);
  });

  it("follows a rename made elsewhere that lands just before the save", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    d.box().value = "Takes orders, renamed as it saved.";
    // The reload is queued before the save, and Done is pressed before the editor hears of it.
    await act(async () => {
      d.file.change([
        { op: "update-element", id: "api", name: "Orders API" },
        { op: "rename", id: "api", to: "orders-api" },
      ]);
      button(d.editor()!, "Done").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements["orders-api"]!.notes).toBe("Takes orders, renamed as it saved.");
  });

  it("opens at once, and keeps the first editor when another Expand is pressed in the same moment", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    const expands = [...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand");
    await act(async () => {
      expands[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expands[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.box().value).toBe("");
    d.box().value = "Uses REST.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.elements.web!.uses).toEqual([
      { to: "api", description: "Calls", notes: "Uses REST." },
      { to: "api", description: "Sends events to", notes: "Over a queue." },
    ]);
  });

  it("can't save a relationship's notes until the edits made before Expand have landed", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    const description = d.panel().querySelectorAll<HTMLInputElement>('input[aria-label="Description"]')[0]!;
    const expand = [...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!;
    const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    // A slow save of the description, which leaving its box starts just before Expand.
    d.file.delay = 200;
    await act(async () => {
      description.value = "Calls over REST";
      description.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(d.editor()?.open).toBe(true);
    expect(button(d.editor()!, "Done").disabled).toBe(true);
    await wait(300);
    expect(button(d.editor()!, "Done").disabled).toBe(false);
    expect(d.editor()!.textContent).not.toContain("changed or deleted elsewhere");

    d.file.delay = 0;
    d.box().value = "Every call is authenticated.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.web!.uses![0]).toEqual({ to: "api", description: "Calls over REST", notes: "Every call is authenticated." });
  });

  it("loses track of a relationship, rather than guess, when an edit elsewhere moves them before it knows which it's on", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    const expand = [...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!;
    // The reload, which deletes the first relationship so the second takes its place, is queued
    // just before Expand is pressed for the first, as the panel still shows both.
    await act(async () => {
      d.file.change([{ op: "remove-relationship", from: "web", to: "api", index: 0 }]);
      expand.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.box().value).toBe("");
    expect(d.editor()!.textContent).toContain("Web → API was changed or deleted elsewhere, so these notes can't be saved.");
    d.box().value = "Uses REST.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.file.doc.elements.web!.uses).toEqual([{ to: "api", description: "Sends events to", notes: "Over a queue." }]);
  });

  it("lets a relationship's notes be written in a file with errors, keeps them when the save is refused, and saves them once it's fixed", async () => {
    // A shape the format doesn't have is an error that stops the file being changed safely.
    const broken = JSON.parse(serializeDocument(doc));
    broken.elements.api.shape = "blob";
    const d = await designer(JSON.stringify(broken, null, 2));
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    await click([...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!);
    await d.settle();
    expect(button(d.editor()!, "Done").disabled).toBe(false);
    d.box().value = "Uses REST.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.editor()!.textContent).toContain("These notes weren't saved. They're still here: try again, or copy them to keep them.");
    expect(d.file.doc.elements.web!.uses![0]!.notes).toBeUndefined();

    // Fixed outside, it reloads, and the notes save.
    d.file.put(serializeDocument(doc));
    await d.settle();
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.web!.uses![0]).toEqual({ to: "api", description: "Calls", notes: "Uses REST." });
  });

  it("saves a relationship's notes, and not over another's once an edit elsewhere puts that one in its place", async () => {
    const d = await designer();
    const arrow = d.host.querySelector('.react-flow__edge[data-id="web->api"]');
    expect(arrow).not.toBeNull();
    await click(arrow!);
    const expands = [...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand");
    expect(expands).toHaveLength(2);

    // The second relationship's notes save to it.
    await click(expands[1]!);
    expect(d.title()).toBe("Notes on Web → API");
    expect(d.box().value).toBe("Over a queue.");
    d.box().value = "Over a queue, in order.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.elements.web!.uses).toEqual([
      { to: "api", description: "Calls" },
      { to: "api", description: "Sends events to", notes: "Over a queue, in order." },
    ]);

    // The first relationship is deleted elsewhere while its notes are open, so the second takes its place.
    await click(expands[0]!);
    d.box().value = "Uses REST.";
    d.file.change([{ op: "remove-relationship", from: "web", to: "api", index: 0 }]);
    await d.settle();
    expect(d.editor()!.textContent).toContain("Web → API was changed or deleted elsewhere, so these notes can't be saved.");
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.file.doc.elements.web!.uses).toEqual([{ to: "api", description: "Sends events to", notes: "Over a queue, in order." }]);
  });
});
