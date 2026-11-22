// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation, type Sticky } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { BLOCK_KINDS, type ViewDef } from "@open-arch/core";
import { addBlockOps, besideBlocks, blockUnder, connectOps, FlowchartDiagram, flowchartLayout, laneHead, moveOps, newBlockPlace, noteOnBlockOps, pinOps, tipsOf, type DrawnItem } from "../src/canvas/FlowchartDiagram.js";
import { blockHeight, blockWidth, dropInLane, LANE, laneColumns, onOutline, outlineToward, placeInLanes, routeToOutlines, savedAt, SLANT } from "../src/canvas/flowchartLayout.js";
import { followRenames, followsName, LEVEL_NAMES, shownInProperties, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, choose, click, menusFor, mount, select } from "./dom.js";

/** A return, each block placed, so nothing waits for ELK. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, customer: { kind: "person", name: "Customer" } },
  views: {
    returns: {
      title: "Returns",
      level: "flowchart",
      scope: "shop",
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", at: [0, 0] },
        { id: "in-time", kind: "decision", text: "Within 30 days?", at: [0, 120] },
        { id: "refund", text: "Refund the card", description: "Within 3 days", at: [0, 300] },
        { id: "refuse", text: "Say no", at: [300, 300] },
        { id: "done", kind: "end", text: "Done", at: [0, 450] },
      ],
      flows: [
        { from: "asked", to: "in-time" },
        { from: "in-time", to: "refund", text: "Yes" },
        { from: "in-time", to: "refuse", text: "No" },
        { from: "refund", to: "done" },
      ],
    },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("returns")!;

/** Keeps the edits sent, and what's selected. */
function recorder() {
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const edit = async (e: Edit) => {
    edits.push(typeof e === "function" ? e(ws) : e);
    return true;
  };
  return { edits, selected, edit, onSelect: (s: Selection) => void selected.push(s) };
}

/** The diagram of the flowchart, with this selected. */
async function diagram(selection: Selection = null, model: OpenArchDocument = doc) {
  const built = buildWorkspace(model);
  const r = recorder();
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(FlowchartDiagram, {
        computed: computeView(built, built.views.get("returns")!),
        selection,
        onSelect: r.onSelect,
        edit: r.edit,
        menus: menusFor("returns"),
        onError() {},
        exportItems: [],
        snap: { settings: SNAP_DEFAULTS, set() {} },
      }),
    ),
  );
  // The blocks are drawn once their positions are worked out, an effect later.
  await act(async () => {});
  return { host, ...r };
  // React Flow draws arrows only once it has measured the blocks, which this page can't do, so
  // flows are checked in the browser.
}

/** The details panel for the flowchart, showing what's selected. */
function panel(selection: Selection, isNew = false) {
  const r = recorder();
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection,
    isNew,
    syncsDocs: false,
    syncsSkill: false,
    docs: null,
    fileName: "shop.openarch",
    edit: r.edit,
    onSelect: r.onSelect,
    onHide() {},
    onDelete() {},
    onFindUsages() {},
    onNewView() {},
    onNewLibrary: async () => {},
    onBuild() {},
    onAddSticky() {},
    onDeleteView() {},
    onEditNotes() {},
  });
  return { host: mount(element), ...r };
}

/** Types into a text area and leaves it, which saves it. */
async function write(box: HTMLTextAreaElement | HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, text);
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve));
}

describe("FlowchartDiagram", () => {
  it("draws each block in its kind's shape, with its text and description, in the frame of the element whose process it is", async () => {
    const { host } = await diagram();
    const blocks = [...host.querySelectorAll(".flow-block")];
    expect(blocks.map((b) => [b.className.replace(/ selected/, ""), b.querySelector(".flow-text")!.textContent])).toEqual([
      ["flow-block flow-start", "Return asked for"],
      ["flow-block flow-decision", "Within 30 days?"],
      ["flow-block flow-process", "Refund the card"],
      ["flow-block flow-process", "Say no"],
      ["flow-block flow-end", "Done"],
    ]);
    // Only the kinds that aren't a box with CSS have an outline drawn behind them.
    expect(blocks[1]!.querySelector(".flow-shape polygon")!.getAttribute("points")).toBe("50,0 100,50 50,100 0,50");
    expect(blocks[0]!.querySelector(".flow-shape")).toBeNull();
    expect(blocks[2]!.querySelector(".flow-desc")!.textContent).toBe("Within 3 days");
    expect((blocks[1] as HTMLElement).style.width).toBe("220px");
    expect(host.querySelector(".frame-label")?.textContent).toContain("Shop");
    expect(host.textContent).toContain("flowchart view of Shop [System]");
  });

  it("draws a line from a sticky note to the block it's on, and gives each note a dot to drag to a block", async () => {
    const noted = structuredClone(doc);
    noted.views.returns!.stickies = { on: { text: "Within 3 days", on: { block: "refund" }, at: [400, 300] }, off: { text: "On nothing" } };
    const { host } = await diagram(null, noted);
    expect(host.querySelectorAll(".sticky-lines line")).toHaveLength(1);
    expect([...host.querySelectorAll<HTMLElement>(".sticky-grip")].map((g) => g.title)).toEqual(["Drag to a block to put the note on it", "Drag to a block to put the note on it"]);
    // A note on nothing has no line.
    expect((await diagram(null, doc)).host.querySelector(".sticky-lines")).toBeNull();
  });

  it("says how to start when there are no blocks", async () => {
    const empty: OpenArchDocument = { ...doc, views: { returns: { title: "Returns", level: "flowchart", blocks: [], flows: [] } } };
    const { host } = await diagram(null, empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This flowchart has no blocks yet.");
  });

  it("adds a block from + Add, after the one selected, with a flow to it, and selects it to give it text", async () => {
    const { host, edits, selected } = await diagram({ kind: "block", id: "refund" });
    await click(button(host, "+ Add"));
    const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database", "Lane", "Sticky note"]);
    await click(items.find((b) => b.textContent === "Decision")!);
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toHaveLength(1);
    const [add, flow] = edits[0]!;
    expect(add).toMatchObject({ op: "add-block", view: "returns", id: "new-decision", kind: "decision", text: "New decision", position: 4 });
    expect(flow).toEqual({ op: "add-flow", view: "returns", from: "refund", to: "new-decision" });
    expect(selected).toEqual([{ kind: "block", id: "new-decision" }]);
  });
});

describe("adding a block", () => {
  it("goes after the selected block, with a flow from it, unless that's an end, where the process stops", () => {
    expect(addBlockOps(view, "process", { kind: "block", id: "in-time" }, [5, 6])).toEqual({
      id: "new-process",
      ops: [
        { op: "add-block", view: "returns", id: "new-process", kind: "process", text: "New process", at: [5, 6], position: 3 },
        { op: "add-flow", view: "returns", from: "in-time", to: "new-process" },
      ],
    });
    expect(addBlockOps(view, "end", { kind: "block", id: "done" }, [0, 0]).ops).toEqual([{ op: "add-block", view: "returns", id: "end", kind: "end", text: "End", at: [0, 0], position: 6 }]);
    expect(addBlockOps(view, "start", null, [0, 0]).ops).toEqual([{ op: "add-block", view: "returns", id: "start", kind: "start", text: "Start", at: [0, 0] }]);
    const taken = buildWorkspace({ ...doc, views: { returns: { ...doc.views.returns!, blocks: [{ id: "new-document", text: "Slip" }, { id: "start", text: "Begin" }] } } }).views.get("returns")!;
    expect(addBlockOps(taken, "document", null, [0, 0]).id).toBe("new-document-2");
    expect(addBlockOps(taken, "start", null, [0, 0]).id).toBe("start-2");
  });

  it("gives each kind an ID made from its text, so the ID follows the text it's given next", () => {
    for (const kind of BLOCK_KINDS) {
      for (const on of [view, buildWorkspace({ ...doc, views: { returns: { ...doc.views.returns!, blocks: [{ id: "start", text: "Begin" }, { id: "end", text: "Stop" }] } } }).views.get("returns")!]) {
        const [add] = addBlockOps(on, kind, null, [0, 0]).ops as Extract<Operation, { op: "add-block" }>[];
        expect(followsName(add!.id, add!.text!), `${kind}: ${add!.id}`).toBe(true);
      }
    }
    expect(addBlockOps(view, "input-output", null, [0, 0]).id).toBe("new-input-or-output");
  });
});

describe("dragging on a flowchart", () => {
  // Two blocks the designer placed, one with a position, and a note.
  const drawn: DrawnItem[] = [
    { kind: "block", id: "asked", position: { x: 10.4, y: 20.6 }, placed: true },
    { kind: "block", id: "in-time", position: { x: 0, y: 120 } },
    { kind: "block", id: "refund", position: { x: 5, y: 300 }, placed: true },
    { kind: "sticky", id: "note", position: { x: 400, y: 0 } },
  ];

  it("keeps the blocks the designer placed where they are", () => {
    expect(pinOps(view, drawn)).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [10, 21] },
      { op: "update-block", view: "returns", id: "refund", at: [5, 300] },
    ]);
    expect(pinOps(view, drawn, new Set(["asked"]))).toEqual([{ op: "update-block", view: "returns", id: "refund", at: [5, 300] }]);
  });

  it("moves the blocks and notes let go of, and keeps the rest of the placed blocks where they are", () => {
    const dragged: DrawnItem[] = [
      { kind: "block", id: "refund", position: { x: 50.2, y: 350 }, placed: true },
      { kind: "sticky", id: "note", position: { x: 420, y: 10 } },
    ];
    expect(moveOps(view, drawn, dragged)).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [10, 21] },
      { op: "update-block", view: "returns", id: "refund", at: [50, 350] },
      { op: "update-sticky", view: "returns", id: "note", at: [420, 10] },
    ]);
  });

  it("adds a flow dragged from one block to another, numbered after the rest, with the placed blocks kept where they are", () => {
    expect(connectOps(view, drawn, "refuse", "done")).toEqual({
      ops: [
        { op: "update-block", view: "returns", id: "asked", at: [10, 21] },
        { op: "update-block", view: "returns", id: "refund", at: [5, 300] },
        { op: "add-flow", view: "returns", from: "refuse", to: "done" },
      ],
      number: 5,
    });
    expect(connectOps(view, drawn, "done", "done")).toBeNull();
    expect(connectOps(view, drawn, "done", "note")).toBeNull();
  });
});

describe("a sticky note on a flowchart's block", () => {
  const note = (id: string, on?: { block: string }, at?: [number, number]): Sticky => ({ id, path: "", text: "N", color: "yellow", ...(on && { on }), ...(at && { at }) });

  it("goes beside its block until it's moved: right of it, level with its top", () => {
    const noted = { blocks: view.blocks, stickies: [note("n", { block: "in-time" }), note("moved", { block: "refund" }, [5, 6]), note("loose"), note("lost", { block: "gone" })] };
    // in-time is a decision, 220 wide.
    expect(besideBlocks(noted, { "in-time": { x: 0, y: 120 }, refund: { x: 0, y: 300 } })).toEqual({ n: { x: 220 + 80, y: 120 } });
    // A block that isn't placed yet has nothing beside it.
    expect(besideBlocks(noted, { refund: { x: 0, y: 300 } })).toEqual({});
  });

  it("is put on the block its dot is let go on: the one on top, and none under a note", () => {
    const boxes = new Map([
      ["under", { x: 0, y: 0, w: 180, h: 52 }],
      ["over", { x: 100, y: 20, w: 180, h: 52 }],
    ]);
    expect(blockUnder({ x: 50, y: 10 }, boxes, [])).toBe("under");
    expect(blockUnder({ x: 150, y: 30 }, boxes, [])).toBe("over");
    expect(blockUnder({ x: 280, y: 72 }, boxes, [])).toBe("over");
    expect(blockUnder({ x: 400, y: 30 }, boxes, [])).toBeUndefined();
    expect(blockUnder({ x: 150, y: 30 }, boxes, [{ x: 140, y: 0, w: 150, h: 100 }])).toBeUndefined();
  });

  it("stays where it's drawn when it's put on a block, and isn't put on the block it's on", () => {
    expect(noteOnBlockOps(view, note("n"), "refund", { x: 400.4, y: 9.6 })).toEqual([{ op: "update-sticky", view: "returns", id: "n", on: { block: "refund" }, at: [400, 10] }]);
    // One that was moved keeps its place.
    expect(noteOnBlockOps(view, note("n", { block: "asked" }, [1, 2]), "refund", { x: 1, y: 2 })).toEqual([{ op: "update-sticky", view: "returns", id: "n", on: { block: "refund" } }]);
    expect(noteOnBlockOps(view, note("n", { block: "refund" }), "refund", { x: 1, y: 2 })).toEqual([]);
  });
});

describe("laying out a flowchart", () => {
  it("goes from the first block down, with a loop back up turned round, not the way on", async () => {
    // The shop's checkout: as the blocks are listed, with a way back from a declined card.
    const ids = ["checks-out", "total", "card", "pay", "paid", "declined", "save", "receipt", "placed"];
    const edges = [
      { from: "checks-out", to: "total" },
      { from: "total", to: "card" },
      { from: "card", to: "pay" },
      { from: "pay", to: "paid" },
      { from: "paid", to: "save" },
      { from: "paid", to: "declined" },
      { from: "declined", to: "card" },
      { from: "save", to: "receipt" },
      { from: "receipt", to: "placed" },
    ];
    const at = await flowchartLayout(
      ids.map((id) => ({ id, inside: false, height: 60 })),
      edges,
    );
    const y = (id: string) => at[id]!.y;
    for (const [a, b] of [["checks-out", "total"], ["total", "card"], ["card", "pay"], ["pay", "paid"], ["paid", "save"], ["paid", "declined"], ["save", "receipt"], ["receipt", "placed"]] as const) {
      expect(y(a), `${a} above ${b}`).toBeLessThan(y(b));
    }
  });
});

describe("a flowchart's shapes", () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };

  it("have arrows meet a decision only at its diamond's tips", () => {
    expect([...tipsOf(view.blocks)]).toEqual(["in-time"]);
    // Routed to a tip, an end stays there: it's on the diamond's outline already.
    expect(onOutline("decision", box, { x: 100, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 100, y: 0 });
    expect(onOutline("decision", box, { x: 200, y: 50 }, { x: -1, y: 0 })).toEqual({ x: 200, y: 50 });
  });

  it("meet arrows on a diamond's edges, not its box's corners", () => {
    // Straight down into the top, halfway to its corner: halfway down to its widest.
    expect(onOutline("decision", box, { x: 50, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 50, y: 25 });
    // Into the middle of a side, at its point.
    expect(onOutline("decision", box, { x: 0, y: 50 }, { x: 1, y: 0 })).toEqual({ x: 0, y: 50 });
    // Out of its bottom, going down, is into it going up.
    expect(onOutline("decision", box, { x: 150, y: 100 }, { x: 0, y: -1 })).toEqual({ x: 150, y: 75 });
  });

  it("meet arrows on a pill's round ends, and on an input or output's slanted sides", () => {
    const pill = { x: 0, y: 0, w: 160, h: 40 };
    expect(onOutline("start", pill, { x: 0, y: 20 }, { x: 1, y: 0 })).toEqual({ x: 0, y: 20 });
    expect(onOutline("end", pill, { x: 160, y: 30 }, { x: -1, y: 0 }).x).toBeCloseTo(160 - 20 + Math.sqrt(300));
    expect(onOutline("start", pill, { x: 80, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 80, y: 0 });
    expect(onOutline("input-output", { x: 0, y: 0, w: 180, h: 60 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual({ x: SLANT, y: 0 });
    expect(onOutline("input-output", { x: 0, y: 0, w: 180, h: 60 }, { x: 180, y: 60 }, { x: -1, y: 0 })).toEqual({ x: 180 - SLANT, y: 60 });
    // A box's outline is its box.
    expect(onOutline("process", box, { x: 50, y: 0 }, { x: 0, y: 1 })).toEqual({ x: 50, y: 0 });
  });

  it("meet a sticky note's line on their outline, on its way to their middle", () => {
    const meets = (at: { x: number; y: number }, x: number, y: number) => {
      expect(at.x).toBeCloseTo(x);
      expect(at.y).toBeCloseTo(y);
    };
    // A diamond: at a tip, and halfway along an edge.
    meets(outlineToward("decision", box, { x: 500, y: 50 }), 200, 50);
    meets(outlineToward("decision", box, { x: 300, y: -50 }), 150, 25);
    // A pill: its flat top, the middle of a round end, and round the end, as far from its centre as it's round.
    const pill = { x: 0, y: 0, w: 160, h: 40 };
    meets(outlineToward("start", pill, { x: 80, y: -100 }), 80, 0);
    meets(outlineToward("start", pill, { x: 120, y: -80 }), 88, 0);
    meets(outlineToward("end", pill, { x: 400, y: 20 }), 160, 20);
    const round = outlineToward("end", pill, { x: 380, y: -30 });
    expect(Math.hypot(round.x - 140, round.y - 20)).toBeCloseTo(20);
    expect(round.x).toBeGreaterThan(150);
    expect(round.y).toBeLessThan(20);
    // An input or output: halfway down a slanted side, half the slant in, and its flat top.
    const slanted = { x: 0, y: 0, w: 180, h: 60 };
    meets(outlineToward("input-output", slanted, { x: 400, y: 30 }), 180 - SLANT / 2, 30);
    meets(outlineToward("input-output", slanted, { x: -400, y: 30 }), SLANT / 2, 30);
    meets(outlineToward("input-output", slanted, { x: 90, y: -90 }), 90, 0);
    // A box: its edge.
    meets(outlineToward("process", box, { x: 500, y: 50 }), 200, 50);
    meets(outlineToward("database", box, { x: 100, y: 300 }), 100, 100);
    meets(outlineToward("process", box, { x: 500, y: 250 }), 200, 100);
    // From inside the outline, or its middle, where it is.
    meets(outlineToward("decision", box, { x: 110, y: 55 }), 110, 55);
    meets(outlineToward("process", box, { x: 100, y: 50 }), 100, 50);
  });

  it("move a route's ends onto the outlines of the blocks it joins", () => {
    const from = { kind: "decision" as const, box };
    const to = { kind: "process" as const, box: { x: 0, y: 300, w: 180, h: 52 } };
    expect(
      routeToOutlines(
        [
          { x: 150, y: 100 },
          { x: 150, y: 300 },
        ],
        from,
        to,
      ),
    ).toEqual([
      { x: 150, y: 75 },
      { x: 150, y: 300 },
    ]);
  });

  it("are as wide as their kind, and as tall as their text", () => {
    expect([blockWidth("start"), blockWidth("process"), blockWidth("decision")]).toEqual([160, 180, 220]);
    expect(blockHeight({ kind: "process", text: "Pack it", description: undefined })).toBe(52);
    expect(blockHeight({ kind: "process", text: "Pack it", description: "A description that wraps onto another line or two" })).toBeGreaterThan(52);
    expect(blockHeight({ kind: "decision", text: "In stock?" })).toBe(100);
  });
});

describe("a flowchart view in the designer", () => {
  it("shows a selected block or flow in the details, while it's there", () => {
    expect(shownInProperties(ws, view, { kind: "block", id: "in-time" })).toMatchObject({ kind: "block", block: { id: "in-time", kind: "decision" } });
    expect(shownInProperties(ws, view, { kind: "flow", number: 2 })).toMatchObject({ kind: "flow", flow: { from: "in-time", to: "refund", text: "Yes" } });
    expect(shownInProperties(ws, view, { kind: "block", id: "gone" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "flow", number: 5 })).toMatchObject({ kind: "view" });
  });

  it("has no boxes to show or hide, and is named in menus", () => {
    expect(viewAction(ws, view, computeView(ws, view), "customer")).toBeNull();
    expect(LEVEL_NAMES.flowchart).toBe("Flowchart view");
  });

  it("follows a renamed view in block and flow operations", () => {
    const renames = [{ op: "rename" as const, id: "returns", to: "refunds" }];
    expect(followRenames([{ op: "add-flow", view: "returns", from: "asked", to: "done" }], renames)).toEqual([{ op: "add-flow", view: "refunds", from: "asked", to: "done" }]);
    expect(followRenames([{ op: "update-block", view: "returns", id: "asked", text: "Hi" }], renames)).toEqual([{ op: "update-block", view: "refunds", id: "asked", text: "Hi" }]);
  });
});

describe("a block's details", () => {
  it("change its text, with its ID following it, and select it under its new ID", async () => {
    const { host, edits, selected } = panel({ kind: "block", id: "done" }, true);
    const text = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!;
    expect(document.activeElement).toBe(text);
    expect(host.textContent).toContain("Changes with the text.");
    await write(text, "Returned");
    expect(edits).toEqual([[{ op: "update-block", view: "returns", id: "done", text: "Returned", newId: "returned" }]]);
    expect(selected).toEqual([{ kind: "block", id: "returned" }]);
    // A block needs text, so none puts its text back.
    await write(text, " ");
    expect(edits).toHaveLength(1);
    expect(text.value).toBe("Done");
    // An ID that doesn't follow its text stays put.
    const other = panel({ kind: "block", id: "refund" });
    await write(other.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!, "Pay it back");
    expect(other.edits).toEqual([[{ op: "update-block", view: "returns", id: "refund", text: "Pay it back" }]]);
    expect(other.host.textContent).toContain("Doesn't match the text, so it stays put when you change the text.");
  });

  it("change its kind, list its flows, add one, lay it out again, and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "block", id: "in-time" });
    expect(host.textContent).toContain("A question with more than one way on");
    expect(host.textContent).toContain("→ Refund the card Yes→ Say no No← Return asked for");
    await choose(select(host, "Kind"), "process");
    await choose(select(host, "Add a flow to"), "done");
    await click(button(host, "Lay out again"));
    await click(button(host, "Delete block"));
    expect(edits).toEqual([
      [{ op: "update-block", view: "returns", id: "in-time", kind: "process" }],
      [{ op: "add-flow", view: "returns", from: "in-time", to: "done" }],
      [{ op: "update-block", view: "returns", id: "in-time", at: null }],
      [{ op: "remove-block", view: "returns", id: "in-time" }],
    ]);
    expect(selected).toEqual([{ kind: "flow", number: 5 }, null]);
    // It can't flow to itself, so it isn't on the list.
    expect([...select(host, "Add a flow to").options].map((o) => o.textContent)).not.toContain("Within 30 days?");
  });
});

describe("a flow's details", () => {
  it("change its ends and text, move it and delete it, and ask a way out of a decision which answer it's for", async () => {
    const { host, edits, selected } = panel({ kind: "flow", number: 3 });
    const text = host.querySelector<HTMLInputElement>('input[aria-label="Text"]')!;
    expect(text.value).toBe("No");
    expect(host.textContent).toContain("It's a way out of a decision, so say which answer it's for.");
    await choose(select(host, "To"), "done");
    await write(text, "");
    await click(button(host, "Move up"));
    await click(button(host, "Delete flow"));
    expect(edits).toEqual([
      [{ op: "update-flow", view: "returns", flow: 3, to: "done" }],
      [{ op: "update-flow", view: "returns", flow: 3, text: null }],
      [{ op: "update-flow", view: "returns", flow: 3, newFlow: 2 }],
      [{ op: "remove-flow", view: "returns", flow: 3 }],
    ]);
    expect(selected).toEqual([{ kind: "flow", number: 2 }, null]);
    expect(panel({ kind: "flow", number: 4 }).host.textContent).not.toContain("way out of a decision");
  });
});

describe("the New view dialog", () => {
  it("makes a flowchart of an element, or of nothing in particular with a title", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "flowchart");
    const of = select(host, "The process of");
    expect([...of.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Nothing in particular", "Customer [Person]", "Shop [System]"]);
    expect(host.querySelector<HTMLInputElement>("input")!.placeholder).toBe("e.g. Handling a return");
    expect(button(host, "Create view").disabled).toBe(true);
    await choose(of, "shop");
    await click(button(host, "Create view"));
    expect(created).toEqual([{ op: "add-view", id: "shop-process", level: "flowchart", scope: "shop", title: "Shop process" }]);
  });
});

/** The return in lanes: the customer's, and the shop's, with the end in neither. */
const lanedDoc: OpenArchDocument = {
  ...doc,
  views: {
    returns: {
      ...doc.views.returns!,
      lanes: [
        { id: "customer", name: "Customer", description: "Whoever bought it" },
        { id: "shop", name: "Shop" },
      ],
      blocks: doc.views.returns!.blocks!.map((b) => (b.id === "done" ? b : { ...b, lane: b.id === "asked" ? "customer" : "shop" })),
    },
  },
};
const lanedWs = buildWorkspace(lanedDoc);
const lanedView = lanedWs.views.get("returns")!;

describe("a flowchart's lanes", () => {
  it("are columns, left to right, the one for blocks in no lane first, each as wide as its blocks need", () => {
    const at = { asked: { x: 20, y: 0 }, "in-time": { x: 0, y: 120 }, refund: { x: 300, y: 300 }, refuse: { x: 0, y: 300 }, done: { x: 20, y: 450 } };
    const { columns, positions } = laneColumns(lanedView, at);
    expect(columns.map((c) => [c.lane?.id, c.x, c.w])).toEqual([
      [undefined, 0, LANE.minWidth],
      ["customer", 260, LANE.minWidth],
      // refund is 300 in, and 180 wide, with the room either side.
      ["shop", 520, 300 + 180 + 2 * LANE.pad],
    ]);
    expect(positions.asked).toEqual({ x: 260 + LANE.pad + 20, y: 0 });
    expect(positions.refund).toEqual({ x: 520 + LANE.pad + 300, y: 300 });
    expect(positions.refuse).toEqual({ x: 520 + LANE.pad, y: 300 });
    // With every block in a lane, there's no column for blocks in none.
    expect(laneColumns(lanedView, { asked: { x: 0, y: 0 } }).columns.map((c) => c.lane?.id)).toEqual(["customer", "shop"]);
  });

  it("move just the block dragged, the leftmost of its lane too, and draw an x less than 0, which only a file edited by hand has, at 0", () => {
    const at = { asked: { x: 0, y: 0 }, "in-time": { x: 0, y: 120 }, refund: { x: 40, y: 300 }, refuse: { x: 300, y: 300 }, done: { x: 0, y: 450 } };
    const before = laneColumns(lanedView, at);
    const shop = before.columns.find((c) => c.lane?.id === "shop")!;
    // Drag in-time, at the inside of shop's left, 50 to the right.
    const dragged: DrawnItem = { kind: "block", id: "in-time", position: { x: before.positions["in-time"]!.x + 50, y: 120 }, lane: "shop", w: 220 };
    const [op] = moveOps(lanedView, [], [dragged], before.columns);
    expect(op).toEqual({ op: "update-block", view: "returns", id: "in-time", at: [50, 120] });
    const after = laneColumns(lanedView, { ...at, "in-time": { x: 50, y: 120 } });
    expect(after.positions["in-time"]!.x).toBe(before.positions["in-time"]!.x + 50);
    for (const id of ["asked", "refund", "refuse", "done"]) expect(after.positions[id], id).toEqual(before.positions[id]);
    // Let go of left of the lane's inside, it stays at the inside.
    expect(savedAt(shop, { x: shop.x - 10, y: 0 })).toEqual([0, 0]);
    expect(laneColumns(lanedView, { ...at, refund: { x: -300, y: 300 } }).positions.refund!.x).toBe(shop.x + LANE.pad);
  });

  it("take a block let go of over them, by its middle, keeping its place from the lane's left", () => {
    const columns = laneColumns(lanedView, { asked: { x: 0, y: 0 }, done: { x: 0, y: 400 } }).columns;
    expect(columns.map((c) => c.x)).toEqual([0, 260, 520]);
    expect(dropInLane(columns, { x: 400, y: 50 }, 180)).toEqual({ lane: "customer", at: [400 - 260 - LANE.pad, 50] });
    // Its middle is over the shop's lane, though its left isn't.
    expect(dropInLane(columns, { x: 440, y: 50 }, 180)).toEqual({ lane: "shop", at: [0, 50] });
    expect(dropInLane(columns, { x: 10, y: 50 }, 180)).toEqual({ lane: undefined, at: [0, 50] });
    // Beyond either end, it's the nearest.
    expect(dropInLane(columns, { x: -900, y: 0 }, 180).lane).toBeUndefined();
    expect(dropInLane(columns, { x: 5000, y: 0 }, 180).lane).toBe("shop");
    expect(savedAt(columns[2]!, { x: 600.4, y: 99.6 })).toEqual([600 - 520 - LANE.pad, 100]);
  });

  it("place blocks without a position down the middle of their lane, at ELK's height, beside any already there", () => {
    const auto = { asked: { x: 500, y: 0 }, "in-time": { x: 500, y: 120 }, refund: { x: 300, y: 300 }, refuse: { x: 700, y: 300 }, done: { x: 500, y: 450 } };
    const placed = placeInLanes(lanedView, { asked: { x: 5, y: 1000 } }, auto);
    // The saved one stays, and the rest line up with it: 1000 below ELK's.
    expect(placed.asked).toEqual({ x: 5, y: 1000 });
    expect(placed["in-time"]).toEqual({ x: LANE.centre - 220 / 2, y: 1120 });
    expect(placed.refund).toEqual({ x: LANE.centre - 90, y: 1300 });
    // refuse is in refund's lane, at its height, so it goes beside it.
    expect(placed.refuse).toEqual({ x: LANE.centre - 90 + LANE.beside, y: 1300 });
    // done is in no lane, at the middle of that column.
    expect(placed.done).toEqual({ x: LANE.centre - 80, y: 1450 });
  });

  it("keep the blocks the designer placed where they are in their lanes, and move one let go of over another lane into it", () => {
    const columns = laneColumns(lanedView, { asked: { x: 0, y: 0 }, done: { x: 0, y: 400 } }).columns;
    const drawn: DrawnItem[] = [
      { kind: "block", id: "asked", position: { x: 300, y: 0 }, placed: true, lane: "customer", w: 160 },
      { kind: "block", id: "refund", position: { x: 560, y: 300 }, placed: true, lane: "shop", w: 180 },
    ];
    expect(pinOps(lanedView, drawn, new Set(), columns)).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [300 - 260 - LANE.pad, 0] },
      { op: "update-block", view: "returns", id: "refund", at: [560 - 520 - LANE.pad, 300] },
    ]);
    const dragged: DrawnItem[] = [{ kind: "block", id: "refund", position: { x: 300, y: 320 }, placed: true, lane: "shop", w: 180 }];
    expect(moveOps(lanedView, drawn, dragged, columns)).toEqual([
      { op: "update-block", view: "returns", id: "asked", at: [10, 0] },
      { op: "update-block", view: "returns", id: "refund", lane: "customer", at: [10, 320] },
    ]);
    // Over its own lane, only its place changes; over the column for no lane, it leaves its lane.
    expect(moveOps(lanedView, [], [{ ...dragged[0]!, position: { x: 600, y: 320 } }], columns)).toEqual([{ op: "update-block", view: "returns", id: "refund", at: [50, 320] }]);
    expect(moveOps(lanedView, [], [{ ...dragged[0]!, position: { x: 20, y: 320 } }], columns)).toEqual([{ op: "update-block", view: "returns", id: "refund", lane: null, at: [0, 320] }]);
    expect(connectOps(lanedView, drawn, "refuse", "done", columns)!.ops[0]).toEqual({ op: "update-block", view: "returns", id: "asked", at: [10, 0] });
    expect(addBlockOps(lanedView, "process", null, [10, 20], "shop").ops).toEqual([{ op: "add-block", view: "returns", id: "new-process", kind: "process", text: "New process", lane: "shop", at: [10, 20] }]);
  });

  it("put a new block under the block selected, in its lane; at the bottom of the lane selected; or else in the lane in the middle of the canvas", () => {
    const at = { asked: { x: 0, y: 0 }, "in-time": { x: 0, y: 120 }, refund: { x: 0, y: 300 }, refuse: { x: 260, y: 300 }, done: { x: 0, y: 450 } };
    const extra = { ...lanedView, lanes: [...lanedView.lanes, { id: "warehouse", path: "", number: 3, name: "Warehouse" }] } as ViewDef;
    const { columns, positions } = laneColumns(extra, at);
    expect(columns.map((c) => [c.lane?.id, c.x])).toEqual([
      [undefined, 0],
      ["customer", 260],
      ["shop", 520],
      ["warehouse", 1020],
    ]);
    const boxes = new Map(extra.blocks.map((b) => [b.id, { ...positions[b.id]!, w: blockWidth(b.kind), h: blockHeight(b) }]));
    const around = { columns, boxes, top: -70, middle: { x: 600, y: 400 }, occupied: [] };
    // Under in-time, which is 220 wide, centred: in shop, 20 in from its inside, and 70 below in-time's bottom.
    expect(newBlockPlace(extra, "process", { kind: "block", id: "in-time" }, around)).toEqual({ at: [20, 120 + 100 + 70], lane: "shop" });
    // Under done, in the column for blocks in no lane: in no lane.
    expect(newBlockPlace(extra, "process", { kind: "block", id: "done" }, around)).toEqual({ at: [0, 450 + blockHeight({ kind: "end", text: "Done" }) + 70], lane: undefined });
    // At the bottom of customer, under asked, down its middle.
    expect(newBlockPlace(extra, "process", { kind: "lane", id: "customer" }, around)).toEqual({ at: [LANE.centre - 90, 44 + 70], lane: "customer" });
    // In warehouse, which has none yet: at its top, under the lanes' names, however tall they are.
    expect(newBlockPlace(extra, "process", { kind: "lane", id: "warehouse" }, around)).toEqual({ at: [LANE.centre - 90, -70 + LANE.head + LANE.pad], lane: "warehouse" });
    expect(newBlockPlace(extra, "process", { kind: "lane", id: "warehouse" }, { ...around, head: 58 })).toEqual({ at: [LANE.centre - 90, -70 + 58 + LANE.pad], lane: "warehouse" });
    // With nothing selected, in the lane under the middle of the canvas.
    expect(newBlockPlace(extra, "process", null, around)).toEqual({ at: [0, 370], lane: "shop" });
    // In the nearest free spot.
    expect(newBlockPlace(extra, "process", null, { ...around, occupied: [{ x: 510, y: 370 }] }).at).not.toEqual([0, 370]);
    // Without lanes, where it's drawn.
    expect(newBlockPlace(view, "process", null, { boxes: new Map(), top: 0, middle: { x: 600, y: 400 }, occupied: [] })).toEqual({ at: [510, 370] });
  });

  it("are drawn as columns behind the blocks, with their names, and the column for blocks in no lane", async () => {
    const { host } = await diagram(null, lanedDoc);
    expect([...host.querySelectorAll(".flow-lane")].map((l) => [l.className, l.textContent])).toEqual([
      ["flow-lane loose", "No lane"],
      ["flow-lane", "Customer"],
      ["flow-lane", "Shop"],
    ]);
    expect(host.querySelectorAll(".flow-lane")[1]!.getAttribute("title")).toBe("Whoever bought it");
    const selected = await diagram({ kind: "lane", id: "shop" }, lanedDoc);
    expect(selected.host.querySelector(".flow-lane.selected")?.textContent).toBe("Shop");
    expect(button(selected.host, "+ Add").title).toBe("Add a block in the lane selected, a lane after it, or a sticky note");
    expect(button(host, "+ Add").title).toBe("Add a block, a lane or a sticky note");
  });

  it("are selected by clicking them, and the column for blocks in no lane selects nothing", async () => {
    const { host, selected } = await diagram(null, lanedDoc);
    await click(host.querySelector('.react-flow__node[data-id="lane:shop"]')!);
    await click(host.querySelector('.react-flow__node[data-id="lane:"]')!);
    expect(selected).toEqual([{ kind: "lane", id: "shop" }, null]);
  });

  it("say how to add a block in one, when there are lanes but no blocks", async () => {
    const empty: OpenArchDocument = { ...doc, views: { returns: { title: "Returns", level: "flowchart", lanes: [{ id: "customer", name: "Customer" }], blocks: [], flows: [] } } };
    const { host } = await diagram(null, empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This flowchart has lanes but no blocks yet. Select a lane and use + Add to add a block in it");
    expect([...host.querySelectorAll(".flow-lane")].map((l) => l.textContent)).toEqual(["Customer"]);
  });

  it("are added from + Add, after the lane selected, and selected to name them", async () => {
    const { host, edits, selected } = await diagram({ kind: "lane", id: "customer" }, lanedDoc);
    await click(button(host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Lane")!);
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits.at(-1)!.at(-1)).toEqual({ op: "add-lane", view: "returns", id: "new-lane", name: "New lane", position: 2 });
    expect(selected).toEqual([{ kind: "lane", id: "new-lane" }]);
  });
});

describe("a lane's name too long for one line", () => {
  /**
   * This page has no layout, so every name would measure nothing. Here each letter is 8 wide, and a
   * name wraps in its lane, less the 12 either side of it, onto lines 18 tall, with 8 above and
   * below them and the line under it, as in a browser.
   */
  const measure = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (!this.matches(".flow-lane-name")) return measure.call(this);
      const room = parseFloat((this.parentElement as HTMLElement).style.width) - 24;
      return { width: room + 24, height: Math.ceil((this.textContent!.length * 8) / room) * 18 + 17.5 } as DOMRect;
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = measure;
  });

  /** The customer's lane is 260 wide, so its name's 45 letters need two lines. */
  const long = structuredClone(lanedDoc);
  long.views.returns!.lanes![0]!.name = "Customer, or whoever is returning it for them";
  /** Where a lane is drawn, and how tall. */
  const drawn = (host: HTMLElement, id: string) => {
    const node = host.querySelector<HTMLElement>(`.react-flow__node[data-id="lane:${id}"]`)!;
    const [x, y] = /translate\(([-\d.]+)px, ?([-\d.]+)px\)/.exec(node.style.transform)!.slice(1).map(Number);
    return { x, y, height: parseFloat(node.querySelector<HTMLElement>(".flow-lane")!.style.height) };
  };

  it("is as tall as it needs, wrapped to its lane's width, and no shorter than one line's room", () => {
    const columns = [
      { x: 0, w: 260 },
      { lane: { id: "customer", path: "", number: 1, name: "Customer, or whoever is returning it for them" }, x: 260, w: 260 },
      { lane: { id: "shop", path: "", number: 2, name: "Shop" }, x: 520, w: 540 },
    ];
    expect(laneHead(columns)).toBe(54);
    // In a lane wide enough for it, it's on one line.
    expect(laneHead([{ ...columns[1]!, w: 540 }])).toBe(LANE.head);
    expect(laneHead([])).toBe(LANE.head);
    // The names it measured aren't left on the page.
    expect(document.querySelector(".flow-lane-name")).toBeNull();
  });

  it("isn't cut short: it wraps, a long word too, and none of it is hidden", async () => {
    // This page has no layout, so it reads the stylesheet.
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    document.head.append(style);
    try {
      const { host } = await diagram(null, long);
      const name = getComputedStyle(host.querySelector('.react-flow__node[data-id="lane:customer"] .flow-lane-name')!);
      expect(name.whiteSpace).not.toBe("nowrap");
      expect(name.overflowWrap).toBe("anywhere");
      expect(name.overflow).not.toBe("hidden");
      expect(name.textOverflow).not.toBe("ellipsis");
    } finally {
      style.remove();
    }
  });

  it("is drawn in full, with every lane's name as tall, and the lanes that much taller, above the blocks", async () => {
    const short = await diagram(null, lanedDoc);
    const { host } = await diagram(null, long);
    expect(host.querySelector('.react-flow__node[data-id="lane:customer"]')!.textContent).toBe("Customer, or whoever is returning it for them");
    expect([...host.querySelectorAll<HTMLElement>(".flow-lane-name")].map((n) => n.style.minHeight)).toEqual(["54px", "54px", "54px"]);
    expect([...short.host.querySelectorAll<HTMLElement>(".flow-lane-name")].map((n) => n.style.minHeight)).toEqual(["40px", "40px", "40px"]);
    // The highest block is at 0, with the room above it and the names above that: 14 more than a line's.
    for (const id of ["", "customer", "shop"]) {
      const [was, now] = [drawn(short.host, id), drawn(host, id)];
      expect(was.y).toBe(-LANE.head - LANE.pad);
      expect(now).toEqual({ x: was.x, y: -54 - LANE.pad, height: was.height + 14 });
    }
  });
});

describe("a flowchart lane's details and a block's lane", () => {
  /** The details panel for the laned flowchart. */
  function lanedPanel(selection: Selection) {
    const r = { edits: [] as Operation[][], selected: [] as Selection[] };
    const element = createElement(Properties, {
      ws: lanedWs,
      view: lanedView as ViewDef,
      computed: computeView(lanedWs, lanedView),
      selection,
      isNew: false,
      syncsDocs: false,
      syncsSkill: false,
      docs: null,
      fileName: "shop.openarch",
      edit: async (e: Edit) => {
        r.edits.push(typeof e === "function" ? e(lanedWs) : e);
        return true;
      },
      onSelect: (s: Selection) => void r.selected.push(s),
      onHide() {},
      onDelete() {},
      onFindUsages() {},
      onNewView() {},
      onNewLibrary: async () => {},
      onBuild() {},
      onAddSticky() {},
      onDeleteView() {},
      onEditNotes() {},
    });
    return { host: mount(element), ...r };
  }

  it("list a lane's blocks, and move it left or right", async () => {
    const { host, edits, selected } = lanedPanel({ kind: "lane", id: "customer" });
    expect(host.textContent).toContain("BlocksReturn asked for Start");
    expect(button(host, "Move left").disabled).toBe(true);
    await click(button(host, "Move right"));
    await click(host.querySelector<HTMLButtonElement>(".link")!);
    expect(edits).toEqual([[{ op: "update-lane", view: "returns", id: "customer", position: 2 }]]);
    expect(selected).toEqual([{ kind: "block", id: "asked" }]);
  });

  it("move a block into another lane, or out of its lane", async () => {
    const { host, edits } = lanedPanel({ kind: "block", id: "refund" });
    const lane = select(host, "Lane");
    expect([...lane.options].map((o) => o.textContent)).toEqual(["(no lane)", "Customer", "Shop"]);
    expect(lane.value).toBe("shop");
    await choose(lane, "customer");
    await choose(lane, "");
    // Its place was in its old lane, so it's laid out again in the new one.
    expect(edits).toEqual([[{ op: "update-block", view: "returns", id: "refund", lane: "customer", at: null }], [{ op: "update-block", view: "returns", id: "refund", lane: null, at: null }]]);
    // A flowchart without lanes doesn't ask.
    expect(panel({ kind: "block", id: "refund" }).host.textContent).not.toContain("(no lane)");
  });
});
