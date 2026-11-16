// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { boxedSelection, drawnArrowEnds, drawnBox, moveOps, WhiteboardDiagram } from "../src/canvas/WhiteboardDiagram.js";
import type { PlacedShape } from "../src/canvas/whiteboard.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, click, key, mount } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 14,
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

const view = (model: OpenArchDocument = shop) => buildWorkspace(model).views.get("ideas")!;

/** The whiteboard's diagram. It keeps the edits it sends, and what it selects. */
async function diagram(model: OpenArchDocument = shop, selection: Selection = null) {
  const ws = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(WhiteboardDiagram, {
        computed: computeView(ws, ws.views.get("ideas")!),
        selection,
        onSelect: (s: Selection) => void selected.push(s),
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return true;
        },
        exportItems: [],
        snap: { settings: SNAP_DEFAULTS, set() {} },
      }),
    ),
  );
  // The shapes are drawn an effect later.
  await act(async () => {});
  return { host, edits, selected };
  // React Flow draws arrows only once it has measured the shapes, which this page can't do, so
  // arrows, and dragging shapes and arrows' ends, are checked in the browser. The edits a drag
  // sends are tested below.
}

/** Presses the pointer at a point on the page, moves it to another, and lets go, as a drag with a drawing tool. */
async function draw(target: Element, from: [number, number], ...to: [number, number][]) {
  const at = ([clientX, clientY]: [number, number]) => ({ bubbles: true, button: 0, pointerId: 1, clientX, clientY });
  await act(async () => void target.dispatchEvent(new PointerEvent("pointerdown", at(from))));
  for (const point of to) await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", at(point))));
  await act(async () => void window.dispatchEvent(new PointerEvent("pointerup", at(to[to.length - 1] ?? from))));
}

const tool = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`.wb-tools button[aria-label="${label}"]`)!;
const pressed = (host: HTMLElement) => host.querySelector(".wb-tools button[aria-pressed=true]")?.getAttribute("aria-label");

describe("WhiteboardDiagram", () => {
  it("draws each shape with its text, sketched in its colour and fill, and a pen's line, and the sticky note", async () => {
    const { host } = await diagram();
    const node = (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"] .wb-shape`)!;
    expect([...host.querySelectorAll(".wb-shape .wb-text")].map((t) => t.textContent)).toEqual(["Faster checkout", "Cache the menus", "Orders DB"]);
    expect(node("cache").className).toContain("wb-shape-rectangle");
    expect(node("cache").className).toContain("wb-fill-yellow");
    // Its outline is sketched twice over, as a marker draws it, and filled.
    expect(node("cache").querySelectorAll("path.wb-stroke").length).toBeGreaterThan(0);
    expect(node("cache").querySelectorAll("path.wb-fill")).toHaveLength(1);
    expect(node("db").className).toContain("wb-ink-blue");
    expect(node("db").className).toContain("dashed");
    expect(node("db").querySelectorAll("path.wb-fill")).toHaveLength(0);
    expect(node("title").className).toContain("wb-size-large");
    expect(node("title").querySelector("svg")).toBeNull();
    expect(node("scribble").querySelector("path.wb-pen-line")?.getAttribute("d")).toBe("M 6 6 Q 18 12 27 10 L 36 8");
    expect(host.querySelector(".sticky-text")?.textContent).toBe("Rough!");
    expect(host.textContent).toContain("whiteboard view");
    expect(host.querySelector(".empty-hint")).toBeNull();
  });

  it("draws each shape over the ones before it, and a selected one with grips to resize it, but not a pen's line", async () => {
    const { host } = await diagram(shop, { kind: "board", shapes: ["cache", "scribble"], arrows: [], stickies: [] });
    const wrapper = (id: string) => host.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
    expect(["title", "cache", "db", "scribble"].map((id) => wrapper(id).style.zIndex)).toEqual(["1", "2", "3", "4"]);
    expect(wrapper("cache").classList.contains("selected")).toBe(true);
    expect(wrapper("cache").querySelector(".react-flow__resize-control")).not.toBeNull();
    expect(wrapper("scribble").querySelector(".react-flow__resize-control")).toBeNull();
    expect(wrapper("db").classList.contains("selected")).toBe(false);
  });

  it("picks a tool from the bottom of the board, or with its key, and goes back to selecting on Escape", async () => {
    const { host } = await diagram();
    expect([...host.querySelectorAll(".wb-tools button")].map((b) => b.getAttribute("title"))).toEqual([
      "Select and move (V)",
      "Rectangle (R)",
      "Ellipse (O)",
      "Diamond (D)",
      "Arrow (A)",
      "Line (L)",
      "Pen (P)",
      "Text (T)",
    ]);
    expect(pressed(host)).toBe("Select and move");
    await click(tool(host, "Pen"));
    expect(pressed(host)).toBe("Pen");
    expect(host.querySelector(".whiteboard")!.classList.contains("drawing")).toBe(true);
    await key(document.body, "r");
    expect(pressed(host)).toBe("Rectangle");
    await key(document.body, "Escape");
    expect(pressed(host)).toBe("Select and move");
    // Typing in a box doesn't pick tools.
    const input = document.createElement("input");
    document.body.append(input);
    await key(input, "p");
    expect(pressed(host)).toBe("Select and move");
    input.remove();
  });

  it("draws a rectangle by dragging, then goes back to selecting it", async () => {
    const { host, edits, selected } = await diagram();
    await click(tool(host, "Rectangle"));
    await draw(host.querySelector(".react-flow__pane")!, [600, 500], [650, 520], [700, 560]);
    expect(edits).toEqual([[{ op: "add-shape", view: "ideas", id: "rectangle", kind: "rectangle", at: [600, 500, 100, 60] }]]);
    expect(selected).toEqual([{ kind: "shape", id: "rectangle" }]);
    expect(pressed(host)).toBe("Select and move");
  });

  it("draws a line with the pen, over a shape too, and keeps the pen", async () => {
    const { host, edits } = await diagram();
    await click(tool(host, "Pen"));
    await draw(host.querySelector('.react-flow__node[data-id="cache"]')!, [10, 10], [20, 20], [30, 30], [40, 10]);
    expect(edits).toEqual([[{ op: "add-shape", view: "ideas", id: "pen", kind: "pen", at: [10, 10], points: [[0, 0], [20, 20], [30, 0]] }]]);
    expect(pressed(host)).toBe("Pen");
  });

  it("types text where the text tool is clicked, and makes a text shape of it, or nothing if it's left empty", async () => {
    const { host, edits } = await diagram();
    await click(tool(host, "Text"));
    await draw(host.querySelector(".react-flow__pane")!, [400, 400]);
    const box = host.querySelector<HTMLTextAreaElement>(".wb-text-draft textarea")!;
    expect(box).not.toBeNull();
    box.value = "An idea";
    // React hears a text box lose focus as focusout.
    await act(async () => void box.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(edits).toEqual([[{ op: "add-shape", view: "ideas", id: "text", kind: "text", text: "An idea", at: [392, 380] }]]);
    expect(host.querySelector(".wb-text-draft")).toBeNull();
    await click(tool(host, "Text"));
    await draw(host.querySelector(".react-flow__pane")!, [400, 400]);
    await act(async () => void host.querySelector(".wb-text-draft textarea")!.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(edits).toHaveLength(1);
  });

  it("writes in a shape the text tool clicks, and removes text that's left with nothing to say", async () => {
    const { host, edits, selected } = await diagram();
    await click(tool(host, "Text"));
    await draw(host.querySelector('.react-flow__node[data-id="cache"]')!, [20, 20]);
    expect(selected).toEqual([{ kind: "shape", id: "cache" }]);
    expect(pressed(host)).toBe("Select and move");
    expect(host.querySelector(".wb-text-draft")).toBeNull();
    const box = host.querySelector<HTMLTextAreaElement>('.react-flow__node[data-id="cache"] textarea')!;
    expect(box.value).toBe("Cache the menus");
    box.value = "Cache the menus, for a day";
    await act(async () => void box.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    // Double-clicking text writes in it too.
    await act(async () => void host.querySelector('.react-flow__node[data-id="title"] .wb-shape')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const title = host.querySelector<HTMLTextAreaElement>('.react-flow__node[data-id="title"] textarea')!;
    title.value = "  ";
    await act(async () => void title.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(edits).toEqual([
      [{ op: "update-shape", view: "ideas", id: "cache", text: "Cache the menus, for a day" }],
      [{ op: "remove-shape", view: "ideas", id: "title" }],
    ]);
  });

  it("adds a rectangle, an ellipse, a diamond or a note from + Add, in the middle of the board", async () => {
    const { host, edits, selected } = await diagram();
    const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === text)!;
    await click(button(host, "+ Add"));
    expect([...document.querySelectorAll('.context-menu [role="menuitem"]')].map((b) => b.textContent)).toEqual(["Rectangle", "Ellipse", "Diamond", "Text", "Sticky note"]);
    await click(item("Ellipse"));
    await click(button(host, "+ Add"));
    await click(item("Sticky note"));
    expect(edits.map((e) => e.map((op) => op.op))).toEqual([["add-shape"], ["add-sticky"]]);
    expect(edits[0]![0]).toMatchObject({ op: "add-shape", view: "ideas", id: "ellipse", kind: "ellipse" });
    expect((edits[0]![0] as Extract<Operation, { op: "add-shape" }>).at!.slice(2)).toEqual([160, 80]);
    expect(edits[1]![0]).toMatchObject({ op: "add-sticky", view: "ideas", id: "note-2", text: "New note" });
    expect(selected).toEqual([
      { kind: "shape", id: "ellipse" },
      { kind: "sticky", id: "note-2" },
    ]);
  });

  it("says how to start when there's nothing on it", async () => {
    const empty = structuredClone(shop);
    empty.views.ideas = { title: "Ideas", level: "whiteboard", shapes: [], arrows: [] };
    const { host } = await diagram(empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This whiteboard is empty.");
  });
});

describe("drawing and moving on a whiteboard", () => {
  const placed: PlacedShape[] = [
    { id: "cache", kind: "rectangle", box: { x: 0, y: 0, w: 180, h: 90 } },
    { id: "db", kind: "ellipse", box: { x: 300, y: 0, w: 160, h: 80 } },
  ];

  it("saves where shapes and notes were dragged, from a pen line's corner, and leaves out a shape that didn't move", () => {
    expect(
      moveOps(view(), [
        { kind: "shape", id: "cache", position: { x: 10.4, y: 20.6 } },
        { kind: "shape", id: "db", position: { x: 300, y: 0 } },
        // A pen's box is round its points, 6 pixels out.
        { kind: "shape", id: "scribble", position: { x: 394, y: 294 } },
        { kind: "sticky", id: "note", position: { x: 5, y: 6 } },
      ], placed),
    ).toEqual([
      { op: "update-shape", view: "ideas", id: "cache", at: [10, 21] },
      { op: "update-shape", view: "ideas", id: "scribble", at: [400, 300] },
      { op: "update-sticky", view: "ideas", id: "note", at: [5, 6] },
    ]);
  });

  it("puts an arrow's end dragged on its own onto the shape it's let go on, but not the one at its other end, or at the point", () => {
    const end = (arrow: string, which: "from" | "to", x: number, y: number) => ({ kind: "end" as const, arrow, end: which, point: { x, y } });
    expect(moveOps(view(), [end("look", "from", 20, 20)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: "cache" }]);
    expect(moveOps(view(), [end("reads", "to", 20, 20)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", to: [20, 20] }]);
    expect(moveOps(view(), [end("reads", "to", 700.4, 20.6)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", to: [700, 21] }]);
    // Dragged with others, the ends of an arrow stay at their points, in one edit of it.
    expect(moveOps(view(), [end("look", "from", 20, 20), { kind: "shape", id: "cache", position: { x: 1, y: 1 } }], placed)).toEqual([
      { op: "update-shape", view: "ideas", id: "cache", at: [1, 1] },
      { op: "update-arrow", view: "ideas", id: "look", from: [20, 20] },
    ]);
    expect(moveOps(view(), [end("look", "from", 1, 2), end("look", "to", 3, 4)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: [1, 2], to: [3, 4] }]);
  });

  it("selects what a drag across the board has inside it, and the arrows all of whose ends are", () => {
    expect(boxedSelection(view(), new Set(["cache", "db", "sticky:note"]))).toEqual({ kind: "board", shapes: ["cache", "db"], arrows: ["reads"], stickies: ["note"] });
    // An arrow from a point is in it when the grip at its point is.
    expect(boxedSelection(view(), new Set(["scribble", "end:look:from"]))).toEqual({ kind: "board", shapes: ["scribble"], arrows: ["look"], stickies: [] });
    expect(boxedSelection(view(), new Set(["scribble"]))).toEqual({ kind: "shape", id: "scribble" });
    expect(boxedSelection(view(), new Set(["end:look:from"]))).toBeNull();
    expect(boxedSelection(view(), new Set())).toBeNull();
  });

  it("draws a shape from corner to corner, whichever way it's dragged, or the usual size centred on a click", () => {
    expect(drawnBox({ x: 100, y: 100 }, { x: 40.4, y: 20.6 }, 1)).toEqual([40, 21, 60, 79]);
    expect(drawnBox({ x: 100, y: 100 }, { x: 102, y: 101 }, 1)).toEqual([20, 60, 160, 80]);
    // A few pixels on the diagram are a drag when it's zoomed in.
    expect(drawnBox({ x: 100, y: 100 }, { x: 104, y: 103 }, 4)).toEqual([100, 100, 10, 10]);
  });

  it("draws an arrow from a shape or a point to another shape or a point, but not a click on nothing", () => {
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 350, y: 40 }, "cache", placed, 1)).toEqual({ from: "cache", to: "db" });
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 600, y: 300 }, "cache", placed, 1)).toEqual({ from: "cache", to: [600, 300] });
    expect(drawnArrowEnds({ x: 600.4, y: 300 }, { x: 20, y: 20 }, undefined, placed, 1)).toEqual({ from: [600, 300], to: "cache" });
    // Not back to the shape it starts on.
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 60, y: 60 }, "cache", placed, 1)).toEqual({ from: "cache", to: [60, 60] });
    expect(drawnArrowEnds({ x: 600, y: 300 }, { x: 601, y: 301 }, undefined, placed, 1)).toBeNull();
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 21, y: 21 }, "cache", placed, 1)).toBeNull();
  });
});
