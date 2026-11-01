import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, checkWorkspace, computeView, exportDocs, OpError, parseDocument, parseOperations, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

const fails = (doc: OpenArchDocument, ...ops: Operation[]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("expected the operations to be refused");
};

/** The shop, with a sequence view of an order being placed. */
function ordering(): OpenArchDocument {
  const doc = shop();
  doc.views["place-order"] = {
    title: "Place an order",
    level: "sequence",
    steps: [
      { from: "customer", to: "web-app" },
      { from: "web-app", to: "api", description: "POST /orders", technology: "JSON/HTTPS" },
      { from: "api", to: "db" },
      { from: "api", to: "payments" },
      { from: "api", to: "web-app", description: "Order placed", reply: true },
    ],
  };
  return doc;
}

const computed = (doc: OpenArchDocument, id = "place-order") => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

describe("sequence views in the file", () => {
  it("reads and writes steps, and writes no include list", () => {
    const text = serializeDocument(ordering());
    expect(text).toContain(
      [
        '    "place-order": {',
        '      "title": "Place an order",',
        '      "level": "sequence",',
        '      "steps": [',
        '        { "from": "customer", "to": "web-app" },',
        '        { "from": "web-app", "to": "api", "description": "POST /orders", "technology": "JSON/HTTPS" },',
        '        { "from": "api", "to": "db" },',
        '        { "from": "api", "to": "payments" },',
        '        { "from": "api", "to": "web-app", "description": "Order placed", "reply": true }',
        "      ]",
        "    }",
      ].join("\n"),
    );
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views["place-order"]).toEqual(ordering().views["place-order"]);
    // An empty one keeps its empty list, so it's plain it's a list of steps.
    const empty = serializeDocument(apply(shop(), { op: "add-view", id: "refund", level: "sequence" }));
    expect(empty).toContain('"refund": {\n      "title": "Refund",\n      "level": "sequence",\n      "steps": []\n    }');
  });

  it("reports fields a sequence view doesn't take, steps on other views, and malformed steps", () => {
    const result = parseDocument(
      JSON.stringify({
        openarch: 4,
        name: "X",
        elements: {},
        views: {
          s: { title: "S", level: "sequence", include: ["*"], layout: {}, steps: [{ from: "a" }, { from: "a", to: "b", reply: "yes", label: "x" }, 3] },
          l: { title: "L", level: "landscape", steps: [] },
        },
      }),
    );
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.s.include",
      "field-not-allowed views.s.layout",
      "field-required views.s.steps[0].to",
      "field-unknown views.s.steps[1].label",
      "field-type views.s.steps[1].reply",
      "field-type views.s.steps[2]",
      "field-not-allowed views.l.steps",
    ]);
    expect(result.doc.views.s).toEqual({ title: "S", level: "sequence", steps: [{ from: "a", to: "b" }] });
    expect(result.doc.views.l).toEqual({ title: "L", level: "landscape" });
  });
});

describe("computing a sequence view", () => {
  it("shows the elements in its steps, in the order they first appear, with no arrows", () => {
    const cv = computed(ordering());
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "web-app", "api", "db", "payments"]);
    expect(cv.edges).toEqual([]);
    expect(cv.boundary).toBeUndefined();
    expect(cv.diagnostics).toEqual([]);
  });

  it("finds each step's relationships, through elements inside its ends, and labels calls with them", () => {
    const cv = computed(ordering());
    expect(cv.steps.map((s) => [s.number, s.label, s.labelTechnology, s.sources])).toEqual([
      [1, "Buys things", "HTTPS", [{ element: "customer", index: 0 }]],
      // web-app uses a component inside the api, so the step goes along that.
      [2, "POST /orders", "JSON/HTTPS", [{ element: "web-app", index: 0 }]],
      [3, "Stores orders", "SQL", [{ element: "controller", index: 0 }]],
      [4, "Charges cards", undefined, [{ element: "controller", index: 1 }]],
      // A reply goes back along a call's relationship, but isn't labelled with it.
      [5, "Order placed", undefined, [{ element: "web-app", index: 0 }]],
    ]);
  });

  it("warns about a step with no relationship, and reports unknown elements and steps to itself", () => {
    const doc = ordering();
    doc.views["place-order"]!.steps!.push(
      { from: "db", to: "customer" },
      { from: "custmer", to: "api" },
      { from: "api", to: "api" },
      { from: "customer", to: "web-app", reply: true },
      { from: "web-app", to: "shop" },
    );
    const found = checkWorkspace(buildWorkspace(doc)).map((d) => `${d.severity} ${d.rule} ${d.path}${d.fix?.startsWith("Did") ? ` (${d.fix})` : ""}`);
    expect(found).toEqual([
      "warning step-relationship-missing views.place-order.steps[5]",
      'error step-unknown-element views.place-order.steps[6].from (Did you mean "customer"?)',
      "error step-self views.place-order.steps[7]",
      "warning step-relationship-missing views.place-order.steps[8]",
      "warning step-relationship-missing views.place-order.steps[9]",
    ]);
    const missing = checkWorkspace(buildWorkspace(doc)).find((d) => d.path === "views.place-order.steps[8]")!;
    expect(missing.message).toBe('Step 9: the model has no relationship from "web-app" to "customer", for this reply to go back along.');
  });

  it("takes no scope", () => {
    const doc = ordering();
    doc.views["place-order"]!.scope = "shop";
    expect(rules(doc)).toEqual(["view-scope-not-allowed"]);
  });
});

describe("step operations", () => {
  const base = () => apply(shop(), { op: "add-view", id: "place-order", level: "sequence", title: "Place an order" });

  it("adds a sequence view with a title from its ID, and refuses include and exclude", () => {
    expect(apply(shop(), { op: "add-view", id: "place-order", level: "sequence" }).views["place-order"]).toEqual({ title: "Place Order", level: "sequence", steps: [] });
    expect(fails(shop(), { op: "add-view", id: "x", level: "sequence", include: ["api"] })).toMatch(/takes no include or exclude list/);
    expect(fails(shop(), { op: "add-view", id: "x", level: "sequence", scope: "shop" })).toMatch(/don't take a `scope`/);
    expect(fails(ordering(), { op: "update-view", id: "place-order", exclude: ["api"] })).toMatch(/takes no include or exclude list/);
    expect(fails(ordering(), { op: "show-in-view", view: "place-order", id: "api" })).toMatch(/Add a step with add-step/);
    expect(fails(ordering(), { op: "hide-in-view", view: "place-order", id: "api" })).toMatch(/Add a step with add-step/);
    expect(fails(ordering(), { op: "set-layout", view: "place-order", positions: { api: [0, 0] } })).toMatch(/no box positions/);
  });

  it("adds steps at the end, or at a number", () => {
    let doc = apply(base(), { op: "add-step", view: "place-order", from: "customer", to: "web-app" }, { op: "add-step", view: "place-order", from: "api", to: "db", description: " Saves it ", technology: "SQL" });
    doc = apply(doc, { op: "add-step", view: "place-order", from: "web-app", to: "api", step: 2 }, { op: "add-step", view: "place-order", from: "db", to: "api", reply: true });
    expect(doc.views["place-order"]!.steps).toEqual([
      { from: "customer", to: "web-app" },
      { from: "web-app", to: "api" },
      { from: "api", to: "db", description: "Saves it", technology: "SQL" },
      { from: "db", to: "api", reply: true },
    ]);
    expect(applyOperations(doc, [{ op: "add-step", view: "place-order", from: "api", to: "payments" }]).summary).toEqual(["added step 5 to view place-order: api -> payments"]);
  });

  it("refuses steps the model has no relationship for, and steps on other views", () => {
    expect(fails(base(), { op: "add-step", view: "place-order", from: "db", to: "api" })).toBe(
      'The model has no relationship from "db" to "api". Add one first with add-relationship db api, or with one between elements inside them.',
    );
    expect(fails(base(), { op: "add-step", view: "place-order", from: "web-app", to: "customer", reply: false })).toMatch(/no relationship from "web-app" to "customer"\./);
    expect(fails(base(), { op: "add-step", view: "place-order", from: "customer", to: "web-app", reply: true })).toMatch(/no relationship from "web-app" to "customer" for this reply/);
    expect(fails(base(), { op: "add-step", view: "place-order", from: "api", to: "api" })).toBe("A step can't go from an element to itself.");
    // The web app uses a component inside the API, which is inside the shop, but the web app is in the shop too.
    expect(fails(base(), { op: "add-step", view: "place-order", from: "web-app", to: "shop" })).toBe('"web-app" and "shop" contain one another, so no relationship can join them, and no step either.');
    expect(fails(base(), { op: "add-step", view: "place-order", from: "custmer", to: "api" })).toBe('No element has the ID "custmer". Did you mean "customer"?');
    expect(fails(base(), { op: "add-step", view: "place-order", from: "customer", to: "web-app", step: 2 })).toBe('View "place-order" has 0 steps, so a new one can be step 1 to 1.');
    expect(fails(shop(), { op: "add-step", view: "landscape", from: "customer", to: "shop" })).toBe('View "landscape" is a landscape view. Only sequence views have steps.');
  });

  it("changes, moves and removes steps by number", () => {
    let doc = apply(ordering(), { op: "update-step", view: "place-order", step: 2, description: null, technology: "HTTPS" });
    expect(doc.views["place-order"]!.steps![1]).toEqual({ from: "web-app", to: "api", technology: "HTTPS" });
    doc = apply(doc, { op: "update-step", view: "place-order", step: 5, newStep: 1 });
    expect(doc.views["place-order"]!.steps!.map((s) => `${s.from}>${s.to}`)).toEqual(["api>web-app", "customer>web-app", "web-app>api", "api>db", "api>payments"]);
    doc = apply(doc, { op: "update-step", view: "place-order", step: 1, reply: false, from: "web-app", to: "api" }, { op: "remove-step", view: "place-order", step: 5 });
    expect(doc.views["place-order"]!.steps!.map((s) => `${s.from}>${s.to}${s.reply ? " reply" : ""}`)).toEqual(["web-app>api", "customer>web-app", "web-app>api", "api>db"]);
    expect(fails(ordering(), { op: "update-step", view: "place-order", step: 6, description: "x" })).toBe('View "place-order" has 5 steps: "step" must be 1 to 5.');
    expect(fails(ordering(), { op: "update-step", view: "place-order", step: 1 })).toMatch(/Say what to change on step 1/);
    expect(fails(ordering(), { op: "update-step", view: "place-order", step: 1, newStep: 9 })).toMatch(/"newStep" must be 1 to 5/);
    expect(fails(ordering(), { op: "update-step", view: "place-order", step: 1, to: "db" })).toMatch(/no relationship from "customer" to "db"/);
  });

  it("checks steps sent as JSON", () => {
    expect(parseOperations({ op: "add-step", view: "v", from: "a", to: "b", step: 1, reply: true })).toHaveLength(1);
    expect(() => parseOperations({ op: "remove-step", view: "v", step: 0 })).toThrow('remove-step: "step" must be a step\'s number, 1 or more.');
    expect(() => parseOperations({ op: "update-step", view: "v", step: 1, index: 2 })).toThrow(/update-step has no field "index"/);
  });

  it("follows renames, and drops the steps of removed elements", () => {
    let doc = apply(ordering(), { op: "rename", id: "api", to: "orders-api" });
    expect(doc.views["place-order"]!.steps!.map((s) => `${s.from}>${s.to}`)).toEqual(["customer>web-app", "web-app>orders-api", "orders-api>db", "orders-api>payments", "orders-api>web-app"]);
    doc = apply(doc, { op: "remove-element", id: "payments" });
    expect(doc.views["place-order"]!.steps).toHaveLength(4);
    doc = apply(doc, { op: "remove-element", id: "shop" });
    expect(doc.views["place-order"]).toEqual({ title: "Place an order", level: "sequence", steps: [] });
  });

  it("lets a relationship a step goes along be removed, with a warning", () => {
    const result = applyOperations(ordering(), [{ op: "remove-relationship", from: "controller", to: "payments" }]);
    expect(result.warnings.map((w) => `${w.rule} ${w.path}`)).toEqual(["step-relationship-missing views.place-order.steps[3]"]);
  });
});

describe("sequence views in the docs", () => {
  it("draws a Mermaid sequence diagram, with people as actors and replies dashed", () => {
    expect(renderMermaid(computed(ordering()))).toBe(
      [
        "sequenceDiagram",
        "  autonumber",
        "  actor customer as Customer<br/>[Person]",
        "  participant web_app as Web App<br/>[Container: React]",
        "  participant api as API<br/>[Container: Node.js]",
        "  participant db as DB<br/>[Container]",
        "  participant payments as Payments<br/>[External System]",
        "  customer->>web_app: Buys things [HTTPS]",
        "  web_app->>api: POST /orders [JSON/HTTPS]",
        "  api->>db: Stores orders [SQL]",
        "  api->>payments: Charges cards",
        "  api-->>web_app: Order placed",
      ].join("\n"),
    );
  });

  it("escapes what a sequence diagram reads as syntax, and gives keywords as IDs a suffix", () => {
    const doc = shop();
    doc.elements.note = { kind: "system", name: "Notes; #1", uses: [{ to: "payments", description: "Pays\n<fast>" }] };
    doc.views.s = { title: "S", level: "sequence", steps: [{ from: "note", to: "payments" }] };
    const lines = renderMermaid(computed(doc, "s")).split("\n");
    expect(lines).toContain("  participant note_ as Notes#59; #35;1<br/>[System]");
    expect(lines).toContain("  note_->>payments: Pays #lt;fast#gt;");
    doc.views.s.steps = [];
    expect(renderMermaid(computed(doc, "s"))).toBe("sequenceDiagram\n  %% This view has no steps yet.");
  });

  it("lists the steps, and the notes of the relationships they go along, on the view's page", () => {
    const doc = ordering();
    doc.elements.controller!.uses![0]!.notes = "In one transaction.";
    const page = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/place-order.md")!.content;
    expect(page).toContain("Sequence view.");
    expect(page).toContain("```mermaid\nsequenceDiagram\n");
    expect(page).toContain(
      [
        "## Steps",
        "",
        "| # | From | To | Description | Technology |",
        "|---|---|---|---|---|",
        "| 1 | [Customer](../elements/customer.md) | [Web App](../elements/web-app.md) | Buys things | HTTPS |",
        "| 2 | [Web App](../elements/web-app.md) | [API](../elements/api.md) | POST /orders | JSON/HTTPS |",
        "| 3 | [API](../elements/api.md) | [DB](../elements/db.md) | Stores orders | SQL |",
        "| 4 | [API](../elements/api.md) | [Payments](../elements/payments.md) | Charges cards |  |",
        "| 5 | [API](../elements/api.md) | [Web App](../elements/web-app.md) | Reply: Order placed |  |",
        "",
        "### Controller → DB: Stores orders",
        "",
        "In one transaction.",
      ].join("\n"),
    );
    const api = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "elements/api.md")!.content;
    expect(api).toContain("- [Place an order](../views/place-order.md)");
  });
});
