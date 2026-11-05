import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, checkWorkspace, computeView, describeElement, exportDocs, OpError, parseDocument, parseOperations, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with a state view of an order's lifecycle, scoped to its API's controller. */
function lifecycle(): OpenArchDocument {
  const doc = shop();
  doc.views["order-states"] = {
    title: "Order states",
    level: "state",
    scope: "controller",
    initial: "placed",
    states: {
      delivered: { name: "Delivered", final: true },
      paid: { name: "Paid", description: "The card was charged." },
      placed: { name: "Placed", at: [0, 0] },
      cancelled: { name: "Cancelled", final: true },
    },
    transitions: [
      { from: "placed", to: "paid", event: "Payment taken", guard: "paid in full", action: "Send a receipt" },
      { from: "paid", to: "delivered", event: "Delivered" },
      { from: "placed", to: "cancelled", event: "Cancel" },
      { from: "paid", to: "paid", event: "Reminder" },
    ],
  };
  return doc;
}

const view = (doc: OpenArchDocument, id = "order-states") => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

const fails = (doc: OpenArchDocument, ...ops: Operation[]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("The operations were applied.");
};

describe("state views", () => {
  it("are read and written, with their states by ID and their transitions in order", () => {
    const text = serializeDocument(lifecycle());
    expect(text).toContain(`      "level": "state",
      "scope": "controller",
      "initial": "placed",
      "states": {
        "cancelled": { "name": "Cancelled", "final": true },
        "delivered": { "name": "Delivered", "final": true },
        "paid": { "name": "Paid", "description": "The card was charged." },
        "placed": { "name": "Placed", "at": [0, 0] }
      },
      "transitions": [
        { "from": "placed", "to": "paid", "event": "Payment taken", "guard": "paid in full", "action": "Send a receipt" },`);
    expect(text).not.toMatch(/"order-states": \{[^}]*"include"/);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(rules(lifecycle())).toEqual([]);
  });

  it("refuse fields of other views, and report malformed states and transitions", () => {
    const doc = { ...lifecycle(), views: { v: { title: "V", level: "state", include: ["*"], steps: [], states: { Bad: { name: "B" }, ok: { name: "OK", final: "yes", at: [1] } }, transitions: [{ from: "ok" }, "x"] } } };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.v.include",
      "field-not-allowed views.v.steps",
      "id-format views.v.states.Bad",
      "field-type views.v.states.ok.final",
      "field-type views.v.states.ok.at",
      "field-required views.v.transitions[0].to",
      "field-type views.v.transitions[1]",
    ]);
    const other = parseDocument(JSON.stringify({ ...lifecycle(), views: { v: { title: "V", level: "landscape", states: {}, transitions: [] } } }));
    expect(other.diagnostics.map((d) => [d.path, d.message])).toEqual([
      ["views.v.states", "Only state views have `states`."],
      ["views.v.transitions", "Only state views have `transitions`."],
    ]);
  });

  it("list their states from the initial one, along the transitions, then the rest", () => {
    expect(view(lifecycle()).view.states.map((s) => s.id)).toEqual(["placed", "paid", "cancelled", "delivered"]);
  });

  it("are checked: transitions and the initial state name states, and there is an initial state", () => {
    const doc = lifecycle();
    doc.views["order-states"]!.initial = "plaed";
    doc.views["order-states"]!.transitions!.push({ from: "paid", to: "shipped" });
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => `${d.rule} ${d.path} ${d.fix ?? ""}`)).toEqual([
      'state-initial-unknown views.order-states.initial Did you mean "placed"?',
      "transition-unknown-state views.order-states.transitions[4].to ",
    ]);
    delete doc.views["order-states"]!.initial;
    expect(rules(doc)).toContain("state-initial-missing");
  });

  it("take an optional scope of any kind, and frame their states with it", () => {
    expect(view(lifecycle()).boundary?.id).toBe("controller");
    const doc = apply(lifecycle(), { op: "add-view", id: "checkout", level: "state" });
    expect(doc.views.checkout).toEqual({ title: "Checkout", level: "state", states: {}, transitions: [] });
    expect(apply(doc, { op: "add-view", id: "shop-states", level: "state", scope: "shop" }).views["shop-states"]!.title).toBe("Shop states");
    expect(fails(doc, { op: "add-view", id: "x", level: "state", scope: "nope" })).toBe('Scope "nope" isn\'t an element.');
  });

  it("are listed on their element's page as its states", () => {
    const ws = buildWorkspace(lifecycle());
    expect(describeElement(ws, "controller")!.views).toContainEqual({ view: ws.views.get("order-states"), as: "states" });
    const page = exportDocs(ws, "shop.openarch").find((f) => f.path === "elements/controller.md")!.content;
    expect(page).toContain("- [Order states](../views/order-states.md) (its states)");
  });

  it("show in Mermaid as a state diagram, with a start, ends, and UML's transition labels", () => {
    expect(renderMermaid(view(lifecycle()))).toBe(
      [
        "stateDiagram-v2",
        '  state "Placed" as placed',
        '  state "Paid" as paid',
        "  paid : The card was charged.",
        '  state "Cancelled" as cancelled',
        '  state "Delivered" as delivered',
        "  [*] --> placed",
        "  placed --> paid : Payment taken [paid in full] / Send a receipt",
        "  paid --> delivered : Delivered",
        "  placed --> cancelled : Cancel",
        "  paid --> paid : Reminder",
        "  cancelled --> [*]",
        "  delivered --> [*]",
      ].join("\n"),
    );
  });

  it("escape what Mermaid reads as markup, and keywords used as IDs", () => {
    const doc = lifecycle();
    doc.views["order-states"]!.states!.note = { name: 'Waiting: "now"', description: "Card #1; then cash" };
    doc.views["order-states"]!.transitions!.push({ from: "paid", to: "note", event: "Wait: a bit", guard: "x > 1" });
    const text = renderMermaid(view(doc));
    expect(text).toContain('  state "Waiting#58; #quot;now#quot;" as note_\n  note_ : Card #35;1#59; then cash');
    expect(text).toContain("  paid --> note_ : Wait#58; a bit [x #gt; 1]");
  });

  it("are documented with tables of their states and transitions", () => {
    const page = exportDocs(buildWorkspace(lifecycle()), "shop.openarch").find((f) => f.path === "views/order-states.md")!.content;
    expect(page).toContain("State view of [Controller](../elements/controller.md).");
    expect(page).toContain("| Placed (starts here) |  |\n| Paid | The card was charged. |\n| Cancelled (can end here) |  |");
    expect(page).toContain("| 1 | Placed | Paid | Payment taken [paid in full] / Send a receipt |");
    expect(page).not.toContain("## Elements");
  });
});

describe("state operations", () => {
  const base = () => apply(shop(), { op: "add-view", id: "order-states", level: "state", scope: "controller" });

  it("add, change, rename and remove states, keeping transitions and the initial state in step", () => {
    let doc = apply(base(), { op: "add-state", view: "order-states", id: "placed", initial: true }, { op: "add-state", view: "order-states", id: "paid", final: true, at: [10.4, 20.6] });
    expect(doc.views["order-states"]!.states).toEqual({ placed: { name: "Placed" }, paid: { name: "Paid", final: true, at: [10, 21] } });
    expect(doc.views["order-states"]!.initial).toBe("placed");
    doc = apply(doc, { op: "add-transition", view: "order-states", from: "placed", to: "paid", event: " Pay " });
    doc = apply(doc, { op: "update-state", view: "order-states", id: "placed", newId: "new", name: "New", description: "Just placed." });
    expect(doc.views["order-states"]!.initial).toBe("new");
    expect(doc.views["order-states"]!.transitions).toEqual([{ from: "new", to: "paid", event: "Pay" }]);
    doc = apply(doc, { op: "update-state", view: "order-states", id: "paid", final: false, at: null, initial: true });
    expect(doc.views["order-states"]!.states!.paid).toEqual({ name: "Paid" });
    expect(doc.views["order-states"]!.initial).toBe("paid");
    const removed = applyOperations(doc, [{ op: "remove-state", view: "order-states", id: "paid" }]);
    expect(removed.summary).toEqual(["removed state paid from view order-states and 1 transition to or from it"]);
    expect(removed.doc.views["order-states"]).not.toHaveProperty("initial");
    expect(removed.doc.views["order-states"]!.transitions).toEqual([]);
  });

  it("add, change, move and remove transitions by number", () => {
    let doc = apply(base(), { op: "add-state", view: "order-states", id: "a", initial: true }, { op: "add-state", view: "order-states", id: "b" });
    doc = apply(doc, { op: "add-transition", view: "order-states", from: "a", to: "b", event: "Go" }, { op: "add-transition", view: "order-states", from: "b", to: "b", transition: 1 });
    expect(doc.views["order-states"]!.transitions).toEqual([{ from: "b", to: "b" }, { from: "a", to: "b", event: "Go" }]);
    doc = apply(doc, { op: "update-transition", view: "order-states", transition: 2, event: null, guard: "ready", to: "a", newTransition: 1 });
    expect(doc.views["order-states"]!.transitions).toEqual([{ from: "a", to: "a", guard: "ready" }, { from: "b", to: "b" }]);
    doc = apply(doc, { op: "remove-transition", view: "order-states", transition: 2 });
    expect(doc.views["order-states"]!.transitions).toEqual([{ from: "a", to: "a", guard: "ready" }]);
  });

  it("refuse what doesn't fit", () => {
    const doc = apply(base(), { op: "add-state", view: "order-states", id: "a" });
    expect(fails(doc, { op: "add-state", view: "order-states", id: "a" })).toBe('View "order-states" already has a state "a".');
    expect(fails(doc, { op: "add-state", view: "order-states", id: "Bad" })).toMatch(/isn't a valid ID/);
    expect(fails(doc, { op: "add-state", view: "landscape", id: "x" })).toBe('View "landscape" is a landscape view. Only state views have states and transitions.');
    expect(fails(doc, { op: "add-transition", view: "order-states", from: "a", to: "shipped" })).toBe('View "order-states" has no state "shipped". Its states: a.');
    expect(fails(doc, { op: "update-transition", view: "order-states", transition: 1, event: "x" })).toBe('View "order-states" has no transitions yet.');
    expect(fails(doc, { op: "update-state", view: "order-states", id: "a" })).toBe('Say what to change on state "a": newId, name, description, initial, final, at.');
    expect(fails(doc, { op: "show-in-view", view: "order-states", id: "shop" })).toMatch(/^A state view draws its states, not elements/);
    expect(fails(doc, { op: "set-layout", view: "order-states", positions: {} })).toBe("A state view has no boxes. Move a state with update-state --at.");
  });

  it("are checked when sent as JSON", () => {
    expect(parseOperations({ op: "update-state", view: "v", id: "a", at: null })).toEqual([{ op: "update-state", view: "v", id: "a", at: null }]);
    expect(() => parseOperations({ op: "add-transition", view: "v", from: "a", to: "b", transition: 0 })).toThrow('add-transition: "transition" must be a number, 1 or more: 1 is the first.');
  });

  it("go with the element they're the states of, and follow its new ID", () => {
    expect(apply(lifecycle(), { op: "rename", id: "controller", to: "orders" }).views["order-states"]!.scope).toBe("orders");
    expect(apply(lifecycle(), { op: "remove-element", id: "controller" }).views).not.toHaveProperty("order-states");
  });
});
