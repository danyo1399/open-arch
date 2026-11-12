// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { EventDiagram } from "../src/canvas/EventDiagram.js";
import type { Edit } from "../src/state.js";
import { button, click, mount } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 11,
  name: "Shop",
  elements: {},
  views: {
    ordering: {
      title: "Ordering",
      description: "From the order to the payment.",
      level: "event",
      lanes: [
        { id: "customer", name: "Customer" },
        { id: "shop", name: "Shop" },
      ],
      cards: [
        { id: "place-order", kind: "command", name: "Place order", lane: "customer" },
        { id: "order-placed", kind: "event", name: "Order placed", description: "Saved, unpaid.", lane: "shop", from: ["place-order"] },
      ],
      stickies: { note: { text: "Read it left to right." } },
    },
  },
};

/** The diagram of the event view. It keeps the edits it sends, and what it selects. */
async function diagram(model: OpenArchDocument = shop, selection: Selection = null) {
  const ws = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: { selection: Selection; isNew?: boolean }[] = [];
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(EventDiagram, {
        computed: computeView(ws, ws.views.get("ordering")!),
        selection,
        onSelect: (s: Selection, options?: { isNew?: boolean }) => void selected.push({ selection: s, ...options }),
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return true;
        },
        exportItems: [],
      }),
    ),
  );
  // The lanes and cards are drawn an effect later.
  await act(async () => {});
  return { host, edits, selected };
  // React Flow draws arrows only once it has measured the cards, which this page can't do, so
  // arrows and dragging are checked in the browser.
}

describe("EventDiagram", () => {
  it("draws each lane with its name, and each card with its kind, name and description, in its kind's colour", async () => {
    const { host } = await diagram();
    expect([...host.querySelectorAll(".event-lane-name")].map((n) => n.textContent)).toEqual(["Customer", "Shop"]);
    expect([...host.querySelectorAll(".event-card")].map((n) => n.textContent)).toEqual(["CommandPlace order", "EventOrder placedSaved, unpaid."]);
    expect(host.querySelector('.react-flow__node[data-id="place-order"] .event-card')!.classList.contains("event-card-command")).toBe(true);
    expect(host.querySelector('.react-flow__node[data-id="order-placed"] .event-card')!.classList.contains("event-card-event")).toBe(true);
    expect(host.querySelector(".sticky-text")!.textContent).toBe("Read it left to right.");
    expect(host.textContent).toContain("event view");
    expect(host.textContent).toContain("From the order to the payment.");
    expect(host.querySelector(".empty-hint")).toBeNull();
  });

  it("marks the lane and the card that are selected", async () => {
    const lane = await diagram(shop, { kind: "lane", id: "shop" });
    expect([...lane.host.querySelectorAll(".event-lane.selected")].map((n) => n.textContent)).toEqual(["Shop"]);
    const card = await diagram(shop, { kind: "card", id: "place-order" });
    expect([...card.host.querySelectorAll(".event-card.selected")].map((n) => n.textContent)).toEqual(["CommandPlace order"]);
  });

  it("draws a row above the lanes for cards in no lane, and no rows at all when there are no lanes", async () => {
    const loose = structuredClone(shop);
    delete loose.views.ordering!.cards![0]!.lane;
    const { host } = await diagram(loose);
    expect([...host.querySelectorAll(".event-lane-name")].map((n) => n.textContent)).toEqual(["No lane", "Customer", "Shop"]);
    expect(host.querySelector(".event-lane.loose")).not.toBeNull();
    const storm = structuredClone(shop);
    storm.views.ordering!.lanes = [];
    storm.views.ordering!.cards = [{ id: "a", kind: "event", name: "A" }];
    expect((await diagram(storm)).host.querySelectorAll(".event-lane")).toHaveLength(0);
  });

  it("adds a card of each kind, a lane or a note from + Add, and selects a new card or lane to name it", async () => {
    const { host, edits, selected } = await diagram(shop, { kind: "card", id: "place-order" });
    // The menu opens over the page, not inside the diagram.
    const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === text)!;
    await click(button(host, "+ Add"));
    expect([...document.querySelectorAll('.context-menu [role="menuitem"]')].map((b) => b.textContent)).toEqual(["Event", "Command", "Actor", "Policy", "Read model", "External system", "Aggregate", "Hotspot", "Lane", "Sticky note"]);
    await click(item("Policy"));
    await click(button(host, "+ Add"));
    await click(item("Lane"));
    expect(edits).toEqual([
      [{ op: "add-card", view: "ordering", id: "new-policy", kind: "policy", name: "New policy", lane: "customer", position: 2 }],
      [{ op: "add-lane", view: "ordering", id: "new-lane", name: "New lane" }],
    ]);
    expect(selected).toEqual([
      { selection: { kind: "card", id: "new-policy" }, isNew: true },
      { selection: { kind: "lane", id: "new-lane" }, isNew: true },
    ]);
  });

  it("says how to start when there's nothing in it", async () => {
    const empty = structuredClone(shop);
    empty.views.ordering = { title: "Ordering", level: "event", lanes: [], cards: [] };
    const { host } = await diagram(empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This view has no cards yet.");
  });
});
