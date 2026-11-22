// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** A title, two shapes joined by an arrow, a pen line with an arrow to it from a point, and a note. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: {},
  views: {
    ideas: {
      title: "Ideas",
      level: "whiteboard",
      shapes: [
        { id: "title", kind: "text", text: "Faster checkout", at: [0, -80], size: "large" },
        { id: "cache", kind: "rectangle", text: "Cache the menus", at: [0, 0, 180, 90], fill: "yellow" },
        { id: "db", kind: "ellipse", text: "Orders DB", at: [300, 0], color: "blue", dashed: true },
        { id: "scribble", kind: "pen", at: [300, 200], points: [[0, 0], [12, 6], [30, 2]], color: "red" },
      ],
      arrows: [
        { id: "reads", from: "cache", to: "db", text: "reads" },
        { id: "look", from: [500, 260], to: "scribble" },
      ],
      stickies: { note: { text: "Rough!", at: [0, 300] } },
    },
  },
};

/** The whole designer, open on the whiteboard. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "ideas", file);
type Open = Awaited<ReturnType<typeof designer>>;
const slow = async (): Promise<[Open, SlowHost]> => {
  const file = new SlowHost("shop.openarch", serializeDocument(doc));
  return [await designer(doc, file), file];
};
const shape = async (d: Open, id: string, view = "ideas") => (await d.saved(view)).shapes.find((s) => s.id === id);
const arrow = async (d: Open, id: string) => (await d.saved()).arrows.find((a) => a.id === id);
/** Clicks this with Shift held, which adds it to what's selected, or takes it out. */
const shiftClick = async (target: Element) => {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
  });
};
const colours = ["Black", "Grey", "Red", "Orange", "Green", "Blue", "Purple"];

describe("a whiteboard shape's right-click menu", () => {
  it("selects the shape, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("cache")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Rectangle2 of 4 from the back");
    expect(d.labels()).toEqual(["Edit text", "Shape", "Colour", "Fill", "Text size", "Make it dashed", "Bring to front", "Send to back", "Delete"]);
    // Text has no outline to dash. A pen line has no text, and no fill.
    await d.rightClick(d.node("title")!);
    expect(d.labels()).toEqual(["Edit text", "Shape", "Colour", "Fill", "Text size", "Bring to front", "Delete"]);
    await d.rightClick(d.node("scribble")!);
    expect(d.details()).toBe("Pen line4 of 4 from the back");
    expect(d.labels()).toEqual(["Colour", "Make it dashed", "Send to back", "Delete"]);
  });

  it("edits its text in place", async () => {
    const d = await designer();
    await d.rightClick(d.node("cache")!);
    await d.pick("Edit text");
    const box = d.node("cache")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
  });

  it("changes its shape, colour, fill, text size and outline", async () => {
    const d = await designer();
    await d.rightClick(d.node("cache")!);
    await d.pick("Shape");
    // Text alone needs text, which it has.
    expect(d.labels()).toEqual(["Ellipse", "Diamond", "Text"]);
    await d.pick("Diamond");
    expect((await shape(d, "cache"))!.kind).toBe("diamond");

    await d.rightClick(d.node("cache")!);
    await d.pick("Colour");
    expect(d.labels()).toEqual(colours.filter((c) => c !== "Black"));
    await d.pick("Green");
    await d.rightClick(d.node("cache")!);
    await d.pick("Fill");
    expect(d.labels()).toEqual(["None: see-through", "White", "Grey", "Red", "Orange", "Green", "Blue", "Purple"]);
    await d.pick("None: see-through");
    await d.rightClick(d.node("cache")!);
    await d.pick("Text size", "Huge");
    await d.rightClick(d.node("cache")!);
    await d.pick("Make it dashed");
    expect(await shape(d, "cache")).toMatchObject({ color: "green", size: "huge", dashed: true });
    expect((await shape(d, "cache"))!.fill).toBeUndefined();
    await d.rightClick(d.node("cache")!);
    await d.pick("Make it solid");
    expect((await shape(d, "cache"))!.dashed).toBe(false);
    // With no fill, there's none to take away.
    await d.rightClick(d.node("cache")!);
    await d.pick("Fill");
    expect(d.labels()).not.toContain("None: see-through");
  });

  it("doesn't offer text alone to a shape with no text", async () => {
    const blank = structuredClone(doc);
    blank.views.ideas!.shapes![1]!.text = undefined;
    const d = await designer(blank);
    await d.rightClick(d.node("cache")!);
    await d.pick("Shape");
    expect(d.labels()).toEqual(["Ellipse", "Diamond"]);
  });

  it("brings it to the front or sends it to the back, and deletes it, with the arrows to and from it", async () => {
    const d = await designer();
    await d.rightClick(d.node("cache")!);
    await d.pick("Bring to front");
    expect((await d.saved()).shapes.map((s) => s.id)).toEqual(["title", "db", "scribble", "cache"]);
    await d.rightClick(d.node("cache")!);
    expect(d.labels()).not.toContain("Bring to front");
    await d.pick("Send to back");
    expect((await d.saved()).shapes.map((s) => s.id)).toEqual(["cache", "title", "db", "scribble"]);
    await d.rightClick(d.node("cache")!);
    await d.pick("Delete");
    const view = await d.saved();
    expect(view.shapes.map((s) => s.id)).toEqual(["title", "db", "scribble"]);
    expect(view.arrows.map((a) => a.id)).toEqual(["look"]);
    expect(d.details()).toBe("View");
  });
});

describe("a whiteboard arrow's right-click menu", () => {
  it("selects the arrow, from its line or its grip, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("arrow:reads")!);
    expect(d.details()).toBe("Arrow");
    // Both ends are on shapes, so each can be put on a side.
    expect(d.labels()).toEqual(["Edit text", "Heads", "Colour", "Make it dashed", "Side its start is on", "Side its end is on", "Delete"]);
    // An end at a point has no sides. Its grip is the arrow's too.
    await d.rightClick(d.node("end:look:from")!);
    expect(d.details()).toBe("Arrow");
    expect(d.labels()).toEqual(["Edit text", "Heads", "Colour", "Make it dashed", "Side its end is on", "Delete"]);
  });

  it("edits its text, and changes its heads, colour, line and sides", async () => {
    const d = await designer();
    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Edit text");
    expect(document.activeElement!.tagName).toBe("TEXTAREA");
    await key(document.activeElement!, "Escape");

    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Heads");
    expect(d.labels()).toEqual(["Arrow: both ways", "Line: no heads"]);
    await d.pick("Line: no heads");
    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Colour", "Purple");
    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Make it dashed");
    expect(await arrow(d, "reads")).toMatchObject({ heads: "none", color: "purple", dashed: true });

    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Side its start is on");
    expect(d.labels()).toEqual(["Top", "Right", "Bottom", "Left"]);
    await d.pick("Bottom");
    expect((await arrow(d, "reads"))!.from).toEqual({ shape: "cache", side: "bottom" });
    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Side its start is on");
    expect(d.labels()).toEqual(["Any side, facing the other end", "Top", "Right", "Left"]);
    await d.pick("Any side, facing the other end");
    expect((await arrow(d, "reads"))!.from).toBe("cache");
  });

  it("deletes it, and nothing else", async () => {
    const d = await designer();
    await d.rightClick(d.edge("arrow:reads")!);
    await d.pick("Delete");
    const view = await d.saved();
    expect(view.arrows.map((a) => a.id)).toEqual(["look"]);
    expect(view.shapes).toHaveLength(4);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of several things selected together on a whiteboard", () => {
  it("keeps them selected when one of them is right-clicked, and deletes them all", async () => {
    const d = await designer();
    await click(d.node("cache")!);
    await shiftClick(d.node("sticky:note")!);
    await shiftClick(d.edge("arrow:look")!);
    expect(d.details()).toBe("1 shape, 1 arrow, 1 note");
    for (const one of [d.node("sticky:note")!, d.edge("arrow:look")!, d.node("cache")!]) {
      await d.rightClick(one);
      expect(d.details()).toBe("1 shape, 1 arrow, 1 note");
      expect(d.labels()).toEqual(["Delete them"]);
    }
    await d.pick("Delete them");
    const view = await d.saved();
    expect(view.shapes.map((s) => s.id)).toEqual(["title", "db", "scribble"]);
    expect(view.arrows).toEqual([]);
    expect(view.stickies).toEqual([]);
    expect(d.details()).toBe("View");
  });

  it("selects just the one right-clicked when it isn't one of them", async () => {
    const d = await designer();
    await click(d.node("cache")!);
    await shiftClick(d.node("db")!);
    await d.rightClick(d.node("title")!);
    expect(d.details()).toBe("Text1 of 4 from the back");
    expect(d.labels()).toContain("Edit text");
  });
});

describe("the right-click menus of a whiteboard's notes and background", () => {
  it("has a sticky note's menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Edit text");
    expect(document.activeElement).toBe(d.node("sticky:note")!.querySelector("textarea"));
    await key(document.activeElement!, "Escape");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and has what the toolbar has, with nothing to lay out", async () => {
    const d = await designer();
    await click(d.node("cache")!);
    await d.rightClick(d.pane());
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Rectangle", "Ellipse", "Diamond", "Text", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("adds a shape with its middle where it was clicked, text beside it, and a sticky note by it", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1000, y: 600 });
    await d.pick("Add", "Ellipse");
    expect(await shape(d, "ellipse")).toMatchObject({ kind: "ellipse", at: [920, 560, 160, 80] });
    expect(d.details()).toBe("Ellipse5 of 5 from the back");

    await d.rightClick(d.pane(), { x: 1000, y: 1200 });
    await d.pick("Add", "Text");
    const box = d.host.querySelector<HTMLTextAreaElement>(".wb-text-draft textarea")!;
    expect(document.activeElement).toBe(box);
    await write(box, "Ship it");
    await d.settle();
    expect((await d.saved()).shapes.at(-1)).toMatchObject({ kind: "text", text: "Ship it" });
    expect((await d.saved()).shapes.at(-1)!.at![1]).toBeLessThan(1200);

    await d.rightClick(d.pane(), { x: 3000, y: 1500 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1450] });
  });

  it("opens with a drawing tool picked too, as only the left button draws", async () => {
    const d = await designer();
    await click(d.host.querySelector('[aria-label="Rectangle"]')!);
    await d.rightClick(d.node("db")!);
    expect(d.details()).toBe("Ellipse3 of 4 from the back");
    expect(d.labels()).toContain("Fill");
    await key(document.activeElement!, "Escape");
    await d.rightClick(d.edge("arrow:reads")!);
    expect(d.details()).toBe("Arrow");
    await d.pick("Edit text");
    expect(document.activeElement!.tagName).toBe("TEXTAREA");
    await key(document.activeElement!, "Escape");
    await d.rightClick(d.node("end:look:from")!);
    expect(d.details()).toBe("Arrow");
    await key(document.activeElement!, "Escape");
    await d.rightClick(d.pane(), { x: 1000, y: 1200 });
    expect(d.details()).toBe("View");
    await d.pick("Add", "Text");
    const box = d.host.querySelector<HTMLTextAreaElement>(".wb-text-draft textarea")!;
    expect(document.activeElement).toBe(box);
    await write(box, "Later");
    await d.settle();
    expect((await d.saved()).shapes.map((s) => s.text ?? s.kind)).toEqual(["Faster checkout", "Cache the menus", "Orders DB", "pen", "Later"]);
  });

  it("opens no menu while a stroke is being drawn, as a long press on a touch screen asks for one", async () => {
    const d = await designer();
    await click(d.host.querySelector('[aria-label="Rectangle"]')!);
    const at = (x: number, y: number) => ({ bubbles: true, button: 0, pointerId: 7, ...d.onScreen({ x, y }) });
    await act(async () => {
      d.pane().dispatchEvent(new PointerEvent("pointerdown", at(1000, 1000)));
    });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...d.onScreen({ x: 1000, y: 1000 }) });
    await act(async () => {
      d.node("db")!.dispatchEvent(event);
      await new Promise<void>((resolve) => setTimeout(resolve));
    });
    expect(event.defaultPrevented).toBe(true);
    expect(d.menuOpen()).toBe(false);
    expect(d.details()).toBe("View");
    // The stroke is drawn as it was going to be.
    await act(async () => {
      window.dispatchEvent(new PointerEvent("pointerup", at(1200, 1100)));
    });
    await d.settle();
    expect((await d.saved()).shapes.at(-1)).toMatchObject({ kind: "rectangle", at: [1000, 1000, 200, 100] });
  });
});

describe("a whiteboard's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("db")!, 300, 420);
    await d.menuKey(d.node("db")!);
    expect(d.details()).toBe("Ellipse3 of 4 from the back");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the shape under the new ID typed for it, and on an arrow to it", async () => {
    for (const target of ["db", "reads"]) {
      const [d, file] = await slow();
      await click(d.node("db")!);
      file.hold = true;
      await write(d.host.querySelector<HTMLInputElement>('input[aria-label="ID"]')!, "orders");
      await d.rightClick(target === "db" ? d.node("db")! : d.edge("arrow:reads")!);
      expect(d.menuOpen()).toBe(false);
      file.release();
      await d.settle();
      expect(d.node("orders"), target).not.toBeNull();
      await d.pick("Delete");
      const view = await d.saved();
      expect(view.arrows.map((a) => a.id), target).toEqual(["look"]);
      expect(view.shapes.some((s) => s.id === "orders"), target).toBe(target !== "db");
    }
  });

  it("opens on what was clicked while text just typed on the board is being saved, and keeps it selected", async () => {
    const [d, file] = await slow();
    await d.rightClick(d.pane(), { x: 1000, y: 1200 });
    await d.pick("Add", "Text");
    file.hold = true;
    // Clicking away saves the text, as a new shape, which is selected once it's saved.
    await write(d.host.querySelector<HTMLTextAreaElement>(".wb-text-draft textarea")!, "Later");
    await d.rightClick(d.node("db")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect((await d.saved()).shapes.at(-1)).toMatchObject({ kind: "text", text: "Later" });
    expect(d.menuOpen()).toBe(true);
    expect(d.details()).toBe("Ellipse3 of 5 from the back");
    expect(d.labels()).toContain("Fill");
  });

  it("doesn't open on an arrow that goes with a shape deleted just before", async () => {
    const [d, file] = await slow();
    await click(d.node("cache")!);
    file.hold = true;
    await click(button(d.host, "Delete"));
    await d.rightClick(d.edge("arrow:reads")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    expect((await d.saved()).arrows.map((a) => a.id)).toEqual(["look"]);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const [d, file] = await slow();
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Brainstorm");
    await d.rightClick(d.node("db")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Ellipse3 of 4 from the back");
    await d.pick("Delete");
    expect((await d.saved("brainstorm")).shapes.map((s) => s.id)).toEqual(["title", "cache", "scribble"]);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const [d, file] = await slow();
    await d.rightClick(d.node("db")!);
    await d.pick("Make it solid");
    await d.rightClick(d.node("db")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("db")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
