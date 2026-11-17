// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, choose, click, key, mount } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 15,
  name: "Shop",
  elements: {},
  views: {
    ideas: {
      title: "Ideas",
      level: "whiteboard",
      shapes: [
        { id: "cache", kind: "rectangle", text: "Cache the menus", at: [0, 0] },
        { id: "db", kind: "ellipse", text: "Orders DB", at: [300, 0] },
        { id: "scribble", kind: "pen", at: [0, 200], points: [[0, 0], [20, 10]] },
      ],
      arrows: [{ id: "reads", from: "cache", to: "db", text: "reads" }],
    },
  },
};

/** The whole designer, open on the workspace's whiteboard, once it has loaded. */
async function designer(model: OpenArchDocument = doc) {
  const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(model)), onClose() {}, onHostChange() {} }));
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  await settle();
  return {
    host,
    settle,
    shapes: () => [...host.querySelectorAll('.react-flow__node[data-id] .wb-shape')].map((n) => n.closest(".react-flow__node")!.getAttribute("data-id")),
    shape: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"] .wb-shape`)!,
    details: () => host.querySelector(".properties .props-header")?.textContent,
    facts: () => host.querySelector(".properties .facts")?.textContent,
  };
  // React Flow draws arrows only once it has measured the shapes, which this page can't do, so
  // clicking an arrow and dragging are checked in the browser.
}

describe("the designer, on a whiteboard view", () => {
  it("shows a clicked shape in the details, and Delete removes it, with the arrow to it", async () => {
    const d = await designer();
    expect(d.shapes()).toEqual(["cache", "db", "scribble"]);
    expect(d.facts()).toBe("LevelwhiteboardShapes3Arrows1");
    await click(d.shape("db"));
    expect(d.details()).toBe("Ellipse2 of 3 from the back");
    expect(d.host.querySelector(".properties")!.textContent).toContain("Arrowsreads");
    await key(document.body, "Delete");
    await d.settle();
    expect(d.shapes()).toEqual(["cache", "scribble"]);
    expect(d.details()).toBe("View");
    expect(d.facts()).toBe("LevelwhiteboardShapes2Arrows0");
    // Undo brings both back.
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, metaKey: true, bubbles: true })));
    await d.settle();
    expect(d.shapes()).toEqual(["cache", "db", "scribble"]);
    expect(d.facts()).toBe("LevelwhiteboardShapes3Arrows1");
  });

  it("changes a shape's colour, fill, text size, kind and place from the details", async () => {
    const d = await designer();
    await click(d.shape("cache"));
    await click(d.host.querySelector('.properties button[aria-label="Red"]')!);
    await d.settle();
    expect(d.shape("cache").className).toContain("wb-ink-red");
    await click(d.host.querySelector('.properties .swatches button[aria-label="Yellow"]')!);
    await d.settle();
    expect(d.shape("cache").className).toContain("wb-fill-yellow");
    await click(d.host.querySelector('.properties button[aria-label="None: see-through"]')!);
    await d.settle();
    expect(d.shape("cache").className).not.toContain("wb-fill-");
    const select = (label: string) => [...d.host.querySelectorAll<HTMLLabelElement>(".properties label.field")].find((l) => l.querySelector(".field-label")?.textContent === label)!.querySelector("select")!;
    await choose(select("Text size"), "huge");
    await choose(select("Shape"), "diamond");
    await d.settle();
    expect(d.shape("cache").className).toContain("wb-shape-diamond");
    expect(d.shape("cache").className).toContain("wb-size-huge");
    await click(button(d.host, "Bring to front"));
    await d.settle();
    expect(d.shapes()).toEqual(["db", "scribble", "cache"]);
    expect(d.details()).toBe("Diamond3 of 3 from the back");
  });

  it("deletes text whose text is emptied in the details, as it does when it's emptied on the board", async () => {
    const withText = structuredClone(doc);
    withText.views.ideas!.shapes!.push({ id: "title", kind: "text", text: "Ideas", at: [0, -100] });
    const d = await designer(withText);
    await click(d.shape("title"));
    expect(d.host.querySelector(".properties")!.textContent).toContain("Text with nothing in it is deleted.");
    const text = [...d.host.querySelectorAll<HTMLLabelElement>(".properties label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Text")!.querySelector("textarea")!;
    text.value = " ";
    await act(async () => void text.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await d.settle();
    expect(d.shapes()).toEqual(["cache", "db", "scribble"]);
    expect(d.details()).toBe("View");
    // Another shape keeps its outline, and only loses its text.
    await click(d.shape("cache"));
    const boxText = [...d.host.querySelectorAll<HTMLLabelElement>(".properties label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Text")!.querySelector("textarea")!;
    boxText.value = "";
    await act(async () => void boxText.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await d.settle();
    expect(d.shapes()).toEqual(["cache", "db", "scribble"]);
    expect(d.shape("cache").querySelector(".wb-text")).toBeNull();
    // With nothing written in it, it can't become text alone, which would draw nothing.
    const kinds = [...d.host.querySelectorAll<HTMLLabelElement>(".properties label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Shape")!;
    expect([...kinds.querySelectorAll("option")].map((o) => [o.textContent, o.disabled])).toEqual([
      ["Rectangle", false],
      ["Ellipse", false],
      ["Diamond", false],
      ["Text", true],
    ]);
    expect(kinds.textContent).toContain("Give it text to make it text alone.");
  });

  it("shows a pen's line with only what a line has: its colour and dashes", async () => {
    const d = await designer();
    await click(d.shape("scribble"));
    expect(d.details()).toBe("Pen line3 of 3 from the back");
    const labels = [...d.host.querySelectorAll(".properties .field-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Colour", "ID"]);
    expect(d.host.querySelector(".properties")!.textContent).toContain("Dashed");
  });
});
