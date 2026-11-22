// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { NODE_H, NODE_W, STICKY } from "../src/canvas/autoLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** A container view of the shop, placed, with a note on the web app and one on its own. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop" },
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

/** The whole designer, open on the container view, with its boxes measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "containers", file);
type Open = Awaited<ReturnType<typeof designer>>;
const slow = async (): Promise<[Open, SlowHost]> => {
  const file = new SlowHost("shop.openarch", serializeDocument(doc));
  return [await designer(doc, file), file];
};
const note = async (d: Open, id: string, view = "containers") => (await d.saved(view)).stickies.find((s) => s.id === id);

describe("a sticky note's right-click menu on a view of boxes", () => {
  it("selects the note, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("sticky:loose")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    // One that's on a box goes back next to it.
    await d.rightClick(d.node("sticky:why")!);
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move next to what it's on", "Delete note"]);
    // Only one menu is open.
    expect(document.querySelectorAll(".context-menu").length).toBe(1);
  });

  it("edits it in place, changes its colour, moves it back and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:why")!);
    await d.pick("Edit text");
    const box = d.node("sticky:why")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
    await key(box, "Escape");

    await d.rightClick(d.node("sticky:why")!);
    await d.pick("Colour", "Blue");
    expect((await note(d, "why"))!.color).toBe("blue");
    await d.rightClick(d.node("sticky:why")!);
    await d.pick("Move next to what it's on");
    expect(await note(d, "why")).toMatchObject({ on: { element: "web" } });
    expect((await note(d, "why"))!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:loose")!);
    await d.pick("Edit notes…");
    await click(button(d.host.querySelector("dialog.notes-editor") as HTMLElement, "Cancel"));
    await d.rightClick(d.node("sticky:loose")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies.map((s) => s.id)).toEqual(["why"]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of a view of boxes' background", () => {
  it("selects nothing, and has what the toolbar has", async () => {
    const d = await designer();
    await click(d.node("web")!);
    await d.rightClick(d.pane(), { x: 2000, y: 1500 });
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Container in Shop", "Shared library", "Person", "Software system", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("adds an element and a sticky note where it was clicked", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 2000, y: 1500 });
    await d.pick("Add", "Container in Shop");
    const view = await d.saved();
    expect(view.layout["new-container"]).toEqual([2000 - NODE_W / 2, 1500 - NODE_H / 2]);
    expect(d.details()).toBe("Container");

    await d.rightClick(d.pane(), { x: 3000, y: 2500 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.text === "New note")).toMatchObject({ at: [3000 - STICKY.width / 2, 2450] });
  });

  it("lays the boxes out again, and has no Auto layout when there's nothing to lay out", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 2000, y: 1500 });
    await d.pick("Auto layout");
    expect((await d.saved()).layout).not.toEqual({ customer: [0, 0], web: [0, 300], api: [500, 300] });

    const empty = await open({ ...doc, views: { landscape: { title: "Landscape", level: "landscape", exclude: ["customer", "shop"] } } }, "landscape");
    await empty.rightClick(empty.pane());
    expect(empty.labels()).toEqual(["Add", "Export"]);
  });

  it("leaves a box and the frame with the menus they had", async () => {
    const d = await designer();
    await d.rightClick(d.node("web")!);
    expect(d.details()).toBe("Container");
    expect(d.labels()).toEqual(["Find usages", "Hide from this view", "Add sticky note", "New view", "Delete from model…"]);
    await key(document.activeElement!, "Escape");
    // The frame is the system's, and takes no clicks: a right-click on it is on the background, and opens the system's menu.
    await d.rightClick(d.pane(), { x: 250, y: 400 });
    expect(d.details()).toBe("System");
    expect(d.labels()).toContain("New view");
    expect(document.querySelectorAll(".context-menu").length).toBe(1);
  });
});

describe("a view of boxes' right-click menu, opened with the keyboard or after an edit", () => {
  it("opens on a note under the keyboard", async () => {
    const d = await designer();
    put(d.node("sticky:loose")!, 300, 420);
    await d.menuKey(d.node("sticky:loose")!);
    expect(d.details()).toBe("Sticky note");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const [d, file] = await slow();
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Shop parts");
    await d.rightClick(d.node("sticky:loose")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Sticky note");
    await d.pick("Delete note");
    expect((await d.saved("shop-parts")).stickies.map((s) => s.id)).toEqual(["why"]);
  });

  it("doesn't open on a note deleted just before", async () => {
    const [d, file] = await slow();
    await click(d.node("sticky:loose")!);
    file.hold = true;
    await click(button(d.host, "Delete note"));
    await d.rightClick(d.node("sticky:loose")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const [d, file] = await slow();
    await d.rightClick(d.node("sticky:loose")!);
    await d.pick("Colour", "Green");
    await d.rightClick(d.node("sticky:loose")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("sticky:loose")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
