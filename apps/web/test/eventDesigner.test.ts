// @vitest-environment happy-dom
import { buildWorkspace, computeView, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Designer, detailsName } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, key, mount } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 11,
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
      ],
    },
  },
};

/** The whole designer, open on the workspace's event view, once it has loaded. */
async function designer() {
  const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  await settle();
  return {
    host,
    settle,
    cards: () => [...host.querySelectorAll(".event-card-name")].map((n) => n.textContent),
    lanes: () => [...host.querySelectorAll(".event-lane-name")].map((n) => n.textContent),
    /** What the details panel is headed with: the kind of thing it shows. */
    details: () => host.querySelector(".properties .props-header")?.textContent,
    node: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`)!,
  };
  // React Flow draws arrows only once it has measured the cards, which this page can't do, so
  // clicking an arrow, dragging a card and dragging a new arrow are checked in the browser. The
  // edits they send are tested in events.test.ts.
}

describe("the designer, on an event view", () => {
  it("shows a clicked card in the details, and Delete removes it, with the arrow to it", async () => {
    const d = await designer();
    expect(d.cards()).toEqual(["Place order", "Order placed"]);
    await click(d.node("place-order"));
    expect(d.details()).toBe("Commandcard 1 of 2");
    await key(document.body, "Delete");
    await d.settle();
    expect(d.cards()).toEqual(["Order placed"]);
    // Nothing is selected any more, so the details are the view's.
    expect(d.details()).toBe("View");
    // The card that came from it comes from nothing now.
    await click(d.node("order-placed"));
    expect(d.host.querySelector(".properties")!.textContent).toContain("Comes fromNothing yet.");
  });

  it("shows a clicked lane in the details, and Delete removes it, leaving its cards in no lane", async () => {
    const d = await designer();
    await click(d.node("lane:shop"));
    expect(d.details()).toBe("Lane 2of 2");
    await key(document.body, "Delete");
    await d.settle();
    expect(d.lanes()).toEqual(["No lane", "Customer"]);
    expect(d.cards()).toEqual(["Place order", "Order placed"]);
    expect(d.details()).toBe("View");
  });

  it("stops showing a card that Undo takes away again", async () => {
    const d = await designer();
    await click(button(d.host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Hotspot")!);
    await d.settle();
    expect(d.cards()).toEqual(["Place order", "Order placed", "New hotspot"]);
    expect(d.details()).toBe("Hotspotcard 3 of 3");
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.cards()).toEqual(["Place order", "Order placed"]);
    expect(d.details()).toBe("View");
  });

  it("names what the details show: a lane, a card, or an arrow by its two cards", () => {
    const ws = buildWorkspace(doc);
    const view = ws.views.get("ordering")!;
    const computed = computeView(ws, view);
    expect(detailsName(ws, view, computed, { kind: "lane", id: "shop" })).toBe("Shop");
    expect(detailsName(ws, view, computed, { kind: "card", id: "order-placed" })).toBe("Order placed");
    expect(detailsName(ws, view, computed, { kind: "cardArrow", from: "place-order", to: "order-placed" })).toBe("Place order → Order placed");
    expect(detailsName(ws, view, computed, { kind: "card", id: "gone" })).toBe("This view");
  });
});
