// @vitest-environment happy-dom
import { applyOperations, buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement, useMemo, useState } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { boxedSelection, drawnArrowEnds, drawnBox, dropEnd, endAt, moveOps, WhiteboardDiagram } from "../src/canvas/WhiteboardDiagram.js";
import type { PlacedShape } from "../src/canvas/whiteboard.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, click, key, mount } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 15,
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

/**
 * The diagram, with a model the test changes as an edit landing would, and edits that wait until
 * the test says whether they were saved, as edits wait their turn while a save is slow.
 */
async function waiting() {
  let setModel!: (model: OpenArchDocument) => void;
  const edits: { ops: Operation[]; done(ok: boolean): void }[] = [];
  function Harness() {
    const [model, set] = useState(shop);
    setModel = set;
    const computed = useMemo(() => {
      const ws = buildWorkspace(model);
      return computeView(ws, ws.views.get("ideas")!);
    }, [model]);
    return createElement(
      ReactFlowProvider,
      null,
      createElement(WhiteboardDiagram, {
        computed,
        selection: null,
        onSelect() {},
        edit: (e: Edit) => new Promise<boolean>((resolve) => void edits.push({ ops: typeof e === "function" ? e(buildWorkspace(model)) : e, done: resolve })),
        exportItems: [],
        snap: { settings: SNAP_DEFAULTS, set() {} },
      }),
    );
  }
  const host = mount(createElement(Harness));
  await act(async () => {});
  return { host, edits, change: (model: OpenArchDocument) => act(async () => setModel(model)) };
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

  it("gives each new shape an ID of its own while the ones before it wait to be saved, and frees the ID of one that's refused", async () => {
    const { host, edits, change } = await waiting();
    const ids = () => edits.map((e) => (e.ops[0] as { id: string }).id);
    await click(tool(host, "Pen"));
    const pane = host.querySelector(".react-flow__pane")!;
    await draw(pane, [600, 600], [640, 620]);
    await draw(pane, [600, 700], [640, 720]);
    expect(ids()).toEqual(["pen", "pen-2"]);
    // The first is saved, and the view has it, while the second still waits its turn.
    const landed = structuredClone(shop);
    landed.views.ideas!.shapes!.push({ id: "pen", kind: "pen", at: [600, 600], points: [[0, 0], [40, 20]] });
    await act(async () => edits[0]!.done(true));
    await change(landed);
    await draw(pane, [600, 800], [640, 820]);
    expect(ids()).toEqual(["pen", "pen-2", "pen-3"]);
    // The second is refused, so its ID is free for the next.
    await act(async () => edits[1]!.done(false));
    await draw(pane, [600, 900], [640, 920]);
    expect(ids()).toEqual(["pen", "pen-2", "pen-3", "pen-2"]);
  });

  it("keeps the point where a pen's line is let go, even with no move to it", async () => {
    const { host, edits } = await diagram();
    await click(tool(host, "Pen"));
    const pane = host.querySelector(".react-flow__pane")!;
    const at = (clientX: number, clientY: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX, clientY });
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointerdown", at(10, 10))));
    await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", at(20, 20))));
    await act(async () => void window.dispatchEvent(new PointerEvent("pointerup", at(60, 10))));
    expect(edits).toEqual([[{ op: "add-shape", view: "ideas", id: "pen", kind: "pen", at: [10, 10], points: [[0, 0], [10, 10], [50, 0]] }]]);
  });

  it("shows the sides of the shape an arrow would go onto, with the one it would go on bigger, but not of the shape it starts on", async () => {
    const { host } = await diagram();
    const pane = host.querySelector(".react-flow__pane")!;
    const dots = () => [...host.querySelectorAll(".wb-sides circle")].map((c) => [c.getAttribute("cx"), c.getAttribute("cy"), c.classList.contains("near")]);
    const at = (clientX: number, clientY: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX, clientY });
    await click(tool(host, "Arrow"));
    // Pointing at the rectangle, near its right side's middle, before anything's drawn.
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointermove", at(175, 44))));
    expect(dots()).toEqual([
      ["90", "0", false],
      ["180", "45", true],
      ["90", "90", false],
      ["0", "45", false],
    ]);
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointermove", at(900, 900))));
    expect(dots()).toEqual([]);
    // Drawing from the rectangle, its own sides don't show, and the ellipse's do.
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointerdown", at(20, 20))));
    await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", at(178, 46))));
    expect(dots()).toEqual([]);
    await act(async () => void window.dispatchEvent(new PointerEvent("pointermove", at(302, 38))));
    expect(dots().map((d) => d[2])).toEqual([false, false, false, true]);
  });

  it("shows no dots for where the pointer was once it's pressed to draw, or the board zooms, until it moves again", async () => {
    const { host } = await diagram();
    const pane = host.querySelector(".react-flow__pane")!;
    const dots = () => host.querySelectorAll(".wb-sides circle").length;
    const at = (clientX: number, clientY: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX, clientY });
    await click(tool(host, "Arrow"));
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointermove", at(175, 44))));
    expect(dots()).toBe(4);
    // A click, which draws nothing.
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointerdown", at(175, 44))));
    await act(async () => void window.dispatchEvent(new PointerEvent("pointerup", at(175, 44))));
    expect(dots()).toBe(0);
    await act(async () => void pane.dispatchEvent(new PointerEvent("pointermove", at(176, 44))));
    expect(dots()).toBe(4);
    await click(host.querySelector(".react-flow__controls-zoomin")!);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));
    expect(dots()).toBe(0);
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
    expect(moveOps(view(), [end("look", "from", 20, 20)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: "cache", fromSide: null }]);
    expect(moveOps(view(), [end("reads", "to", 20, 20)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", to: [20, 20] }]);
    expect(moveOps(view(), [end("reads", "to", 700.4, 20.6)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", to: [700, 21] }]);
    // Dragged with others, the ends of an arrow stay at their points, in one edit of it.
    expect(moveOps(view(), [end("look", "from", 20, 20), { kind: "shape", id: "cache", position: { x: 1, y: 1 } }], placed)).toEqual([
      { op: "update-shape", view: "ideas", id: "cache", at: [1, 1] },
      { op: "update-arrow", view: "ideas", id: "look", from: [20, 20] },
    ]);
    expect(moveOps(view(), [end("look", "from", 1, 2), end("look", "to", 3, 4)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: [1, 2], to: [3, 4] }]);
  });

  it("puts an arrow's end dragged on its own onto the side of a shape it's let go near, which takes it over the shape it's in", () => {
    const end = (arrow: string, which: "from" | "to", x: number, y: number) => ({ kind: "end" as const, arrow, end: which, point: { x, y } });
    // Near the ellipse's left tip, outside it, and near the rectangle's bottom, inside it.
    expect(moveOps(view(), [end("look", "from", 292, 42)], placed, 16)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: { shape: "db", side: "left" } }]);
    expect(moveOps(view(), [end("look", "from", 90, 80)], placed, 16)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: { shape: "cache", side: "bottom" } }]);
    // Not onto a side of the shape at its other end; with no reach, onto the shape, facing the other end.
    expect(moveOps(view(), [end("reads", "to", 90, 80)], placed, 16)).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", to: [90, 80] }]);
    expect(moveOps(view(), [end("look", "from", 90, 80)], placed)).toEqual([{ op: "update-arrow", view: "ideas", id: "look", from: "cache", fromSide: null }]);
    // Let go in the middle of the shape it's on a side of, it faces the other end, as it's shown to while it's dragged.
    const sided = structuredClone(shop);
    sided.views.ideas!.arrows![0]!.from = { shape: "cache", side: "right" };
    const ops = moveOps(view(sided), [end("reads", "from", 90, 45)], placed, 16);
    expect(ops).toEqual([{ op: "update-arrow", view: "ideas", id: "reads", from: "cache", fromSide: null }]);
    expect(applyOperations(sided, ops).doc.views.ideas!.arrows![0]!.from).toBe("cache");
    // Let go on another of its dots, it goes onto that side.
    expect(applyOperations(sided, moveOps(view(sided), [end("reads", "from", 90, 88)], placed, 16)).doc.views.ideas!.arrows![0]!.from).toEqual({ shape: "cache", side: "bottom" });
    // The shape in front wins, with a side of it, or itself, over a side of a shape behind it.
    const front = [...placed, { id: "front", kind: "rectangle" as const, box: { x: 80, y: 60, w: 50, h: 50 } }];
    expect(endAt(front, { x: 90, y: 88 }, 16)).toEqual({ shape: "front", side: "left" });
    // Near the rectangle's bottom, behind, but inside the shape in front.
    expect(endAt(front, { x: 95, y: 95 }, 16)).toBe("front");
    expect(endAt(placed, { x: 95, y: 95 }, 16)).toEqual({ shape: "cache", side: "bottom" });
    expect(endAt(placed, { x: 900, y: 900 }, 16)).toBeUndefined();
    // An ellipse is the shape inside its outline, not in its box's corners.
    expect(endAt(placed, { x: 305, y: 3 }, 16)).toBeUndefined();
  });

  it("joins an arrow dragged from a shape's dot to the shape React Flow drops it on, anywhere on its box, on a side near the pointer", () => {
    // In the corner of the ellipse's box, outside its outline, as React Flow counts a drop anywhere on its box.
    expect(dropEnd(placed, { x: 305, y: 3 }, 16, "cache", "db")).toBe("db");
    expect(dropEnd(placed, { x: 302, y: 38 }, 16, "cache", "db")).toEqual({ shape: "db", side: "left" });
    // Not onto the shape it's dragged from; with nothing to drop on, as endAt says.
    expect(dropEnd(placed, { x: 20, y: 20 }, 16, "cache", "cache")).toBeUndefined();
    expect(dropEnd(placed, { x: 302, y: 38 }, 16, "cache")).toEqual({ shape: "db", side: "left" });
    expect(dropEnd(placed, { x: 305, y: 3 }, 16, "cache")).toBeUndefined();
  });

  it("draws an arrow from a side of a shape to a side of another, when it's pressed and let go near their points", () => {
    expect(drawnArrowEnds({ x: 178, y: 46 }, { x: 302, y: 38 }, placed, 1)).toEqual({ from: { shape: "cache", side: "right" }, to: { shape: "db", side: "left" } });
    // At half size, the reach is twice as far on the board.
    expect(drawnArrowEnds({ x: 160, y: 46 }, { x: 600, y: 300 }, placed, 0.5)).toEqual({ from: { shape: "cache", side: "right" }, to: [600, 300] });
    expect(drawnArrowEnds({ x: 160, y: 46 }, { x: 600, y: 300 }, placed, 1)).toEqual({ from: "cache", to: [600, 300] });
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
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 350, y: 30 }, placed, 1)).toEqual({ from: "cache", to: "db" });
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 600, y: 300 }, placed, 1)).toEqual({ from: "cache", to: [600, 300] });
    expect(drawnArrowEnds({ x: 600.4, y: 300 }, { x: 20, y: 20 }, placed, 1)).toEqual({ from: [600, 300], to: "cache" });
    // Not back to the shape it starts on.
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 60, y: 60 }, placed, 1)).toEqual({ from: "cache", to: [60, 60] });
    expect(drawnArrowEnds({ x: 600, y: 300 }, { x: 601, y: 301 }, placed, 1)).toBeNull();
    expect(drawnArrowEnds({ x: 20, y: 20 }, { x: 21, y: 21 }, placed, 1)).toBeNull();
  });
});
