// @vitest-environment happy-dom
import { buildWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { freeSpotAmong, STICKY } from "../src/canvas/autoLayout.js";
import { addCardAtOp } from "../src/canvas/EventDiagram.js";
import { eventLayout, EVT } from "../src/canvas/eventLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** Three cards along the timeline, in two lanes, each coming from the one before, with a note beside them. */
const doc: OpenArchDocument = {
  openarch: 22,
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
        { id: "take-payment", kind: "command", name: "Take payment", lane: "shop", from: ["order-placed"] },
      ],
      stickies: { note: { text: "Read me", at: [1500, 0] } },
    },
  },
};

/** The whole designer, open on the event view, with its cards measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "ordering", file);

/** A point in a lane's row, in the column of the card at this place along the timeline: 1 is the first. The top row is row 1. */
const inRow = (row: number, column: number) => ({ x: EVT.headWidth + (column - 1) * EVT.column + EVT.column / 2, y: (row - 1) * EVT.row + EVT.row / 2 });

const cards = async (d: Awaited<ReturnType<typeof designer>>, view?: string) => (await d.saved(view)).cards.map((c) => c.id);

describe("where a card added from a right-click goes", () => {
  const view = buildWorkspace(doc).views.get("ordering")!;
  const layout = eventLayout(view);

  it("is the place along the timeline where the click was, in the lane of that row", () => {
    expect(addCardAtOp(view, layout, "event", inRow(1, 2))).toEqual({ op: "add-card", view: "ordering", id: "new-event", kind: "event", name: "New event", lane: "customer", position: 2 });
    expect(addCardAtOp(view, layout, "policy", inRow(2, 1))).toMatchObject({ id: "new-policy", name: "New policy", lane: "shop", position: 1 });
    // Past the last card is the end, which needs no place. Above the rows is the top one, and below, the last.
    expect(addCardAtOp(view, layout, "event", { x: 9000, y: -500 })).toEqual({ op: "add-card", view: "ordering", id: "new-event", kind: "event", name: "New event", lane: "customer" });
    expect(addCardAtOp(view, layout, "event", { x: -500, y: 9000 })).toMatchObject({ lane: "shop", position: 1 });
  });

  it("is in the lane whose menu it was, whatever row the point is in", () => {
    expect(addCardAtOp(view, layout, "event", inRow(1, 3), view.lanes[1])).toMatchObject({ lane: "shop", position: 3 });
  });

  it("is in no lane on the row for cards in none, and on a view with no lanes", () => {
    const loose = structuredClone(doc);
    delete loose.views.ordering!.cards![0]!.lane;
    const some = buildWorkspace(loose).views.get("ordering")!;
    // The row for cards in no lane is the top one, and the lanes follow.
    expect(addCardAtOp(some, eventLayout(some), "event", inRow(1, 2))).toEqual({ op: "add-card", view: "ordering", id: "new-event", kind: "event", name: "New event", position: 2 });
    expect(addCardAtOp(some, eventLayout(some), "event", inRow(2, 2))).toMatchObject({ lane: "customer" });
    const bare = structuredClone(doc);
    bare.views.ordering = { title: "Ordering", level: "event" };
    const none = buildWorkspace(bare).views.get("ordering")!;
    expect(addCardAtOp(none, eventLayout(none), "command", { x: 400, y: 300 })).toEqual({ op: "add-card", view: "ordering", id: "new-command", kind: "command", name: "New command" });
  });
});

describe("a card's right-click menu", () => {
  it("selects the card, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("order-placed")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Eventcard 2 of 3");
    expect(d.labels()).toEqual(["Add after", "Add arrow to", "Add arrow from", "Change kind", "Move to lane", "Move earlier", "Move later", "Delete card"]);
    // The first card has nothing earlier, and the last nothing later.
    await d.rightClick(d.node("place-order")!);
    expect(d.labels()).toEqual(["Add after", "Add arrow to", "Add arrow from", "Change kind", "Move to lane", "Move later", "Delete card"]);
    await d.rightClick(d.node("take-payment")!);
    expect(d.labels()).toEqual(["Add after", "Add arrow to", "Add arrow from", "Change kind", "Move to lane", "Move earlier", "Delete card"]);
  });

  it("adds a card of any kind after it, in its lane, and selects it to give it a name", async () => {
    const d = await designer();
    await d.rightClick(d.node("place-order")!);
    await d.pick("Add after");
    expect(d.labels()).toEqual(["Event", "Command", "Actor", "Policy", "Read model", "External system", "Aggregate", "Hotspot"]);
    await d.pick("Policy");
    const view = await d.saved();
    expect(view.cards.map((c) => c.id)).toEqual(["place-order", "new-policy", "order-placed", "take-payment"]);
    expect(view.cards[1]).toMatchObject({ kind: "policy", name: "New policy", lane: "customer" });
    expect(d.details()).toBe("Policycard 2 of 4");
    expect(document.activeElement).toBe(d.host.querySelector('input[aria-label="Name"]'));
  });

  it("adds an arrow to or from another card, only where one can be drawn, and selects it", async () => {
    const d = await designer();
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Add arrow to");
    // There's an arrow to Take payment already, and none goes to itself.
    expect(d.labels()).toEqual(["Place order [Command]"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Add arrow from");
    expect(d.labels()).toEqual(["Take payment [Command]"]);
    await d.pick("Take payment [Command]");
    expect((await d.saved()).cards[1]!.from).toEqual(["place-order", "take-payment"]);
    expect(d.details()).toBe("Arrow");
    expect(d.edge("take-payment->order-placed")).not.toBeNull();

    await d.rightClick(d.node("order-placed")!);
    await d.pick("Add arrow to", "Place order [Command]");
    expect((await d.saved()).cards[0]!.from).toEqual(["order-placed"]);
    // Every arrow it can have is drawn, so there's none to add.
    await d.rightClick(d.node("order-placed")!);
    expect(d.labels()).toEqual(["Add after", "Change kind", "Move to lane", "Move earlier", "Move later", "Delete card"]);
  });

  it("changes its kind, and moves it to another lane or out of its lane", async () => {
    const d = await designer();
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(["Command", "Actor", "Policy", "Read model", "External system", "Aggregate", "Hotspot"]);
    await d.pick("Hotspot");
    expect((await d.saved()).cards[1]!.kind).toBe("hotspot");

    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "No lane"]);
    await d.pick("Customer");
    expect((await d.saved()).cards[1]!.lane).toBe("customer");
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move to lane", "No lane");
    expect((await d.saved()).cards[1]!.lane).toBeUndefined();
    // In no lane, there's none to move it out of.
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move to lane");
    expect(d.labels()).toEqual(["Customer", "Shop"]);
  });

  it("moves it earlier or later along the timeline, staying on it, and deletes it, with its arrows", async () => {
    const d = await designer();
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move earlier");
    expect(await cards(d)).toEqual(["order-placed", "place-order", "take-payment"]);
    expect(d.details()).toBe("Eventcard 1 of 3");
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move later");
    expect(await cards(d)).toEqual(["place-order", "order-placed", "take-payment"]);

    await d.rightClick(d.node("order-placed")!);
    await d.pick("Delete card");
    const view = await d.saved();
    expect(view.cards.map((c) => [c.id, c.from])).toEqual([["place-order", []], ["take-payment", []]]);
    expect(d.details()).toBe("View");
  });
});

describe("a lane's right-click menu on an event view", () => {
  it("selects the lane, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.node("lane:customer")!);
    expect(d.details()).toBe("Lane 1of 2");
    expect(d.labels()).toEqual(["Add", "Move down", "Delete lane"]);
    await d.rightClick(d.node("lane:shop")!);
    expect(d.labels()).toEqual(["Add", "Move up", "Delete lane"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Event", "Command", "Actor", "Policy", "Read model", "External system", "Aggregate", "Hotspot", "Lane", "Sticky note"]);
  });

  it("adds a card in the lane, at the place along the timeline where it was clicked", async () => {
    const d = await designer();
    await d.rightClick(d.node("lane:shop")!, inRow(2, 2));
    await d.pick("Add", "Event");
    const view = await d.saved();
    expect(view.cards.map((c) => c.id)).toEqual(["place-order", "new-event", "order-placed", "take-payment"]);
    expect(view.cards[1]).toMatchObject({ name: "New event", lane: "shop" });
    expect(d.details()).toBe("Eventcard 2 of 4");
    // Past the last card, it goes at the end.
    await d.rightClick(d.node("lane:customer")!, inRow(1, 9));
    await d.pick("Add", "Actor");
    expect((await d.saved()).cards.at(-1)).toMatchObject({ id: "new-actor", lane: "customer", number: 5 });
  });

  it("adds a lane after it, and a sticky note where it was clicked", async () => {
    const d = await designer();
    await d.rightClick(d.node("lane:customer")!, { x: 300, y: 40 });
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "new-lane", "shop"]);
    expect(d.details()).toBe("Lane 2of 3");

    await d.rightClick(d.node("lane:customer")!, { x: 300, y: 40 });
    await d.pick("Add", "Sticky note");
    // By the click, clear of the cards and the other note.
    const view = await d.saved();
    const taken = [...[...eventLayout(view).cards.values()].map((box) => ({ x: box.x, y: box.y })), { x: 1500, y: 0 }];
    const spot = freeSpotAmong({ x: 300 - STICKY.width / 2, y: 40 - 50 }, taken);
    expect(view.stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [spot.x, spot.y] });
    expect(Math.hypot(spot.x - 300, spot.y - 40)).toBeLessThan(400);
    expect(document.activeElement).toBe(d.node("sticky:note-2")!.querySelector("textarea"));
  });

  it("moves the lane up or down, and deletes it, leaving its cards in no lane", async () => {
    const d = await designer();
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move down");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["shop", "customer"]);
    await d.rightClick(d.node("lane:customer")!);
    await d.pick("Move up");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop"]);
    await d.rightClick(d.node("lane:shop")!);
    await d.pick("Delete lane");
    const view = await d.saved();
    expect(view.lanes.map((l) => l.id)).toEqual(["customer"]);
    expect(view.cards.map((c) => c.lane)).toEqual(["customer", undefined, undefined]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of an arrow between cards", () => {
  it("selects the arrow, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("place-order->order-placed")!);
    expect(d.details()).toBe("Arrow");
    expect(d.labels()).toEqual(["Delete arrow"]);
    await d.pick("Delete arrow");
    expect((await d.saved()).cards.map((c) => c.from)).toEqual([[], [], ["order-placed"]]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menus of an event view's notes and background", () => {
  it("has a sticky note's menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
    await key(box, "Escape");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Move beside the diagram");
    expect((await d.saved()).stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and has what the toolbar has, with nothing to lay out", async () => {
    const d = await designer();
    await click(d.node("order-placed")!);
    await d.rightClick(d.pane());
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Event", "Command", "Actor", "Policy", "Read model", "External system", "Aggregate", "Hotspot", "Lane", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("adds a card, a lane and a sticky note from the background, where it was clicked", async () => {
    const d = await designer();
    // To the right of the rows, level with the second: at the end, in that row's lane.
    await d.rightClick(d.pane(), { x: 5000, y: EVT.row * 1.5 });
    await d.pick("Add", "Event");
    expect((await d.saved()).cards.at(-1)).toMatchObject({ id: "new-event", lane: "shop", number: 4 });
    expect(d.details()).toBe("Eventcard 4 of 4");

    await d.rightClick(d.pane(), { x: 5000, y: 20 });
    await d.pick("Add", "Lane");
    expect((await d.saved()).lanes.map((l) => l.id)).toEqual(["customer", "shop", "new-lane"]);

    await d.rightClick(d.pane(), { x: 3000, y: 1500 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1450] });
  });

  it("is the menu for the row of cards in no lane too, which is no lane", async () => {
    const loose = structuredClone(doc);
    delete loose.views.ordering!.cards![1]!.lane;
    const d = await designer(loose);
    await click(d.node("place-order")!);
    await d.rightClick(d.node("lane:")!, inRow(1, 1));
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add", "Hotspot");
    const view = await d.saved();
    expect(view.cards.map((c) => c.id)).toEqual(["new-hotspot", "place-order", "order-placed", "take-payment"]);
    expect(view.cards[0]!.lane).toBeUndefined();
  });
});

describe("an event view's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("order-placed")!, 300, 420);
    await d.menuKey(d.node("order-placed")!);
    expect(d.details()).toBe("Eventcard 2 of 3");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the card under the new ID its name gave it", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("order-placed")!);
    file.hold = true;
    // Its ID follows its name, and the save that renames it hasn't landed when it's right-clicked.
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "Order made");
    await d.rightClick(d.node("order-placed")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("order-made")).not.toBeNull();
    await d.pick("Move earlier");
    expect(await cards(d)).toEqual(["order-made", "place-order", "take-payment"]);
  });

  it("opens on an arrow under the new ID of the card at either end", async () => {
    for (const [card, name, arrow, left] of [
      ["place-order", "Order", "place-order->order-placed", [[], [], ["order-placed"]]],
      ["take-payment", "Pay", "order-placed->take-payment", [[], ["place-order"], []]],
    ] as const) {
      const file = new SlowHost("shop.openarch", serializeDocument(doc));
      const d = await designer(doc, file);
      await click(d.node(card)!);
      file.hold = true;
      await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, name);
      await d.rightClick(d.edge(arrow)!);
      expect(d.menuOpen()).toBe(false);
      file.release();
      await d.settle();
      expect(d.details(), card).toBe("Arrow");
      await d.pick("Delete arrow");
      expect((await d.saved()).cards.map((c) => c.from), card).toEqual(left);
    }
  });

  it("doesn't open on an arrow that goes with a card deleted just before, or that the details took away", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("place-order")!);
    file.hold = true;
    await click(button(d.host, "Delete card"));
    await d.rightClick(d.edge("place-order->order-placed")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    expect(await cards(d)).toEqual(["order-placed", "take-payment"]);

    const again = new SlowHost("shop.openarch", serializeDocument(doc));
    const gone = await designer(doc, again);
    await click(gone.node("order-placed")!);
    again.hold = true;
    await click(button(gone.host, "Remove arrow"));
    await gone.rightClick(gone.edge("place-order->order-placed")!);
    again.release();
    await gone.settle();
    expect(gone.menuOpen()).toBe(false);
    expect((await gone.saved()).cards.map((c) => c.from)).toEqual([[], [], ["order-placed"]]);
    // The other arrow is still there to open a menu on.
    await gone.rightClick(gone.edge("order-placed->take-payment")!);
    expect(gone.labels()).toEqual(["Delete arrow"]);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Taking an order");
    await d.rightClick(d.node("order-placed")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Eventcard 2 of 3");
    await d.pick("Delete card");
    expect(await cards(d, "taking-an-order")).toEqual(["place-order", "take-payment"]);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await d.rightClick(d.node("order-placed")!);
    await d.pick("Move earlier");
    await d.rightClick(d.node("order-placed")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    // And with a Redo on its way.
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("order-placed")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
