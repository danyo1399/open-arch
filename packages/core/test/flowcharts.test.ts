import { describe, expect, it } from "vitest";
import {
  applyOperations,
  buildWorkspace,
  checkWorkspace,
  computeView,
  describeElement,
  exportDocs,
  OpError,
  parseDocument,
  parseOperations,
  renderMermaid,
  serializeDocument,
  stickyAnchor,
  type OpenArchDocument,
  type Operation,
} from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with a flowchart of a return: asked for, a decision, a label emailed, a check and a refund, or a no. */
function returns(): OpenArchDocument {
  const doc = shop();
  doc.views.returns = {
    title: "Returns",
    level: "flowchart",
    scope: "api",
    blocks: [
      { id: "asked", kind: "start", text: "Return asked for", at: [0, 0] },
      { id: "in-time", kind: "decision", text: "Within 30 days?", at: [0, 120] },
      { id: "label", kind: "input-output", text: "Email a return label" },
      { id: "check", kind: "subprocess", text: "Check the item" },
      { id: "refund", text: "Refund the card", description: "Within 3 days" },
      { id: "refuse", text: "Say no,\nand why" },
      { id: "slip", kind: "document", text: "Return slip" },
      { id: "log", kind: "database", text: "Returns log" },
      { id: "done", kind: "end", text: "Done" },
    ],
    flows: [
      { from: "asked", to: "in-time" },
      { from: "in-time", to: "label", text: "Yes" },
      { from: "in-time", to: "refuse", text: "No" },
      { from: "label", to: "check" },
      { from: "check", to: "slip" },
      { from: "check", to: "refund" },
      { from: "refund", to: "log" },
      { from: "refund", to: "done" },
      { from: "refuse", to: "done" },
    ],
  };
  return doc;
}

function fails(doc: OpenArchDocument, ...ops: Operation[]): string {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("expected the operations to be refused");
}

/** The shop with an empty flowchart, "returns", of nothing in particular. */
const base = () => apply(shop(), { op: "add-view", id: "returns", level: "flowchart" });

const view = (doc: OpenArchDocument, id = "returns") => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

describe("flowchart views", () => {
  it("are read and written, with a block or a flow on each line, in the file's order", () => {
    const text = serializeDocument(returns());
    expect(text).toContain(`    "returns": {
      "title": "Returns",
      "level": "flowchart",
      "scope": "api",
      "blocks": [
        { "id": "asked", "kind": "start", "text": "Return asked for", "at": [0, 0] },
        { "id": "in-time", "kind": "decision", "text": "Within 30 days?", "at": [0, 120] },
        { "id": "label", "kind": "input-output", "text": "Email a return label" },
        { "id": "check", "kind": "subprocess", "text": "Check the item" },
        { "id": "refund", "text": "Refund the card", "description": "Within 3 days" },
        { "id": "refuse", "text": "Say no,\\nand why" },
        { "id": "slip", "kind": "document", "text": "Return slip" },
        { "id": "log", "kind": "database", "text": "Returns log" },
        { "id": "done", "kind": "end", "text": "Done" }
      ],
      "flows": [
        { "from": "asked", "to": "in-time" },
        { "from": "in-time", "to": "label", "text": "Yes" },
        { "from": "in-time", "to": "refuse", "text": "No" },
        { "from": "label", "to": "check" },
        { "from": "check", "to": "slip" },
        { "from": "check", "to": "refund" },
        { "from": "refund", "to": "log" },
        { "from": "refund", "to": "done" },
        { "from": "refuse", "to": "done" }
      ]
    },`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.returns).toEqual(returns().views.returns);
    expect(rules(returns())).toEqual([]);
  });

  it("are written with empty lists when they have nothing on them yet, and leave out the defaults", () => {
    expect(serializeDocument(base())).toContain(`      "level": "flowchart",\n      "blocks": [],\n      "flows": []\n    }`);
    const doc = apply(base(), { op: "add-block", view: "returns", id: "pack", kind: "process", text: " Pack it ", at: [1.4, 2.6] }, { op: "add-block", view: "returns", id: "ship" }, { op: "add-flow", view: "returns", from: "pack", to: "ship", text: " " });
    expect(doc.views.returns).toEqual({
      title: "Returns",
      level: "flowchart",
      blocks: [
        { id: "pack", text: "Pack it", at: [1, 3] },
        { id: "ship", text: "Ship" },
      ],
      flows: [{ from: "pack", to: "ship" }],
    });
    const parsed = parseDocument(JSON.stringify({ ...shop(), views: { f: { title: "F", level: "flowchart", blocks: [{ id: "a", kind: "process", text: "A" }], flows: [] } } }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.f).toEqual({ title: "F", level: "flowchart", blocks: [{ id: "a", text: "A" }], flows: [] });
  });

  it("are new in version 16: a version 15 file is read as it is", () => {
    const old = shop();
    const parsed = parseDocument(JSON.stringify({ ...old, openarch: 15 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(old);
  });

  it("refuse fields of other views, and report malformed blocks and flows", () => {
    const doc = {
      ...shop(),
      views: {
        f: {
          title: "F",
          level: "flowchart",
          include: ["*"],
          layout: {},
          shapes: [],
          blocks: [
            { id: "ok", text: "OK" },
            { id: "ok", text: "Again" },
            { id: "Bad", text: "Bad" },
            { text: "No ID" },
            { id: "odd", kind: "oval", text: "Odd", at: [1], colour: "red" },
            { id: "blank", text: " " },
            "nope",
          ],
          flows: [{ from: "ok", to: "blank", text: 3 }, { from: "ok" }, { from: "ok", to: "blank", why: "?" }, 7],
        },
        other: { title: "Other", level: "state", blocks: [], flows: [] },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.f.include",
      "field-not-allowed views.f.layout",
      "field-not-allowed views.f.shapes",
      "id-duplicate views.f.blocks[1].id",
      "id-format views.f.blocks[2].id",
      "field-required views.f.blocks[3].id",
      "field-unknown views.f.blocks[4].colour",
      "block-kind-invalid views.f.blocks[4].kind",
      "field-type views.f.blocks[4].at",
      "field-required views.f.blocks[5].text",
      "field-type views.f.blocks[6]",
      "field-type views.f.flows[0].text",
      "field-required views.f.flows[1].to",
      "field-unknown views.f.flows[2].why",
      "field-type views.f.flows[3]",
      "field-not-allowed views.other.blocks",
      "field-not-allowed views.other.flows",
    ]);
    expect(parsed.diagnostics.find((d) => d.path === "views.f.include")!.message).toBe("Flowchart views don't take `include`: they show their blocks, each where its `at` puts it, or laid out from the first down.");
    expect(parsed.doc.views.f!.blocks).toEqual([
      { id: "ok", text: "OK" },
      { id: "odd", text: "Odd" },
      { id: "blank", text: "blank" },
    ]);
    expect(parsed.doc.views.f!.flows).toEqual([
      { from: "ok", to: "blank" },
      { from: "ok", to: "blank" },
    ]);
    expect(parsed.valid).toBe(false);
  });

  it("know each block's place and kind, and each flow's number", () => {
    const v = buildWorkspace(returns()).views.get("returns")!;
    expect(v.blocks.map((b) => [b.id, b.number, b.kind])).toEqual([
      ["asked", 1, "start"],
      ["in-time", 2, "decision"],
      ["label", 3, "input-output"],
      ["check", 4, "subprocess"],
      ["refund", 5, "process"],
      ["refuse", 6, "process"],
      ["slip", 7, "document"],
      ["log", 8, "database"],
      ["done", 9, "end"],
    ]);
    expect(v.flows.map((f) => [f.number, f.from, f.to, f.text])).toContainEqual([2, "in-time", "label", "Yes"]);
    expect(view(returns())).toMatchObject({ nodes: [], edges: [], diagnostics: [], boundary: { id: "api" } });
  });

  it("can be of any element, or of nothing in particular, and its element's page says so", () => {
    expect(view(base()).boundary).toBeUndefined();
    for (const scope of ["customer", "shop", "api", "controller"]) expect(rules(apply(shop(), { op: "add-view", id: "f", level: "flowchart", scope }))).toEqual([]);
    expect(apply(shop(), { op: "add-view", id: "f", level: "flowchart", scope: "api" }).views.f!.title).toBe("API process");
    expect(base().views.returns!.title).toBe("Returns");
    expect(fails(shop(), { op: "add-view", id: "f", level: "flowchart", scope: "nope" })).toBe('Scope "nope" isn\'t an element.');
    expect(describeElement(buildWorkspace(returns()), "api")!.views.find((v) => v.view.id === "returns")!.as).toBe("process");
    const page = exportDocs(buildWorkspace(returns()), "shop.openarch").find((f) => f.path === "elements/api.md")!.content;
    expect(page).toContain("- [Returns](../views/returns.md) (its process)");
    // Renaming the element keeps the view on it, and removing it removes the view, as for a state view.
    expect(apply(returns(), { op: "rename", id: "api", to: "orders-api" }).views.returns!.scope).toBe("orders-api");
    expect(apply(returns(), { op: "remove-element", id: "api" }).views.returns).toBeUndefined();
  });

  it("are checked: a flow's ends are blocks of the view, and what a flowchart says is followed", () => {
    const doc = returns();
    const v = doc.views.returns!;
    v.blocks!.push({ id: "ask", kind: "decision", text: "Ask again?" }, { id: "again", kind: "start", text: "Again" });
    v.flows!.push(
      { from: "refnd", to: "done" },
      { from: "done", to: "log" },
      { from: "log", to: "asked" },
      { from: "check", to: "check" },
      { from: "ask", to: "done" },
    );
    const found = checkWorkspace(buildWorkspace(doc)).map((d) => [d.severity, d.rule, d.path, d.message, d.fix]);
    expect(found).toEqual([
      ["error", "flow-unknown-block", "views.returns.flows[9].from", 'Flow 10: "refnd" isn\'t a block of this view.', 'Did you mean "refund"?'],
      ["warning", "flow-from-end", "views.returns.flows[10].from", 'Flow 11 leaves "done", an end, but the process ends there.', "Make the block another kind, or remove the flow."],
      ["warning", "flow-to-start", "views.returns.flows[11].to", 'Flow 12 goes into "asked", a start, but nothing comes before the start.', "Point it at the step after the start instead, or make the block another kind."],
      ["warning", "flow-to-itself", "views.returns.flows[12].to", 'Flow 13 goes from block "check" to itself, so it isn\'t drawn.', "Point `to` at another block, or remove the flow."],
      ["warning", "decision-flow-text", "views.returns.flows[13].text", 'Flow 14, out of the decision "ask", doesn\'t say which answer it\'s for.', 'Give it text, like "Yes" or "No".'],
      ["warning", "decision-ways", "views.returns.blocks[9].kind", 'The decision "ask" has one way out, so it decides nothing.', 'Add a flow out of it for each answer, with text like "Yes" and "No", or make it a process.'],
    ]);
  });

  it("warn when they have blocks but no start, or a decision with no way out", () => {
    const doc = apply(base(), { op: "add-block", view: "returns", id: "which", kind: "decision", text: "Which?" });
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.rule, d.path, d.message, d.fix])).toEqual([
      ["flowchart-start-missing", "views.returns.blocks", "This flowchart has no start, so it doesn't say where the process begins.", "Add one with `open-arch add-block returns start --kind start`, and a flow from it."],
      ["decision-ways", "views.returns.blocks[0].kind", 'The decision "which" has no way out, so it decides nothing.', 'Add a flow out of it for each answer, with text like "Yes" and "No", or make it a process.'],
    ]);
    // An empty one says nothing yet.
    expect(rules(base())).toEqual([]);
    // The command it suggests uses an ID the view doesn't have, so it works.
    const taken = apply(base(), { op: "add-block", view: "returns", id: "start", text: "Begin" }, { op: "add-block", view: "returns", id: "start-2", text: "Again" });
    const fix = checkWorkspace(buildWorkspace(taken)).find((d) => d.rule === "flowchart-start-missing")!.fix!;
    expect(fix).toBe("Add one with `open-arch add-block returns start-3 --kind start`, and a flow from it.");
    expect(rules(apply(taken, { op: "add-block", view: "returns", id: "start-3", kind: "start" }))).toEqual([]);
  });

  it("show in Mermaid as a flowchart, each block in its kind's shape, with the text of each flow", () => {
    expect(renderMermaid(view(returns()))).toBe(
      [
        "flowchart TB",
        '  asked(["Return asked for"])',
        '  in_time{"Within 30 days?"}',
        '  label[/"Email a return label"/]',
        '  check[["Check the item"]]',
        '  refund["Refund the card<br/><i>Within 3 days</i>"]',
        '  refuse["Say no,<br/>and why"]',
        '  slip["Return slip"]',
        '  log[("Returns log")]',
        '  done(["Done"])',
        "  asked --> in_time",
        '  in_time -->|"Yes"| label',
        '  in_time -->|"No"| refuse',
        "  label --> check",
        "  check --> slip",
        "  check --> refund",
        "  refund --> log",
        "  refund --> done",
        "  refuse --> done",
      ].join("\n"),
    );
    // Text is escaped, a block called "end" isn't read as a keyword, and flows Mermaid can't draw are left out.
    const doc = apply(
      base(),
      { op: "add-block", view: "returns", id: "end", kind: "end", text: 'Say "bye" <b>' },
      { op: "add-block", view: "returns", id: "a", text: "A" },
      { op: "add-flow", view: "returns", from: "a", to: "end", text: "a|b" },
    );
    doc.views.returns!.flows!.push({ from: "a", to: "a" }, { from: "a", to: "gone" });
    const text = renderMermaid(view(doc));
    expect(text).toBe(["flowchart TB", '  end_(["Say #quot;bye#quot; #lt;b#gt;"])', '  a["A"]', '  a -->|"a#124;b"| end_'].join("\n"));
    expect(renderMermaid(view(base()))).toBe("flowchart TB\n  %% This view has no blocks yet.");
  });

  it("are documented with a table of their blocks and one of their flows", () => {
    const page = exportDocs(buildWorkspace(returns()), "shop.openarch").find((f) => f.path === "views/returns.md")!.content;
    expect(page).toContain("# Returns\n\nFlowchart view of [API](../elements/api.md).\n\n```mermaid\nflowchart TB\n");
    expect(page).toContain(
      [
        "## Blocks",
        "",
        "| # | Block | Kind | Description |",
        "|---|---|---|---|",
        "| 1 | Return asked for | Start |  |",
        "| 2 | Within 30 days? | Decision |  |",
        "| 3 | Email a return label | Input or output |  |",
        "| 4 | Check the item | Subprocess |  |",
        "| 5 | Refund the card | Process | Within 3 days |",
        "| 6 | Say no, / and why | Process |  |",
        "| 7 | Return slip | Document |  |",
        "| 8 | Returns log | Database |  |",
        "| 9 | Done | End |  |",
        "",
        "## Flows",
        "",
        "| # | From | To | Text |",
        "|---|---|---|---|",
        "| 1 | Return asked for | Within 30 days? |  |",
        "| 2 | Within 30 days? | Email a return label | Yes |",
        "| 3 | Within 30 days? | Say no, / and why | No |",
      ].join("\n"),
    );
    expect(exportDocs(buildWorkspace(base()), "shop.openarch").find((f) => f.path === "views/returns.md")!.content).toContain("## Blocks\n\nNone yet.\n\n[All views");
  });
});

describe("block and flow operations", () => {
  it("add blocks of each kind, at a place in the list, and say what they added", () => {
    const result = applyOperations(base(), [
      { op: "add-block", view: "returns", id: "asked", kind: "start", text: "Return asked for" },
      { op: "add-block", view: "returns", id: "in-time", kind: "decision", text: "Within 30 days?", description: "From the day it was delivered", at: [10, 20] },
      { op: "add-block", view: "returns", id: "label", kind: "input-output", position: 2 },
    ]);
    expect(result.summary).toEqual(["added start asked to view returns", "added decision in-time to view returns", "added input or output label to view returns, as block 2"]);
    expect(result.doc.views.returns!.blocks).toEqual([
      { id: "asked", kind: "start", text: "Return asked for" },
      { id: "label", kind: "input-output", text: "Label" },
      { id: "in-time", kind: "decision", text: "Within 30 days?", description: "From the day it was delivered", at: [10, 20] },
    ]);
    expect(fails(base(), { op: "add-block", view: "returns", id: "Bad" })).toBe('"Bad" isn\'t a valid ID. IDs are lowercase kebab-case, like "pack-order".');
    expect(fails(returns(), { op: "add-block", view: "returns", id: "done" })).toBe('View "returns" already has a block "done".');
    expect(fails(base(), { op: "add-block", view: "returns", id: "a", kind: "diamond" as never })).toBe('Unknown kind of block "diamond". Use one of: start, end, process, decision, input-output, subprocess, document, database.');
    expect(fails(base(), { op: "add-block", view: "returns", id: "a", position: 3 })).toBe('View "returns" has 0 blocks, so a new one\'s position can be 1 to 1.');
    expect(fails(shop(), { op: "add-block", view: "landscape", id: "a" })).toBe('View "landscape" is a landscape view. Only flowchart views have blocks and flows.');
  });

  it("update a block's kind, text, description, position and place, and give it a new ID that its flows follow", () => {
    const doc = apply(
      returns(),
      { op: "update-block", view: "returns", id: "refund", kind: "subprocess", text: "Refund", description: null, at: null },
      { op: "update-block", view: "returns", id: "asked", at: [5.6, 7.2] },
      { op: "update-block", view: "returns", id: "in-time", newId: "on-time", kind: "process", position: 1 },
    );
    const v = doc.views.returns!;
    expect(v.blocks![0]).toEqual({ id: "on-time", text: "Within 30 days?", at: [0, 120] });
    expect(v.blocks![1]).toEqual({ id: "asked", kind: "start", text: "Return asked for", at: [6, 7] });
    expect(v.blocks!.find((b) => b.id === "refund")).toEqual({ id: "refund", kind: "subprocess", text: "Refund" });
    expect(v.flows!.slice(0, 3)).toEqual([
      { from: "asked", to: "on-time" },
      { from: "on-time", to: "label", text: "Yes" },
      { from: "on-time", to: "refuse", text: "No" },
    ]);
    const said = (op: Operation) => applyOperations(returns(), [op]).summary[0];
    expect(said({ op: "update-block", view: "returns", id: "done", position: 1 })).toBe("moved block done to block 1 in view returns");
    expect(said({ op: "update-block", view: "returns", id: "done", position: 9 })).toBe("block done is already block 9 in view returns");
    expect(said({ op: "update-block", view: "returns", id: "done", text: "Finished", position: 1 })).toBe("updated block done in view returns, and moved it to block 1");
    expect(said({ op: "update-block", view: "returns", id: "done", newId: "finished" })).toBe("renamed block done to finished in view returns");
    expect(fails(returns(), { op: "update-block", view: "returns", id: "done" })).toBe('Say what to change on block "done": newId, kind, text, description, lane, at, position.');
    expect(fails(returns(), { op: "update-block", view: "returns", id: "done", text: " " })).toBe("A block needs some text: what's done, or for a decision, the question.");
    expect(fails(returns(), { op: "update-block", view: "returns", id: "done", newId: "refund" })).toBe('View "returns" already has a block "refund".');
    expect(fails(returns(), { op: "update-block", view: "returns", id: "dnoe", text: "X" })).toBe('View "returns" has no block "dnoe". Did you mean "done"?');
  });

  it("remove a block with the flows to and from it", () => {
    const result = applyOperations(returns(), [{ op: "remove-block", view: "returns", id: "refund" }]);
    expect(result.summary).toEqual(["removed block refund from view returns and 3 flows to or from it"]);
    expect(result.doc.views.returns!.flows!.some((f) => f.from === "refund" || f.to === "refund")).toBe(false);
    expect(applyOperations(returns(), [{ op: "remove-block", view: "returns", id: "slip" }, { op: "remove-block", view: "returns", id: "log" }]).summary[1]).toBe("removed block log from view returns and 1 flow to or from it");
  });

  it("add, change, move and remove flows by number", () => {
    const start = apply(base(), { op: "add-block", view: "returns", id: "a", kind: "decision", text: "A?" }, { op: "add-block", view: "returns", id: "b" }, { op: "add-block", view: "returns", id: "c" });
    const result = applyOperations(start, [
      { op: "add-flow", view: "returns", from: "a", to: "b", text: "Yes" },
      { op: "add-flow", view: "returns", from: "a", to: "c", text: "No", flow: 1 },
    ]);
    expect(result.summary).toEqual(["added flow 1 to view returns: a -> b", "added flow 1 to view returns: a -> c"]);
    expect(result.warnings).toEqual([]);
    const doc = result.doc;
    expect(doc.views.returns!.flows).toEqual([
      { from: "a", to: "c", text: "No" },
      { from: "a", to: "b", text: "Yes" },
    ]);
    expect(apply(doc, { op: "update-flow", view: "returns", flow: 1, to: "b", text: "Maybe" }).views.returns!.flows![0]).toEqual({ from: "a", to: "b", text: "Maybe" });
    expect(apply(doc, { op: "update-flow", view: "returns", flow: 1, text: null }).views.returns!.flows![0]).toEqual({ from: "a", to: "c" });
    expect(applyOperations(doc, [{ op: "update-flow", view: "returns", flow: 1, newFlow: 2 }]).summary).toEqual(["moved flow 1 to 2 in view returns"]);
    expect(apply(doc, { op: "update-flow", view: "returns", flow: 1, newFlow: 2 }).views.returns!.flows![1]).toEqual({ from: "a", to: "c", text: "No" });
    expect(applyOperations(doc, [{ op: "remove-flow", view: "returns", flow: 2 }]).summary).toEqual(["removed flow 2 from view returns"]);
    expect(apply(doc, { op: "remove-flow", view: "returns", flow: 2 }).views.returns!.flows).toEqual([{ from: "a", to: "c", text: "No" }]);
    // A new warning comes back with the change, without stopping it.
    expect(applyOperations(doc, [{ op: "add-flow", view: "returns", from: "b", to: "a" }, { op: "update-flow", view: "returns", flow: 1, text: null }]).warnings.map((w) => w.rule)).toEqual(["decision-flow-text"]);
  });

  it("refuse flows that join no blocks, a block to itself, or say what another says", () => {
    const doc = returns();
    expect(fails(doc, { op: "add-flow", view: "returns", from: "done", to: "nope" })).toBe('View "returns" has no block "nope". Its blocks: asked, in-time, label, check, refund, refuse, slip, log, done.');
    expect(fails(doc, { op: "add-flow", view: "returns", from: "done", to: "done" })).toBe("A flow can't go from a block to itself.");
    expect(fails(doc, { op: "add-flow", view: "returns", from: "in-time", to: "label", text: "Yes" })).toBe('View "returns" already has a flow from "in-time" to "label" that says "Yes": flow 2.');
    expect(fails(doc, { op: "add-flow", view: "returns", from: "asked", to: "in-time" })).toBe('View "returns" already has a flow from "asked" to "in-time": flow 1.');
    expect(fails(doc, { op: "add-flow", view: "returns", from: "in-time", to: "label", flow: 11 })).toBe('View "returns" has 9 flows, so a new one can be flow 1 to 10.');
    expect(fails(doc, { op: "update-flow", view: "returns", flow: 3, text: "Yes", to: "label" })).toBe('View "returns" already has a flow from "in-time" to "label" that says "Yes": flow 2.');
    expect(fails(doc, { op: "update-flow", view: "returns", flow: 1, to: "asked" })).toBe("A flow can't go from a block to itself.");
    expect(fails(doc, { op: "update-flow", view: "returns", flow: 1 })).toBe("Say what to change on flow 1: from, to, text, newFlow.");
    expect(fails(doc, { op: "update-flow", view: "returns", flow: 10, text: "x" })).toBe('View "returns" has 9 flows: "flow" must be 1 to 9.');
    expect(fails(doc, { op: "update-flow", view: "returns", flow: 1, newFlow: 10 })).toBe('View "returns" has 9 flows, so "newFlow" must be 1 to 9.');
    expect(fails(base(), { op: "remove-flow", view: "returns", flow: 1 })).toBe('View "returns" has no flows yet.');
    // Its own text, unchanged, isn't another flow's.
    expect(apply(doc, { op: "update-flow", view: "returns", flow: 2, text: "Yes" }).views.returns!.flows![1]).toEqual({ from: "in-time", to: "label", text: "Yes" });
  });

  it("refuse what only other views take", () => {
    expect(fails(shop(), { op: "add-view", id: "f", level: "flowchart", include: ["shop"] })).toMatch(/^A flowchart view draws its blocks, not elements/);
    expect(fails(returns(), { op: "update-view", id: "returns", newElements: "hide" })).toMatch(/^A flowchart view draws its blocks, not elements/);
    expect(fails(returns(), { op: "show-in-view", view: "returns", id: "shop" })).toMatch(/^A flowchart view draws its blocks, not elements/);
    expect(fails(returns(), { op: "hide-in-view", view: "returns", id: "shop" })).toMatch(/^A flowchart view draws its blocks, not elements/);
    expect(fails(returns(), { op: "set-layout", view: "returns", positions: { shop: [0, 0] } })).toBe("A flowchart view has no boxes. Move a block with update-block --at.");
    expect(fails(returns(), { op: "add-sticky", view: "returns", id: "n", text: "Hi", on: { element: "api" } })).toBe(
      'View "returns" is a flowchart view, which draws its blocks, not elements or relationships: a sticky note on it can only be on a block.',
    );
    expect(apply(returns(), { op: "add-sticky", view: "returns", id: "n", text: "Hi", at: [0, 0] }).views.returns!.stickies).toEqual({ n: { text: "Hi", at: [0, 0] } });
  });

  it("are checked as JSON", () => {
    expect(parseOperations({ op: "add-block", view: "returns", id: "a", kind: "start", at: [1, 2], position: 1 })).toHaveLength(1);
    expect(() => parseOperations({ op: "add-block", view: "returns" })).toThrow('add-block needs "id".');
    expect(() => parseOperations({ op: "update-block", view: "returns", id: "a", at: [1] })).toThrow('update-block: "at" must be a position, [x, y], or null to let the designer place it.');
    expect(() => parseOperations({ op: "add-flow", view: "returns", from: "a" })).toThrow('add-flow needs "to".');
    expect(() => parseOperations({ op: "update-flow", view: "returns", flow: 0 })).toThrow('update-flow: "flow" must be a number, 1 or more: 1 is the first.');
    expect(() => parseOperations({ op: "remove-flow", view: "returns", flow: 1, text: "x" })).toThrow('remove-flow has no field "text".');
  });
});

/** The return, with a note on its decision, where it was put, and one on nothing. */
function noted(): OpenArchDocument {
  const doc = returns();
  doc.views.returns!.stickies = {
    days: { text: "Counted from delivery.", on: { block: "in-time" }, at: [300, 120] },
    plain: { text: "Not on anything." },
  };
  return doc;
}

describe("sticky notes on a flowchart's blocks", () => {
  it("are read and written in the file's canonical form", () => {
    const text = serializeDocument(noted());
    expect(text).toContain('"days": { "text": "Counted from delivery.", "on": { "block": "in-time" }, "at": [300, 120] },');
    const read = parseDocument(text);
    expect(read.diagnostics).toEqual([]);
    expect(read.doc.views.returns).toEqual(noted().views.returns);
    expect(buildWorkspace(read.doc).views.get("returns")!.stickies.find((s) => s.id === "days")!.on).toEqual({ block: "in-time" });
  });

  it("are new in version 20: a version 19 file is read as it is", () => {
    const parsed = parseDocument(JSON.stringify({ ...returns(), openarch: 19 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(returns());
  });

  it("report what isn't a block, and a block on another view, and keep the note", () => {
    const doc = returns() as unknown as { views: Record<string, Record<string, unknown>> };
    doc.views.landscape!.stickies = { box: { text: "Box", on: { block: "in-time" } } };
    doc.views.returns!.stickies = {
      a: { text: "A", on: "in-time" },
      b: { text: "B", on: { element: "api" } },
      c: { text: "C", on: { from: "asked", to: "in-time" } },
      d: { text: "D", on: { block: "" } },
      e: { text: "E", on: { block: "in-time", side: "left" } },
      f: { text: "F", on: {} },
      g: { text: "G", on: { block: 3 } },
      h: { text: "H", on: { block: "in-time", element: "api" } },
    };
    const result = parseDocument(JSON.stringify(doc));
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.landscape.stickies.box.on.block",
      "field-type views.returns.stickies.a.on",
      "field-not-allowed views.returns.stickies.b.on.element",
      "field-not-allowed views.returns.stickies.c.on.from",
      "field-required views.returns.stickies.d.on.block",
      "field-unknown views.returns.stickies.e.on.side",
      "field-required views.returns.stickies.f.on",
      "field-type views.returns.stickies.g.on.block",
      "field-not-allowed views.returns.stickies.h.on.element",
    ]);
    const message = (path: string) => result.diagnostics.find((d) => d.path === path)!.message;
    expect(message("views.landscape.stickies.box.on.block")).toBe("Only a sticky note on a flowchart view can be on a block.");
    expect(message("views.returns.stickies.a.on")).toBe('Must be a block of this view, like { "block": "pack-order" }.');
    expect(message("views.returns.stickies.b.on.element")).toBe("A flowchart view draws its blocks, not elements or relationships: a sticky note on it can only be on a block.");
    expect(result.doc.views.landscape!.stickies).toEqual({ box: { text: "Box" } });
    expect(result.doc.views.returns!.stickies).toEqual({ a: { text: "A" }, b: { text: "B" }, c: { text: "C" }, d: { text: "D" }, e: { text: "E", on: { block: "in-time" } }, f: { text: "F" }, g: { text: "G" }, h: { text: "H" } });
  });

  it("point at the block, and are checked: it's a block of the view", () => {
    const anchor = (doc: OpenArchDocument, id: string) => {
      const cv = view(doc);
      return stickyAnchor(buildWorkspace(doc), cv, cv.view.stickies.find((s) => s.id === id)!.on!);
    };
    expect(anchor(noted(), "days")).toEqual({ kind: "block", id: "in-time" });
    expect(rules(noted())).toEqual([]);

    const doc = noted();
    doc.views.returns!.stickies!.days!.on = { block: "in-tme" };
    doc.views.returns!.stickies!.plain!.on = { block: "packing" };
    expect(anchor(doc, "days")).toBeUndefined();
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.severity, d.rule, d.path, d.message, d.fix])).toEqual([
      ["error", "sticky-unknown-target", "views.returns.stickies.days.on.block", 'The note is on the block "in-tme", which isn\'t a block of this view.', 'Did you mean "in-time"?'],
      [
        "error",
        "sticky-unknown-target",
        "views.returns.stickies.plain.on.block",
        'The note is on the block "packing", which isn\'t a block of this view.',
        "Take the note off it: `open-arch update-sticky returns plain --detach`.",
      ],
    ]);
    // A view of boxes draws no blocks, and a flowchart no elements.
    const boxes = view(returns(), "shop-containers");
    expect(stickyAnchor(buildWorkspace(returns()), boxes, { block: "in-time" })).toBeUndefined();
    expect(stickyAnchor(buildWorkspace(returns()), view(returns()), { element: "api" })).toBeUndefined();
  });

  it("are added on a block, moved to another, and taken off, and say what they're on", () => {
    const added = applyOperations(returns(), [{ op: "add-sticky", view: "returns", id: "days", text: "Counted from delivery.", on: { block: "in-time" } }]);
    expect(added.summary).toEqual(["added sticky note days to view returns, on block in-time"]);
    expect(added.warnings).toEqual([]);
    expect(added.doc.views.returns!.stickies).toEqual({ days: { text: "Counted from delivery.", on: { block: "in-time" } } });
    const moved = apply(added.doc, { op: "update-sticky", view: "returns", id: "days", on: { block: "refund" } });
    expect(moved.views.returns!.stickies!.days!.on).toEqual({ block: "refund" });
    expect(apply(moved, { op: "update-sticky", view: "returns", id: "days", on: null }).views.returns!.stickies).toEqual({ days: { text: "Counted from delivery." } });
  });

  it("refuse a block the view doesn't have, an element or a relationship, and a block on another view", () => {
    expect(fails(returns(), { op: "add-sticky", view: "returns", id: "n", text: "N", on: { block: "refnd" } })).toBe('View "returns" has no block "refnd". Did you mean "refund"?');
    expect(fails(noted(), { op: "update-sticky", view: "returns", id: "days", on: { from: "asked", to: "in-time" } })).toBe(
      'View "returns" is a flowchart view, which draws its blocks, not elements or relationships: a sticky note on it can only be on a block.',
    );
    expect(fails(returns(), { op: "add-sticky", view: "shop-containers", id: "n", text: "N", on: { block: "refund" } })).toBe(
      'View "shop-containers" is a container view. Only a sticky note on a flowchart view can be on a block.',
    );
    const sequence = apply(returns(), { op: "add-view", id: "order", level: "sequence" });
    expect(fails(sequence, { op: "add-sticky", view: "order", id: "n", text: "N", on: { block: "refund" } })).toBe('View "order" is a sequence view. Only a sticky note on a flowchart view can be on a block.');
  });

  it("follow a block to its new ID, and come off one that's removed", () => {
    const renamed = apply(noted(), { op: "update-block", view: "returns", id: "in-time", newId: "in-30-days" });
    expect(renamed.views.returns!.stickies!.days!.on).toEqual({ block: "in-30-days" });
    expect(rules(renamed)).toEqual([]);
    const removed = apply(noted(), { op: "remove-block", view: "returns", id: "in-time" });
    expect(removed.views.returns!.stickies).toEqual({ days: { text: "Counted from delivery.", at: [300, 120] }, plain: { text: "Not on anything." } });
    // Another block's going leaves it be.
    expect(apply(noted(), { op: "remove-block", view: "returns", id: "refund" }).views.returns!.stickies!.days!.on).toEqual({ block: "in-time" });
  });

  it("stay on a block when an element with the block's ID is renamed or removed", () => {
    // The flowchart has a block "db", and the model an element "db".
    const doc = apply(noted(), { op: "add-block", view: "returns", id: "db", kind: "database", text: "Orders" }, { op: "update-sticky", view: "returns", id: "days", on: { block: "db" } });
    expect(apply(doc, { op: "rename", id: "db", to: "database" }).views.returns!.stickies!.days!.on).toEqual({ block: "db" });
    expect(apply(doc, { op: "remove-element", id: "db" }).views.returns!.stickies!.days!.on).toEqual({ block: "db" });
    // And when a relationship between elements goes.
    expect(apply(doc, { op: "remove-relationship", from: "controller", to: "db" }).views.returns!.stickies!.days!.on).toEqual({ block: "db" });
  });

  it("are checked as JSON", () => {
    expect(parseOperations({ op: "add-sticky", view: "returns", id: "n", text: "N", on: { block: "refund" } })).toHaveLength(1);
    expect(parseOperations({ op: "update-sticky", view: "returns", id: "n", on: { block: "refund" } })).toHaveLength(1);
    for (const on of [{ block: 2 }, { block: "refund", element: "api" }, { block: "refund", side: "left" }]) {
      expect(() => parseOperations({ op: "update-sticky", view: "returns", id: "n", on })).toThrow(/^update-sticky: "on" must be an element, .* or on a flowchart view a block, like \{ "block": "pack-order" \}, or null to take the note off it\.$/);
    }
  });

  it("start with the block's text in the docs, on one line", () => {
    const doc = noted();
    doc.views.returns!.stickies!.plain!.on = { block: "refuse" };
    const page = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/returns.md")!.content;
    expect(page).toContain(['## Sticky notes', "", '> On "Within 30 days?": Counted from delivery.', "", '> On "Say no, / and why": Not on anything.', "", "## Blocks"].join("\n"));
  });
});

/** The return, in a lane for the customer and one for the shop, with the end in neither. */
function laned(): OpenArchDocument {
  const doc = returns();
  const v = doc.views.returns!;
  v.lanes = [
    { id: "customer", name: "Customer" },
    { id: "shop", name: "Shop", description: "The online shop's staff" },
  ];
  for (const b of v.blocks!) if (b.id !== "done") b.lane = b.id === "asked" ? "customer" : "shop";
  return doc;
}

describe("flowchart lanes", () => {
  it("are read and written, a lane on each line before the blocks, and only when there are some", () => {
    const text = serializeDocument(laned());
    expect(text).toContain(`      "scope": "api",
      "lanes": [
        { "id": "customer", "name": "Customer" },
        { "id": "shop", "name": "Shop", "description": "The online shop's staff" }
      ],
      "blocks": [
        { "id": "asked", "kind": "start", "text": "Return asked for", "lane": "customer", "at": [0, 0] },`);
    expect(text).toContain(`        { "id": "done", "kind": "end", "text": "Done" }\n`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.returns).toEqual(laned().views.returns);
    expect(rules(laned())).toEqual([]);
    expect(serializeDocument(returns())).not.toContain('"lanes"');
    expect(buildWorkspace(laned()).views.get("returns")!.blocks.map((b) => b.lane)).toEqual(["customer", "shop", "shop", "shop", "shop", "shop", "shop", "shop", undefined]);
  });

  it("are new in version 17: a version 16 file is read as it is", () => {
    const parsed = parseDocument(JSON.stringify({ ...returns(), openarch: 16 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(returns());
  });

  it("are only on event and flowchart views, and report malformed lanes and lanes on blocks", () => {
    const doc = {
      ...shop(),
      views: {
        f: { title: "F", level: "flowchart", lanes: [{ id: "a", name: "A" }, { id: "a", name: "Again" }, { name: "No ID" }], blocks: [{ id: "x", text: "X", lane: 5 }], flows: [] },
        w: { title: "W", level: "whiteboard", lanes: [], shapes: [], arrows: [] },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => [`${d.rule} ${d.path}`, d.message])).toEqual([
      ["id-duplicate views.f.lanes[1].id", '"a" is the ID of two lanes of this view.'],
      ["field-required views.f.lanes[2].id", "`id` is required: an ID unique among the view's lanes."],
      ["field-type views.f.blocks[0].lane", "Must be a string."],
      ["field-not-allowed views.w.lanes", "Only event and flowchart views have `lanes`."],
    ]);
  });

  it("are checked: a block's lane is a lane of the view", () => {
    const doc = laned();
    doc.views.returns!.blocks![8]!.lane = "shpo";
    doc.views.returns!.blocks![7]!.lane = "warehouse";
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.rule, d.path, d.message, d.fix])).toEqual([
      ["block-lane-unknown", "views.returns.blocks[7].lane", 'Block "log" is in the lane "warehouse", which isn\'t a lane of this view.', "Its lanes: customer, shop."],
      ["block-lane-unknown", "views.returns.blocks[8].lane", 'Block "done" is in the lane "shpo", which isn\'t a lane of this view.', 'Did you mean "shop"?'],
    ]);
    const none = returns();
    none.views.returns!.blocks![0]!.lane = "customer";
    expect(checkWorkspace(buildWorkspace(none)).find((d) => d.rule === "block-lane-unknown")!.fix).toBe("Add it with `open-arch add-lane returns customer`.");
  });

  it("are added, renamed, moved and removed, and blocks go in them and out of them", () => {
    const result = applyOperations(returns(), [
      { op: "add-lane", view: "returns", id: "shop" },
      { op: "add-lane", view: "returns", id: "customer", position: 1 },
      { op: "add-block", view: "returns", id: "chat", text: "Ask why", lane: "shop" },
      { op: "update-block", view: "returns", id: "asked", lane: "customer" },
      { op: "update-block", view: "returns", id: "refund", lane: "shop" },
    ]);
    expect(result.summary).toEqual([
      "added lane shop to view returns",
      "added lane customer to view returns, as lane 1",
      "added process chat to view returns",
      "updated block asked in view returns",
      "updated block refund in view returns",
    ]);
    const doc = result.doc;
    expect(doc.views.returns!.lanes).toEqual([
      { id: "customer", name: "Customer" },
      { id: "shop", name: "Shop" },
    ]);
    expect(doc.views.returns!.blocks!.at(-1)).toEqual({ id: "chat", text: "Ask why", lane: "shop" });
    // A new ID for a lane takes its blocks with it.
    const renamed = apply(doc, { op: "update-lane", view: "returns", id: "shop", newId: "staff", position: 1 });
    expect(renamed.views.returns!.lanes!.map((l) => l.id)).toEqual(["staff", "customer"]);
    expect(renamed.views.returns!.blocks!.filter((b) => b.lane === "staff").map((b) => b.id)).toEqual(["refund", "chat"]);
    // Removing a lane leaves its blocks in no lane, laid out again: their positions were from its left.
    const placed = apply(doc, { op: "update-block", view: "returns", id: "refund", at: [10, 300] }, { op: "update-block", view: "returns", id: "asked", at: [10, 0] });
    const removed = applyOperations(placed, [{ op: "remove-lane", view: "returns", id: "shop" }]);
    expect(removed.summary).toEqual(["removed lane shop from view returns, leaving 2 blocks in no lane, to be laid out again"]);
    const left = removed.doc.views.returns!.blocks!;
    expect(left.find((b) => b.id === "refund")).toEqual({ id: "refund", text: "Refund the card", description: "Within 3 days" });
    // Blocks in the lanes that are left keep theirs.
    expect(left.find((b) => b.id === "asked")).toEqual({ id: "asked", kind: "start", text: "Return asked for", lane: "customer", at: [10, 0] });
    expect(apply(doc, { op: "update-block", view: "returns", id: "asked", lane: null }).views.returns!.blocks![0]).toEqual({ id: "asked", kind: "start", text: "Return asked for", at: [0, 0] });
    expect(fails(doc, { op: "add-block", view: "returns", id: "x", lane: "warehouse" })).toBe('View "returns" has no lane "warehouse". Its lanes: customer, shop.');
    expect(fails(doc, { op: "update-block", view: "returns", id: "asked", lane: "custmer" })).toBe('View "returns" has no lane "custmer". Did you mean "customer"?');
    expect(fails(shop(), { op: "add-lane", view: "landscape", id: "x" })).toBe('View "landscape" is a landscape view. Only event and flowchart views have lanes.');
  });

  it("move blocks right when a flowchart gets its first lane, so none has an x less than 0, which a lane refuses", () => {
    const doc = apply(returns(), { op: "update-block", view: "returns", id: "asked", at: [-300, 0] }, { op: "update-block", view: "returns", id: "in-time", at: [-100, 120] });
    const added = applyOperations(doc, [{ op: "add-lane", view: "returns", id: "customer" }]);
    expect(added.summary).toEqual(["added lane customer to view returns, moving its placed blocks 300 to the right, so none has an x less than 0"]);
    const laned = added.doc;
    expect(laned.views.returns!.blocks!.slice(0, 2).map((b) => b.at)).toEqual([
      [0, 0],
      [200, 120],
    ]);
    // Only the first lane moves them: they're all 0 or more after it.
    expect(apply(laned, { op: "add-lane", view: "returns", id: "shop" }).views.returns!.blocks![1]!.at).toEqual([200, 120]);
    // Blocks placed at 0 or more stay where they are.
    expect(apply(returns(), { op: "add-lane", view: "returns", id: "customer" }).views.returns!.blocks![0]!.at).toEqual([0, 0]);
    const lane = "In a flowchart with lanes, a block's x is from the inside of its lane's left, so it can't be less than 0.";
    expect(fails(laned, { op: "update-block", view: "returns", id: "asked", at: [-1, 0] })).toBe(lane);
    expect(fails(laned, { op: "add-block", view: "returns", id: "x", at: [-5, 0] })).toBe(lane);
    expect(apply(laned, { op: "update-block", view: "returns", id: "asked", at: [0, 9] }).views.returns!.blocks![0]!.at).toEqual([0, 9]);
    // A file edited by hand can still have one, which check warns of.
    laned.views.returns!.blocks![0]!.at = [-40, 9];
    expect(checkWorkspace(buildWorkspace(laned)).map((d) => [d.rule, d.path, d.message, d.fix])).toEqual([
      ["block-x-negative", "views.returns.blocks[0].at", 'Block "asked" is at an x of -40, less than 0, so it\'s drawn at the inside of its lane\'s left.', "Give it an x of 0 or more: `open-arch update-block returns asked --at 0,9`."],
    ]);
    // Without lanes, x can be anything.
    expect(rules(doc)).toEqual([]);
  });

  it("show in Mermaid as a frame for each lane, with its blocks inside it", () => {
    const text = renderMermaid(view(laned()));
    expect(text).toContain(
      [
        "flowchart TB",
        '  done(["Done"])',
        '  subgraph lane__customer["Customer"]',
        "    direction TB",
        '    asked(["Return asked for"])',
        "  end",
        '  subgraph lane__shop["Shop"]',
        "    direction TB",
        '    in_time{"Within 30 days?"}',
      ].join("\n"),
    );
    expect(text).toContain('  refuse --> done\n  style lane__customer fill:none,stroke:#8a94a6\n  style lane__shop fill:none,stroke:#8a94a6');
    // A lane with no blocks yet is a frame with its name.
    const empty = apply(base(), { op: "add-lane", view: "returns", id: "customer" });
    expect(renderMermaid(view(empty))).toBe(["flowchart TB", '  subgraph lane__customer["Customer"]', "  end", "  style lane__customer fill:none,stroke:#8a94a6"].join("\n"));
  });

  it("are documented with a table of lanes, and each block's lane", () => {
    const page = exportDocs(buildWorkspace(laned()), "shop.openarch").find((f) => f.path === "views/returns.md")!.content;
    expect(page).toContain(
      [
        "## Lanes",
        "",
        "| Lane | Description |",
        "|---|---|",
        "| Customer |  |",
        "| Shop | The online shop's staff |",
        "",
        "## Blocks",
        "",
        "| # | Block | Kind | Lane | Description |",
        "|---|---|---|---|---|",
        "| 1 | Return asked for | Start | Customer |  |",
        "| 2 | Within 30 days? | Decision | Shop |  |",
      ].join("\n"),
    );
    expect(page).toContain("| 9 | Done | End |  |  |");
  });
});

/** The return, with the customer's lane for the customer and the shop's for the API. */
function forElements(): OpenArchDocument {
  const doc = laned();
  doc.views.returns!.lanes![0]!.element = "customer";
  doc.views.returns!.lanes![1]!.element = "api";
  return doc;
}

describe("flowchart lanes for elements", () => {
  it("are read and written with the element, and are new in version 21: a version 20 file is read as it is", () => {
    const text = serializeDocument(forElements());
    expect(text).toContain(`      "lanes": [
        { "id": "customer", "name": "Customer", "element": "customer" },
        { "id": "shop", "name": "Shop", "description": "The online shop's staff", "element": "api" }
      ],`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.returns).toEqual(forElements().views.returns);
    expect(buildWorkspace(parsed.doc).views.get("returns")!.lanes.map((l) => l.element)).toEqual(["customer", "api"]);
    expect(rules(forElements())).toEqual([]);
    const old = parseDocument(JSON.stringify({ ...laned(), openarch: 20 }));
    expect(old.diagnostics).toEqual([]);
    expect(old.doc).toEqual(laned());
  });

  it("are only a flowchart's: an event view's lane can't be for an element", () => {
    const doc = { ...shop(), views: { e: { title: "E", level: "event", lanes: [{ id: "a", name: "A", element: "customer" }], cards: [] }, f: { title: "F", level: "flowchart", lanes: [{ id: "b", name: "B", element: 5 }], blocks: [], flows: [] } } };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => [`${d.rule} ${d.path}`, d.message])).toEqual([
      ["field-not-allowed views.e.lanes[0].element", "Only a flowchart's lanes can be for an element."],
      ["field-type views.f.lanes[0].element", "Must be a string."],
    ]);
    expect(parsed.doc.views.e!.lanes).toEqual([{ id: "a", name: "A" }]);
  });

  it("are checked: the element is one of the model's", () => {
    const doc = forElements();
    doc.views.returns!.lanes![0]!.element = "custmer";
    doc.views.returns!.lanes![1]!.element = "warehouse";
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.rule, d.path, d.message, d.fix])).toEqual([
      ["lane-element-unknown", "views.returns.lanes[0].element", 'Lane "customer" is for "custmer", which isn\'t an element.', 'Did you mean "customer"?'],
      ["lane-element-unknown", "views.returns.lanes[1].element", 'Lane "shop" is for "warehouse", which isn\'t an element.', 'Name an element of the model, or take it off with `open-arch update-lane returns shop --element ""`.'],
    ]);
  });

  it("are added and changed with an element, which names a new lane, and taken off it", () => {
    const result = applyOperations(returns(), [
      { op: "add-lane", view: "returns", id: "buyer", element: "customer" },
      { op: "add-lane", view: "returns", id: "staff", name: "Shop staff", element: "api" },
    ]);
    expect(result.doc.views.returns!.lanes).toEqual([
      { id: "buyer", name: "Customer", element: "customer" },
      { id: "staff", name: "Shop staff", element: "api" },
    ]);
    const changed = apply(result.doc, { op: "update-lane", view: "returns", id: "staff", element: "web-app" });
    expect(changed.views.returns!.lanes![1]).toEqual({ id: "staff", name: "Shop staff", element: "web-app" });
    expect(apply(changed, { op: "update-lane", view: "returns", id: "staff", element: null }).views.returns!.lanes![1]).toEqual({ id: "staff", name: "Shop staff" });
    expect(apply(changed, { op: "update-lane", view: "returns", id: "staff", element: "" }).views.returns!.lanes![1]).toEqual({ id: "staff", name: "Shop staff" });
    expect(fails(returns(), { op: "add-lane", view: "returns", id: "x", element: "custmer" })).toBe('No element has the ID "custmer". Did you mean "customer"?');
    expect(fails(changed, { op: "update-lane", view: "returns", id: "staff", element: "nope" })).toMatch(/^No element has the ID "nope"/);
    const events = apply(shop(), { op: "add-view", id: "orders", level: "event", title: "Orders" });
    expect(fails(events, { op: "add-lane", view: "orders", id: "x", element: "customer" })).toBe('View "orders" is an event view. Only a flowchart\'s lanes can be for an element.');
    expect(parseOperations({ op: "update-lane", view: "returns", id: "staff", element: null })).toEqual([{ op: "update-lane", view: "returns", id: "staff", element: null }]);
    expect(parseOperations({ op: "add-lane", view: "returns", id: "x", element: "api" })).toEqual([{ op: "add-lane", view: "returns", id: "x", element: "api" }]);
  });

  it("follow their element to a new ID, and stay, with their blocks, when it's removed", () => {
    const renamed = apply(forElements(), { op: "rename", id: "api", to: "backend" });
    expect(renamed.views.returns!.lanes![1]!.element).toBe("backend");
    // The lane stays, with its blocks in it, for no element.
    const removed = apply(forElements(), { op: "remove-element", id: "customer" });
    expect(removed.views.returns!.lanes).toEqual([
      { id: "customer", name: "Customer" },
      { id: "shop", name: "Shop", description: "The online shop's staff", element: "api" },
    ]);
    expect(removed.views.returns!.blocks![0]!.lane).toBe("customer");
    expect(rules(removed)).toEqual([]);
  });

  it("list the flowchart in their element's views, in show and on its page in the docs, and the lanes in the view's", () => {
    const ws = buildWorkspace(forElements());
    expect(describeElement(ws, "customer")!.views.find((v) => v.view.id === "returns")).toMatchObject({ as: "lane", lanes: [{ id: "customer" }] });
    // The element a flowchart is of is drawn as its frame, its process, before its lanes.
    expect(describeElement(ws, "api")!.views.find((v) => v.view.id === "returns")!.as).toBe("process");
    const files = exportDocs(ws, "shop.openarch");
    expect(files.find((f) => f.path === "elements/customer.md")!.content).toContain("- [Returns](../views/returns.md) (its lane, Customer)");
    const page = files.find((f) => f.path === "views/returns.md")!.content;
    expect(page).toContain(
      ["## Lanes", "", "| Lane | Element | Description |", "|---|---|---|", "| Customer | [Customer](../elements/customer.md) |  |", "| Shop | [API](../elements/api.md) | The online shop's staff |"].join("\n"),
    );
  });
});
