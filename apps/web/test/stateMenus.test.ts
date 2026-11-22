// @vitest-environment happy-dom
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import { STATE_W } from "../src/canvas/stateLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** An order's states, each placed, so nothing waits for ELK, with a note beside them. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    "order-states": {
      title: "Order states",
      level: "state",
      initial: "placed",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", at: [0, 300] }, shipped: { name: "Shipped", final: true, at: [0, 600] } },
      transitions: [
        { from: "placed", to: "paid", event: "Payment taken" },
        { from: "paid", to: "shipped", event: "Sent" },
        { from: "paid", to: "placed", event: "Refunded" },
      ],
      stickies: { note: { text: "Read me", at: [800, 0] } },
    },
  },
};

/** The whole designer, open on the state view, with its states measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "order-states", file);

describe("a state's right-click menu", () => {
  it("selects the state, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("paid")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("State");
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Paid");
    expect(d.labels()).toEqual(["Add transition to", "It starts here", "It can end here", "Lay out again", "Delete state"]);
    // The state it starts in, and one it can end in, say so.
    await d.rightClick(d.node("placed")!);
    expect(d.labels()).toContain("It doesn't start here");
    await d.rightClick(d.node("shipped")!);
    expect(d.labels()).toContain("It can't end here");
  });

  it("adds a transition to another state, or back to itself, and selects it", async () => {
    const d = await designer();
    await d.rightClick(d.node("paid")!);
    await d.pick("Add transition to");
    expect(d.labels()).toEqual(["Placed", "Paid (itself)", "Shipped"]);
    await d.pick("Paid (itself)");
    expect((await d.saved()).transitions.at(-1)).toMatchObject({ number: 4, from: "paid", to: "paid" });
    expect(d.details()).toBe("Transition 4of 4");
  });

  it("says where it starts and where it can end, lays a state out again and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("paid")!);
    await d.pick("It starts here");
    expect((await d.saved()).initial).toBe("paid");
    await d.rightClick(d.node("paid")!);
    await d.pick("It doesn't start here");
    expect((await d.saved()).initial).toBeUndefined();

    await d.rightClick(d.node("paid")!);
    await d.pick("It can end here");
    expect((await d.saved()).states.find((s) => s.id === "paid")!.final).toBe(true);
    await d.rightClick(d.node("shipped")!);
    await d.pick("It can't end here");
    expect((await d.saved()).states.find((s) => s.id === "shipped")!.final).toBe(false);

    await d.rightClick(d.node("paid")!);
    await d.pick("Lay out again");
    expect((await d.saved()).states.find((s) => s.id === "paid")!.at).toBeUndefined();
    // The designer places it now, so there's nothing to lay out again.
    await d.rightClick(d.node("paid")!);
    expect(d.labels()).not.toContain("Lay out again");

    await d.pick("Delete state");
    const view = await d.saved();
    expect(view.states.map((s) => s.id).sort()).toEqual(["placed", "shipped"]);
    expect(view.transitions).toEqual([]);
    expect(d.details()).toBe("View");
  });
});

describe("a transition's right-click menu", () => {
  it("selects the transition, from its line or its label, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("transition:2")!);
    expect(d.details()).toBe("Transition 2of 3");
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to transition 1", "Move down, to transition 3", "Delete transition"]);
    await key(document.activeElement!, "Escape");
    expect(d.menuOpen()).toBe(false);

    const label = [...d.host.querySelectorAll(".arrow-label")].find((l) => l.textContent === "Refunded")!;
    await d.rightClick(label);
    expect(d.details()).toBe("Transition 3of 3");
    // The last one has no way down.
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to transition 2", "Delete transition"]);
  });

  it("moves either end to another state, which can be the one at its other end", async () => {
    const d = await designer();
    await d.rightClick(d.edge("transition:2")!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Placed", "Paid"]);
    await d.pick("Paid");
    expect((await d.saved()).transitions[1]).toMatchObject({ from: "paid", to: "paid", event: "Sent" });
    await d.rightClick(d.edge("transition:1")!);
    await d.pick("Change from", "Shipped");
    expect((await d.saved()).transitions[0]).toMatchObject({ from: "shipped", to: "paid" });
  });

  it("moves it up or down the list, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("transition:2")!);
    await d.pick("Move up, to transition 1");
    expect((await d.saved()).transitions.map((t) => t.event)).toEqual(["Sent", "Payment taken", "Refunded"]);
    expect(d.details()).toBe("Transition 1of 3");
    await d.rightClick(d.edge("transition:1")!);
    await d.pick("Delete transition");
    expect((await d.saved()).transitions.map((t) => t.event)).toEqual(["Payment taken", "Refunded"]);
    expect(d.details()).toBe("View");
  });
});

describe("a sticky note's right-click menu on a state view", () => {
  it("selects the note, edits it in place, and changes, moves and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Colour", "Green");
    expect((await d.saved()).stickies[0]!.color).toBe("green");

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
    await key(box, "Escape");

    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Edit notes…");
    await click(button(d.host.querySelector("dialog.notes-editor") as HTMLElement, "Cancel"));
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Move beside the diagram");
    expect((await d.saved()).stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });
});

describe("the right-click menu of a state view's background", () => {
  it("selects nothing, and has what the toolbar has", async () => {
    const d = await designer();
    await click(d.node("paid")!);
    expect(d.details()).toBe("State");
    await d.rightClick(d.pane());
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["State", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("is the menu for the frame too, which takes no clicks", async () => {
    const scoped = structuredClone(doc);
    scoped.views["order-states"]!.scope = "shop";
    const d = await designer(scoped);
    expect((d.node("__frame") as HTMLElement).style.pointerEvents).toBe("none");
    await d.rightClick(d.pane());
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
  });

  it("adds a state and a sticky note where it was clicked", async () => {
    const d = await designer();
    await d.rightClick(d.pane(), { x: 1500, y: 600 });
    await d.pick("Add", "State");
    expect((await d.saved()).states.find((s) => s.id === "new-state")).toMatchObject({ name: "New state", at: [1500 - STATE_W / 2, 570] });
    expect(d.details()).toBe("State");
    expect(document.activeElement).toBe(d.host.querySelector('input[aria-label="Name"]'));

    await d.rightClick(d.pane(), { x: 3000, y: 1200 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1150] });
    expect(document.activeElement).toBe(d.host.querySelector(".sticky textarea"));
  });

  it("lays the states out again, and has no Auto layout when there's nothing to lay out", async () => {
    const d = await designer();
    await d.rightClick(d.pane());
    await d.pick("Auto layout");
    const view = await d.saved();
    expect(view.states.map((s) => s.at)).not.toEqual([[0, 0], [0, 300], [0, 600]]);
    expect(view.stickies[0]!.at).toBeUndefined();

    const empty = structuredClone(doc);
    empty.views["order-states"] = { title: "Order states", level: "state" };
    const none = await designer(empty);
    await none.rightClick(none.pane());
    expect(none.labels()).toEqual(["Add", "Export"]);
  });
});

describe("a state view's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("paid")!, 300, 420);
    await d.menuKey(d.node("paid")!);
    expect(d.details()).toBe("State");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the state under the new ID its name gave it", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("paid")!);
    file.hold = true;
    // Its ID follows its name, and the save that renames it hasn't landed when it's right-clicked.
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "Paid for");
    await d.rightClick(d.node("paid")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("paid-for")).not.toBeNull();
    await d.pick("Delete state");
    expect((await d.saved()).states.map((s) => s.id).sort()).toEqual(["placed", "shipped"]);
  });

  it("opens on a transition under the number it has once one before it is deleted", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.edge("transition:1")!);
    file.hold = true;
    await click(button(d.host, "Delete transition"));
    await d.rightClick(d.edge("transition:3")!);
    file.release();
    await d.settle();
    // Refunded was transition 3, and is transition 2 now.
    expect(d.details()).toBe("Transition 2of 2");
    await d.pick("Delete transition");
    expect((await d.saved()).transitions.map((t) => t.event)).toEqual(["Sent"]);
  });

  it("doesn't open on a transition once one of its states is deleted, as its number can't be told", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("shipped")!);
    file.hold = true;
    await click(button(d.host, "Delete state"));
    await d.rightClick(d.edge("transition:3")!);
    file.release();
    await d.settle();
    expect((await d.saved()).transitions.map((t) => t.event)).toEqual(["Payment taken", "Refunded"]);
    expect(d.menuOpen()).toBe(false);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Order lifecycle");
    await d.rightClick(d.node("paid")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("State");
    await d.pick("It can end here");
    expect((await d.saved("order-lifecycle")).states.find((s) => s.id === "paid")!.final).toBe(true);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await d.rightClick(d.node("paid")!);
    await d.pick("It can end here");
    await d.rightClick(d.node("paid")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    // And with a Redo on its way.
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("paid")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
