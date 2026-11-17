// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { addBlockOps, FlowchartDiagram } from "../src/canvas/FlowchartDiagram.js";
import { blockHeight, blockWidth, onOutline, routeToOutlines, SLANT } from "../src/canvas/flowchartLayout.js";
import { followRenames, LEVEL_NAMES, shownInProperties, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, choose, click, mount, select } from "./dom.js";

/** A return, each block placed, so nothing waits for ELK. */
const doc: OpenArchDocument = {
  openarch: 16,
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

  it("says how to start when there are no blocks", async () => {
    const empty: OpenArchDocument = { ...doc, views: { returns: { title: "Returns", level: "flowchart", blocks: [], flows: [] } } };
    const { host } = await diagram(null, empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This flowchart has no blocks yet.");
  });

  it("adds a block from + Add, after the one selected, with a flow to it, and selects it to give it text", async () => {
    const { host, edits, selected } = await diagram({ kind: "block", id: "refund" });
    await click(button(host, "+ Add"));
    const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(["Process", "Start", "End", "Decision", "Input or output", "Subprocess", "Document", "Database", "Sticky note"]);
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
    expect(addBlockOps(view, "end", { kind: "block", id: "done" }, [0, 0]).ops).toEqual([{ op: "add-block", view: "returns", id: "new-end", kind: "end", text: "End", at: [0, 0], position: 6 }]);
    expect(addBlockOps(view, "start", null, [0, 0]).ops).toEqual([{ op: "add-block", view: "returns", id: "new-start", kind: "start", text: "Start", at: [0, 0] }]);
    const taken = buildWorkspace({ ...doc, views: { returns: { ...doc.views.returns!, blocks: [{ id: "new-document", text: "Slip" }] } } }).views.get("returns")!;
    expect(addBlockOps(taken, "document", null, [0, 0]).id).toBe("new-document-2");
  });
});

describe("a flowchart's shapes", () => {
  const box = { x: 0, y: 0, w: 200, h: 100 };

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
