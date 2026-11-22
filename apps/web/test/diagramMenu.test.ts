import { applyOperations, buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { followMenu, isSelected, menuOn, menuRenamesIn, menuThere, selectionFor, type MenuRename, type NumberedPart } from "../src/canvas/diagramMenu.js";

/** A flowchart in two lanes, a state view and an entity view, each with a note. */
const doc: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    returns: {
      title: "Returns",
      level: "flowchart",
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "staff", name: "Staff" },
      ],
      blocks: [
        { id: "asked", kind: "start", text: "Return asked for", lane: "customer" },
        { id: "in-time", kind: "decision", text: "Within 30 days?", lane: "staff" },
        { id: "refund", text: "Refund the card", lane: "staff" },
        { id: "say-no", text: "Say no", lane: "staff" },
        { id: "done", kind: "end", text: "Done", lane: "customer" },
      ],
      flows: [
        { from: "asked", to: "in-time" },
        { from: "in-time", to: "refund", text: "Yes" },
        { from: "in-time", to: "say-no", text: "No" },
        { from: "refund", to: "done" },
      ],
      stickies: { note: { text: "Read me" } },
    },
    states: {
      title: "Order states",
      level: "state",
      initial: "placed",
      states: { placed: { name: "Placed" }, paid: { name: "Paid" }, shipped: { name: "Shipped", final: true } },
      transitions: [
        { from: "placed", to: "paid", event: "Payment taken" },
        { from: "paid", to: "shipped", event: "Sent" },
        { from: "paid", to: "placed", event: "Refunded" },
      ],
      stickies: { note: { text: "Read me" } },
    },
    data: {
      title: "Orders data",
      level: "entity",
      entities: [
        { id: "customer", name: "Customer", attributes: [{ name: "id", keys: ["pk"] }, { name: "email" }] },
        { id: "order", name: "Order", attributes: [{ name: "id", keys: ["pk"] }, { name: "customer_id", keys: ["fk"] }] },
        { id: "line", name: "Line", attributes: [{ name: "id" }] },
      ],
      links: [
        { from: "customer", to: "order", text: "places" },
        { from: "order", to: "line", text: "has" },
        { from: "customer", to: "customer", text: "referred" },
      ],
      stickies: { note: { text: "Read me" } },
    },
  },
};

/**
 * A sequence view and a deployment view of the same containers. Their steps and connections are
 * numbered, and some go when an element is deleted from the model, a node from the deployment
 * view, or a node is told what it runs.
 */
const live: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {
    buyer: { kind: "person", name: "Buyer", uses: [{ to: "web" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api" }, { to: "cache" }] },
    api: { kind: "container", name: "API", parent: "shop", uses: [{ to: "db" }] },
    db: { kind: "container", name: "DB", parent: "shop" },
    cache: { kind: "container", name: "Cache", parent: "shop" },
  },
  views: {
    ordering: {
      title: "Placing an order",
      level: "sequence",
      steps: [
        { from: "buyer", to: "web", description: "Orders" },
        { from: "web", to: "api", description: "Submits" },
        { from: "api", to: "db", description: "Saves" },
        { from: "api", to: "web", reply: true, description: "Says it's saved" },
        { from: "web", to: "cache", description: "Remembers" },
      ],
      stickies: { note: { text: "Read me" } },
    },
    production: {
      title: "Production",
      level: "deployment",
      nodes: {
        region: { name: "Region" },
        lb: { name: "Load balancer", parent: "region", infrastructure: true },
        server: { name: "Server", parent: "region", runs: ["web", "api"] },
        data: { name: "Database server", parent: "region", runs: ["db"] },
        edge: { name: "Edge", runs: ["cache"] },
      },
      connections: [
        { from: "lb", to: "web", description: "Forwards" },
        { from: "lb", to: "server", description: "Checks" },
        { from: "edge", to: "lb", description: "Routes" },
        { from: "lb", to: "db", description: "Reads" },
        { from: "data", to: "edge", description: "Backs up to" },
        { from: "cache", to: "lb", description: "Falls back" },
      ],
      stickies: { note: { text: "Read me" } },
    },
  },
};

/**
 * What the menu for a right-click on this is for once these edits have landed, one after
 * another, and the ID its view then has: what was clicked, followed through what each did, then
 * looked for in the view as they leave it. Null when it isn't there.
 */
function landed(view: string, on: Selection, edits: Operation[][], from: OpenArchDocument = doc) {
  let ws = buildWorkspace(from);
  const clicked = menuOn(on)!;
  expect(menuThere(ws.views.get(view)!, clicked), "it's there to click").toBe(true);
  const renames: MenuRename[] = [];
  for (const ops of edits) {
    renames.push(...menuRenamesIn(ops, ws));
    ws = buildWorkspace(applyOperations(ws.doc, ops).doc);
  }
  const followed = followMenu(clicked, view, renames);
  const now = ws.views.get(followed.view);
  return now && followed.on && menuThere(now, followed.on) ? { on: followed.on, view: followed.view } : null;
}

describe("what a diagram's right-click menu is for", () => {
  const [returns, states, data] = ["returns", "states", "data"].map((id) => buildWorkspace(doc).views.get(id)!) as [ReturnType<typeof view>, ReturnType<typeof view>, ReturnType<typeof view>];
  function view() {
    return buildWorkspace(doc).views.get("returns")!;
  }

  it("is what the click selects, or the diagram for the background", () => {
    for (const on of [{ kind: "block", id: "refund" }, { kind: "flow", number: 2 }, { kind: "state", id: "paid" }, { kind: "transition", number: 1 }, { kind: "attribute", entity: "order", name: "id" }] as const) {
      expect(menuOn(on)).toEqual(on);
      expect(selectionFor(menuOn(on)!)).toEqual(on);
    }
    expect(menuOn(null)).toEqual({ kind: "diagram" });
    expect(selectionFor({ kind: "diagram" })).toBeNull();
    // What's selected on a view whose things aren't followed has no menu here.
    expect(menuOn({ kind: "element", id: "shop" })).toBeNull();
    expect(menuOn({ kind: "workspace" })).toBeNull();
  });

  it("is there while its view has it", () => {
    expect(menuThere(returns, { kind: "diagram" })).toBe(true);
    expect([{ kind: "block", id: "refund" }, { kind: "lane", id: "staff" }, { kind: "sticky", id: "note" }, { kind: "flow", number: 4 }].map((on) => menuThere(returns, on as never))).toEqual([true, true, true, true]);
    expect([{ kind: "block", id: "gone" }, { kind: "lane", id: "refund" }, { kind: "flow", number: 5 }, { kind: "flow", number: 0 }, { kind: "state", id: "paid" }].map((on) => menuThere(returns, on as never))).toEqual([false, false, false, false, false]);
    expect([{ kind: "state", id: "paid" }, { kind: "transition", number: 3 }].map((on) => menuThere(states, on as never))).toEqual([true, true]);
    expect(menuThere(states, { kind: "transition", number: 4 })).toBe(false);
    expect([{ kind: "entity", id: "order" }, { kind: "attribute", entity: "order", name: "customer_id" }, { kind: "link", number: 3 }].map((on) => menuThere(data, on as never))).toEqual([true, true, true]);
    expect([{ kind: "attribute", entity: "order", name: "email" }, { kind: "attribute", entity: "gone", name: "id" }, { kind: "link", number: 4 }].map((on) => menuThere(data, on as never))).toEqual([false, false, false]);
  });

  it("is what's selected while the menu is open", () => {
    expect(isSelected({ kind: "flow", number: 3 }, { kind: "flow", number: 3 })).toBe(true);
    expect(isSelected({ kind: "flow", number: 3 }, { kind: "flow", number: 2 })).toBe(false);
    expect(isSelected({ kind: "flow", number: 3 }, { kind: "link", number: 3 })).toBe(false);
    expect(isSelected({ kind: "block", id: "staff" }, { kind: "lane", id: "staff" })).toBe(false);
    expect(isSelected({ kind: "attribute", entity: "order", name: "id" }, { kind: "attribute", entity: "order", name: "id" })).toBe(true);
    expect(isSelected({ kind: "attribute", entity: "order", name: "id" }, { kind: "attribute", entity: "customer", name: "id" })).toBe(false);
    expect(isSelected({ kind: "attribute", entity: "order", name: "id" }, { kind: "entity", id: "order" })).toBe(false);
    expect(isSelected({ kind: "diagram" }, null)).toBe(true);
    expect(isSelected({ kind: "diagram" }, { kind: "block", id: "refund" })).toBe(false);
    expect(isSelected({ kind: "block", id: "refund" }, null)).toBe(false);
  });
});

describe("a menu's target, followed through the edits that land before it opens", () => {
  it("stays what it was through edits to other things", () => {
    const others: Operation[][] = [[{ op: "remove-block", view: "returns", id: "asked" }], [{ op: "update-block", view: "returns", id: "refund", position: 1 }], [{ op: "update-block", view: "returns", id: "say-no", newId: "turn-it-down" }]];
    expect(landed("returns", { kind: "block", id: "refund" }, others)).toEqual({ on: { kind: "block", id: "refund" }, view: "returns" });
    expect(landed("returns", { kind: "sticky", id: "note" }, others)).toEqual({ on: { kind: "sticky", id: "note" }, view: "returns" });
    expect(landed("returns", { kind: "lane", id: "staff" }, others)).toEqual({ on: { kind: "lane", id: "staff" }, view: "returns" });
    expect(landed("returns", null, others)).toEqual({ on: { kind: "diagram" }, view: "returns" });
  });

  it("follows a block, a lane, a state or an entity through the edit that gives it a new ID", () => {
    expect(landed("returns", { kind: "block", id: "say-no" }, [[{ op: "update-block", view: "returns", id: "say-no", text: "Turn it down", newId: "turn-it-down" }]])?.on).toEqual({ kind: "block", id: "turn-it-down" });
    // And through one after another.
    const twice: Operation[][] = [[{ op: "update-block", view: "returns", id: "say-no", newId: "refuse" }], [{ op: "update-block", view: "returns", id: "refuse", newId: "turn-it-down" }]];
    expect(landed("returns", { kind: "block", id: "say-no" }, twice)?.on).toEqual({ kind: "block", id: "turn-it-down" });
    expect(landed("returns", { kind: "lane", id: "staff" }, [[{ op: "update-lane", view: "returns", id: "staff", name: "Shop staff", newId: "shop-staff" }]])?.on).toEqual({ kind: "lane", id: "shop-staff" });
    expect(landed("states", { kind: "state", id: "paid" }, [[{ op: "update-state", view: "states", id: "paid", name: "Paid for", newId: "paid-for" }]])?.on).toEqual({ kind: "state", id: "paid-for" });
    expect(landed("data", { kind: "entity", id: "order" }, [[{ op: "update-entity", view: "data", id: "order", newId: "purchase" }]])?.on).toEqual({ kind: "entity", id: "purchase" });
    // A lane and a block can share an ID: one's new ID isn't the other's.
    const shared = structuredClone(doc);
    shared.views.returns!.blocks!.push({ id: "staff", text: "Call the staff" });
    expect(landed("returns", { kind: "block", id: "staff" }, [[{ op: "update-lane", view: "returns", id: "staff", newId: "shop-staff" }]], shared)?.on).toEqual({ kind: "block", id: "staff" });
    // Told to be what it is already, it has no new ID.
    expect(menuRenamesIn([{ op: "update-block", view: "returns", id: "refund", newId: "refund" }], buildWorkspace(doc))).toEqual([]);
    expect(menuRenamesIn([{ op: "update-state", view: "states", id: "paid", name: "Paid for" }], buildWorkspace(doc))).toEqual([]);
  });

  it("is lost with what's deleted, even when something else then takes its ID", () => {
    // The last block deleted, and another added at the end, where it was.
    expect(landed("returns", { kind: "block", id: "done" }, [[{ op: "remove-block", view: "returns", id: "done" }], [{ op: "add-block", view: "returns", id: "new-process", text: "New process" }]])).toBeNull();
    // The last block deleted, and the refund then given its ID, typed into its ID box.
    const taken: Operation[][] = [[{ op: "remove-block", view: "returns", id: "done" }], [{ op: "update-block", view: "returns", id: "refund", newId: "done" }]];
    expect(landed("returns", { kind: "block", id: "done" }, taken)).toBeNull();
    expect(landed("returns", { kind: "block", id: "refund" }, taken)?.on).toEqual({ kind: "block", id: "done" });
    // In one edit, too.
    expect(landed("returns", { kind: "block", id: "done" }, [[...taken[0]!, ...taken[1]!]])).toBeNull();
    expect(landed("returns", { kind: "sticky", id: "note" }, [[{ op: "remove-sticky", view: "returns", id: "note" }], [{ op: "add-sticky", view: "returns", id: "note", text: "Another" }]])).toBeNull();
    const lanes: Operation[][] = [[{ op: "remove-lane", view: "returns", id: "staff" }], [{ op: "update-lane", view: "returns", id: "customer", newId: "staff" }]];
    expect(landed("returns", { kind: "lane", id: "staff" }, lanes)).toBeNull();
    expect(landed("returns", { kind: "lane", id: "customer" }, lanes)?.on).toEqual({ kind: "lane", id: "staff" });
    expect(landed("states", { kind: "state", id: "shipped" }, [[{ op: "remove-state", view: "states", id: "shipped" }], [{ op: "update-state", view: "states", id: "paid", newId: "shipped" }]])).toBeNull();
    expect(landed("data", { kind: "entity", id: "line" }, [[{ op: "remove-entity", view: "data", id: "line" }], [{ op: "add-entity", view: "data", id: "line", name: "Line" }]])).toBeNull();
    // Another view's block of the same ID is deleted: this one's is still there.
    const two = structuredClone(doc);
    two.views.exchanges = { title: "Exchanges", level: "flowchart", blocks: [{ id: "done", text: "Done" }] };
    expect(landed("returns", { kind: "block", id: "done" }, [[{ op: "remove-block", view: "exchanges", id: "done" }]], two)?.on).toEqual({ kind: "block", id: "done" });
  });

  it("follows an attribute through its new name and its entity's new ID, and loses it with either", () => {
    const email = { kind: "attribute", entity: "customer", name: "email" } as const;
    expect(landed("data", email, [[{ op: "update-attribute", view: "data", entity: "customer", name: "email", newName: " e_mail " }]])?.on).toEqual({ kind: "attribute", entity: "customer", name: "e_mail" });
    expect(landed("data", email, [[{ op: "update-entity", view: "data", id: "customer", newId: "shopper" }], [{ op: "update-attribute", view: "data", entity: "shopper", name: "email", newName: "mail" }]])?.on).toEqual({ kind: "attribute", entity: "shopper", name: "mail" });
    // Another entity's attribute of the same name, and another attribute of its own entity, aren't it.
    const others: Operation[][] = [[{ op: "update-attribute", view: "data", entity: "order", name: "id", newName: "number" }], [{ op: "update-attribute", view: "data", entity: "customer", name: "id", newName: "number" }], [{ op: "update-attribute", view: "data", entity: "customer", name: "email", type: "text", position: 1 }]];
    expect(landed("data", email, others)?.on).toEqual(email);
    expect(landed("data", email, [[{ op: "remove-attribute", view: "data", entity: "customer", name: "email" }], [{ op: "add-attribute", view: "data", entity: "customer", name: "email" }]])).toBeNull();
    expect(landed("data", email, [[{ op: "remove-entity", view: "data", id: "customer" }], [{ op: "add-entity", view: "data", id: "customer" }], [{ op: "add-attribute", view: "data", entity: "customer", name: "email" }]])).toBeNull();
    // The entity is still there when one of its attributes goes.
    expect(landed("data", { kind: "entity", id: "customer" }, [[{ op: "remove-attribute", view: "data", entity: "customer", name: "email" }]])?.on).toEqual({ kind: "entity", id: "customer" });
    expect(menuRenamesIn([{ op: "update-attribute", view: "data", entity: "customer", name: "email", newName: "email" }], buildWorkspace(doc))).toEqual([]);
  });

  /**
   * How one kind of numbered list is changed: by its own operations, and by the ones that delete
   * from it with something else, `cuts`: a block, a state or an entity with its arrows, and for a
   * connection or a step, a node, what a node runs, or an element of the model.
   */
  const LISTS: Record<NumberedPart, { view: string; from?: OpenArchDocument; cuts: Operation[]; add(n: number, at?: number): Operation; move(from: number, to: number): Operation; remove(n: number): Operation; retext(n: number): Operation }> = {
    flow: {
      view: "returns",
      cuts: ["refund", "say-no", "in-time"].map((id) => ({ op: "remove-block", view: "returns", id })),
      add: (n, at) => ({ op: "add-flow", view: "returns", from: "asked", to: "done", text: `new ${n}`, ...(at !== undefined && { flow: at }) }),
      move: (from, to) => ({ op: "update-flow", view: "returns", flow: from, newFlow: to }),
      remove: (n) => ({ op: "remove-flow", view: "returns", flow: n }),
      retext: (n) => ({ op: "update-flow", view: "returns", flow: n, to: "say-no" }),
    },
    transition: {
      view: "states",
      cuts: [{ op: "remove-state", view: "states", id: "paid" }],
      add: (n, at) => ({ op: "add-transition", view: "states", from: "placed", to: "shipped", action: `new ${n}`, ...(at !== undefined && { transition: at }) }),
      move: (from, to) => ({ op: "update-transition", view: "states", transition: from, newTransition: to }),
      remove: (n) => ({ op: "remove-transition", view: "states", transition: n }),
      retext: (n) => ({ op: "update-transition", view: "states", transition: n, to: "paid" }),
    },
    link: {
      view: "data",
      cuts: [{ op: "remove-entity", view: "data", id: "order" }],
      add: (n, at) => ({ op: "add-link", view: "data", from: "line", to: "customer", text: `new ${n}`, ...(at !== undefined && { link: at }) }),
      move: (from, to) => ({ op: "update-link", view: "data", link: from, newLink: to }),
      remove: (n) => ({ op: "remove-link", view: "data", link: n }),
      retext: (n) => ({ op: "update-link", view: "data", link: n, to: "order" }),
    },
    connection: {
      view: "production",
      from: live,
      cuts: [
        { op: "remove-node", view: "production", id: "edge" },
        { op: "remove-node", view: "production", id: "data" },
        { op: "update-node", view: "production", id: "server", runs: ["api"] },
        { op: "remove-element", id: "db" },
        // Deletes nothing: the node is told what it runs already, and a view of something else changes.
        { op: "update-node", view: "production", id: "server", runs: ["web", "api"], technology: "Linux" },
        { op: "remove-step", view: "ordering", step: 1 },
      ],
      add: (n, at) => ({ op: "add-connection", view: "production", from: "lb", to: "region", description: `new ${n}`, ...(at !== undefined && { connection: at }) }),
      move: (from, to) => ({ op: "update-connection", view: "production", connection: from, newConnection: to }),
      remove: (n) => ({ op: "remove-connection", view: "production", connection: n }),
      retext: (n) => ({ op: "update-connection", view: "production", connection: n, technology: "HTTPS" }),
    },
    step: {
      view: "ordering",
      from: live,
      cuts: [
        { op: "remove-element", id: "cache" },
        { op: "remove-element", id: "db" },
        // Deletes nothing: a node of another view goes, with its connections.
        { op: "remove-node", view: "production", id: "edge" },
      ],
      add: (n, at) => ({ op: "add-step", view: "ordering", from: "buyer", to: "web", description: `new ${n}`, ...(at !== undefined && { step: at }) }),
      move: (from, to) => ({ op: "update-step", view: "ordering", step: from, newStep: to }),
      remove: (n) => ({ op: "remove-step", view: "ordering", step: n }),
      retext: (n) => ({ op: "update-step", view: "ordering", step: n, technology: "HTTPS" }),
    },
  };
  /** The model with text on every flow, so each can be told from the others. */
  const labelled = structuredClone(doc);
  labelled.views.returns!.flows!.forEach((f, i) => (f.text = `flow ${i + 1}`));
  /** What each one of a numbered list says, which stays with it wherever it goes: a flow's or a link's text, a transition's event or action, a connection's or a step's description. */
  function labelsOf(list: NumberedPart, ws: ReturnType<typeof buildWorkspace>) {
    const view = ws.views.get(LISTS[list].view)!;
    if (list === "flow") return view.flows.map((f) => f.text ?? "");
    if (list === "transition") return view.transitions.map((t) => t.action ?? t.event ?? "");
    if (list === "connection") return view.connections.map((c) => c.description ?? "");
    if (list === "step") return view.steps.map((s) => s.description ?? "");
    return view.links.map((l) => l.text ?? "");
  }

  it.each(["flow", "transition", "link", "connection", "step"] as const)("follows a %s to the number it has however others are added, deleted and moved round it, in one edit or several, and when something else that's deleted takes some with it", (list) => {
    const kit = LISTS[list];
    // The same sequences every run: a small generator stands in for chance.
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    for (let round = 0; round < 60; round++) {
      let ws = buildWorkspace(kit.from ?? labelled);
      const start = labelsOf(list, ws);
      const edits: Operation[][] = [];
      const renames: MenuRename[] = [];
      // What's still there to delete, each of which takes some of the list with it.
      const cuts = [...kit.cuts];
      for (let step = 0; step < 6; step++) {
        const ops: Operation[] = [];
        let now = ws;
        // One operation, or two in the same edit.
        for (let k = 0; k <= random(2); k++) {
          const count = labelsOf(list, now).length;
          // Now and then, something else is deleted, and some of them go with it.
          const cut = cuts.length > 0 && random(6) === 0;
          const does = count === 0 ? 0 : random(5);
          const op = cut
            ? cuts.splice(random(cuts.length), 1)[0]!
            : does === 0
              ? kit.add(round * 100 + step * 10 + k, random(3) === 0 ? undefined : 1 + random(count + 1))
              : does === 1
                ? kit.remove(1 + random(count))
                : does === 2
                  ? kit.retext(1 + random(count))
                  : kit.move(1 + random(count), 1 + random(count));
          try {
            now = buildWorkspace(applyOperations(now.doc, [op]).doc);
            ops.push(op);
          } catch {
            // One the list can't have, such as a second flow with the same ends and text: left out.
          }
        }
        if (ops.length === 0) continue;
        edits.push(ops);
        renames.push(...menuRenamesIn(ops, ws));
        ws = buildWorkspace(applyOperations(ws.doc, ops).doc);
      }
      const end = labelsOf(list, ws);
      start.forEach((label, i) => {
        const followed = followMenu({ kind: list, number: i + 1 }, kit.view, renames).on;
        const at = end.indexOf(label);
        expect(followed, `${label} after ${JSON.stringify(edits)}`).toEqual(at < 0 ? null : { kind: list, number: at + 1 });
      });
    }
  });

  it("keeps a numbered thing's number through an edit to it where it is, and through one added at the end", () => {
    expect(menuRenamesIn([{ op: "update-flow", view: "returns", flow: 2, text: "Sure" }], buildWorkspace(doc))).toEqual([]);
    expect(menuRenamesIn([{ op: "update-flow", view: "returns", flow: 2, newFlow: 2 }], buildWorkspace(doc))).toEqual([]);
    expect(menuRenamesIn([{ op: "add-transition", view: "states", from: "placed", to: "shipped" }], buildWorkspace(doc))).toEqual([]);
    expect(menuRenamesIn([{ op: "add-link", view: "data", from: "line", to: "order", link: 1 }], buildWorkspace(doc))).toEqual([{ kind: "added", list: "link", view: "data", number: 1 }]);
    // Another view's list, or another list of this view, is renumbered: this one isn't.
    expect(followMenu({ kind: "flow", number: 2 }, "returns", [{ kind: "removed", list: "flow", view: "exchanges", number: 1 }, { kind: "removed", list: "link", view: "returns", number: 1 }]).on).toEqual({ kind: "flow", number: 2 });
  });

  it("follows the arrows that stay when a block, a state or an entity is deleted, to their new numbers, and loses the ones that go with it", () => {
    // Deleting the start takes flow 1, from it, with it.
    const cut: Operation[][] = [[{ op: "remove-block", view: "returns", id: "asked" }]];
    expect(landed("returns", { kind: "flow", number: 1 }, cut)).toBeNull();
    expect(landed("returns", { kind: "flow", number: 4 }, cut)?.on).toEqual({ kind: "flow", number: 3 });
    expect(landed("returns", { kind: "block", id: "refund" }, cut)?.on).toEqual({ kind: "block", id: "refund" });
    // Deleting the decision takes flows 1, 2 and 3, to and from it, and leaves the last as the first.
    const middle: Operation[][] = [[{ op: "remove-block", view: "returns", id: "in-time" }]];
    expect([1, 2, 3, 4].map((number) => landed("returns", { kind: "flow", number }, middle)?.on ?? null)).toEqual([null, null, null, { kind: "flow", number: 1 }]);
    // A state's transitions, a loop back to itself too, and an entity's links.
    const looped = structuredClone(doc);
    looped.views.states!.transitions!.push({ from: "shipped", to: "shipped", event: "Tracked" }, { from: "placed", to: "placed", event: "Changed" });
    const shipped: Operation[][] = [[{ op: "remove-state", view: "states", id: "shipped" }]];
    expect([1, 2, 3, 4, 5].map((number) => landed("states", { kind: "transition", number }, shipped, looped)?.on ?? null)).toEqual([
      { kind: "transition", number: 1 },
      null,
      { kind: "transition", number: 2 },
      null,
      { kind: "transition", number: 3 },
    ]);
    expect(landed("states", { kind: "state", id: "paid" }, shipped)?.on).toEqual({ kind: "state", id: "paid" });
    const line: Operation[][] = [[{ op: "remove-entity", view: "data", id: "order" }]];
    expect([1, 2, 3].map((number) => landed("data", { kind: "link", number }, line)?.on ?? null)).toEqual([null, null, { kind: "link", number: 1 }]);
    expect(landed("data", { kind: "attribute", entity: "customer", name: "id" }, line)?.on).toEqual({ kind: "attribute", entity: "customer", name: "id" });
    // A lane or a note takes nothing with it.
    expect(landed("returns", { kind: "flow", number: 4 }, [[{ op: "remove-lane", view: "returns", id: "staff" }], [{ op: "remove-sticky", view: "returns", id: "note" }]])?.on).toEqual({ kind: "flow", number: 4 });
  });

  it("follows the arrows through an edit that deletes a block, a state or an entity and does more, as one of Ask AI's can", () => {
    // A flow is added at the front, the start deleted, which takes that flow and the old first with it, and the view described.
    const batch: Operation[] = [
      { op: "add-flow", view: "returns", from: "asked", to: "done", text: "Gave up", flow: 1 },
      { op: "remove-block", view: "returns", id: "asked" },
      { op: "update-view", id: "returns", description: "Sending something back" },
    ];
    expect([1, 2, 3, 4].map((number) => landed("returns", { kind: "flow", number }, [batch])?.on ?? null)).toEqual([null, { kind: "flow", number: 1 }, { kind: "flow", number: 2 }, { kind: "flow", number: 3 }]);
    // The blocks, and another view's arrows, are followed as ever.
    expect(landed("returns", { kind: "block", id: "refund" }, [batch])?.on).toEqual({ kind: "block", id: "refund" });
    expect(landed("states", { kind: "transition", number: 1 }, [batch])?.on).toEqual({ kind: "transition", number: 1 });
    // An element deleted under the ID an operation ahead of it gave it: its views are the ones it has by then.
    const scoped = structuredClone(doc);
    scoped.elements.api = { kind: "container", name: "API", parent: "shop" };
    scoped.elements.db = { kind: "container", name: "DB", parent: "shop" };
    scoped.views.data!.scope = "db";
    scoped.views.returns!.scope = "api";
    const renamed: Operation[] = [
      { op: "rename", id: "api", to: "gateway" },
      { op: "remove-element", id: "gateway" },
    ];
    expect(menuRenamesIn(renamed, buildWorkspace(scoped))).toEqual([
      { kind: "view", id: "api", to: "gateway" },
      { kind: "view-gone", id: "returns" },
      { kind: "element-gone", id: "gateway" },
    ]);
    // The workspace the edit started from has no such element, so it alone says nothing went.
    expect(menuRenamesIn([renamed[1]!], buildWorkspace(applyOperations(buildWorkspace(scoped).doc, [renamed[0]!]).doc))).toEqual([
      { kind: "view-gone", id: "returns" },
      { kind: "element-gone", id: "gateway" },
    ]);
    expect(followMenu({ kind: "diagram" }, "returns", menuRenamesIn(renamed, buildWorkspace(scoped))).on).toBeNull();
    expect(followMenu({ kind: "diagram" }, "data", menuRenamesIn(renamed, buildWorkspace(scoped))).on).toEqual({ kind: "diagram" });
    // An element moved inside another, which is then deleted: its view goes with that one.
    const moved: Operation[] = [
      { op: "add-element", id: "store", kind: "system" },
      { op: "update-element", id: "db", parent: "store" },
      { op: "remove-element", id: "store" },
    ];
    expect(menuRenamesIn(moved, buildWorkspace(scoped))).toEqual([
      { kind: "view-gone", id: "data" },
      { kind: "element-gone", id: "db" },
      { kind: "element-gone", id: "store" },
    ]);
  });

  it("loses a view's arrows, or everything, where the workspace an operation was applied to can't be worked out", () => {
    // Told of operations that don't go with the workspace it's given: the first can't be applied to it. An edit that's only right
    // as a whole is refused the same way when the operations ahead of a delete are applied on their own.
    const odd: Operation[] = [
      { op: "update-view", id: "no-such-view", title: "Nothing" },
      { op: "remove-block", view: "returns", id: "asked" },
    ];
    expect(menuRenamesIn(odd, buildWorkspace(doc))).toEqual([
      { kind: "gone", what: "block", view: "returns", id: "asked" },
      { kind: "kinds-lost", kinds: ["flow"], view: "returns" },
    ]);
    expect(followMenu({ kind: "flow", number: 4 }, "returns", menuRenamesIn(odd, buildWorkspace(doc))).on).toBeNull();
    expect(followMenu({ kind: "block", id: "refund" }, "returns", menuRenamesIn(odd, buildWorkspace(doc))).on).toEqual({ kind: "block", id: "refund" });
    expect(followMenu({ kind: "transition", number: 1 }, "states", menuRenamesIn(odd, buildWorkspace(doc))).on).toEqual({ kind: "transition", number: 1 });
    expect(menuRenamesIn([odd[0]!, { op: "remove-element", id: "shop" }], buildWorkspace(doc))).toEqual([{ kind: "lost" }]);
  });

  it("loses everything but the diagram through Undo, Redo or a file changed elsewhere, which write a whole version and don't say what they did", () => {
    // Told without the workspace before: the renames a whole version made, and that's all it says.
    const undone = menuRenamesIn([{ op: "rename", id: "returns", to: "refunds" }]);
    expect(undone).toEqual([{ kind: "lost" }, { kind: "view", id: "returns", to: "refunds" }]);
    expect(menuRenamesIn([])).toEqual([{ kind: "lost" }]);
    // What has the same ID, name or number after it needn't be the same one.
    const all = [
      { kind: "block", id: "refund" },
      { kind: "lane", id: "staff" },
      { kind: "sticky", id: "note" },
      { kind: "flow", number: 2 },
      { kind: "state", id: "paid" },
      { kind: "transition", number: 1 },
      { kind: "entity", id: "order" },
      { kind: "attribute", entity: "order", name: "id" },
      { kind: "link", number: 1 },
      { kind: "card", id: "order-placed" },
      { kind: "cardArrow", from: "place-order", to: "order-placed" },
      { kind: "screen", id: "cart" },
      { kind: "widget", id: "pay" },
      { kind: "node", id: "server" },
      { kind: "instance", node: "server", element: "web" },
      { kind: "connection", number: 1 },
      { kind: "step", number: 1 },
    ] as const;
    for (const on of all) {
      expect(followMenu(on, "returns", undone), on.kind).toEqual({ on: null, view: "refunds" });
      // Nothing after brings it back.
      expect(followMenu(on, "returns", [...undone, { kind: "block", view: "refunds", id: "refund", to: "pay-back" }]).on, on.kind).toBeNull();
    }
    // The diagram's menu is for no one thing, so it's followed to the view's new ID.
    expect(followMenu({ kind: "diagram" }, "returns", undone)).toEqual({ on: { kind: "diagram" }, view: "refunds" });
    // An edit's own operations are told with the workspace before, and lose nothing.
    expect(menuRenamesIn([{ op: "rename", id: "returns", to: "refunds" }], buildWorkspace(doc))).toEqual([{ kind: "view", id: "returns", to: "refunds" }]);
  });

  it("follows the view through its own new ID, and leaves another view's things alone", () => {
    const retitled: Operation[][] = [
      [
        { op: "update-view", id: "returns", title: "Refunds" },
        { op: "rename", id: "returns", to: "refunds" },
      ],
      [{ op: "update-block", view: "refunds", id: "say-no", newId: "turn-it-down" }],
    ];
    expect(landed("returns", { kind: "block", id: "say-no" }, retitled)).toEqual({ on: { kind: "block", id: "turn-it-down" }, view: "refunds" });
    expect(landed("returns", null, retitled)).toEqual({ on: { kind: "diagram" }, view: "refunds" });
    // Another flowchart has a block of the same ID, which gets a new one.
    const two = structuredClone(doc);
    two.views.exchanges = { title: "Exchanges", level: "flowchart", blocks: [{ id: "say-no", text: "Say no" }] };
    expect(landed("returns", { kind: "block", id: "say-no" }, [[{ op: "update-block", view: "exchanges", id: "say-no", newId: "decline" }]], two)).toEqual({ on: { kind: "block", id: "say-no" }, view: "returns" });
    // An element's new ID is no view's.
    expect(landed("returns", { kind: "block", id: "say-no" }, [[{ op: "rename", id: "shop", to: "store" }]])).toEqual({ on: { kind: "block", id: "say-no" }, view: "returns" });
  });

  it("is lost with its view, deleted on its own or with the element it's a view of", () => {
    const scoped = structuredClone(doc);
    scoped.elements.api = { kind: "container", name: "API", parent: "shop" };
    scoped.views.returns!.scope = "api";
    scoped.views.other = { title: "Other", level: "flowchart" };
    expect(menuRenamesIn([{ op: "remove-view", id: "returns" }], buildWorkspace(scoped))).toEqual([{ kind: "view-gone", id: "returns" }]);
    // Deleting the system deletes the container in it, and the flowchart of that.
    expect(menuRenamesIn([{ op: "remove-element", id: "shop" }], buildWorkspace(scoped))).toEqual([
      { kind: "view-gone", id: "returns" },
      { kind: "element-gone", id: "shop" },
      { kind: "element-gone", id: "api" },
    ]);
    expect(menuRenamesIn([{ op: "remove-element", id: "api" }], buildWorkspace(scoped))).toEqual([
      { kind: "view-gone", id: "returns" },
      { kind: "element-gone", id: "api" },
    ]);
    // The diagram's own menu goes with the view, even if another view then takes its ID.
    const gone: MenuRename[] = [{ kind: "view-gone", id: "returns" }, { kind: "view", id: "other", to: "returns" }];
    expect(followMenu({ kind: "diagram" }, "returns", gone).on).toBeNull();
    expect(followMenu({ kind: "block", id: "refund" }, "returns", gone).on).toBeNull();
    expect(followMenu({ kind: "diagram" }, "other", gone)).toEqual({ on: { kind: "diagram" }, view: "returns" });
    // In an edit that does more, too.
    expect(menuRenamesIn([{ op: "update-view", id: "other", title: "Others" }, { op: "remove-element", id: "api" }], buildWorkspace(scoped))).toEqual([
      { kind: "view-gone", id: "returns" },
      { kind: "element-gone", id: "api" },
    ]);
  });
});

/** An event view in two lanes, and a wireframe view of two screens, one with a row that has a panel in it. */
const boards: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {},
  views: {
    ordering: {
      title: "Ordering",
      level: "event",
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "shop", name: "Shop" },
      ],
      cards: [
        { id: "place-order", kind: "command", name: "Place order", lane: "customer" },
        { id: "order-placed", kind: "event", name: "Order placed", lane: "shop", from: ["place-order"] },
        { id: "take-payment", kind: "command", name: "Take payment", lane: "shop", from: ["order-placed", "place-order"] },
      ],
      stickies: { note: { text: "Read me" } },
    },
    checkout: {
      title: "Checkout",
      level: "wireframe",
      screens: [
        {
          id: "cart",
          name: "Cart",
          widgets: [
            { id: "title", kind: "heading", text: "Your cart" },
            {
              id: "actions",
              kind: "row",
              widgets: [
                { id: "pay", kind: "button", text: "Pay", to: "payment" },
                { id: "more", kind: "panel", widgets: [{ id: "help", kind: "link", text: "Help" }] },
              ],
            },
          ],
        },
        { id: "payment", name: "Payment", widgets: [{ id: "card", kind: "panel", text: "Card" }] },
      ],
      stickies: { note: { text: "Read me" } },
    },
  },
};

describe("what an event view's right-click menu is for", () => {
  const ordering = buildWorkspace(boards).views.get("ordering")!;
  const arrow = (from: string, to: string) => ({ kind: "cardArrow", from, to }) as const;

  it("is a card, a lane, a note, or an arrow the view draws", () => {
    for (const on of [{ kind: "card", id: "order-placed" }, { kind: "lane", id: "shop" }, { kind: "sticky", id: "note" }, arrow("place-order", "order-placed")] as const) {
      expect(menuOn(on)).toEqual(on);
      expect(menuThere(ordering, on), on.kind).toBe(true);
      expect(isSelected(on, on)).toBe(true);
    }
    expect(menuThere(ordering, { kind: "card", id: "customer" })).toBe(false);
    // An arrow goes one way: there's none back.
    expect(menuThere(ordering, arrow("order-placed", "place-order"))).toBe(false);
    expect(isSelected(arrow("place-order", "order-placed"), arrow("place-order", "take-payment"))).toBe(false);
  });

  it("follows a card to its new ID, and loses it once it's deleted, whatever takes its ID after", () => {
    const renamed: Operation[][] = [[{ op: "update-card", view: "ordering", id: "order-placed", name: "Order made", newId: "order-made" }]];
    expect(landed("ordering", { kind: "card", id: "order-placed" }, renamed, boards)?.on).toEqual({ kind: "card", id: "order-made" });
    expect(landed("ordering", { kind: "card", id: "take-payment" }, renamed, boards)?.on).toEqual({ kind: "card", id: "take-payment" });
    // A card moved, or changed some other way, is the same card.
    expect(landed("ordering", { kind: "card", id: "order-placed" }, [[{ op: "update-card", view: "ordering", id: "order-placed", position: 1, kind: "policy" }]], boards)?.on).toEqual({ kind: "card", id: "order-placed" });
    const replaced: Operation[][] = [[{ op: "remove-card", view: "ordering", id: "order-placed" }], [{ op: "add-card", view: "ordering", id: "order-placed", kind: "event" }]];
    expect(landed("ordering", { kind: "card", id: "order-placed" }, replaced, boards)).toBeNull();
    expect(landed("ordering", { kind: "card", id: "take-payment" }, replaced, boards)?.on).toEqual({ kind: "card", id: "take-payment" });
  });

  it("follows an arrow by the cards at its ends, and loses it with either of them", () => {
    const from: Operation[][] = [[{ op: "update-card", view: "ordering", id: "place-order", newId: "order" }]];
    expect(landed("ordering", arrow("place-order", "order-placed"), from, boards)?.on).toEqual(arrow("order", "order-placed"));
    const to: Operation[][] = [[{ op: "update-card", view: "ordering", id: "order-placed", newId: "order-made" }]];
    expect(landed("ordering", arrow("place-order", "order-placed"), to, boards)?.on).toEqual(arrow("place-order", "order-made"));
    // An arrow between other cards is left alone.
    expect(landed("ordering", arrow("place-order", "take-payment"), to, boards)?.on).toEqual(arrow("place-order", "take-payment"));
    for (const id of ["place-order", "order-placed"]) {
      const gone = menuRenamesIn([{ op: "remove-card", view: "ordering", id }], buildWorkspace(boards));
      expect(followMenu(arrow("place-order", "order-placed"), "ordering", gone).on, id).toBeNull();
    }
    const other = menuRenamesIn([{ op: "remove-card", view: "ordering", id: "take-payment" }], buildWorkspace(boards));
    expect(followMenu(arrow("place-order", "order-placed"), "ordering", other).on).toEqual(arrow("place-order", "order-placed"));
    // The same cards in another view are other cards.
    const elsewhere = menuRenamesIn([{ op: "remove-card", view: "billing", id: "place-order" }], buildWorkspace(boards));
    expect(followMenu(arrow("place-order", "order-placed"), "ordering", elsewhere).on).toEqual(arrow("place-order", "order-placed"));
  });

  it("loses an arrow once its card no longer comes from the other, and keeps the ones it still comes from", () => {
    // Said with a space to trim, as update-card reads it.
    const one: Operation[][] = [[{ op: "update-card", view: "ordering", id: "take-payment", from: [" order-placed "] }]];
    expect(landed("ordering", arrow("place-order", "take-payment"), one, boards)).toBeNull();
    expect(landed("ordering", arrow("order-placed", "take-payment"), one, boards)?.on).toEqual(arrow("order-placed", "take-payment"));
    // Another card's arrows are left alone.
    expect(landed("ordering", arrow("place-order", "order-placed"), one, boards)?.on).toEqual(arrow("place-order", "order-placed"));
    // It doesn't come back with an arrow drawn there after.
    const again: Operation[][] = [...one, [{ op: "update-card", view: "ordering", id: "take-payment", from: ["order-placed", "place-order"] }]];
    expect(landed("ordering", arrow("place-order", "take-payment"), again, boards)).toBeNull();
    for (const from of [null, []]) {
      const none = menuRenamesIn([{ op: "update-card", view: "ordering", id: "take-payment", from }], buildWorkspace(boards));
      expect(followMenu(arrow("order-placed", "take-payment"), "ordering", none).on).toBeNull();
    }
    // Told which cards it comes from and given a new ID at once: the cards are said under the ID it had.
    const both: Operation[][] = [[{ op: "update-card", view: "ordering", id: "take-payment", from: ["order-placed"], newId: "pay" }]];
    expect(landed("ordering", arrow("order-placed", "take-payment"), both, boards)?.on).toEqual(arrow("order-placed", "pay"));
    expect(landed("ordering", arrow("place-order", "take-payment"), both, boards)).toBeNull();
    // A card changed without saying where it comes from keeps its arrows.
    expect(landed("ordering", arrow("place-order", "take-payment"), [[{ op: "update-card", view: "ordering", id: "take-payment", lane: "customer" }]], boards)?.on).toEqual(arrow("place-order", "take-payment"));
  });
});

describe("what a wireframe view's right-click menu is for", () => {
  const checkout = buildWorkspace(boards).views.get("checkout")!;
  const widget = (id: string) => ({ kind: "widget", id }) as const;
  const after = (on: Selection, ops: Operation[], from = boards) => followMenu(menuOn(on), "checkout", menuRenamesIn(ops, buildWorkspace(from))).on;

  it("is a screen, a note, or a widget, on a screen or inside a row or a panel", () => {
    for (const on of [{ kind: "screen", id: "payment" }, widget("title"), widget("pay"), widget("help"), { kind: "sticky", id: "note" }] as const) {
      expect(menuOn(on)).toEqual(on);
      expect(menuThere(checkout, on), on.id).toBe(true);
    }
    // A screen's ID is no widget's, nor a widget's a screen's.
    expect(menuThere(checkout, widget("cart"))).toBe(false);
    expect(menuThere(checkout, { kind: "screen", id: "pay" })).toBe(false);
  });

  it("follows a screen and a widget to its new ID", () => {
    expect(landed("checkout", { kind: "screen", id: "cart" }, [[{ op: "update-screen", view: "checkout", id: "cart", name: "Basket", newId: "basket" }]], boards)?.on).toEqual({ kind: "screen", id: "basket" });
    expect(landed("checkout", widget("help"), [[{ op: "update-widget", view: "checkout", id: "help", newId: "get-help" }]], boards)?.on).toEqual(widget("get-help"));
    // A widget moved to another screen, or into a panel, is the same widget.
    expect(landed("checkout", widget("pay"), [[{ op: "update-widget", view: "checkout", id: "pay", in: "card" }]], boards)?.on).toEqual(widget("pay"));
    // A screen and a widget can share an ID: each is followed as its own kind.
    expect(after({ kind: "screen", id: "cart" }, [{ op: "update-widget", view: "checkout", id: "cart", newId: "basket" }])).toEqual({ kind: "screen", id: "cart" });
  });

  it("loses the widgets on a screen that's deleted, and no others", () => {
    const gone: Operation[] = [{ op: "remove-screen", view: "checkout", id: "cart" }];
    expect(menuRenamesIn(gone, buildWorkspace(boards))).toEqual([
      { kind: "gone", what: "screen", view: "checkout", id: "cart" },
      ...["title", "actions", "pay", "more", "help"].map((id) => ({ kind: "gone", what: "widget", view: "checkout", id })),
    ]);
    expect(["title", "actions", "pay", "more", "help", "card"].map((id) => after(widget(id), gone))).toEqual([null, null, null, null, null, widget("card")]);
    expect(after({ kind: "screen", id: "cart" }, gone)).toBeNull();
    expect(after({ kind: "screen", id: "payment" }, gone)).toEqual({ kind: "screen", id: "payment" });
    // Nothing brings one back: a widget added under its ID after is another.
    const replaced: Operation[][] = [gone, [{ op: "add-widget", view: "checkout", id: "pay", kind: "button", screen: "payment" }]];
    expect(landed("checkout", widget("pay"), replaced, boards)).toBeNull();
  });

  it("loses the widgets inside a row or a panel that's deleted, however deep, and no others", () => {
    const gone: Operation[] = [{ op: "remove-widget", view: "checkout", id: "actions" }];
    expect(["title", "actions", "pay", "more", "help", "card"].map((id) => after(widget(id), gone))).toEqual([widget("title"), null, null, null, null, widget("card")]);
    expect(after({ kind: "screen", id: "cart" }, gone)).toEqual({ kind: "screen", id: "cart" });
    // One with nothing inside it takes nothing with it.
    expect(menuRenamesIn([{ op: "remove-widget", view: "checkout", id: "pay" }], buildWorkspace(boards))).toEqual([{ kind: "gone", what: "widget", view: "checkout", id: "pay" }]);
  });

  it("follows the widgets through an edit that does more first, as one of Ask AI's can", () => {
    // The link is moved out of its panel onto the screen, then the panel deleted: the link isn't in it by then.
    const out: Operation[] = [
      { op: "update-widget", view: "checkout", id: "help", in: null },
      { op: "remove-widget", view: "checkout", id: "more" },
    ];
    expect(after(widget("help"), out)).toEqual(widget("help"));
    expect(after(widget("more"), out)).toBeNull();
    // The button is moved to the other screen, then that screen deleted: it goes with the one it's on by then.
    const moved: Operation[] = [
      { op: "update-widget", view: "checkout", id: "pay", to: null, screen: "payment" },
      { op: "remove-screen", view: "checkout", id: "payment" },
    ];
    expect(["pay", "card", "title"].map((id) => after(widget(id), moved))).toEqual([null, null, widget("title")]);
  });

  it("loses the view's widgets where the workspace a delete was applied to can't be worked out", () => {
    // Told of operations that don't go with the workspace it's given: the first can't be applied to it.
    for (const remove of [{ op: "remove-screen", view: "checkout", id: "payment" }, { op: "remove-widget", view: "checkout", id: "more" }] as const) {
      const odd: Operation[] = [{ op: "update-view", id: "no-such-view", title: "Nothing" }, remove];
      expect(menuRenamesIn(odd, buildWorkspace(boards))).toEqual([
        { kind: "gone", what: remove.op === "remove-screen" ? "screen" : "widget", view: "checkout", id: remove.id },
        { kind: "kinds-lost", kinds: ["widget"], view: "checkout" },
      ]);
      expect(after(widget("title"), odd), remove.op).toBeNull();
      // The screens are followed as ever, and so is another view.
      expect(after({ kind: "screen", id: "cart" }, odd)).toEqual({ kind: "screen", id: "cart" });
      expect(followMenu({ kind: "card", id: "order-placed" }, "ordering", menuRenamesIn(odd, buildWorkspace(boards))).on).toEqual({ kind: "card", id: "order-placed" });
    }
  });
});

describe("what a deployment view's right-click menu is for", () => {
  const production = buildWorkspace(live).views.get("production")!;
  const node = (id: string) => ({ kind: "node", id }) as const;
  const runs = (node: string, element: string) => ({ kind: "instance", node, element }) as const;
  const connection = (number: number) => ({ kind: "connection", number }) as const;
  const after = (on: Selection, ops: Operation[], from = live) => followMenu(menuOn(on), "production", menuRenamesIn(ops, buildWorkspace(from))).on;

  it("is a node, a connection, a note, or a container or system running in a node", () => {
    for (const on of [node("region"), node("lb"), runs("server", "web"), connection(6), { kind: "sticky", id: "note" }] as const) {
      expect(menuOn(on)).toEqual(on);
      expect(menuThere(production, on), JSON.stringify(on)).toBe(true);
      expect(isSelected(on, on)).toBe(true);
    }
    // It runs in another node, not this one.
    expect(menuThere(production, runs("server", "db"))).toBe(false);
    expect(menuThere(production, runs("nowhere", "web"))).toBe(false);
    expect(menuThere(production, connection(7))).toBe(false);
    expect(isSelected(runs("server", "web"), runs("server", "api"))).toBe(false);
    // An arrow between two elements is the model's, and isn't followed here.
    expect(menuOn({ kind: "arrow", from: "web", to: "api" })).toBeNull();
  });

  it("follows a node to its new ID, and what runs in one by the node's ID and its own", () => {
    const renamed: Operation[] = [{ op: "update-node", view: "production", id: "server", name: "App server", newId: "app-server" }];
    expect(after(node("server"), renamed)).toEqual(node("app-server"));
    expect(after(runs("server", "web"), renamed)).toEqual(runs("app-server", "web"));
    expect(after(runs("data", "db"), renamed)).toEqual(runs("data", "db"));
    // The element's new ID is the model's to give.
    const element: Operation[] = [{ op: "rename", id: "web", to: "website" }];
    expect(landed("production", runs("server", "web"), [element, renamed], live)?.on).toEqual(runs("app-server", "website"));
    expect(after(node("server"), element)).toEqual(node("server"));
    // A node moved inside another, or changed some other way, is the same node.
    expect(landed("production", node("edge"), [[{ op: "update-node", view: "production", id: "edge", parent: "region", technology: "CDN" }]], live)?.on).toEqual(node("edge"));
  });

  it("loses a node with the node it's inside, however deep, and what ran in each", () => {
    const deep = structuredClone(live);
    deep.views.production!.nodes!.rack = { name: "Rack", parent: "server" };
    const gone: Operation[] = [{ op: "remove-node", view: "production", id: "region" }];
    expect(["region", "lb", "server", "rack", "data", "edge"].map((id) => after(node(id), gone, deep))).toEqual([null, null, null, null, null, node("edge")]);
    expect(after(runs("server", "web"), gone, deep)).toBeNull();
    expect(after(runs("edge", "cache"), gone, deep)).toEqual(runs("edge", "cache"));
    // Nothing brings one back: a node added under its ID after is another.
    const replaced: Operation[][] = [gone, [{ op: "add-node", view: "production", id: "server", runs: ["web"] }]];
    expect(landed("production", node("server"), replaced, deep)).toBeNull();
    expect(landed("production", runs("server", "web"), replaced, deep)).toBeNull();
  });

  it("loses what a node no longer runs, and keeps what it still does", () => {
    // Said with a space to trim, as update-node reads it.
    const stopped: Operation[] = [{ op: "update-node", view: "production", id: "server", runs: [" api "] }];
    expect(after(runs("server", "web"), stopped)).toBeNull();
    expect(after(runs("server", "api"), stopped)).toEqual(runs("server", "api"));
    expect(after(runs("data", "db"), stopped)).toEqual(runs("data", "db"));
    expect(after(node("server"), stopped)).toEqual(node("server"));
    for (const none of [null, []]) expect(after(runs("server", "api"), [{ op: "update-node", view: "production", id: "server", runs: none }])).toBeNull();
    // It doesn't come back when it's run there again.
    expect(landed("production", runs("server", "web"), [stopped, [{ op: "update-node", view: "production", id: "server", runs: ["api", "web"] }]], live)).toBeNull();
    // Told what it runs and given a new ID at once: what it runs is said under the ID it had.
    const both: Operation[] = [{ op: "update-node", view: "production", id: "server", runs: ["web"], newId: "app" }];
    expect(after(runs("server", "web"), both)).toEqual(runs("app", "web"));
    expect(after(runs("server", "api"), both)).toBeNull();
    // A node changed without saying what it runs keeps it all.
    expect(after(runs("server", "web"), [{ op: "update-node", view: "production", id: "server", instances: 3 }])).toEqual(runs("server", "web"));
  });

  it("loses what runs in a node when it's deleted from the model, on its own or with what it's inside", () => {
    expect(after(runs("server", "web"), [{ op: "remove-element", id: "web" }])).toBeNull();
    expect(after(runs("server", "api"), [{ op: "remove-element", id: "web" }])).toEqual(runs("server", "api"));
    // The system goes, and every container in it.
    expect(after(runs("edge", "cache"), [{ op: "remove-element", id: "shop" }])).toBeNull();
    expect(after(node("edge"), [{ op: "remove-element", id: "shop" }])).toEqual(node("edge"));
    // Another added under its ID, and run there, is another.
    const replaced: Operation[][] = [
      [{ op: "remove-element", id: "web" }],
      [
        { op: "add-element", id: "web", kind: "container", parent: "shop" },
        { op: "update-node", view: "production", id: "server", runs: ["api", "web"] },
      ],
    ];
    expect(landed("production", runs("server", "web"), replaced, live)).toBeNull();
  });

  it("follows the connections left when a node goes, with those to what only it ran", () => {
    // Routes and Backs up to are the edge node's, and Falls back is from the cache, which only it runs.
    const edge: Operation[] = [{ op: "remove-node", view: "production", id: "edge" }];
    expect([1, 2, 3, 4, 5, 6].map((number) => after(connection(number), edge))).toEqual([connection(1), connection(2), null, connection(3), null, null]);
    // Stopping the web app running in its node takes the connection to it, and no other.
    const stopped: Operation[] = [{ op: "update-node", view: "production", id: "server", runs: ["api"] }];
    expect([1, 2, 3].map((number) => after(connection(number), stopped))).toEqual([null, connection(1), connection(2)]);
    // And deleting the database from the model, the one to it.
    expect([3, 4, 5].map((number) => after(connection(number), [{ op: "remove-element", id: "db" }]))).toEqual([connection(3), null, connection(4)]);
    // A node told what it runs already, or anything else, keeps them all, and so does a new ID.
    const kept: Operation[] = [
      { op: "update-node", view: "production", id: "server", runs: ["web", "api"] },
      { op: "update-node", view: "production", id: "edge", newId: "cdn", technology: "CDN" },
      { op: "rename", id: "cache", to: "store" },
    ];
    expect(menuRenamesIn(kept, buildWorkspace(live))).toEqual([
      { kind: "runs", view: "production", node: "server", runs: ["web", "api"] },
      { kind: "node", view: "production", id: "edge", to: "cdn" },
      { kind: "view", id: "cache", to: "store" },
    ]);
    // In an edit that does more first: the load balancer's node goes before the edge's, so the numbers are the ones left by then.
    const more: Operation[] = [
      { op: "remove-connection", view: "production", connection: 1 },
      { op: "remove-node", view: "production", id: "edge" },
    ];
    expect([2, 3, 4, 5, 6].map((number) => after(connection(number), more))).toEqual([connection(1), null, connection(2), null, null]);
  });

  it("loses the view's connections, and its nodes with what runs in them, where there's no telling what a delete took", () => {
    // Told of operations that don't go with the workspace it's given: the first can't be applied to it.
    const odd: Operation[] = [
      { op: "update-view", id: "no-such-view", title: "Nothing" },
      { op: "remove-node", view: "production", id: "data" },
    ];
    expect(menuRenamesIn(odd, buildWorkspace(live))).toEqual([
      { kind: "gone", what: "node", view: "production", id: "data" },
      { kind: "kinds-lost", kinds: ["node"], view: "production" },
      { kind: "kinds-lost", kinds: ["connection"], view: "production" },
    ]);
    expect([node("edge"), runs("edge", "cache"), connection(1)].map((on) => after(on, odd))).toEqual([null, null, null]);
    expect(after({ kind: "sticky", id: "note" }, odd)).toEqual({ kind: "sticky", id: "note" });
    expect(followMenu({ kind: "step", number: 1 }, "ordering", menuRenamesIn(odd, buildWorkspace(live))).on).toEqual({ kind: "step", number: 1 });
    // A delete the workspace it's told with can't have: what it took can't be read off.
    const missing: Operation[] = [{ op: "remove-node", view: "production", id: "no-such-node" }];
    expect(menuRenamesIn(missing, buildWorkspace(live))).toEqual([
      { kind: "gone", what: "node", view: "production", id: "no-such-node" },
      { kind: "kinds-lost", kinds: ["connection"], view: "production" },
    ]);
    // A view with no connections has none to lose.
    const bare = structuredClone(live);
    delete bare.views.production!.connections;
    expect(menuRenamesIn([{ op: "remove-node", view: "production", id: "edge" }], buildWorkspace(bare))).toEqual([{ kind: "gone", what: "node", view: "production", id: "edge" }]);
  });
});

describe("what a sequence view's right-click menu is for", () => {
  const ordering = buildWorkspace(live).views.get("ordering")!;
  const step = (number: number) => ({ kind: "step", number }) as const;
  const after = (on: Selection, ops: Operation[]) => followMenu(menuOn(on), "ordering", menuRenamesIn(ops, buildWorkspace(live))).on;

  it("is a step, by its number, or a note", () => {
    expect(menuOn(step(5))).toEqual(step(5));
    expect([1, 5, 6, 0].map((number) => menuThere(ordering, step(number)))).toEqual([true, true, false, false]);
    expect(menuThere(ordering, { kind: "sticky", id: "note" })).toBe(true);
    // An element's heading has the menu an element has on any view, which isn't followed here.
    expect(menuOn({ kind: "element", id: "web" })).toBeNull();
  });

  it("follows the steps left when an element is deleted from the model, which takes the steps it's in", () => {
    // Saves, step 3, is the API's call to the database.
    const gone: Operation[] = [{ op: "remove-element", id: "db" }];
    expect([1, 2, 3, 4, 5].map((number) => after(step(number), gone))).toEqual([step(1), step(2), null, step(3), step(4)]);
    expect(menuRenamesIn(gone, buildWorkspace(live))).toEqual([
      { kind: "element-gone", id: "db" },
      { kind: "removed", list: "step", view: "ordering", number: 3 },
      { kind: "removed", list: "connection", view: "production", number: 4 },
    ]);
    // Every step has an element of the system at an end.
    expect([1, 5].map((number) => after(step(number), [{ op: "remove-element", id: "shop" }]))).toEqual([null, null]);
    // An element's new ID, or its name, renumbers nothing.
    expect(after(step(3), [{ op: "rename", id: "db", to: "database" }, { op: "update-element", id: "database", name: "Database" }])).toEqual(step(3));
    // In an edit that does more first.
    const more: Operation[] = [
      { op: "add-step", view: "ordering", from: "buyer", to: "web", description: "Looks", step: 1 },
      { op: "remove-element", id: "cache" },
    ];
    expect([1, 3, 5].map((number) => after(step(number), more))).toEqual([step(2), step(4), null]);
  });
});
