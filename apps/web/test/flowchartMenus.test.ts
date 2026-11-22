// @vitest-environment happy-dom
import { buildWorkspace, serializeDocument, type Lane, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import { blockPlaceAt, canFlow } from "../src/canvas/FlowchartDiagram.js";
import type { LaneColumn } from "../src/canvas/flowchartLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, choose, click, key, select } from "./dom.js";
import { designer as open, put, SlowHost, write, type MenuDesigner } from "./menuDesigner.js";

/** A return, each block placed, so nothing waits for ELK, with a note beside it. */
const doc: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    returns: {
      title: "Returns",
      level: "flowchart",
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", at: [0, 0] },
        { id: "in-time", kind: "decision", text: "Within 30 days?", at: [0, 200] },
        { id: "refund", text: "Refund the card", at: [0, 500] },
        { id: "say-no", text: "Say no", at: [400, 500] },
        { id: "done", kind: "end", text: "Done", at: [0, 800] },
      ],
      flows: [
        { from: "asked", to: "in-time" },
        { from: "in-time", to: "refund", text: "Yes" },
        { from: "in-time", to: "say-no", text: "No" },
        { from: "refund", to: "done" },
      ],
      stickies: { note: { text: "Read me", at: [800, 0] } },
    },
  },
};

/**
 * The same return in two lanes, each block's x from the inside of its lane's left. The customer's
 * lane is 260 wide, from 0, and the shop's 490, from 260.
 */
const laned = structuredClone(doc);
laned.views.returns!.lanes = [
  { id: "customer", name: "Customer" },
  { id: "shop", name: "Shop" },
];
laned.views.returns!.blocks = [
  { id: "asked", kind: "start", text: "Return asked for", lane: "customer", at: [0, 0] },
  { id: "in-time", kind: "decision", text: "Within 30 days?", lane: "shop", at: [0, 200] },
  { id: "refund", text: "Refund the card", lane: "shop", at: [0, 500] },
  { id: "say-no", text: "Say no", lane: "shop", at: [250, 500] },
  { id: "done", kind: "end", text: "Done", lane: "customer", at: [0, 800] },
];

/** The whole designer, open on the flowchart, with its blocks measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "returns", file);
/** The arrow drawn for the flow with this number. */
const flow = (d: MenuDesigner, number: number) => d.edge(`flow:${number}`);

describe("adding a block where the diagram was right-clicked", () => {
  const lane = (id: string, number: number): Lane => ({ id, number, name: id, path: `views.returns.lanes[${number - 1}]` });
  const columns: LaneColumn[] = [
    { lane: lane("customer", 1), x: 0, w: 260 },
    { lane: lane("shop", 2), x: 260, w: 300 },
  ];

  it("puts its middle there, or in the nearest free spot", () => {
    // A process is 180 wide, and 52 tall with a line of text.
    expect(blockPlaceAt("process", { x: 500, y: 300 }, { occupied: [] })).toEqual({ at: [410, 274] });
    const moved = blockPlaceAt("process", { x: 500, y: 300 }, { occupied: [{ x: 410, y: 274 }] }).at;
    expect(moved).not.toEqual([410, 274]);
    expect(Math.hypot(moved[0] - 410, moved[1] - 274)).toBeLessThan(300);
  });

  it("puts it in the lane it lands in, its place from the inside of that lane's left", () => {
    expect(blockPlaceAt("process", { x: 400, y: 100 }, { columns, occupied: [] })).toEqual({ lane: "shop", at: [20, 74] });
    expect(blockPlaceAt("process", { x: 130, y: 100 }, { columns, occupied: [] })).toEqual({ lane: "customer", at: [10, 74] });
    // The column for blocks in no lane is no lane.
    expect(blockPlaceAt("process", { x: 130, y: 100 }, { columns: [{ x: 0, w: 260 }, { lane: lane("shop", 1), x: 260, w: 300 }], occupied: [] })).toEqual({ lane: undefined, at: [10, 74] });
  });

  it("keeps it in the lane that was clicked when the nearest free spot is over another", () => {
    // Its spot in the customer's lane is taken, so it goes beside it, further left than the lane starts.
    const beside = blockPlaceAt("process", { x: 130, y: 100 }, { columns, occupied: [{ x: 40, y: 74 }, { x: 40, y: 274 }, { x: 40, y: -126 }, { x: 340, y: 74 }] }, "customer");
    expect(beside.lane).toBe("customer");
    expect(beside.at[0]).toBeGreaterThanOrEqual(0);
    // Asked for a lane the flowchart doesn't have, it's in the lane it lands in.
    expect(blockPlaceAt("process", { x: 400, y: 100 }, { columns, occupied: [] }, "gone")).toEqual({ lane: "shop", at: [20, 74] });
  });
});

describe("the flows a flowchart can have", () => {
  const view = buildWorkspace(doc).views.get("returns")!;

  it("go from one block to another, and aren't ones it has already, with the same ends and text", () => {
    expect(canFlow(view, "refund", "asked")).toBe(true);
    expect(canFlow(view, "asked", "asked")).toBe(false);
    expect(canFlow(view, "asked", "in-time")).toBe(false);
    expect(canFlow(view, "asked", "in-time", "Again")).toBe(true);
    // The one from the decision to the refund says Yes, so another can say something else, or nothing.
    expect(canFlow(view, "in-time", "refund")).toBe(true);
    expect(canFlow(view, "in-time", "refund", "Yes")).toBe(false);
  });

  it("can be the flow that's being changed", () => {
    expect(canFlow(view, "in-time", "refund", "Yes", view.flows[1])).toBe(true);
    expect(canFlow(view, "in-time", "refund", "Yes", view.flows[2])).toBe(false);
  });
});

describe("a block's right-click menu", () => {
  it("selects the block, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("in-time")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Decision");
    // The flowchart has no lanes to move it to.
    expect(d.labels()).toEqual(["Add after", "Add flow to", "Add sticky note", "Change kind", "Lay out again", "Delete block"]);
  });

  it("adds a sticky note on the block, with its text to type", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    await d.pick("Add sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", on: { block: "refund" } });
    expect(d.details()).toBe("Sticky note");
    expect(document.activeElement).toBe(d.node("sticky:note-2")!.querySelector("textarea"));
    expect(d.menuOpen()).toBe(false);
  });

  it("adds a block after it, with a flow to it, and selects it to give it text", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    await d.pick("Add after");
    expect(d.labels()).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database"]);
    await d.pick("Decision");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.id)).toEqual(["asked", "in-time", "refund", "new-decision", "say-no", "done"]);
    expect(view.flows.at(-1)).toMatchObject({ from: "refund", to: "new-decision" });
    expect(d.details()).toBe("Decision");
    expect(document.activeElement).toBe(d.host.querySelector('textarea[aria-label="Text"]'));
    expect(d.menuOpen()).toBe(false);
  });

  it("adds a flow to a block it has none to yet, and selects the flow", async () => {
    const d = await designer();
    await d.rightClick(d.node("asked")!);
    await d.pick("Add flow to");
    // Not to itself, or to the decision, which it flows to already.
    expect(d.labels()).toEqual(["Refund the card", "Say no", "Done"]);
    await d.pick("Done");
    expect((await d.saved()).flows.at(-1)).toMatchObject({ number: 5, from: "asked", to: "done" });
    expect(d.details()).toBe("Flow 5of 5");
  });

  it("changes its kind, lays it out again and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("asked")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(["Process", "End", "Decision", "Input or output", "Subprocess", "Document", "Database"]);
    await d.pick("Document");
    expect((await d.saved()).blocks[0]).toMatchObject({ id: "asked", kind: "document", at: [0, 0] });

    await d.rightClick(d.node("asked")!);
    await d.pick("Lay out again");
    expect((await d.saved()).blocks[0]!.at).toBeUndefined();
    // The designer places it now, so there's nothing to lay out again.
    await d.rightClick(d.node("asked")!);
    expect(d.labels()).not.toContain("Lay out again");

    await d.pick("Delete block");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.id)).toEqual(["in-time", "refund", "say-no", "done"]);
    expect(view.flows.map((f) => f.from)).not.toContain("asked");
    expect(d.details()).toBe("View");
  });

  it("moves it to another lane, or out of its lane, and lays it out again there", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "No lane"]);
    await d.pick("Customer");
    const moved = (await d.saved()).blocks.find((b) => b.id === "refund")!;
    expect(moved.lane).toBe("customer");
    expect(moved.at).toBeUndefined();

    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane", "No lane");
    expect((await d.saved()).blocks.find((b) => b.id === "refund")!.lane).toBeUndefined();
    // In no lane, it has none to leave.
    await d.rightClick(d.node("refund")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "Shop"]);
  });
});

describe("a flow's right-click menu", () => {
  it("selects the flow, from its line or its text, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(flow(d, 2)!);
    expect(d.details()).toBe("Flow 2of 4");
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to flow 1", "Move down, to flow 3", "Delete flow"]);
    await key(document.activeElement!, "Escape");
    expect(d.menuOpen()).toBe(false);

    const text = [...d.host.querySelectorAll(".arrow-label")].find((l) => l.textContent === "No")!;
    await d.rightClick(text);
    expect(d.details()).toBe("Flow 3of 4");
    expect(d.labels()).toContain("Delete flow");
  });

  it("has no way up for the first flow, or down for the last", async () => {
    const d = await designer();
    await d.rightClick(flow(d, 1)!);
    expect(d.labels()).toEqual(["Change from", "Change to", "Move down, to flow 2", "Delete flow"]);
    await d.rightClick(flow(d, 4)!);
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to flow 3", "Delete flow"]);
  });

  it("opens on the one that was clicked of two flows with the same ends and text, as only a file written by hand has", async () => {
    const twins = structuredClone(doc);
    // Flow 5 is flow 4 again, and flow 6 tells them from the last.
    twins.views.returns!.flows!.push({ from: "refund", to: "done" }, { from: "say-no", to: "done" });
    const d = await designer(twins);
    await d.rightClick(flow(d, 5)!);
    expect(d.details()).toBe("Flow 5of 6");
    await d.pick("Move down, to flow 6");
    // It's the second of the two that moved, past the last flow.
    expect((await d.saved()).flows.map((f) => `${f.from}>${f.to}`)).toEqual(["asked>in-time", "in-time>refund", "in-time>say-no", "refund>done", "say-no>done", "refund>done"]);
    expect(d.details()).toBe("Flow 6of 6");
    await d.rightClick(flow(d, 4)!);
    expect(d.details()).toBe("Flow 4of 6");
    await d.pick("Delete flow");
    expect((await d.saved()).flows.map((f) => `${f.from}>${f.to}`)).toEqual(["asked>in-time", "in-time>refund", "in-time>say-no", "say-no>done", "refund>done"]);
  });

  it("moves either end to another block, but not to make a flow the flowchart has already", async () => {
    const d = await designer();
    // Not to the decision it comes from, or to the refund, where it goes already.
    await d.rightClick(flow(d, 2)!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Return asked for", "Say no", "Done"]);
    await d.pick("Done");
    expect((await d.saved()).flows[1]).toMatchObject({ from: "in-time", to: "done", text: "Yes" });
    expect(d.details()).toBe("Flow 2of 4");

    await d.rightClick(flow(d, 1)!);
    await d.pick("Change from");
    expect(d.labels()).toEqual(["Refund the card", "Say no", "Done"]);
    await d.pick("Refund the card");
    expect((await d.saved()).flows[0]).toMatchObject({ from: "refund", to: "in-time" });

    // The refund now flows to the decision with no text, so its flow to Done can't go there too.
    await d.rightClick(flow(d, 4)!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Return asked for", "Say no"]);
  });

  it("moves it up or down the list, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(flow(d, 2)!);
    await d.pick("Move down, to flow 3");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "No", "Yes", undefined]);
    expect(d.details()).toBe("Flow 3of 4");

    await d.rightClick(flow(d, 3)!);
    await d.pick("Delete flow");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "No", undefined]);
    expect(d.details()).toBe("View");
  });
});

describe("a lane's right-click menu", () => {
  it("selects the lane, and lists what can be done with it", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    expect(d.details()).toBe("Lane 1of 2");
    expect(d.labels()).toEqual(["Add", "Move right", "Delete lane"]);
    await d.rightClick(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    expect(d.labels()).toEqual(["Add", "Move left", "Delete lane"]);
  });

  it("adds a block where it was clicked, in that lane, on its own", async () => {
    const d = await designer(laned);
    // A spot in the shop's lane with nothing near it.
    await d.rightClick(d.node("lane:shop")!, { x: 700, y: 300 });
    await d.pick("Add");
    expect(d.labels()).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database", "Lane", "Sticky note"]);
    await d.pick("Process");
    const view = await d.saved();
    // Its middle is where the click was: 700 less half its width, from the inside of the lane's left, at 290.
    expect(view.blocks.at(-1)).toMatchObject({ id: "new-process", lane: "shop", at: [320, 274] });
    expect(view.flows).toHaveLength(4);
    expect(d.details()).toBe("Process");
  });

  it("adds a lane after it, and a sticky note where it was clicked", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "new-lane", "shop"]);

    await d.rightClick(d.node("lane:shop")!, { x: 900, y: 1200 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [900 - STICKY.width / 2, 1150] });
    // Its text is being typed, in place.
    expect(document.activeElement).toBe(d.host.querySelector(".sticky textarea"));
  });

  it("moves it left or right, and deletes it, leaving its blocks in no lane", async () => {
    const d = await designer(laned);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move right");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["shop", "customer"]);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move left");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop"]);

    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Delete lane");
    const view = await d.saved();
    expect(view.lanes.map((l) => l.id)).toEqual(["shop"]);
    expect(view.blocks.filter((b) => b.lane === undefined).map((b) => b.id)).toEqual(["asked", "done"]);
    expect(d.details()).toBe("View");
  });

  it("shows the details of the element the lane is for, which say what kind it is under the lane's name", async () => {
    const forShop = structuredClone(laned);
    forShop.views.returns!.lanes![1]!.element = "shop";
    const d = await designer(forShop);
    expect(d.node("lane:shop")!.querySelector(".flow-lane-name")!.textContent).toBe("Shop[System]");
    expect(d.node("lane:customer")!.querySelector(".flow-lane-kind")).toBeNull();
    await d.rightClick(d.node("lane:shop")!);
    expect(d.labels()).toEqual(["Add", "Show Shop", "Move left", "Delete lane"]);
    await d.pick("Show Shop");
    expect(d.details()).toBe("System");
    // Find usages lists the flowchart, and goes back to the lane.
    await click(button(d.host, "Find usages"));
    const usage = [...d.host.querySelectorAll<HTMLButtonElement>(".usages .row")].find((r) => r.textContent!.startsWith("Returns"))!;
    expect(usage.textContent).toBe("Returnsflowchart · its lane, Shop");
    await click(usage);
    expect(d.details()).toBe("Lane 2of 2");
  });

  it("is the diagram's on the column for blocks in no lane", async () => {
    const loose = structuredClone(laned);
    delete loose.views.returns!.blocks![3]!.lane;
    const d = await designer(loose);
    await d.rightClick(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    await d.rightClick(d.node("lane:")!);
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });
});

describe("a sticky note's right-click menu on a flowchart", () => {
  it("selects the note, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
  });

  it("moves a note that's on a block back next to the block", async () => {
    const onBlock = structuredClone(doc);
    onBlock.views.returns!.stickies!.note!.on = { block: "refund" };
    const d = await designer(onBlock);
    await d.rightClick(d.node("sticky:note")!);
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move next to what it's on", "Delete note"]);
    await d.pick("Move next to what it's on");
    const note = (await d.saved()).stickies[0]!;
    expect(note.on).toEqual({ block: "refund" });
    expect(note.at).toBeUndefined();
    // On a block the flowchart doesn't have, it goes beside the diagram.
    const lost = structuredClone(doc);
    lost.views.returns!.stickies!.note!.on = { block: "gone" };
    const other = await designer(lost);
    await other.rightClick(other.node("sticky:note")!);
    expect(other.labels()).toContain("Move beside the diagram");
  });

  it("edits its text in place, where a right-click is left to the browser, to paste", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
  });

  it("changes its colour, opens its notes, moves it back beside the diagram and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Colour");
    expect(d.labels()).toEqual(["Pink", "Blue", "Green"]);
    await d.pick("Blue");
    expect((await d.saved()).stickies[0]!.color).toBe("blue");

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit notes…");
    const editor = d.host.querySelector("dialog.notes-editor")!;
    expect(editor.querySelector("h2")!.textContent).toContain("Read me");
    await click(button(editor as HTMLElement, "Cancel"));

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Move beside the diagram");
    expect((await d.saved()).stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.labels()).not.toContain("Move beside the diagram");

    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of a flowchart's background", () => {
  it("selects nothing, and has what the toolbar has", async () => {
    const d = await designer();
    await click(d.node("refund")!);
    expect(d.details()).toBe("Process");
    const event = await d.rightClick(d.pane());
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…", "Save as PNG…"]));
  });

  it("is the menu for the frame too, which takes no clicks", async () => {
    const scoped = structuredClone(doc);
    scoped.views.returns!.scope = "shop";
    const d = await designer(scoped);
    const frame = d.node("__frame") as HTMLElement;
    expect(frame.querySelector(".frame-label")!.textContent).toContain("Shop");
    // A right-click on it lands on the background behind it.
    expect(frame.style.pointerEvents).toBe("none");
    await d.rightClick(d.pane());
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("adds a block where it was clicked, on its own, and selects it to give it text", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    await d.pick("Add", "Decision");
    const view = await d.saved();
    // A decision is 220 wide and 100 tall, and its middle is where the click was.
    expect(view.blocks.at(-1)).toMatchObject({ id: "new-decision", kind: "decision", at: [1390, 550] });
    expect(view.blocks.at(-1)!.lane).toBeUndefined();
    expect(view.flows).toHaveLength(4);
    expect(d.details()).toBe("Decision");
    expect(document.activeElement).toBe(d.host.querySelector('textarea[aria-label="Text"]'));
  });

  it("adds a block in the lane it lands in, a lane at the right, and a sticky note where it was clicked", async () => {
    const d = await designer(laned);
    // Right of the lanes, level with nothing: the shop's lane, from 260, is the nearest.
    await d.rightClick(d.pane(), { x: 1500, y: 300 });
    await d.pick("Add", "Process");
    expect((await d.saved()).blocks.at(-1)).toMatchObject({ id: "new-process", lane: "shop", at: [1120, 274] });

    await d.rightClick(d.pane());
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop", "new-lane"]);

    await d.rightClick(d.pane(), { x: 3000, y: 1200 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1150] });
  });

  it("adds a lane at the right whatever is selected by the time it's picked", async () => {
    const d = await designer(laned);
    await d.rightClick(d.pane());
    // A lane selected under the open menu, without a press, which would have closed it.
    await click(d.node("lane:customer")!);
    expect(d.details()).toBe("Lane 1of 2");
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop", "new-lane"]);
    // + Add puts one after the lane selected.
    await click(d.node("lane:customer")!);
    await click(button(d.host, "+ Add"));
    await d.pick("Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "new-lane-2", "shop", "new-lane"]);
  });

  it("lays the flowchart out again, and has no Auto layout when there's nothing to lay out", async () => {
    const d = await designer();
    await d.rightClick(d.pane());
    await d.pick("Auto layout");
    const view = await d.saved();
    expect(view.blocks.map((b) => b.at)).not.toEqual(doc.views.returns!.blocks!.map((b) => b.at));
    // The note goes back beside the diagram.
    expect(view.stickies[0]!.at).toBeUndefined();

    const empty = structuredClone(doc);
    empty.views.returns = { title: "Returns", level: "flowchart" };
    const none = await designer(empty);
    await none.rightClick(none.pane());
    expect(none.labels()).toEqual(["Add", "Export"]);
  });
});

describe("a flowchart's right-click menu, opened with the keyboard", () => {
  it("opens under what it's for, which it selects", async () => {
    const d = await designer();
    put(d.node("refund")!, 300, 420);
    await d.menuKey(d.node("refund")!);
    expect(d.details()).toBe("Process");
    expect(d.labels()).toContain("Delete block");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);

    put(flow(d, 2)!, 520, 260);
    await key(document.activeElement!, "Escape");
    await d.menuKey(flow(d, 2)!);
    expect(d.details()).toBe("Flow 2of 4");
    const flowMenu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([flowMenu.style.left, flowMenu.style.top]).toEqual(["520px", "260px"]);
  });

  it("adds from a lane's menu at the point it opened at, under the lane", async () => {
    const d = await designer(laned);
    // The lane's bottom left corner is at this point on the diagram, with nothing near it.
    const corner = d.onScreen({ x: 900, y: 1200 });
    put(d.node("lane:shop")!, corner.clientX, corner.clientY);
    await d.menuKey(d.node("lane:shop")!);
    expect(d.details()).toBe("Lane 2of 2");
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [900 - STICKY.width / 2, 1150] });
  });
});

describe("a flowchart's right-click menu, as the flowchart changes under it", () => {
  /** The flowchart in a file whose saves wait, with this block selected and new text typed for it: the save that gives it a new ID is on its way. */
  const renaming = async (id: string, text: string) => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node(id)!);
    file.hold = true;
    await write(d.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!, text);
    return { d, file };
  };
  const text = (d: MenuDesigner) => d.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!.value;

  it("waits for a slow save, then opens on the block under the new ID its text gave it", async () => {
    // Its ID follows its text, and the save that renames it hasn't landed when it's right-clicked.
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("say-no")!);
    // No menu yet: an item picked now would name an ID that's about to change.
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("say-no")).toBeNull();
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.labels()).toContain("Delete block");
    expect(text(d)).toBe("Turn it down");
    await d.pick("Delete block");
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "refund", "done"]);
  });

  it("is for the block that was right-clicked, not one whose new ID lands meanwhile and selects it", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    // The save selected the renamed block as it landed; the menu's block is selected again.
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.menuOpen()).toBe(true);
    expect(text(d)).toBe("Refund the card");
    await d.pick("Delete block");
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "turn-it-down", "done"]);
  });

  it("is for the block that's drawn, not one that had its ID before", async () => {
    const d = await designer();
    // The block that said no gets new text, and a new ID with it.
    await click(d.node("say-no")!);
    await write(d.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Text"]')!, "Turn it down");
    await d.settle();
    // Then the refund is given the ID it had. Both edits are drawn by now, so neither is followed again.
    await click(d.node("refund")!);
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="ID"]')!, "say-no");
    await d.settle();
    await d.rightClick(d.node("say-no")!);
    expect(text(d)).toBe("Refund the card");
    await d.pick("Delete block");
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "turn-it-down", "done"]);
  });

  it("doesn't open when what was right-clicked is gone once the edits before it have landed", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("refund")!);
    file.hold = true;
    await click(button(d.host, "Delete block"));
    // Still drawn, as its delete hasn't landed.
    await d.rightClick(d.node("refund")!);
    file.release();
    await d.settle();
    expect(d.node("refund")).toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("doesn't open on a block added at the end, for the last block, deleted just before", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("done")!);
    file.hold = true;
    await click(button(d.host, "Delete block"));
    // With nothing selected, + Add puts the new block last, where the deleted one was.
    await click(d.pane());
    await click(button(d.host, "+ Add"));
    await d.pick("Process");
    await d.rightClick(d.node("done")!);
    file.release();
    await d.settle();
    expect((await d.saved()).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "refund", "say-no", "new-process"]);
    expect(d.menuOpen()).toBe(false);
  });

  it("doesn't open on a block given the ID of the one right-clicked, deleted just before", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("done")!);
    file.hold = true;
    await click(button(d.host, "Delete block"));
    // The refund is given its ID, which is free once the delete lands.
    await click(d.node("refund")!);
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="ID"]')!, "done");
    await d.rightClick(d.node("done")!);
    file.release();
    await d.settle();
    expect((await d.saved()).blocks.map((b) => [b.id, b.text])).toEqual([["asked", "Return asked for"], ["in-time", "Within 30 days?"], ["done", "Refund the card"], ["say-no", "Say no"]]);
    expect(d.menuOpen()).toBe(false);
  });

  it("doesn't open on a flow added since, for the last flow, deleted just before", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(flow(d, 4)!);
    expect(d.details()).toBe("Flow 4of 4");
    file.hold = true;
    await click(button(d.host, "Delete flow"));
    // The details are still the flow's, as its delete hasn't landed: another block's add a flow, which gets its number.
    await click(d.node("say-no")!);
    await choose(select(d.host, "Add a flow to"), "done");
    await d.rightClick(flow(d, 4)!);
    file.release();
    await d.settle();
    expect((await d.saved()).flows.map((f) => `${f.from}>${f.to}`)).toEqual(["asked>in-time", "in-time>refund", "in-time>say-no", "say-no>done"]);
    expect(d.menuOpen()).toBe(false);
  });

  it("opens on a flow under the number it has once a block is deleted, unless it went with the block", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("asked")!);
    file.hold = true;
    await click(button(d.host, "Delete block"));
    // Flow 1 comes from the block that's being deleted. The flow that says No, flow 3, has nothing to do with it.
    await d.rightClick(flow(d, 3)!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.details()).toBe("Flow 2of 3");
    await d.pick("Delete flow");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual(["Yes", undefined]);

    const again = new SlowHost("shop.openarch", serializeDocument(doc));
    const gone = await designer(doc, again);
    await click(gone.node("asked")!);
    again.hold = true;
    await click(button(gone.host, "Delete block"));
    await gone.rightClick(flow(gone, 1)!);
    again.release();
    await gone.settle();
    expect((await gone.saved()).flows).toHaveLength(3);
    expect(gone.menuOpen()).toBe(false);
  });

  it("opens on a flow under the number it has once a flow before it is deleted", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(flow(d, 1)!);
    file.hold = true;
    await click(button(d.host, "Delete flow"));
    await d.rightClick(flow(d, 3)!);
    file.release();
    await d.settle();
    // The flow that said No was flow 3, and is flow 2 now.
    expect(d.details()).toBe("Flow 2of 3");
    await d.pick("Delete flow");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual(["Yes", undefined]);
  });

  it("opens on a flow whose text was typed just before, once that's saved", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(flow(d, 2)!);
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Text"]')!, "Sure");
    await d.rightClick(flow(d, 2)!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.details()).toBe("Flow 2of 4");
    await d.pick("Move down, to flow 3");
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "No", "Sure", undefined]);
  });

  it("opens once a title typed just before has given the flowchart a new ID, on the same diagram", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    const pane = d.pane();
    file.hold = true;
    // The view's ID follows its title, so this renames the view.
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Refunds");
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="ID"]')!.value).toBe("refunds");
    // The diagram wasn't made again for the new ID, which would have dropped the menu and fitted it again.
    expect(d.pane()).toBe(pane);
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Add", "Process");
    expect((await d.saved("refunds")).blocks.at(-1)).toMatchObject({ id: "new-process", at: [1410, 574] });

    // A block's menu too, after another title.
    file.hold = true;
    await click(d.pane());
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Money back");
    await d.rightClick(d.node("refund")!);
    file.release();
    await d.settle();
    expect(d.details()).toBe("Process");
    await d.pick("Delete block");
    expect((await d.saved("money-back")).blocks.map((b) => b.id)).toEqual(["asked", "in-time", "say-no", "done", "new-process"]);
  });

  it("opens straight after a new title when saving takes no time, too", async () => {
    const d = await designer();
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Refunds");
    await d.rightClick(d.pane());
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("opens another view's diagram afresh", async () => {
    const two = structuredClone(doc);
    two.views.exchanges = { title: "Exchanges", level: "flowchart", blocks: [{ id: "swap", text: "Swap it", at: [0, 0] }] };
    const d = await designer(two);
    const pane = d.pane();
    await d.rightClick(d.node("swap")!);
    expect(d.menuOpen()).toBe(true);
    const returns = [...d.host.querySelectorAll<HTMLElement>(".sidebar .row-main")].find((r) => r.textContent?.includes("Returns"))!;
    await click(returns);
    await d.settle();
    expect(d.node("refund")).not.toBeNull();
    expect(d.pane()).not.toBe(pane);
    expect(d.menuOpen()).toBe(false);
  });

  it("doesn't open on a note that an Undo put where the one right-clicked was, under its ID", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    // The note is deleted, and another added, which gets its ID.
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    await d.rightClick(d.pane(), { x: 3000, y: 1200 });
    await d.pick("Add", "Sticky note");
    await key(d.host.querySelector(".sticky textarea")!, "Escape");
    await d.settle();
    expect((await d.saved()).stickies.map((s) => [s.id, s.text])).toEqual([["note", "New note"]]);
    // Two Undos on their way bring the first note back; the new one is still drawn when it's right-clicked.
    file.hold = true;
    await click(button(d.host, "Undo"));
    await click(button(d.host, "Undo"));
    await d.rightClick(d.node("sticky:note")!);
    file.release();
    await d.settle();
    expect((await d.saved()).stickies.map((s) => [s.id, s.text])).toEqual([["note", "Read me"]]);
    expect(d.menuOpen()).toBe(false);
  });

  it("opens the background's menu through an Undo, which leaves the diagram what it was", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    file.hold = true;
    await click(button(d.host, "Undo"));
    await d.rightClick(d.pane());
    file.release();
    await d.settle();
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("isn't called off by something on the page losing the focus, only by the window", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    await act(async () => {
      d.pane().dispatchEvent(new FocusEvent("blur"));
      d.pane().dispatchEvent(new Event("resize"));
    });
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(true);
    expect(text(d)).toBe("Refund the card");
  });

  it("is called off by a press while it waits", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    await act(async () => {
      d.pane().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    });
    file.release();
    await d.settle();
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("is called off by a key while it waits, as a shortcut's edit would land after it opened", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    // Escape selects nothing; the menu doesn't then open and select the block again.
    await key(document.body, "Escape");
    file.release();
    await d.settle();
    expect(d.node("turn-it-down")).not.toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("is called off by the wheel, which moves the diagram from under it, and by the window changing size or losing the focus", async () => {
    for (const event of [new WheelEvent("wheel", { bubbles: true }), new Event("resize"), new Event("blur")]) {
      const { d, file } = await renaming("say-no", "Turn it down");
      await d.rightClick(d.node("refund")!);
      await act(async () => {
        (event.type === "wheel" ? d.pane() : window).dispatchEvent(event);
      });
      file.release();
      await d.settle();
      expect(d.menuOpen(), event.type).toBe(false);
    }
  });

  it("opens only the last one asked for", async () => {
    const { d, file } = await renaming("say-no", "Turn it down");
    await d.rightClick(d.node("refund")!);
    await d.rightClick(flow(d, 1)!);
    file.release();
    await d.settle();
    expect(document.querySelectorAll(".context-menu")).toHaveLength(1);
    expect(d.details()).toBe("Flow 1of 4");
    expect(d.labels()).toContain("Delete flow");
  });

  it("closes when what it's for is gone", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    await d.pick("Add", "Process");
    await d.rightClick(d.node("new-process")!);
    expect(d.menuOpen()).toBe(true);
    // As when the file changes outside the designer: Undo takes the block away under the menu.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.node("new-process")).toBeNull();
    expect(d.menuOpen()).toBe(false);
  });

  it("closes when a whole version of the file is written under it, though what it's for has the same ID after", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    await d.pick("Change kind", "Document");
    await d.rightClick(d.node("refund")!);
    expect(d.menuOpen()).toBe(true);
    // Undo makes it a process again: a block called refund is there after, but Undo doesn't say it's the same one.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.node("refund")).not.toBeNull();
    expect(d.details()).toBe("Process");
    expect(d.menuOpen()).toBe(false);
    // The background's menu is for the diagram, which it still is.
    await d.rightClick(d.pane());
    await click(button(d.host, "Redo"));
    await d.settle();
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("closes when a flow's number goes to another flow", async () => {
    const d = await designer();
    await d.rightClick(flow(d, 2)!);
    await d.pick("Move down, to flow 3");
    await d.rightClick(flow(d, 3)!);
    expect(d.labels()).toContain("Delete flow");
    // Undo puts it back at 2 under the menu, so flow 3 is another flow now.
    await click(button(d.host, "Undo"));
    await d.settle();
    expect((await d.saved()).flows.map((f) => f.text)).toEqual([undefined, "Yes", "No", undefined]);
    expect(d.menuOpen()).toBe(false);
  });

  it("closes when something else is selected", async () => {
    const d = await designer();
    await d.rightClick(d.node("refund")!);
    expect(d.menuOpen()).toBe(true);
    // Selected without a press, which would have closed the menu itself.
    await click(d.node("asked")!);
    expect(d.details()).toBe("Start");
    expect(d.menuOpen()).toBe(false);
    // The background's menu is for nothing that's selected, so it stays.
    await d.rightClick(d.pane());
    await click(d.node("asked")!);
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });
});
