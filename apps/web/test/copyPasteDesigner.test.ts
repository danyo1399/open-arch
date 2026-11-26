// @vitest-environment happy-dom
import { loadWorkspace, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NODE_H, NODE_W } from "../src/canvas/autoLayout.js";
import { button, click, key } from "./dom.js";
import { designer as open, type MenuDesigner } from "./menuDesigner.js";

/** A container view of the shop, placed, with a note on the web app and one on its own. */
const doc: OpenArchDocument = {
  openarch: 22,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
    orders: { kind: "component", name: "Orders", parent: "api" },
  },
  views: {
    containers: {
      title: "Containers",
      level: "container",
      scope: "shop",
      layout: { customer: [0, 0], web: [0, 300], api: [500, 300] },
      stickies: {
        why: { text: "Server-rendered", on: { element: "web" }, at: [-400, 300] },
        loose: { text: "Read me", at: [1200, 0] },
      },
    },
  },
};

const designer = () => open(doc, "containers");
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** Clicks a box or note with Ctrl (⌘ on a Mac) held, which adds it to the selection. */
async function addToSelection(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: !isMac, metaKey: isMac }));
  });
}

/** Selects the web app, the API and the note on its own, together. */
async function selectThree(d: MenuDesigner) {
  await click(d.node("web")!);
  await addToSelection(d.node("api")!);
  await addToSelection(d.node("sticky:loose")!);
  expect(d.details()).toBe("2 boxes and 1 sticky note");
}

/** Sends a copy or paste to the page, as Ctrl+C or Ctrl+V does, and returns the clipboard's text after it. */
async function clipboardEvent(type: "copy" | "paste", text = "") {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
  await act(async () => {
    document.body.dispatchEvent(event);
  });
  return { event, text: data.getData("text/plain") };
}

const elements = async (d: MenuDesigner) => [...loadWorkspace(await d.file.load()).elements.keys()].sort();

afterEach(() => vi.restoreAllMocks());

describe("several boxes selected together", () => {
  it("are deleted from the model together, with the notes selected with them, once it's confirmed, and one Undo brings them back", async () => {
    const d = await designer();
    await selectThree(d);
    await key(document.body, "Delete");
    const dialog = d.host.querySelector<HTMLElement>(".modal")!;
    expect(dialog.textContent).toContain("Delete 2 elements?");
    expect(dialog.textContent).toContain("Deleting removes Web and API from every view");
    expect(dialog.textContent).toContain("Also deletes what's inside them: Orders.");
    expect(dialog.textContent).toContain("Removes relationships to them from: Customer.");
    expect(dialog.textContent).toContain("Also deletes the sticky note selected with them.");
    await click(button(dialog, "Delete from model"));
    await d.settle();
    expect(await elements(d)).toEqual(["customer", "shop"]);
    expect((await d.saved()).stickies.map((s) => s.id)).toEqual(["why"]);

    await click(button(d.host, "Undo"));
    await d.settle();
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
    expect((await d.saved()).stickies.map((s) => s.id).sort()).toEqual(["loose", "why"]);
  });

  it("can only be hidden from the view instead, which leaves the notes", async () => {
    const d = await designer();
    await selectThree(d);
    await key(document.body, "Delete");
    await click(button(d.host.querySelector<HTMLElement>(".modal")!, "Only hide them from this view"));
    await d.settle();
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
    expect((await d.saved()).exclude.sort()).toEqual(["api", "web"]);
    expect((await d.saved()).stickies.map((s) => s.id).sort()).toEqual(["loose", "why"]);
  });

  it("have a right-click menu for them all, and Copy and Delete in their details", async () => {
    const d = await designer();
    await selectThree(d);
    await d.rightClick(d.node("api")!);
    expect(d.labels()).toEqual(["Copy", "Hide from this view", "Delete from model…"]);
    // The selection stays as it was.
    expect(d.details()).toBe("2 boxes and 1 sticky note");
    await key(document.activeElement!, "Escape");
    const details = d.host.querySelector<HTMLElement>(".properties")!;
    expect(button(details, "Copy")).toBeTruthy();
    await click(button(details, "Delete from model…"));
    expect(d.host.querySelector(".modal")!.textContent).toContain("Delete 2 elements?");
  });

  it("are copied with Ctrl+C, and pasted with Ctrl+V as new elements, selected, as one step for Undo", async () => {
    const d = await designer();
    await selectThree(d);
    const copied = await clipboardEvent("copy");
    expect(copied.event.defaultPrevented).toBe(true);
    expect(JSON.parse(copied.text).elements.map((e: { id: string }) => e.id).sort()).toEqual(["api", "orders", "web"]);

    const pasted = await clipboardEvent("paste", copied.text);
    expect(pasted.event.defaultPrevented).toBe(true);
    await d.settle();
    expect(await elements(d)).toEqual(["api", "api-2", "customer", "orders", "orders-2", "shop", "web", "web-2"]);
    const ws = loadWorkspace(await d.file.load());
    expect(ws.elements.get("web-2")!.uses.map((r) => r.to)).toEqual(["api-2"]);
    expect(ws.elements.get("orders-2")!.parent).toBe("api-2");
    expect(d.details()).toBe("2 boxes and 1 sticky note");
    // On the view they came from, a step below and to the right of them, so they don't hide them.
    expect(ws.views.get("containers")!.layout).toMatchObject({ web: [0, 300], api: [500, 300], "web-2": [40, 340], "api-2": [540, 340] });
    expect(ws.views.get("containers")!.stickies.find((s) => s.text === "Read me" && s.id !== "loose")!.at).toEqual([1240, 40]);

    // Pasted again, a step further.
    await clipboardEvent("paste", copied.text);
    await d.settle();
    expect((await d.saved()).layout).toMatchObject({ "web-3": [80, 380], "api-3": [580, 380] });

    await click(button(d.host, "Undo"));
    await d.settle();
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
  });

  it("leaves Ctrl+C and Ctrl+V to text being typed, and pastes nothing from other text", async () => {
    const d = await designer();
    await selectThree(d);
    // A box to type in, as the details have.
    const input = document.createElement("input");
    d.host.append(input);
    for (const type of ["copy", "paste"]) {
      const data = new DataTransfer();
      data.setData("text/plain", type === "paste" ? (await clipboardEvent("copy")).text : "");
      const event = new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true });
      await act(async () => void input.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    const pasted = await clipboardEvent("paste", "Just some text");
    expect(pasted.event.defaultPrevented).toBe(false);
    await d.settle();
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
  });
});

describe("several sticky notes selected together", () => {
  it("are deleted at once with Delete, without asking, and one Undo brings them back", async () => {
    const d = await designer();
    await click(d.node("sticky:why")!);
    await addToSelection(d.node("sticky:loose")!);
    expect(d.details()).toBe("2 sticky notes");
    await key(document.body, "Delete");
    expect(d.host.querySelector(".modal")).toBeNull();
    await d.settle();
    expect((await d.saved()).stickies).toEqual([]);
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect((await d.saved()).stickies.map((s) => s.id).sort()).toEqual(["loose", "why"]);
  });

  it("are deleted with Delete notes in their details", async () => {
    const d = await designer();
    await click(d.node("sticky:why")!);
    await addToSelection(d.node("sticky:loose")!);
    await click(button(d.host.querySelector<HTMLElement>(".properties")!, "Delete notes"));
    await d.settle();
    expect((await d.saved()).stickies).toEqual([]);
  });
});

describe("the several boxes' menu", () => {
  it("hides them all from the view, as one step for Undo", async () => {
    const d = await designer();
    await selectThree(d);
    await d.rightClick(d.node("api")!);
    await d.pick("Hide from this view");
    expect((await d.saved()).exclude.sort()).toEqual(["api", "web"]);
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect((await d.saved()).exclude).toEqual([]);
  });
});

describe("Copy and Paste in the menus", () => {
  it("copies one box from Copy in its details", async () => {
    const d = await designer();
    let clipboard = "";
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void (clipboard = text));
    await click(d.node("web")!);
    await click(button(d.host.querySelector<HTMLElement>(".properties")!, "Copy"));
    await d.settle();
    expect(JSON.parse(clipboard).elements.map((e: { id: string }) => e.id)).toEqual(["web"]);
    expect(d.host.querySelector(".toast")?.textContent).toContain("Copied 1 box.");
  });

  it("says why what's on the clipboard can't be pasted, and pastes none of it", async () => {
    const d = await designer();
    const odd = { copied: "open-arch/copied", elements: [{ id: "x", kind: "constructor", name: "X", picked: true }], relationships: [], stickies: [] };
    await clipboardEvent("paste", JSON.stringify(odd));
    await d.settle();
    expect(d.host.querySelector(".toast")?.textContent).toContain(`"X" is a constructor, which isn't a kind of element, so nothing was pasted.`);
    expect(await elements(d)).toEqual(["api", "customer", "orders", "shop", "web"]);
  });

  it("copies one box from its menu, and pastes it from the background's where it was clicked", async () => {
    const d = await designer();
    let clipboard = "";
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(async (text) => void (clipboard = text));
    vi.spyOn(navigator.clipboard, "readText").mockImplementation(async () => clipboard);
    await d.rightClick(d.node("api")!);
    await d.pick("Copy");
    expect(d.host.querySelector(".toast")?.textContent).toContain("Copied 1 box.");

    await d.rightClick(d.pane(), { x: 2000, y: 1500 });
    await d.pick("Paste");
    await d.settle();
    const view = await d.saved();
    // Where Add puts a new box clicked there.
    expect(view.layout["api-2"]).toEqual([2000 - NODE_W / 2, 1500 - NODE_H / 2]);
    expect(d.details()).toBe("Container");
  });

  it("says so when there's nothing to paste", async () => {
    const d = await designer();
    vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("Hello");
    await d.rightClick(d.pane(), { x: 2000, y: 1500 });
    await d.pick("Paste");
    expect(d.host.querySelector(".toast")?.textContent).toContain("There's nothing to paste here.");
  });
});
