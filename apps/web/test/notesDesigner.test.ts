// @vitest-environment happy-dom
import { applyOperations, loadWorkspace, serializeDocument, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  openarch: 21,
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
    /** Once the editor's formatted notes have loaded, shows them as markdown, and gives back their box. */
    markdown: async () => {
      await act(() => vi.waitFor(() => expect(host.querySelector("dialog.notes-editor .ProseMirror")).not.toBeNull()));
      await click(button(host.querySelector("dialog.notes-editor")!, "Markdown"));
      return host.querySelector<HTMLTextAreaElement>("dialog.notes-editor textarea")!;
    },
    /** The editor's formatted notes, once they've loaded. */
    formatted: async () => {
      await act(() => vi.waitFor(() => expect(host.querySelector("dialog.notes-editor .ProseMirror")).not.toBeNull()));
      return host.querySelector<HTMLElement>("dialog.notes-editor .ProseMirror")!;
    },
  };
}

describe("writing notes in the bigger editor", () => {
  it("opens an element's notes, saves them as one step for Undo, and shows them in the panel", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    expect(d.editor()?.open).toBe(true);
    expect(d.title()).toBe("Notes on API");
    expect((await d.markdown()).value).toBe("Takes orders.");

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

    (await d.markdown()).value = "Takes orders, now by its new name.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements["orders-api"]!.notes).toBe("Takes orders, now by its new name.");
  });

  it("follows a rename made elsewhere while it's open", async () => {
    const d = await designer();
    await d.select("API");
    await click(button(d.panel(), "Expand"));
    (await d.markdown()).value = "Takes orders, whatever it's called.";
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
    (await d.markdown()).value = "Long notes, half written.";
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

    (await d.markdown()).value = "Every call is authenticated.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.web!.uses![0]).toEqual({ to: "api", description: "Calls over REST", notes: "Every call is authenticated." });
  });

  it("checks again as the save runs, for an edit elsewhere that lands just before it", async () => {
    const d = await designer();
    await click(d.host.querySelector('.react-flow__edge[data-id="web->api"]')!);
    await click([...d.panel().querySelectorAll("button")].filter((b) => b.textContent === "Expand")[0]!);
    (await d.markdown()).value = "Uses REST.";
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
    (await d.markdown()).value = "Takes orders, renamed as it saved.";
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
    expect((await d.markdown()).value).toBe("");
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
    (await d.markdown()).value = "Every call is authenticated.";
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
    expect((await d.markdown()).value).toBe("");
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
    (await d.markdown()).value = "Uses REST.";
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
    expect((await d.markdown()).value).toBe("Over a queue.");
    d.box().value = "Over a queue, in order.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.elements.web!.uses).toEqual([
      { to: "api", description: "Calls" },
      { to: "api", description: "Sends events to", notes: "Over a queue, in order." },
    ]);

    // The first relationship is deleted elsewhere while its notes are open, so the second takes its place.
    await click(expands[0]!);
    (await d.markdown()).value = "Uses REST.";
    d.file.change([{ op: "remove-relationship", from: "web", to: "api", index: 0 }]);
    await d.settle();
    expect(d.editor()!.textContent).toContain("Web → API was changed or deleted elsewhere, so these notes can't be saved.");
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()?.open).toBe(true);
    expect(d.file.doc.elements.web!.uses).toEqual([{ to: "api", description: "Sends events to", notes: "Over a queue, in order." }]);
  });
});

describe("the chip on a box or sticky note with notes", () => {
  /** The shop, with a sticky note with notes on its container view, one without, and a sequence view. */
  const noted = (): OpenArchDocument => {
    const model = structuredClone(doc);
    model.views.containers!.stickies = {
      why: { text: "Why it's split.\nIn two.", at: [400, 0], notes: "The **API** scales on its own." },
      plain: { text: "Nothing more.", at: [400, 200] },
    };
    model.views.calls = { title: "Web calls API", level: "sequence", steps: [{ from: "web", to: "api" }], stickies: { steps: { text: "One step.", notes: "Just the one." } } };
    return model;
  };
  const chip = (host: HTMLElement, node: string) => host.querySelector<HTMLButtonElement>(`.react-flow__node[data-id="${node}"] .notes-button`);

  it("is on the boxes with notes, and opens them formatted, without selecting the box", async () => {
    const d = await designer();
    expect(chip(d.host, "web")).toBeNull();
    const api = chip(d.host, "api")!;
    expect(api.getAttribute("aria-label")).toBe("Notes on API");
    await click(api);
    await d.settle();
    expect(d.title()).toBe("Notes on API");
    expect((await d.formatted()).textContent).toBe("Takes orders.");
    expect(d.host.querySelector(".react-flow__node.selected")).toBeNull();
    expect(d.panel().textContent).not.toContain("Takes orders.");

    // Changed as markdown, the notes save, and the chip stays.
    (await d.markdown()).value = "Takes orders and refunds.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.elements.api!.notes).toBe("Takes orders and refunds.");
    expect(chip(d.host, "api")).not.toBeNull();

    // An element whose notes are taken off loses its chip; one given notes elsewhere gets one.
    d.file.change([
      { op: "update-element", id: "api", notes: null },
      { op: "update-element", id: "web", notes: "The shop's website." },
    ]);
    await d.settle();
    expect(chip(d.host, "api")).toBeNull();
    expect(chip(d.host, "web")).not.toBeNull();
  });

  it("is on the frame round a view's boxes, when what it's round has notes", async () => {
    const d = await designer(serializeDocument({ ...doc, elements: { ...doc.elements, shop: { kind: "system", name: "Shop", notes: "Sells things." } } }));
    const frame = d.host.querySelector<HTMLButtonElement>(".frame-notes .notes-button")!;
    expect(frame.getAttribute("aria-label")).toBe("Notes on Shop");
    await click(frame);
    await d.settle();
    expect(d.title()).toBe("Notes on Shop");
  });

  it("opens the notes as they are once what was typed in the details panel has saved", async () => {
    const d = await designer();
    await d.select("API");
    const notes = d.panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!;
    // Leaving the Notes box, by pressing the chip, saves what's in it; the chip is pressed before that lands.
    await act(async () => {
      notes.value = "Takes orders, typed just now.";
      notes.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      chip(d.host, "api")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect((await d.formatted()).textContent).toBe("Takes orders, typed just now.");
    expect(d.editor()!.textContent).not.toContain("changed elsewhere");
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.file.doc.elements.api!.notes).toBe("Takes orders, typed just now.");
  });

  it("opens nothing when what it's on is deleted before the edits made first have landed", async () => {
    const d = await designer(serializeDocument(noted()));
    // The reloads are queued before the presses, which come before the designer hears of them.
    await act(async () => {
      d.file.change([{ op: "remove-element", id: "api" }]);
      chip(d.host, "api")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(chip(d.host, "api")).toBeNull();

    await act(async () => {
      d.file.change([{ op: "remove-sticky", view: "containers", id: "why" }]);
      chip(d.host, "sticky:why")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await d.settle();
    expect(d.editor()).toBeNull();
    expect(d.host.querySelector('.react-flow__node[data-id="sticky:why"]')).toBeNull();
  });

  it("is on the sticky notes with notes, and opens them by the note's first line", async () => {
    const d = await designer(serializeDocument(noted()));
    expect(chip(d.host, "sticky:plain")).toBeNull();
    const why = chip(d.host, "sticky:why")!;
    expect(why.getAttribute("aria-label")).toBe("Notes on “Why it's split.”");
    await click(why);
    await d.settle();
    expect(d.title()).toBe("Notes on “Why it's split.”");
    expect((await d.formatted()).querySelector("strong")!.textContent).toBe("API");
    // Pressing it doesn't start editing the note's text either.
    expect(d.host.querySelector(".sticky.editing")).toBeNull();
    (await d.markdown()).value = "The API scales on its own, and so does the web app.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.views.containers!.stickies!.why).toEqual({ text: "Why it's split.\nIn two.", at: [400, 0], notes: "The API scales on its own, and so does the web app." });
  });

  it("is beside a sticky note's text in its details, as Notes, which Expand opens", async () => {
    const d = await designer(serializeDocument(noted()));
    await click(d.host.querySelector('.react-flow__node[data-id="sticky:plain"]')!);
    const notes = d.panel().querySelector<HTMLTextAreaElement>('textarea[aria-label="Notes"]')!;
    expect(notes.value).toBe("");
    await click(button(d.panel(), "Expand"));
    expect(d.title()).toBe("Notes on “Nothing more.”");
    (await d.markdown()).value = "Well, a little.";
    await click(button(d.editor()!, "Done"));
    await d.settle();
    expect(d.file.doc.views.containers!.stickies!.plain!.notes).toBe("Well, a little.");
    expect(chip(d.host, "sticky:plain")).not.toBeNull();

    // Deleted elsewhere while its notes are open, they aren't saved.
    await click(chip(d.host, "sticky:plain")!);
    await d.settle();
    (await d.markdown()).value = "More.";
    d.file.change([{ op: "remove-sticky", view: "containers", id: "plain" }]);
    await d.settle();
    expect(d.editor()!.textContent).toContain("“Nothing more.” was changed or deleted elsewhere, so these notes can't be saved.");
  });

  it("is on a deployment view's boxes, and on the frame round a state view, a flowchart and an entity view", async () => {
    const model = structuredClone(doc);
    model.views = {
      ...model.views,
      production: { title: "Production", level: "deployment", nodes: { server: { name: "Server", runs: ["api", "web"] } } },
      "api-states": { title: "API states", level: "state", scope: "api", initial: "up", states: { up: { name: "Up", at: [0, 0] } } },
      "api-flow": { title: "API flow", level: "flowchart", scope: "api", blocks: [{ id: "go", kind: "start", text: "Go", at: [0, 0] }] },
      "api-data": { title: "API data", level: "entity", scope: "api", entities: [{ id: "order", name: "Order", at: [0, 0] }], links: [] },
    };
    const d = await designer(serializeDocument(model));
    /** Opens a view from the Views list, once its boxes are drawn: some are laid out a moment after it opens. */
    const open = async (title: string) => {
      await click([...d.host.querySelectorAll<HTMLButtonElement>(".sidebar .row-main")].find((b) => b.textContent?.startsWith(title))!);
      for (let tries = 0; !d.host.querySelector(".react-flow__node") && tries < 50; tries++) await d.settle();
      await d.settle();
    };
    /** Presses the chip, and says whose notes the editor opened on, closing it. */
    const press = async (chip: HTMLButtonElement | null) => {
      expect(chip?.getAttribute("aria-label")).toBe("Notes on API");
      await click(chip!);
      await d.settle();
      const title = d.title();
      await click(button(d.editor()!, "Cancel"));
      return title;
    };

    await open("Production");
    expect(chip(d.host, "server/web")).toBeNull();
    expect(await press(chip(d.host, "server/api"))).toBe("Notes on API");

    await open("API states");
    expect(await press(d.host.querySelector(".frame-notes .notes-button"))).toBe("Notes on API");

    await open("API flow");
    expect(await press(d.host.querySelector(".frame-notes .notes-button"))).toBe("Notes on API");

    await open("API data");
    expect(await press(d.host.querySelector(".frame-notes .notes-button"))).toBe("Notes on API");

    // What it's round has no notes, so the frame has no chip.
    d.file.change([{ op: "update-element", id: "api", notes: null }]);
    await d.settle();
    expect(d.host.querySelector(".frame-notes .notes-button")).toBeNull();
  });

  it("is on a sequence's boxes and notes too", async () => {
    const d = await designer(serializeDocument(noted()));
    const row = [...d.host.querySelectorAll<HTMLButtonElement>(".sidebar .row-main")].find((b) => b.textContent?.includes("Web calls API"))!;
    await click(row);
    await d.settle();
    const heads = [...d.host.querySelectorAll(".sequence-head")];
    expect(heads.map((h) => !!h.querySelector(".notes-button"))).toEqual([false, true]);
    await click(heads[1]!.querySelector(".notes-button")!);
    await d.settle();
    expect(d.title()).toBe("Notes on API");
    await click(button(d.editor()!, "Cancel"));
    await click(d.host.querySelector<HTMLButtonElement>(".sequence-notes .notes-button")!);
    await d.settle();
    expect(d.title()).toBe("Notes on “One step.”");
    expect((await d.formatted()).textContent).toBe("Just the one.");
  });
});
