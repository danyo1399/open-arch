import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, cardArrows, checkWorkspace, computeView, describeElement, exportDocs, OpError, parseDocument, parseOperations, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with an event view of an order being placed and paid for. */
function ordering(): OpenArchDocument {
  const doc = shop();
  doc.views.ordering = {
    title: "Ordering",
    level: "event",
    lanes: [
      { id: "customer", name: "Customer" },
      { id: "shop", name: "Shop", description: "Everything the shop's own software does." },
    ],
    cards: [
      { id: "place-order", kind: "command", name: "Place order", lane: "customer" },
      { id: "order-placed", kind: "event", name: "Order placed", description: "The order is saved, unpaid.", lane: "shop", from: ["place-order"] },
      { id: "pay-when-placed", kind: "policy", name: "Whenever an order is placed, take payment", lane: "shop", from: ["order-placed"] },
      { id: "declined", kind: "hotspot", name: "What if the card is declined?" },
      { id: "order-status", kind: "read-model", name: "Order status", lane: "customer", from: ["order-placed", "pay-when-placed"] },
    ],
  };
  return doc;
}

const view = (doc: OpenArchDocument, id = "ordering") => {
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

describe("event views", () => {
  it("are read and written, with their lanes from the top down and their cards in order", () => {
    const text = serializeDocument(ordering());
    expect(text).toContain(`    "ordering": {
      "title": "Ordering",
      "level": "event",
      "lanes": [
        { "id": "customer", "name": "Customer" },
        { "id": "shop", "name": "Shop", "description": "Everything the shop's own software does." }
      ],
      "cards": [
        { "id": "place-order", "kind": "command", "name": "Place order", "lane": "customer" },
        { "id": "order-placed", "kind": "event", "name": "Order placed", "description": "The order is saved, unpaid.", "lane": "shop", "from": ["place-order"] },`);
    expect(text).toContain(`        { "id": "declined", "kind": "hotspot", "name": "What if the card is declined?" },`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.ordering).toEqual(ordering().views.ordering);
    expect(rules(ordering())).toEqual([]);
  });

  it("are written with empty lists when they have no lanes or cards yet", () => {
    const doc = apply(shop(), { op: "add-view", id: "refunds", level: "event" });
    expect(doc.views.refunds).toEqual({ title: "Refunds", level: "event", lanes: [], cards: [] });
    expect(serializeDocument(doc)).toContain(`    "refunds": {\n      "title": "Refunds",\n      "level": "event",\n      "lanes": [],\n      "cards": []\n    },`);
  });

  it("are new in version 11: a version 10 file is read as it is, and an event view in it too", () => {
    const parsed = parseDocument(JSON.stringify({ ...ordering(), openarch: 10 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(ordering());
  });

  it("refuse fields of other views, and report malformed lanes and cards", () => {
    const doc = {
      ...shop(),
      views: {
        v: {
          title: "V",
          level: "event",
          scope: "shop",
          include: ["*"],
          layout: {},
          steps: [],
          lanes: [{ id: "Bad", name: "B" }, { name: "No ID" }, { id: "ok", name: "OK", colour: "red" }, { id: "ok", name: "Again" }, "x"],
          cards: [
            { id: "a", kind: "event", name: "A", lane: 3, from: "b" },
            { id: "b", kind: "note", name: "B" },
            { id: "c", name: "C" },
            { kind: "event", name: "No ID" },
            { id: "a", kind: "command", name: "Again" },
            { id: "d", kind: "command" },
          ],
        },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.valid).toBe(false);
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.v.scope",
      "field-not-allowed views.v.include",
      "field-not-allowed views.v.layout",
      "field-not-allowed views.v.steps",
      "id-format views.v.lanes[0].id",
      "field-required views.v.lanes[1].id",
      "field-unknown views.v.lanes[2].colour",
      "id-duplicate views.v.lanes[3].id",
      "field-type views.v.lanes[4]",
      "field-type views.v.cards[0].lane",
      "field-type views.v.cards[0].from",
      "card-kind-invalid views.v.cards[1].kind",
      "field-required views.v.cards[2].kind",
      "field-required views.v.cards[3].id",
      "id-duplicate views.v.cards[4].id",
      "field-required views.v.cards[5].name",
    ]);
    // What's malformed is left out, and the first of two with one ID is kept.
    expect(parsed.doc.views.v).toEqual({ title: "V", level: "event", lanes: [{ id: "ok", name: "OK" }], cards: [{ id: "a", kind: "event", name: "A" }, { id: "d", kind: "command", name: "d" }] });
    expect(parsed.diagnostics.find((d) => d.path === "views.v.scope")!.message).toBe("Event views don't take `scope`: they show their cards in order, each in its lane.");
    const other = parseDocument(JSON.stringify({ ...shop(), views: { v: { title: "V", level: "landscape", lanes: [], cards: [] } } }));
    expect(other.diagnostics.map((d) => [d.path, d.message])).toEqual([
      ["views.v.lanes", "Only event views have `lanes`."],
      ["views.v.cards", "Only event views have `cards`."],
    ]);
  });

  it("are checked: a card's lane is a lane of the view, and it comes from other cards of the view", () => {
    const doc = ordering();
    const cards = doc.views.ordering!.cards!;
    cards[0]!.lane = "custmer";
    cards[1]!.from = ["place-order", "place-order", "order-placed", "order-plcaed"];
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => `${d.severity} ${d.rule} ${d.path} ${d.fix ?? ""}`)).toEqual([
      'error card-lane-unknown views.ordering.cards[0].lane Did you mean "customer"?',
      'error card-from-self views.ordering.cards[1].from[2] Remove "order-placed" from `from`.',
      'error card-from-unknown views.ordering.cards[1].from[3] Did you mean "order-placed"?',
    ]);
    // The view is still drawn, without the arrows that lead nowhere.
    const ws = buildWorkspace(doc);
    expect(cardArrows(ws.views.get("ordering")!).filter((a) => a.to === "order-placed")).toEqual([{ from: "place-order", to: "order-placed" }]);
  });

  it("take no scope, and draw no boxes of the model", () => {
    expect(fails(shop(), { op: "add-view", id: "x", level: "event", scope: "shop" })).toBe("Event views show their lanes and cards, so they don't take a `scope`. Remove `scope`.");
    const cv = view(ordering());
    expect(cv.nodes).toEqual([]);
    expect(cv.edges).toEqual([]);
    const ws = buildWorkspace(ordering());
    expect(describeElement(ws, "shop")!.views.map((v) => v.view.id)).not.toContain("ordering");
  });

  it("draw an arrow to each card from each card it comes from, in the order of the cards", () => {
    const ws = buildWorkspace(ordering());
    expect(cardArrows(ws.views.get("ordering")!)).toEqual([
      { from: "place-order", to: "order-placed" },
      { from: "order-placed", to: "pay-when-placed" },
      { from: "order-placed", to: "order-status" },
      { from: "pay-when-placed", to: "order-status" },
    ]);
  });

  it("show in Mermaid as a flowchart from left to right, with a frame for each lane and each card in its kind's colour", () => {
    expect(renderMermaid(view(ordering()))).toBe(
      [
        "flowchart LR",
        '  declined["What if the card is declined?<br/>[Hotspot]"]',
        '  subgraph lane__customer["Customer"]',
        "    direction LR",
        '    place_order["Place order<br/>[Command]"]',
        '    order_status["Order status<br/>[Read model]"]',
        "  end",
        '  subgraph lane__shop["Shop"]',
        "    direction LR",
        '    order_placed["Order placed<br/>[Event]"]',
        '    pay_when_placed["Whenever an order is placed, take payment<br/>[Policy]"]',
        "  end",
        "  place_order --> order_placed",
        "  order_placed --> pay_when_placed",
        "  order_placed --> order_status",
        "  pay_when_placed --> order_status",
        // Cards no arrow joins to the one before are kept in their order by a link that isn't drawn.
        "  pay_when_placed ~~~ declined",
        "  declined ~~~ order_status",
        "  classDef eventCard fill:#ffb74d,stroke:#b26a00,color:#000000",
        "  class order_placed eventCard",
        "  classDef commandCard fill:#90caf9,stroke:#3f7cac,color:#000000",
        "  class place_order commandCard",
        "  classDef policyCard fill:#ce93d8,stroke:#8a4f95,color:#000000",
        "  class pay_when_placed policyCard",
        "  classDef readModelCard fill:#a5d6a7,stroke:#55895a,color:#000000",
        "  class order_status readModelCard",
        "  classDef hotspotCard fill:#ef9a9a,stroke:#a85454,color:#000000",
        "  class declined hotspotCard",
        "  style lane__customer fill:none,stroke:#8a94a6",
        "  style lane__shop fill:none,stroke:#8a94a6",
      ].join("\n"),
    );
  });

  it("escape what Mermaid reads as markup, and keywords used as IDs, and say so when there are no cards", () => {
    const doc = apply(shop(), { op: "add-view", id: "ordering", level: "event" });
    expect(renderMermaid(view(doc))).toBe("flowchart LR\n  %% This view has no cards yet.");
    const lane = apply(doc, { op: "add-lane", view: "ordering", id: "end", name: 'The "end"' }, { op: "add-card", view: "ordering", id: "end", name: "Order <done> | paid", lane: "end" });
    const text = renderMermaid(view(lane));
    expect(text).toContain('  subgraph lane__end["The #quot;end#quot;"]');
    expect(text).toContain('    end_["Order #lt;done#gt; #124; paid<br/>[Event]"]');
    expect(text).toContain("  class end_ eventCard");
  });

  it("are documented with tables of their lanes and cards", () => {
    const page = exportDocs(buildWorkspace(ordering()), "shop.openarch").find((f) => f.path === "views/ordering.md")!.content;
    expect(page).toContain("\nEvent view.\n");
    expect(page).toContain("## Lanes\n\n| Lane | Description |\n|---|---|\n| Customer |  |\n| Shop | Everything the shop's own software does. |");
    expect(page).toContain("## Cards\n\n| # | Card | Kind | Lane | Comes from | Description |\n|---|---|---|---|---|---|\n| 1 | Place order | Command | Customer |  |  |\n| 2 | Order placed | Event | Shop | Place order | The order is saved, unpaid. |");
    expect(page).toContain("| 4 | What if the card is declined? | Hotspot |  |  |  |\n| 5 | Order status | Read model | Customer | Order placed, Whenever an order is placed, take payment |  |");
    expect(page).not.toContain("## Elements");
    const empty = exportDocs(buildWorkspace(apply(shop(), { op: "add-view", id: "refunds", level: "event" })), "shop.openarch").find((f) => f.path === "views/refunds.md")!.content;
    expect(empty).toContain("## Cards\n\nNone yet.");
    expect(empty).not.toContain("## Lanes");
  });
});

describe("event operations", () => {
  const base = () => apply(shop(), { op: "add-view", id: "ordering", level: "event" });
  const lanes = (doc: OpenArchDocument) => doc.views.ordering!.lanes!.map((l) => l.id);
  const cards = (doc: OpenArchDocument) => doc.views.ordering!.cards!.map((c) => c.id);

  it("add, change, move, rename and remove lanes, and their cards follow", () => {
    let doc = apply(base(), { op: "add-lane", view: "ordering", id: "shop" }, { op: "add-lane", view: "ordering", id: "customer", name: " Customers ", description: "People who buy.", position: 1 });
    expect(doc.views.ordering!.lanes).toEqual([{ id: "customer", name: "Customers", description: "People who buy." }, { id: "shop", name: "Shop" }]);
    doc = apply(doc, { op: "add-card", view: "ordering", id: "place-order", kind: "command", lane: "customer" });
    const moved = applyOperations(doc, [{ op: "update-lane", view: "ordering", id: "customer", position: 2 }]);
    expect(moved.summary).toEqual(["moved lane customer to lane 2 in view ordering"]);
    expect(lanes(moved.doc)).toEqual(["shop", "customer"]);
    const renamed = applyOperations(doc, [{ op: "update-lane", view: "ordering", id: "customer", newId: "buyer", name: "Buyer", description: null, position: 2 }]);
    expect(renamed.summary).toEqual(["renamed lane customer to buyer in view ordering, and moved it to lane 2"]);
    expect(renamed.doc.views.ordering!.lanes).toEqual([{ id: "shop", name: "Shop" }, { id: "buyer", name: "Buyer" }]);
    expect(renamed.doc.views.ordering!.cards![0]!.lane).toBe("buyer");
    const removed = applyOperations(doc, [{ op: "remove-lane", view: "ordering", id: "customer" }]);
    expect(removed.summary).toEqual(["removed lane customer from view ordering, leaving 1 card in no lane"]);
    expect(removed.doc.views.ordering!.cards).toEqual([{ id: "place-order", kind: "command", name: "Place Order" }]);
    expect(applyOperations(doc, [{ op: "remove-lane", view: "ordering", id: "shop" }]).summary).toEqual(["removed lane shop from view ordering"]);
  });

  it("add cards, an event unless they say, at the end or at a position", () => {
    let doc = apply(base(), { op: "add-lane", view: "ordering", id: "shop" });
    const added = applyOperations(doc, [
      { op: "add-card", view: "ordering", id: "order-placed", lane: "shop", description: " Saved. " },
      { op: "add-card", view: "ordering", id: "place-order", kind: "command", name: "Place order", position: 1 },
      { op: "add-card", view: "ordering", id: "order-paid", from: ["order-placed", " order-placed ", ""] },
    ]);
    expect(added.summary).toEqual(["added event order-placed to view ordering", "added command place-order to view ordering, as card 1", "added event order-paid to view ordering"]);
    doc = added.doc;
    expect(doc.views.ordering!.cards).toEqual([
      { id: "place-order", kind: "command", name: "Place order" },
      { id: "order-placed", kind: "event", name: "Order Placed", description: "Saved.", lane: "shop" },
      { id: "order-paid", kind: "event", name: "Order Paid", from: ["order-placed"] },
    ]);
  });

  it("change, move, rename and remove cards, and the arrows follow", () => {
    let doc = apply(
      base(),
      { op: "add-lane", view: "ordering", id: "shop" },
      { op: "add-card", view: "ordering", id: "a", kind: "command" },
      { op: "add-card", view: "ordering", id: "b", from: ["a"], lane: "shop", description: "First." },
      { op: "add-card", view: "ordering", id: "c", from: ["a", "b"] },
    );
    doc = apply(doc, { op: "update-card", view: "ordering", id: "b", kind: "policy", name: "Bee", description: null, lane: null });
    expect(doc.views.ordering!.cards![1]).toEqual({ id: "b", kind: "policy", name: "Bee", from: ["a"] });
    const moved = applyOperations(doc, [{ op: "update-card", view: "ordering", id: "c", position: 1 }]);
    expect(moved.summary).toEqual(["moved card c to card 1 in view ordering"]);
    expect(cards(moved.doc)).toEqual(["c", "a", "b"]);
    // Where it already is, it doesn't move.
    expect(applyOperations(doc, [{ op: "update-card", view: "ordering", id: "c", position: 3 }]).summary).toEqual(["updated card c in view ordering"]);
    const renamed = applyOperations(doc, [{ op: "update-card", view: "ordering", id: "a", newId: "start", lane: "shop", position: 2 }]);
    expect(renamed.summary).toEqual(["renamed card a to start in view ordering, and moved it to card 2"]);
    expect(renamed.doc.views.ordering!.cards).toEqual([
      { id: "b", kind: "policy", name: "Bee", from: ["start"] },
      { id: "start", kind: "command", name: "A", lane: "shop" },
      { id: "c", kind: "event", name: "C", from: ["start", "b"] },
    ]);
    doc = apply(doc, { op: "update-card", view: "ordering", id: "c", from: ["b"] });
    expect(doc.views.ordering!.cards![2]!.from).toEqual(["b"]);
    expect(apply(doc, { op: "update-card", view: "ordering", id: "c", from: null }).views.ordering!.cards![2]).toEqual({ id: "c", kind: "event", name: "C" });
    const removed = applyOperations(doc, [{ op: "remove-card", view: "ordering", id: "b" }]);
    expect(removed.summary).toEqual(["removed card b from view ordering and 2 arrows to or from it"]);
    expect(removed.doc.views.ordering!.cards).toEqual([{ id: "a", kind: "command", name: "A" }, { id: "c", kind: "event", name: "C" }]);
    expect(applyOperations(removed.doc, [{ op: "remove-card", view: "ordering", id: "c" }]).summary).toEqual(["removed card c from view ordering"]);
  });

  it("refuse what doesn't fit", () => {
    const doc = apply(base(), { op: "add-lane", view: "ordering", id: "shop" }, { op: "add-card", view: "ordering", id: "a" });
    expect(fails(doc, { op: "add-lane", view: "ordering", id: "shop" })).toBe('View "ordering" already has a lane "shop".');
    expect(fails(doc, { op: "add-lane", view: "ordering", id: "Bad" })).toMatch(/isn't a valid ID/);
    expect(fails(doc, { op: "add-lane", view: "ordering", id: "x", position: 3 })).toBe('View "ordering" has 1 lane, so a new one\'s position can be 1 to 2.');
    expect(fails(doc, { op: "add-lane", view: "landscape", id: "x" })).toBe('View "landscape" is a landscape view. Only event views have lanes and cards.');
    expect(fails(doc, { op: "update-lane", view: "ordering", id: "shop" })).toBe('Say what to change on lane "shop": newId, name, description, position.');
    expect(fails(doc, { op: "update-lane", view: "ordering", id: "shop", position: 2 })).toBe('View "ordering" has 1 lane, so "position" must be 1 to 1.');
    expect(fails(doc, { op: "update-lane", view: "ordering", id: "shop", name: " " })).toBe("A lane's name can't be empty.");
    expect(fails(doc, { op: "remove-lane", view: "ordering", id: "shp" })).toBe('View "ordering" has no lane "shp". Did you mean "shop"?');
    expect(fails(doc, { op: "add-card", view: "ordering", id: "a" })).toBe('View "ordering" already has a card "a".');
    expect(fails(doc, { op: "add-card", view: "ordering", id: "b", kind: "comand" as never })).toBe('Unknown kind of card "comand". Did you mean "command"? Use one of: event, command, actor, policy, read-model, external-system, aggregate, hotspot.');
    expect(fails(doc, { op: "add-card", view: "ordering", id: "b", lane: "warehouse" })).toBe('View "ordering" has no lane "warehouse". Its lanes: shop.');
    expect(fails(doc, { op: "add-card", view: "ordering", id: "b", from: ["zzz"] })).toBe('View "ordering" has no card "zzz". Its cards: a.');
    expect(fails(doc, { op: "add-card", view: "ordering", id: "b", from: ["b"] })).toBe("A card can't come from itself.");
    expect(fails(doc, { op: "add-card", view: "ordering", id: "b", position: 3 })).toBe('View "ordering" has 1 card, so a new one\'s position can be 1 to 2.');
    expect(fails(doc, { op: "update-card", view: "ordering", id: "a" })).toBe('Say what to change on card "a": newId, kind, name, description, lane, from, position.');
    expect(fails(doc, { op: "update-card", view: "ordering", id: "a", from: ["a"] })).toBe("A card can't come from itself.");
    expect(fails(doc, { op: "update-card", view: "ordering", id: "a", newId: "Bad" })).toMatch(/isn't a valid ID/);
    expect(fails(apply(doc, { op: "add-card", view: "ordering", id: "b" }), { op: "update-card", view: "ordering", id: "a", newId: "b" })).toBe('View "ordering" already has a card "b".');
    expect(fails(base(), { op: "remove-card", view: "ordering", id: "a" })).toBe('View "ordering" has no card "a". Add one with add-card.');
    expect(fails(doc, { op: "show-in-view", view: "ordering", id: "shop" })).toMatch(/^An event view draws its cards, not elements/);
    expect(fails(doc, { op: "hide-in-view", view: "ordering", id: "shop" })).toMatch(/^An event view draws its cards, not elements/);
    expect(fails(doc, { op: "update-view", id: "ordering", include: ["*"] })).toMatch(/^An event view draws its cards, not elements/);
    expect(fails(doc, { op: "add-view", id: "x", level: "event", include: ["shop"] })).toMatch(/^An event view draws its cards, not elements/);
    expect(fails(doc, { op: "set-layout", view: "ordering", positions: {} })).toBe("An event view is laid out from its lanes and the order of its cards, so it has no box positions. Move a card with update-card.");
  });

  it("are checked when sent as JSON", () => {
    expect(parseOperations({ op: "update-card", view: "v", id: "a", lane: null, from: null })).toEqual([{ op: "update-card", view: "v", id: "a", lane: null, from: null }]);
    expect(() => parseOperations({ op: "add-card", view: "v", id: "a", position: 0 })).toThrow('add-card: "position" must be a number, 1 or more: 1 is the first.');
    expect(() => parseOperations({ op: "add-card", view: "v", id: "a", from: "b" })).toThrow('add-card: "from" must be a list of strings.');
    expect(() => parseOperations({ op: "add-lane", view: "v" })).toThrow('add-lane needs "id".');
  });

  it("leave an event view alone when elements are renamed or removed, and keep its sticky notes", () => {
    const doc = apply(ordering(), { op: "add-sticky", view: "ordering", id: "note", text: "Read left to right." });
    expect(apply(doc, { op: "rename", id: "shop", to: "store" }).views.ordering).toEqual(doc.views.ordering);
    expect(apply(doc, { op: "remove-element", id: "shop" }).views.ordering).toEqual(doc.views.ordering);
    expect(apply(doc, { op: "rename", id: "ordering", to: "orders" }).views.orders).toEqual(doc.views.ordering);
  });
});
