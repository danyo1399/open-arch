import { applyOperations, buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { followMenu, isSelected, menuOn, menuRenamesIn, menuThere, selectionFor, type MenuRename, type NumberedPart } from "../src/canvas/diagramMenu.js";

/** A flowchart in two lanes, a state view and an entity view, each with a note. */
const doc: OpenArchDocument = {
  openarch: 20,
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

  /** What says which one of a numbered list is which, however the list is renumbered. */
  const LISTS: Record<NumberedPart, { view: string; ends: string[]; add(n: number, at?: number): Operation; move(from: number, to: number): Operation; remove(n: number): Operation; retext(n: number): Operation; cut(id: string): Operation }> = {
    flow: {
      view: "returns",
      ends: ["refund", "say-no", "in-time"],
      cut: (id) => ({ op: "remove-block", view: "returns", id }),
      add: (n, at) => ({ op: "add-flow", view: "returns", from: "asked", to: "done", text: `new ${n}`, ...(at !== undefined && { flow: at }) }),
      move: (from, to) => ({ op: "update-flow", view: "returns", flow: from, newFlow: to }),
      remove: (n) => ({ op: "remove-flow", view: "returns", flow: n }),
      retext: (n) => ({ op: "update-flow", view: "returns", flow: n, to: "say-no" }),
    },
    transition: {
      view: "states",
      ends: ["paid"],
      cut: (id) => ({ op: "remove-state", view: "states", id }),
      add: (n, at) => ({ op: "add-transition", view: "states", from: "placed", to: "shipped", action: `new ${n}`, ...(at !== undefined && { transition: at }) }),
      move: (from, to) => ({ op: "update-transition", view: "states", transition: from, newTransition: to }),
      remove: (n) => ({ op: "remove-transition", view: "states", transition: n }),
      retext: (n) => ({ op: "update-transition", view: "states", transition: n, to: "paid" }),
    },
    link: {
      view: "data",
      ends: ["order"],
      cut: (id) => ({ op: "remove-entity", view: "data", id }),
      add: (n, at) => ({ op: "add-link", view: "data", from: "line", to: "customer", text: `new ${n}`, ...(at !== undefined && { link: at }) }),
      move: (from, to) => ({ op: "update-link", view: "data", link: from, newLink: to }),
      remove: (n) => ({ op: "remove-link", view: "data", link: n }),
      retext: (n) => ({ op: "update-link", view: "data", link: n, to: "order" }),
    },
  };
  /** The model with text on every flow, so each can be told from the others. */
  const labelled = structuredClone(doc);
  labelled.views.returns!.flows!.forEach((f, i) => (f.text = `flow ${i + 1}`));
  /** What each one of a numbered list says, which stays with it wherever it goes: a flow's or a link's text, a transition's event or action. */
  function labelsOf(list: NumberedPart, ws: ReturnType<typeof buildWorkspace>) {
    const view = ws.views.get(LISTS[list].view)!;
    if (list === "flow") return view.flows.map((f) => f.text ?? "");
    if (list === "transition") return view.transitions.map((t) => t.action ?? t.event ?? "");
    return view.links.map((l) => l.text ?? "");
  }

  it.each(["flow", "transition", "link"] as const)("follows a %s to the number it has however others are added, deleted and moved round it, in one edit or several, and when what's at one's end is deleted", (list) => {
    const kit = LISTS[list];
    // The same sequences every run: a small generator stands in for chance.
    let seed = 7;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % below;
    };
    for (let round = 0; round < 60; round++) {
      let ws = buildWorkspace(labelled);
      const start = labelsOf(list, ws);
      const edits: Operation[][] = [];
      const renames: MenuRename[] = [];
      // The blocks, states or entities that are still there to delete, each with some of the arrows.
      const ends = [...kit.ends];
      for (let step = 0; step < 6; step++) {
        const ops: Operation[] = [];
        let now = ws;
        // Now and then, what's at the end of some of them is deleted, in an edit of its own.
        const cut = ends.length > 0 && random(6) === 0;
        if (cut) ops.push(kit.cut(ends.splice(random(ends.length), 1)[0]!));
        // Or else one operation, or two in the same edit.
        for (let k = 0; !cut && k <= random(2); k++) {
          const count = labelsOf(list, now).length;
          const does = count === 0 ? 0 : random(5);
          const op =
            does === 0
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

  it("loses a view's arrows when an edit deletes a block, a state or an entity and does more, where there's no saying which went", () => {
    const more: Operation[] = [
      { op: "update-view", id: "returns", description: "Sending something back" },
      { op: "remove-block", view: "returns", id: "asked" },
    ];
    expect(menuRenamesIn(more, buildWorkspace(doc))).toEqual([
      { kind: "gone", what: "block", view: "returns", id: "asked" },
      { kind: "lists-lost", lists: ["flow"], view: "returns" },
    ]);
    expect(landed("returns", { kind: "flow", number: 4 }, [more])).toBeNull();
    // The view's blocks, and another view's arrows, are still followed.
    expect(landed("returns", { kind: "block", id: "refund" }, [more])?.on).toEqual({ kind: "block", id: "refund" });
    expect(landed("states", { kind: "transition", number: 1 }, [more])?.on).toEqual({ kind: "transition", number: 1 });
  });

  it("loses everything but the diagram through Undo, Redo or a file changed elsewhere, which write a whole version and don't say what they did", () => {
    // Told without the workspace before: the renames a whole version made, and that's all it says.
    const undone = menuRenamesIn([{ op: "rename", id: "returns", to: "refunds" }]);
    expect(undone).toEqual([{ kind: "lost" }, { kind: "view", id: "returns", to: "refunds" }]);
    expect(menuRenamesIn([])).toEqual([{ kind: "lost" }]);
    // What has the same ID, name or number after it needn't be the same one.
    for (const on of [{ kind: "block", id: "refund" }, { kind: "lane", id: "staff" }, { kind: "sticky", id: "note" }, { kind: "flow", number: 2 }, { kind: "state", id: "paid" }, { kind: "transition", number: 1 }, { kind: "entity", id: "order" }, { kind: "attribute", entity: "order", name: "id" }, { kind: "link", number: 1 }] as const) {
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
    expect(menuRenamesIn([{ op: "remove-element", id: "shop" }], buildWorkspace(scoped))).toEqual([{ kind: "view-gone", id: "returns" }]);
    expect(menuRenamesIn([{ op: "remove-element", id: "api" }], buildWorkspace(scoped))).toEqual([{ kind: "view-gone", id: "returns" }]);
    // The diagram's own menu goes with the view, even if another view then takes its ID.
    const gone: MenuRename[] = [{ kind: "view-gone", id: "returns" }, { kind: "view", id: "other", to: "returns" }];
    expect(followMenu({ kind: "diagram" }, "returns", gone).on).toBeNull();
    expect(followMenu({ kind: "block", id: "refund" }, "returns", gone).on).toBeNull();
    expect(followMenu({ kind: "diagram" }, "other", gone)).toEqual({ on: { kind: "diagram" }, view: "returns" });
    // In an edit that does more, there's no saying which views went with an element.
    expect(menuRenamesIn([{ op: "update-view", id: "other", title: "Others" }, { op: "remove-element", id: "api" }], buildWorkspace(scoped))).toEqual([{ kind: "lost" }]);
  });
});
