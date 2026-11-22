import { computeView, loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { askContext, selectedThings } from "../src/ai/context.js";
import type { Selection } from "../src/canvas/Canvas.js";

const shop: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Browses" }, { to: "shop", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
  },
  views: { context: { title: "Shop context", level: "context", scope: "shop" } },
};

const ws = loadWorkspace(serializeDocument(shop));
const view = ws.views.get("context")!;
const computed = computeView(ws, view);
const said = (selection: Selection) => selectedThings(ws, computed, selection);

describe("what Ask AI is told of where the person is", () => {
  it("names each kind of thing that can be selected as the operations name it", () => {
    expect(said(null)).toEqual([]);
    expect(said({ kind: "element", id: "shop" })).toEqual(["`shop`"]);
    expect(said({ kind: "several", elements: ["shop", "customer"], stickies: ["n1"] })).toEqual(["`shop`", "`customer`", "the sticky note `n1`"]);
    expect(said({ kind: "sticky", id: "n1" })).toEqual(["the sticky note `n1`"]);
    expect(said({ kind: "step", number: 3 })).toEqual(["step 3"]);
    expect(said({ kind: "state", id: "paid" })).toEqual(["the state `paid`"]);
    expect(said({ kind: "transition", number: 2 })).toEqual(["transition 2"]);
    expect(said({ kind: "node", id: "aws" })).toEqual(["the node `aws`"]);
    expect(said({ kind: "connection", number: 1 })).toEqual(["connection 1"]);
    expect(said({ kind: "instance", node: "aws", element: "shop" })).toEqual(["`shop` running in the node `aws`"]);
    expect(said({ kind: "lane", id: "ops" })).toEqual(["the lane `ops`"]);
    expect(said({ kind: "card", id: "placed" })).toEqual(["the card `placed`"]);
    expect(said({ kind: "cardArrow", from: "place", to: "placed" })).toEqual(["the arrow from the card `place` to the card `placed`"]);
    expect(said({ kind: "screen", id: "home" })).toEqual(["the screen `home`"]);
    expect(said({ kind: "widget", id: "buy" })).toEqual(["the widget `buy`"]);
    expect(said({ kind: "shape", id: "s1" })).toEqual(["the shape `s1`"]);
    expect(said({ kind: "boardArrow", id: "a1" })).toEqual(["the arrow `a1`"]);
    expect(said({ kind: "board", shapes: ["s1", "s2"], arrows: ["a1"], stickies: ["n1"] })).toEqual(["the shape `s1`", "the shape `s2`", "the arrow `a1`", "the sticky note `n1`"]);
    expect(said({ kind: "block", id: "start" })).toEqual(["the block `start`"]);
    expect(said({ kind: "flow", number: 4 })).toEqual(["flow 4"]);
    expect(said({ kind: "entity", id: "order" })).toEqual(["the entity `order`"]);
    expect(said({ kind: "attribute", entity: "order", name: "total" })).toEqual(["the attribute `total` of the entity `order`"]);
    expect(said({ kind: "link", number: 1 })).toEqual(["link 1"]);
    expect(said({ kind: "workspace" })).toEqual(["the workspace"]);
  });

  it("names the relationships an arrow draws, rather than its ends, with the index of each after the first between them", () => {
    expect(said({ kind: "arrow", from: "customer", to: "shop" })).toEqual(["the relationship from `customer` to `shop`", "the relationship from `customer` to `shop` (index 1)"]);
    // An arrow the view no longer draws is named by its ends.
    expect(said({ kind: "arrow", from: "shop", to: "customer" })).toEqual(["the arrow from `shop` to `customer`"]);
  });

  it("gives the open view's ID, title and level, and says the same to the person, without backticks", () => {
    expect(askContext(ws, view, computed, { kind: "several", elements: ["shop"], stickies: ["n1"] })).toEqual({
      context: { viewId: "context", viewTitle: "Shop context", viewLevel: "context", selection: ["`shop`", "the sticky note `n1`"] },
      label: "In “Shop context” · shop, the sticky note n1 selected",
    });
    expect(askContext(ws, null, null, null)).toEqual({ context: { selection: [] }, label: "No view open" });
  });
});
