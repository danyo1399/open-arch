// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { addCardOp, cardConnectOps } from "../src/canvas/EventDiagram.js";
import { dropOps, dropSpot, eventLayout, EVT } from "../src/canvas/eventLayout.js";
import { followRenames, shownInProperties, uniqueAmong, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { button, choose, click, mount, select, type } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 11,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, customer: { kind: "person", name: "Customer" } },
  views: {
    ordering: {
      title: "Ordering",
      level: "event",
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "shop", name: "Shop", description: "The shop's own software." },
      ],
      cards: [
        { id: "place-order", kind: "command", name: "Place order", lane: "customer" },
        { id: "order-placed", kind: "event", name: "Order placed", lane: "shop", from: ["place-order"] },
        { id: "order-status", kind: "read-model", name: "Order status", description: "Where the order is.", lane: "customer", from: ["order-placed"] },
      ],
    },
    storm: { title: "Storm", level: "event", lanes: [], cards: [{ id: "a", kind: "event", name: "A" }] },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("ordering")!;
const card = (id: string) => view.cards.find((c) => c.id === id)!;
/** The view with these changes made to its document. */
const changed = (change: (v: NonNullable<OpenArchDocument["views"][string]>) => void) => {
  const copy = structuredClone(doc);
  change(copy.views.ordering!);
  return buildWorkspace(copy).views.get("ordering")!;
};

/** The details panel for the event view, showing what's selected, keeping the edits it sends and what it selects. */
function panel(selection: Selection, isNew = false) {
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection,
    isNew,
    syncsDocs: false,
    docs: null,
    fileName: "shop.openarch",
    edit: async (e: Edit) => {
      edits.push(typeof e === "function" ? e(ws) : e);
      return true;
    },
    onSelect: (s: Selection) => void selected.push(s),
    onHide() {},
    onDelete() {},
    onFindUsages() {},
    onDeleteView() {},
  });
  return { host: mount(element), edits, selected };
}

describe("an event view in the designer", () => {
  it("shows a selected lane, card or arrow in the details, while it's there", () => {
    expect(shownInProperties(ws, view, { kind: "lane", id: "shop" })).toMatchObject({ kind: "lane", lane: { id: "shop", number: 2 } });
    expect(shownInProperties(ws, view, { kind: "card", id: "order-placed" })).toMatchObject({ kind: "card", card: { id: "order-placed", kind: "event" } });
    expect(shownInProperties(ws, view, { kind: "cardArrow", from: "place-order", to: "order-placed" })).toMatchObject({ kind: "cardArrow", from: { id: "place-order" }, to: { id: "order-placed" } });
    expect(shownInProperties(ws, view, { kind: "cardArrow", from: "order-placed", to: "place-order" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "card", id: "gone" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "lane", id: "gone" })).toMatchObject({ kind: "view" });
  });

  it("has no boxes to show or hide", () => {
    expect(viewAction(ws, view, computeView(ws, view), "customer")).toBeNull();
  });

  it("makes new lane and card IDs that the view doesn't have yet", () => {
    const ids = view.cards.map((c) => c.id);
    expect(uniqueAmong(ids, "order-placed")).toBe("order-placed-2");
    expect(uniqueAmong(ids, "order-placed", "order-placed")).toBe("order-placed");
    expect(uniqueAmong(ids, "order-shipped")).toBe("order-shipped");
  });

  it("follows a renamed view in lane and card operations, and leaves their own IDs alone", () => {
    const renames = [{ op: "rename" as const, id: "ordering", to: "orders" }, { op: "rename" as const, id: "customer", to: "buyer" }];
    expect(followRenames([{ op: "update-card", view: "ordering", id: "place-order", lane: "customer", from: ["customer"] }], renames)).toEqual([
      { op: "update-card", view: "orders", id: "place-order", lane: "customer", from: ["customer"] },
    ]);
    expect(followRenames([{ op: "remove-lane", view: "ordering", id: "customer" }], renames)).toEqual([{ op: "remove-lane", view: "orders", id: "customer" }]);
  });
});

describe("an event view's layout", () => {
  it("gives each lane a row, from the top down, and each card a column, in order, in its lane's row", () => {
    const layout = eventLayout(view);
    expect(layout.rows.map((r) => [r.lane?.id, r.box.y])).toEqual([
      ["customer", 0],
      ["shop", EVT.row],
    ]);
    const boxes = [...layout.cards].map(([id, b]) => [id, b.x, b.y]);
    const [top, left] = [(EVT.row - EVT.cardHeight) / 2, EVT.headWidth + EVT.pad];
    expect(boxes).toEqual([
      ["place-order", left, top],
      ["order-placed", left + EVT.column, EVT.row + top],
      ["order-status", left + 2 * EVT.column, top],
    ]);
    expect(layout.rows.every((r) => r.box.w === layout.width)).toBe(true);
    expect(layout.width).toBeGreaterThanOrEqual(left + 2 * EVT.column + EVT.cardWidth);
    expect(layout.height).toBe(2 * EVT.row);
  });

  it("puts cards in no lane, or in one the view doesn't have, in a row of their own above the lanes", () => {
    const loose = changed((v) => {
      delete v.cards![0]!.lane;
      v.cards![1]!.lane = "warehouse";
    });
    const layout = eventLayout(loose);
    expect(layout.rows.map((r) => r.lane?.id)).toEqual([undefined, "customer", "shop"]);
    expect([...layout.cards.values()].map((b) => Math.floor(b.y / EVT.row))).toEqual([0, 0, 1]);
    // A view with no lanes has that row alone, and one with nothing keeps room to show.
    expect(eventLayout(ws.views.get("storm")!).rows.map((r) => r.lane)).toEqual([undefined]);
    const empty = eventLayout(changed((v) => void (v.cards = [])));
    expect(empty.rows).toHaveLength(2);
    expect(empty.width).toBeGreaterThan(EVT.headWidth);
  });

  it("moves a dropped card to the lane and the place along the timeline it was dropped at", () => {
    const layout = eventLayout(view);
    const middle = (column: number, row: number) => ({ x: EVT.headWidth + EVT.pad + column * EVT.column + EVT.cardWidth / 2, y: row * EVT.row + EVT.row / 2 });
    expect(dropSpot(view, layout, middle(1, 1))).toEqual({ lane: "shop", position: 2 });
    // Where it is already: nothing to do.
    expect(dropOps(view, layout, card("order-placed"), middle(1, 1))).toEqual([]);
    expect(dropOps(view, layout, card("order-placed"), middle(1, 0))).toEqual([{ op: "update-card", view: "ordering", id: "order-placed", lane: "customer" }]);
    expect(dropOps(view, layout, card("order-placed"), middle(0, 1))).toEqual([{ op: "update-card", view: "ordering", id: "order-placed", position: 1 }]);
    expect(dropOps(view, layout, card("place-order"), middle(2, 1))).toEqual([{ op: "update-card", view: "ordering", id: "place-order", lane: "shop", position: 3 }]);
    // Past the ends of the timeline is its first or last place, and above or below the rows the top or bottom one.
    expect(dropOps(view, layout, card("place-order"), { x: 99_999, y: 99_999 })).toEqual([{ op: "update-card", view: "ordering", id: "place-order", lane: "shop", position: 3 }]);
    expect(dropOps(view, layout, card("order-status"), { x: -500, y: -500 })).toEqual([{ op: "update-card", view: "ordering", id: "order-status", position: 1 }]);
  });

  it("takes a card dropped on the row above the lanes out of its lane", () => {
    const loose = changed((v) => void delete v.cards![0]!.lane);
    const layout = eventLayout(loose);
    const moved = loose.cards.find((c) => c.id === "order-placed")!;
    expect(dropOps(loose, layout, moved, { x: EVT.headWidth + EVT.pad + EVT.column + 10, y: 10 })).toEqual([{ op: "update-card", view: "ordering", id: "order-placed", lane: null }]);
  });
});

describe("an event view's edits", () => {
  it("draws an arrow by adding to what the card it goes to comes from, once, and never to itself", () => {
    expect(cardConnectOps(view, "place-order", "order-status")).toEqual([{ op: "update-card", view: "ordering", id: "order-status", from: ["order-placed", "place-order"] }]);
    expect(cardConnectOps(view, "place-order", "order-placed")).toEqual([]);
    expect(cardConnectOps(view, "place-order", "place-order")).toEqual([]);
    expect(cardConnectOps(view, "lane:shop", "place-order")).toEqual([]);
    expect(cardConnectOps(view, "place-order", "sticky:note")).toEqual([]);
  });

  it("adds a card after the selected one, in its lane, or in the selected lane, or at the end", () => {
    expect(addCardOp(view, "event", { kind: "card", id: "order-placed" })).toEqual({ op: "add-card", view: "ordering", id: "new-event", kind: "event", name: "New event", lane: "shop", position: 3 });
    expect(addCardOp(view, "read-model", { kind: "lane", id: "shop" })).toEqual({ op: "add-card", view: "ordering", id: "new-read-model", kind: "read-model", name: "New read model", lane: "shop" });
    // With nothing selected, it goes in the lane of the last card.
    expect(addCardOp(view, "hotspot", null)).toEqual({ op: "add-card", view: "ordering", id: "new-hotspot", kind: "hotspot", name: "New hotspot", lane: "customer" });
    expect(addCardOp(ws.views.get("storm")!, "command", null)).toEqual({ op: "add-card", view: "storm", id: "new-command", kind: "command", name: "New command" });
    const again = changed((v) => void v.cards!.push({ id: "new-event", kind: "event", name: "New event" }));
    expect(addCardOp(again, "event", null).id).toBe("new-event-2");
  });
});

describe("a card's details", () => {
  it("rename it, with its ID following the name, and select it under its new ID", async () => {
    const { host, edits, selected } = panel({ kind: "card", id: "place-order" });
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await type(name, "Buy now");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toEqual([[{ op: "update-card", view: "ordering", id: "place-order", name: "Buy now", newId: "buy-now" }]]);
    expect(selected).toEqual([{ kind: "card", id: "buy-now" }]);
  });

  it("change its kind and its lane, and move it along the timeline", async () => {
    const { host, edits } = panel({ kind: "card", id: "order-placed" });
    expect(host.textContent).toContain("card 2 of 3");
    expect(host.textContent).toContain("Something that happened, in the past tense");
    await choose(select(host, "Kind"), "policy");
    await choose(select(host, "Lane"), "");
    await choose(select(host, "Lane"), "customer");
    await click(button(host, "Move earlier"));
    await click(button(host, "Move later"));
    expect(edits).toEqual([
      [{ op: "update-card", view: "ordering", id: "order-placed", kind: "policy" }],
      [{ op: "update-card", view: "ordering", id: "order-placed", lane: null }],
      [{ op: "update-card", view: "ordering", id: "order-placed", lane: "customer" }],
      [{ op: "update-card", view: "ordering", id: "order-placed", position: 1 }],
      [{ op: "update-card", view: "ordering", id: "order-placed", position: 3 }],
    ]);
    // The first card can't go earlier, and the last no later.
    expect(button(panel({ kind: "card", id: "place-order" }).host, "Move earlier").disabled).toBe(true);
    expect(button(panel({ kind: "card", id: "order-status" }).host, "Move later").disabled).toBe(true);
  });

  it("list what it comes from and leads to, add an arrow from another card, and remove one", async () => {
    const { host, edits, selected } = panel({ kind: "card", id: "order-placed" });
    expect(host.textContent).toContain("← Place order");
    expect(host.textContent).toContain("→ Order status");
    const from = select(host, "Add an arrow from");
    // Not itself, and not the card it comes from already.
    expect([...from.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Choose a card…", "Order status [Read model]"]);
    await choose(from, "order-status");
    await click(button(host, "Remove arrow"));
    await click(button(host, "→ Order status"));
    expect(edits).toEqual([
      [{ op: "update-card", view: "ordering", id: "order-placed", from: ["place-order", "order-status"] }],
      [{ op: "update-card", view: "ordering", id: "order-placed", from: [] }],
    ]);
    expect(selected).toEqual([{ kind: "card", id: "order-status" }]);
  });

  it("delete it", async () => {
    const { host, edits, selected } = panel({ kind: "card", id: "order-placed" });
    await click(button(host, "Delete card"));
    expect(edits).toEqual([[{ op: "remove-card", view: "ordering", id: "order-placed" }]]);
    expect(selected).toEqual([null]);
  });
});

describe("a lane's details", () => {
  it("rename it, with its ID following the name, list its cards, move it and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "lane", id: "customer" });
    expect(host.textContent).toContain("Lane 1of 2");
    expect(host.textContent).toContain("Place order CommandOrder status Read model");
    expect(host.textContent).toContain("Deleting the lane keeps its cards, in no lane.");
    expect(button(host, "Move up").disabled).toBe(true);
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await type(name, "Buyer");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    await click(button(host, "Move down"));
    await click(button(host, "Order status"));
    await click(button(host, "Delete lane"));
    expect(edits).toEqual([
      [{ op: "update-lane", view: "ordering", id: "customer", name: "Buyer", newId: "buyer" }],
      [{ op: "update-lane", view: "ordering", id: "customer", position: 2 }],
      [{ op: "remove-lane", view: "ordering", id: "customer" }],
    ]);
    expect(selected).toEqual([{ kind: "lane", id: "buyer" }, { kind: "card", id: "order-status" }, null]);
  });
});

describe("an arrow between two cards' details", () => {
  it("name its ends, select either, and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "cardArrow", from: "order-placed", to: "order-status" });
    expect(host.textContent).toContain("Order placed → Order status");
    expect(host.textContent).toContain("Order status comes from Order placed.");
    await click(button(host, "Order placed"));
    await click(button(host, "Delete arrow"));
    expect(edits).toEqual([[{ op: "update-card", view: "ordering", id: "order-status", from: [] }]]);
    expect(selected).toEqual([{ kind: "card", id: "order-placed" }, null]);
  });
});

describe("the event view's own details", () => {
  it("count its lanes and cards, and say how to change it", () => {
    const { host } = panel(null);
    expect(host.querySelector(".facts")!.textContent).toBe("LeveleventLanes2Cards3");
    expect(host.textContent).toContain("An event view shows what happens in a business process");
    // It has no boxes from the model, so nothing to say about new elements.
    expect(host.textContent).not.toContain("New elements");
  });
});

describe("the New view dialog", () => {
  it("makes an event view once it has a title", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "event");
    expect(host.textContent).toContain("An event view shows what happens in a business process, as event storming does");
    expect(button(host, "Create view").disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("input")!, "Returning an order");
    await click(button(host, "Create view"));
    expect(created).toEqual([{ op: "add-view", id: "returning-an-order", level: "event", scope: undefined, title: "Returning an order" }]);
  });
});
