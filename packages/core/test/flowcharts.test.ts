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
    expect(fails(returns(), { op: "update-block", view: "returns", id: "done" })).toBe('Say what to change on block "done": newId, kind, text, description, at, position.');
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
      'View "returns" is a flowchart view. Only sticky notes on landscape, context, container, component and class views can be on an element or relationship.',
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
