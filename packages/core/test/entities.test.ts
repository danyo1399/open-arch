import { describe, expect, it } from "vitest";
import {
  applyOperations,
  buildWorkspace,
  checkWorkspace,
  computeView,
  describeElement,
  exportDocs,
  OpError,
  parseDocument,
  parseOperations,
  renderMermaid,
  serializeDocument,
  type OpenArchDocument,
  type Operation,
} from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with an entity view of what its DB keeps: customers, their orders, each order's lines, and the products on them. */
function orders(): OpenArchDocument {
  const doc = shop();
  doc.views["orders-data"] = {
    title: "Orders data",
    level: "entity",
    scope: "db",
    entities: [
      {
        id: "customer",
        name: "Customer",
        description: "Someone who shops",
        attributes: [
          { name: "id", type: "uuid", keys: ["pk"] },
          { name: "email", type: "text", keys: ["uk"], description: "Where receipts go" },
          { name: "referred_by", type: "uuid", keys: ["fk"] },
        ],
        at: [0, 0],
      },
      {
        id: "order",
        name: "Order",
        attributes: [
          { name: "id", type: "uuid", keys: ["pk"] },
          { name: "customer_id", type: "uuid", keys: ["fk"] },
          { name: "placed_at", type: "timestamp" },
        ],
      },
      {
        id: "line",
        name: "Order line",
        attributes: [
          { name: "order_id", type: "uuid", keys: ["pk", "fk"] },
          { name: "product_id", type: "uuid", keys: ["pk", "fk"] },
          { name: "quantity", type: "int" },
        ],
      },
      { id: "product", name: "Product" },
    ],
    links: [
      { from: "customer", to: "order", text: "places" },
      { from: "order", to: "line", cardinality: ["one", "one-or-more"], text: "has" },
      { from: "product", to: "line", text: "is on" },
      { from: "customer", to: "customer", cardinality: ["zero-or-one", "zero-or-more"], text: "refers" },
    ],
  };
  return doc;
}

function fails(doc: OpenArchDocument, ...ops: Operation[]): string {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("expected the operations to be refused");
}

/** The shop with an empty entity view, "data", of nothing in particular. */
const base = () => apply(shop(), { op: "add-view", id: "data", level: "entity" });

const view = (doc: OpenArchDocument, id = "orders-data") => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

describe("entity views", () => {
  it("are read and written, with each entity's attributes and each link on a line of its own, in the file's order", () => {
    const text = serializeDocument(orders());
    expect(text).toContain(`    "orders-data": {
      "title": "Orders data",
      "level": "entity",
      "scope": "db",
      "entities": [
        {
          "id": "customer",
          "name": "Customer",
          "description": "Someone who shops",
          "attributes": [
            { "name": "id", "type": "uuid", "keys": ["pk"] },
            { "name": "email", "type": "text", "keys": ["uk"], "description": "Where receipts go" },
            { "name": "referred_by", "type": "uuid", "keys": ["fk"] }
          ],
          "at": [0, 0]
        },
        {
          "id": "order",
          "name": "Order",
          "attributes": [
            { "name": "id", "type": "uuid", "keys": ["pk"] },
            { "name": "customer_id", "type": "uuid", "keys": ["fk"] },
            { "name": "placed_at", "type": "timestamp" }
          ]
        },
        {
          "id": "line",
          "name": "Order line",
          "attributes": [
            { "name": "order_id", "type": "uuid", "keys": ["pk", "fk"] },
            { "name": "product_id", "type": "uuid", "keys": ["pk", "fk"] },
            { "name": "quantity", "type": "int" }
          ]
        },
        {
          "id": "product",
          "name": "Product",
          "attributes": []
        }
      ],
      "links": [
        { "from": "customer", "to": "order", "text": "places" },
        { "from": "order", "to": "line", "cardinality": ["one", "one-or-more"], "text": "has" },
        { "from": "product", "to": "line", "text": "is on" },
        { "from": "customer", "to": "customer", "cardinality": ["zero-or-one", "zero-or-more"], "text": "refers" }
      ]
    }`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    const expected = orders().views["orders-data"]!;
    expected.entities![3]!.attributes = [];
    expect(parsed.doc.views["orders-data"]).toEqual(expected);
    expect(rules(orders())).toEqual([]);
  });

  it("are written with empty lists when they have nothing yet, leave out the defaults, and write each key once, in order", () => {
    expect(serializeDocument(base())).toContain(`      "level": "entity",\n      "entities": [],\n      "links": []\n    }`);
    const doc = base();
    doc.views.data!.entities = [{ id: "a", name: "A", attributes: [{ name: "x", type: "", keys: ["uk", "pk", "uk"], description: "" }], at: [1.4, 2.6] }];
    doc.views.data!.links = [{ from: "a", to: "a", cardinality: ["one", "zero-or-more"], text: "" }];
    const text = serializeDocument(doc);
    expect(text).toContain('            { "name": "x", "keys": ["pk", "uk"] }\n          ],\n          "at": [1, 3]');
    expect(text).toContain('      "links": [\n        { "from": "a", "to": "a" }\n      ]');
  });

  it("are new in version 18: a version 17 file is read as it is", () => {
    const old = shop();
    const parsed = parseDocument(JSON.stringify({ ...old, openarch: 17 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual({ ...old, openarch: 18 });
  });

  it("refuse fields of other views, and report malformed entities, attributes and links", () => {
    const doc = {
      ...shop(),
      views: {
        d: {
          title: "D",
          level: "entity",
          include: ["*"],
          layout: {},
          blocks: [],
          entities: [
            { id: "ok", name: "OK", attributes: [{ name: "id" }, { name: "id", type: "int" }, { name: " " }, { name: "k", keys: ["pk", "primary"] }, { name: "t", type: 3 }, "x", { name: "w", width: 1 }] },
            { id: "ok", name: "Again" },
            { id: "Bad", name: "Bad" },
            { name: "No ID" },
            { id: "odd", name: "Odd", at: [1], attributes: {}, colour: "red" },
            { id: "blank", name: " " },
            "nope",
          ],
          links: [
            { from: "ok", to: "odd", text: 3 },
            { from: "ok" },
            { from: "ok", to: "odd", cardinality: ["one"] },
            { from: "ok", to: "odd", cardinality: ["one", "lots"] },
            { from: "ok", to: "odd", why: "?" },
            7,
          ],
        },
        other: { title: "Other", level: "flowchart", entities: [], links: [] },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.d.include",
      "field-not-allowed views.d.layout",
      "field-not-allowed views.d.blocks",
      "attribute-duplicate views.d.entities[0].attributes[1].name",
      "field-required views.d.entities[0].attributes[2].name",
      "attribute-key-invalid views.d.entities[0].attributes[3].keys",
      "field-type views.d.entities[0].attributes[4].type",
      "field-type views.d.entities[0].attributes[5]",
      "field-unknown views.d.entities[0].attributes[6].width",
      "id-duplicate views.d.entities[1].id",
      "id-format views.d.entities[2].id",
      "field-required views.d.entities[3].id",
      "field-unknown views.d.entities[4].colour",
      "field-type views.d.entities[4].attributes",
      "field-type views.d.entities[4].at",
      "field-required views.d.entities[5].name",
      "field-type views.d.entities[6]",
      "field-type views.d.links[0].text",
      "field-required views.d.links[1].to",
      "field-type views.d.links[2].cardinality",
      "cardinality-invalid views.d.links[3].cardinality",
      "field-unknown views.d.links[4].why",
      "field-type views.d.links[5]",
      "field-not-allowed views.other.entities",
      "field-not-allowed views.other.links",
    ]);
    expect(parsed.diagnostics.find((d) => d.path === "views.d.include")!.message).toBe("Entity views don't take `include`: they show their entities, each where its `at` puts it, or laid out automatically.");
    expect(parsed.diagnostics.find((d) => d.rule === "attribute-duplicate")!.message).toBe('"id" is the name of two attributes of the entity "ok".');
    expect(parsed.doc.views.d!.entities).toEqual([
      { id: "ok", name: "OK", attributes: [{ name: "id" }, { name: "k", keys: ["pk"] }, { name: "t" }, { name: "w" }] },
      { id: "odd", name: "Odd" },
      { id: "blank", name: "blank" },
    ]);
    expect(parsed.doc.views.d!.links).toEqual([
      { from: "ok", to: "odd" },
      { from: "ok", to: "odd" },
      { from: "ok", to: "odd" },
      { from: "ok", to: "odd" },
    ]);
    expect(parsed.valid).toBe(false);
  });

  it("know each entity's and attribute's place, each attribute's keys in order, and each link's number and cardinality", () => {
    const doc = orders();
    doc.views["orders-data"]!.entities![2]!.attributes![0]!.keys = ["fk", "pk"];
    const v = buildWorkspace(doc).views.get("orders-data")!;
    expect(v.entities.map((e) => [e.id, e.number, e.attributes.length])).toEqual([
      ["customer", 1, 3],
      ["order", 2, 3],
      ["line", 3, 3],
      ["product", 4, 0],
    ]);
    expect(v.entities[2]!.attributes[0]).toEqual({ path: "views.orders-data.entities[2].attributes[0]", number: 1, name: "order_id", type: "uuid", keys: ["pk", "fk"], description: undefined });
    expect(v.links.map((l) => [l.number, l.from, l.to, l.cardinality, l.text])).toEqual([
      [1, "customer", "order", ["one", "zero-or-more"], "places"],
      [2, "order", "line", ["one", "one-or-more"], "has"],
      [3, "product", "line", ["one", "zero-or-more"], "is on"],
      [4, "customer", "customer", ["zero-or-one", "zero-or-more"], "refers"],
    ]);
    expect(view(orders())).toMatchObject({ nodes: [], edges: [], diagnostics: [], boundary: { id: "db" } });
  });

  it("can be of a system, container, component or library, or of nothing in particular, and its element's page says so", () => {
    expect(view(base(), "data").boundary).toBeUndefined();
    for (const scope of ["shop", "db", "controller"]) expect(rules(apply(shop(), { op: "add-view", id: "d", level: "entity", scope }))).toEqual([]);
    expect(fails(shop(), { op: "add-view", id: "d", level: "entity", scope: "customer" })).toBe('An entity view\'s scope must be a system, container, component or library, but "customer" is a person.');
    expect(apply(shop(), { op: "add-view", id: "d", level: "entity", scope: "db" }).views.d!.title).toBe("DB entities");
    expect(base().views.data!.title).toBe("Data");
    expect(describeElement(buildWorkspace(orders()), "db")!.views.find((v) => v.view.id === "orders-data")!.as).toBe("data");
    const page = exportDocs(buildWorkspace(orders()), "shop.openarch").find((f) => f.path === "elements/db.md")!.content;
    expect(page).toContain("- [Orders data](../views/orders-data.md) (its data)");
    // Renaming the element keeps the view on it, and removing it removes the view.
    expect(apply(orders(), { op: "rename", id: "db", to: "orders-db" }).views["orders-data"]!.scope).toBe("orders-db");
    expect(apply(orders(), { op: "remove-element", id: "db" }).views["orders-data"]).toBeUndefined();
  });

  it("are checked: a link's ends are entities of the view", () => {
    const doc = orders();
    doc.views["orders-data"]!.links!.push({ from: "ordr", to: "line" }, { from: "order", to: "gone" });
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.severity, d.rule, d.path, d.message, d.fix])).toEqual([
      ["error", "link-unknown-entity", "views.orders-data.links[4].from", 'Link 5: "ordr" isn\'t an entity of this view.', 'Did you mean "order"?'],
      ["error", "link-unknown-entity", "views.orders-data.links[5].to", 'Link 6: "gone" isn\'t an entity of this view.', "Its entities: customer, order, line, product."],
    ]);
    const empty = base();
    empty.views.data!.links = [{ from: "a", to: "b" }];
    expect(checkWorkspace(buildWorkspace(empty)).map((d) => d.fix)).toEqual(["Add it with `open-arch add-entity data a`.", "Add it with `open-arch add-entity data b`."]);
  });

  it("show in Mermaid as an entity-relationship diagram, with each entity's attributes and each link's cardinality in crow's foot notation", () => {
    expect(renderMermaid(view(orders()))).toBe(
      [
        "erDiagram",
        '  customer["Customer"] {',
        "    uuid id PK",
        '    text email UK "Where receipts go"',
        "    uuid referred_by FK",
        "  }",
        '  order["Order"] {',
        "    uuid id PK",
        "    uuid customer_id FK",
        "    timestamp placed_at",
        "  }",
        '  line["Order line"] {',
        "    uuid order_id PK, FK",
        "    uuid product_id PK, FK",
        "    int quantity",
        "  }",
        '  product["Product"]',
        '  customer ||--o{ order : "places"',
        '  order ||--|{ line : "has"',
        '  product ||--o{ line : "is on"',
        '  customer |o--o{ customer : "refers"',
      ].join("\n"),
    );
    // Text is escaped; IDs and words Mermaid would misread are changed; and links to entities that aren't there are left out.
    const doc = apply(
      base(),
      { op: "add-entity", view: "data", id: "one", name: 'Say "hi" <b>' },
      { op: "add-entity", view: "data", id: "2fa", name: "Codes" },
      { op: "add-attribute", view: "data", entity: "one", name: "first name", description: "a\nb" },
      { op: "add-attribute", view: "data", entity: "one", name: "pk", type: "decimal(10,2)" },
      { op: "add-attribute", view: "data", entity: "one", name: "1st", type: "9" },
      { op: "add-link", view: "data", from: "one", to: "2fa", cardinality: ["one-or-more", "zero-or-one"] },
    );
    doc.views.data!.links!.push({ from: "one", to: "gone" });
    expect(renderMermaid(view(doc, "data"))).toBe(
      [
        "erDiagram",
        '  one_["Say #quot;hi#quot; #lt;b#gt;"] {',
        '    _ first_name "a b"',
        "    decimal(10_2) pk_",
        "    _9 _1st",
        "  }",
        '  _2fa["Codes"]',
        '  one_ }|--o| _2fa : ""',
      ].join("\n"),
    );
    expect(renderMermaid(view(base(), "data"))).toBe("erDiagram\n  %% This view has no entities yet.");
  });

  it("are documented with a table of each entity's attributes, and one of the links", () => {
    const page = exportDocs(buildWorkspace(orders()), "shop.openarch").find((f) => f.path === "views/orders-data.md")!.content;
    expect(page).toContain("# Orders data\n\nEntity view of [DB](../elements/db.md).\n\n```mermaid\nerDiagram\n");
    expect(page).toContain(
      [
        "## Entities",
        "",
        "### Customer",
        "",
        "Someone who shops",
        "",
        "| Attribute | Type | Key | Description |",
        "|---|---|---|---|",
        "| id | uuid | PK |  |",
        "| email | text | UK | Where receipts go |",
        "| referred_by | uuid | FK |  |",
        "",
        "### Order",
        "",
        "| Attribute | Type | Key | Description |",
        "|---|---|---|---|",
        "| id | uuid | PK |  |",
        "| customer_id | uuid | FK |  |",
        "| placed_at | timestamp |  |  |",
        "",
        "### Order line",
        "",
        "| Attribute | Type | Key | Description |",
        "|---|---|---|---|",
        "| order_id | uuid | PK, FK |  |",
        "| product_id | uuid | PK, FK |  |",
        "| quantity | int |  |  |",
        "",
        "### Product",
        "",
        "No attributes yet.",
        "",
        "## Links",
        "",
        "| # | From | To | How many | Text |",
        "|---|---|---|---|---|",
        "| 1 | Customer | Order | Exactly one to zero or more | places |",
        "| 2 | Order | Order line | Exactly one to one or more | has |",
        "| 3 | Product | Order line | Exactly one to zero or more | is on |",
        "| 4 | Customer | Customer | Zero or one to zero or more | refers |",
        "",
        "[All views and elements](../README.md)",
      ].join("\n"),
    );
    expect(exportDocs(buildWorkspace(base()), "shop.openarch").find((f) => f.path === "views/data.md")!.content).toContain("## Entities\n\nNone yet.\n\n[All views");
  });
});

describe("entity operations", () => {
  it("add entities, at a place in the list, and say what they added", () => {
    const result = applyOperations(base(), [
      { op: "add-entity", view: "data", id: "customer" },
      { op: "add-entity", view: "data", id: "order", name: " Order ", description: " What's bought ", at: [10.4, 20.6] },
      { op: "add-entity", view: "data", id: "order-line", position: 1 },
    ]);
    expect(result.summary).toEqual(["added entity customer to view data", "added entity order to view data", "added entity order-line to view data, as entity 1"]);
    expect(result.doc.views.data!.entities).toEqual([
      { id: "order-line", name: "Order Line" },
      { id: "customer", name: "Customer" },
      { id: "order", name: "Order", description: "What's bought", at: [10, 21] },
    ]);
    expect(fails(base(), { op: "add-entity", view: "data", id: "Bad" })).toBe('"Bad" isn\'t a valid ID. IDs are lowercase kebab-case, like "order-line".');
    expect(fails(orders(), { op: "add-entity", view: "orders-data", id: "order" })).toBe('View "orders-data" already has an entity "order".');
    expect(fails(base(), { op: "add-entity", view: "data", id: "a", position: 3 })).toBe('View "data" has 0 entities, so a new one\'s position can be 1 to 1.');
    expect(fails(shop(), { op: "add-entity", view: "landscape", id: "a" })).toBe('View "landscape" is a landscape view. Only entity views have entities, attributes and links.');
  });

  it("update an entity's name, description, position and place, and give it a new ID that its links follow", () => {
    const doc = apply(
      orders(),
      { op: "update-entity", view: "orders-data", id: "customer", name: "Shopper", description: null, at: null },
      { op: "update-entity", view: "orders-data", id: "order", at: [5.6, 7.2] },
      { op: "update-entity", view: "orders-data", id: "customer", newId: "shopper", position: 4 },
    );
    const v = doc.views["orders-data"]!;
    expect(v.entities!.map((e) => e.id)).toEqual(["order", "line", "product", "shopper"]);
    expect(v.entities![3]).toMatchObject({ id: "shopper", name: "Shopper" });
    expect(v.entities![3]!.description).toBeUndefined();
    expect(v.entities![3]!.at).toBeUndefined();
    expect(v.entities![0]!.at).toEqual([6, 7]);
    expect(v.links!.map((l) => `${l.from}>${l.to}`)).toEqual(["shopper>order", "order>line", "product>line", "shopper>shopper"]);
    const said = (op: Operation) => applyOperations(orders(), [op]).summary[0];
    expect(said({ op: "update-entity", view: "orders-data", id: "product", position: 1 })).toBe("moved entity product to entity 1 in view orders-data");
    expect(said({ op: "update-entity", view: "orders-data", id: "product", position: 4 })).toBe("entity product is already entity 4 in view orders-data");
    expect(said({ op: "update-entity", view: "orders-data", id: "product", name: "Item", position: 1 })).toBe("updated entity product in view orders-data, and moved it to entity 1");
    expect(said({ op: "update-entity", view: "orders-data", id: "product", newId: "item" })).toBe("renamed entity product to item in view orders-data");
    expect(fails(orders(), { op: "update-entity", view: "orders-data", id: "product" })).toBe('Say what to change on entity "product": newId, name, description, at, position.');
    expect(fails(orders(), { op: "update-entity", view: "orders-data", id: "product", name: " " })).toBe("An entity's name can't be empty.");
    expect(fails(orders(), { op: "update-entity", view: "orders-data", id: "product", newId: "order" })).toBe('View "orders-data" already has an entity "order".');
    expect(fails(orders(), { op: "update-entity", view: "orders-data", id: "prodcut", name: "X" })).toBe('View "orders-data" has no entity "prodcut". Did you mean "product"?');
  });

  it("remove an entity with its attributes and the links to and from it", () => {
    const result = applyOperations(orders(), [{ op: "remove-entity", view: "orders-data", id: "customer" }]);
    expect(result.summary).toEqual(["removed entity customer from view orders-data and 2 links to or from it"]);
    expect(result.doc.views["orders-data"]!.links!.map((l) => `${l.from}>${l.to}`)).toEqual(["order>line", "product>line"]);
    expect(applyOperations(orders(), [{ op: "remove-entity", view: "orders-data", id: "product" }]).summary).toEqual(["removed entity product from view orders-data and 1 link to or from it"]);
  });

  it("add, change, move and remove an entity's attributes, by name", () => {
    const start = apply(base(), { op: "add-entity", view: "data", id: "order" });
    const result = applyOperations(start, [
      { op: "add-attribute", view: "data", entity: "order", name: " total ", type: " money ", description: " With tax " },
      { op: "add-attribute", view: "data", entity: "order", name: "id", type: "uuid", keys: ["uk", "pk", "pk"], position: 1 },
    ]);
    expect(result.summary).toEqual(["added attribute total to entity order in view data", "added attribute id to entity order in view data, as attribute 1"]);
    const doc = result.doc;
    expect(doc.views.data!.entities![0]!.attributes).toEqual([
      { name: "id", type: "uuid", keys: ["pk", "uk"] },
      { name: "total", type: "money", description: "With tax" },
    ]);
    const changed = applyOperations(doc, [
      { op: "update-attribute", view: "data", entity: "order", name: "total", newName: "amount", type: null, keys: ["fk"], description: null },
      { op: "update-attribute", view: "data", entity: "order", name: "id", keys: null, position: 2 },
    ]);
    expect(changed.summary).toEqual(["renamed attribute total to amount of entity order in view data", "updated attribute id of entity order in view data, and moved it to attribute 2"]);
    expect(changed.doc.views.data!.entities![0]!.attributes).toEqual([{ name: "amount", keys: ["fk"] }, { name: "id", type: "uuid" }]);
    const said = (op: Operation) => applyOperations(doc, [op]).summary[0];
    expect(said({ op: "update-attribute", view: "data", entity: "order", name: "id", position: 2 })).toBe("moved attribute id to attribute 2 of entity order in view data");
    expect(said({ op: "update-attribute", view: "data", entity: "order", name: "id", position: 1 })).toBe("attribute id is already attribute 1 of entity order in view data");
    expect(said({ op: "update-attribute", view: "data", entity: "order", name: "id", keys: [] })).toBe("updated attribute id of entity order in view data");
    expect(apply(doc, { op: "update-attribute", view: "data", entity: "order", name: "id", keys: [] }).views.data!.entities![0]!.attributes![0]).toEqual({ name: "id", type: "uuid" });
    const removed = applyOperations(doc, [{ op: "remove-attribute", view: "data", entity: "order", name: "id" }, { op: "remove-attribute", view: "data", entity: "order", name: "total" }]);
    expect(removed.summary).toEqual(["removed attribute id from entity order in view data", "removed attribute total from entity order in view data"]);
    expect(removed.doc.views.data!.entities![0]).toEqual({ id: "order", name: "Order" });
  });

  it("refuse an attribute without a name, on two lines, or with a name its entity has, and unknown keys", () => {
    const doc = orders();
    const add = (fields: Partial<Extract<Operation, { op: "add-attribute" }>>): Operation => ({ op: "add-attribute", view: "orders-data", entity: "order", name: "x", ...fields });
    expect(fails(doc, add({ name: " " }))).toBe('An attribute needs a name: what\'s kept, like "email".');
    expect(fails(doc, add({ name: "a\nb" }))).toBe("An attribute's name is one line: take out the line break.");
    expect(fails(doc, add({ type: "a\nb" }))).toBe("An attribute's type is one line: take out the line break.");
    expect(fails(doc, add({ name: "id" }))).toBe('Entity "order" already has an attribute "id".');
    expect(fails(doc, add({ keys: ["pf" as never] }))).toBe('Unknown key "pf". Did you mean "pk"? Use one of: pk, fk, uk.');
    expect(fails(doc, add({ position: 5 }))).toBe('Entity "order" has 3 attributes, so a new one\'s position can be 1 to 4.');
    expect(fails(doc, add({ entity: "ordr" }))).toBe('View "orders-data" has no entity "ordr". Did you mean "order"?');
    const update = (fields: Partial<Extract<Operation, { op: "update-attribute" }>>): Operation => ({ op: "update-attribute", view: "orders-data", entity: "order", name: "id", ...fields });
    expect(fails(doc, update({}))).toBe('Say what to change on attribute "id": newName, type, keys, description, position.');
    expect(fails(doc, update({ newName: "placed_at" }))).toBe('Entity "order" already has an attribute "placed_at".');
    expect(fails(doc, update({ newName: " " }))).toBe("An attribute's name can't be empty.");
    expect(fails(doc, update({ position: 4 }))).toBe('Entity "order" has 3 attributes, so "position" must be 1 to 3.');
    expect(fails(doc, update({ name: "idd", type: "x" }))).toBe('Entity "order" has no attribute "idd". Did you mean "id"?');
    expect(fails(doc, { op: "remove-attribute", view: "orders-data", entity: "product", name: "id" })).toBe('Entity "product" has no attribute "id". Add one with add-attribute.');
    // Its own name, unchanged, isn't another attribute's.
    expect(apply(doc, update({ newName: "id", type: "int" })).views["orders-data"]!.entities![1]!.attributes![0]).toEqual({ name: "id", type: "int", keys: ["pk"] });
  });

  it("add, change, move and remove links by number, one from an entity to itself too", () => {
    const start = apply(base(), { op: "add-entity", view: "data", id: "a" }, { op: "add-entity", view: "data", id: "b" });
    const result = applyOperations(start, [
      { op: "add-link", view: "data", from: "a", to: "b", text: " has " },
      { op: "add-link", view: "data", from: "a", to: "a", cardinality: ["zero-or-one", "zero-or-more"], text: "leads", link: 1 },
      { op: "add-link", view: "data", from: "b", to: "a", cardinality: ["one", "zero-or-more"] },
    ]);
    expect(result.summary).toEqual(["added link 1 to view data: a -> b", "added link 1 to view data: a -> a", "added link 3 to view data: b -> a"]);
    expect(result.warnings).toEqual([]);
    const doc = result.doc;
    expect(doc.views.data!.links).toEqual([
      { from: "a", to: "a", cardinality: ["zero-or-one", "zero-or-more"], text: "leads" },
      { from: "a", to: "b", text: "has" },
      { from: "b", to: "a" },
    ]);
    expect(apply(doc, { op: "update-link", view: "data", link: 2, to: "a", cardinality: ["one-or-more", "one"], text: "owns" }).views.data!.links![1]).toEqual({ from: "a", to: "a", cardinality: ["one-or-more", "one"], text: "owns" });
    expect(apply(doc, { op: "update-link", view: "data", link: 1, cardinality: null, text: null }).views.data!.links![0]).toEqual({ from: "a", to: "a" });
    expect(applyOperations(doc, [{ op: "update-link", view: "data", link: 1, newLink: 3 }]).summary).toEqual(["moved link 1 to 3 in view data"]);
    expect(apply(doc, { op: "update-link", view: "data", link: 1, newLink: 3 }).views.data!.links![2]).toMatchObject({ from: "a", to: "a", text: "leads" });
    expect(applyOperations(doc, [{ op: "update-link", view: "data", link: 3, text: "x" }]).summary).toEqual(["updated link 3 in view data"]);
    expect(applyOperations(doc, [{ op: "remove-link", view: "data", link: 2 }]).summary).toEqual(["removed link 2 from view data"]);
    expect(apply(doc, { op: "remove-link", view: "data", link: 2 }).views.data!.links!.map((l) => l.text ?? "")).toEqual(["leads", ""]);
  });

  it("refuse links to entities the view doesn't have, with an unknown cardinality, or that say what another says", () => {
    const doc = orders();
    expect(fails(doc, { op: "add-link", view: "orders-data", from: "order", to: "nope" })).toBe('View "orders-data" has no entity "nope". Its entities: customer, order, line, product.');
    expect(fails(doc, { op: "add-link", view: "orders-data", from: "customer", to: "order", text: "places" })).toBe('View "orders-data" already has a link from "customer" to "order" that says "places": link 1.');
    expect(fails(doc, { op: "add-link", view: "orders-data", from: "order", to: "product", cardinality: ["one", "lots" as never] })).toBe('Unknown cardinality "lots". Use one of: one, zero-or-one, one-or-more, zero-or-more.');
    expect(fails(doc, { op: "add-link", view: "orders-data", from: "order", to: "product", link: 6 })).toBe('View "orders-data" has 4 links, so a new one can be link 1 to 5.');
    expect(fails(doc, { op: "update-link", view: "orders-data", link: 3, from: "customer", to: "order", text: "places" })).toBe('View "orders-data" already has a link from "customer" to "order" that says "places": link 1.');
    expect(fails(doc, { op: "update-link", view: "orders-data", link: 1 })).toBe("Say what to change on link 1: from, to, cardinality, text, newLink.");
    expect(fails(doc, { op: "update-link", view: "orders-data", link: 5, text: "x" })).toBe('View "orders-data" has 4 links: "link" must be 1 to 4.');
    expect(fails(doc, { op: "update-link", view: "orders-data", link: 1, newLink: 5 })).toBe('View "orders-data" has 4 links, so "newLink" must be 1 to 4.');
    expect(fails(base(), { op: "remove-link", view: "data", link: 1 })).toBe('View "data" has no links yet.');
    // Its own text, unchanged, isn't another link's.
    expect(apply(doc, { op: "update-link", view: "orders-data", link: 1, text: "places" }).views["orders-data"]!.links![0]).toEqual({ from: "customer", to: "order", text: "places" });
  });

  it("refuse what only other views take", () => {
    expect(fails(shop(), { op: "add-view", id: "d", level: "entity", include: ["shop"] })).toMatch(/^An entity view draws its entities, not elements/);
    expect(fails(orders(), { op: "update-view", id: "orders-data", newElements: "hide" })).toMatch(/^An entity view draws its entities, not elements/);
    expect(fails(orders(), { op: "show-in-view", view: "orders-data", id: "shop" })).toMatch(/^An entity view draws its entities, not elements/);
    expect(fails(orders(), { op: "hide-in-view", view: "orders-data", id: "shop" })).toMatch(/^An entity view draws its entities, not elements/);
    expect(fails(orders(), { op: "set-layout", view: "orders-data", positions: { shop: [0, 0] } })).toBe("An entity view has no boxes. Move an entity with update-entity --at.");
    expect(fails(orders(), { op: "add-sticky", view: "orders-data", id: "n", text: "Hi", on: { element: "db" } })).toBe(
      'View "orders-data" is an entity view. Only sticky notes on landscape, context, container, component and class views can be on an element or relationship.',
    );
    expect(apply(orders(), { op: "add-sticky", view: "orders-data", id: "n", text: "Hi", at: [0, 0] }).views["orders-data"]!.stickies).toEqual({ n: { text: "Hi", at: [0, 0] } });
  });

  it("are checked as JSON", () => {
    expect(parseOperations({ op: "add-link", view: "d", from: "a", to: "b", cardinality: ["one", "one"], link: 1 })).toHaveLength(1);
    expect(parseOperations({ op: "update-link", view: "d", link: 1, cardinality: null })).toHaveLength(1);
    expect(() => parseOperations({ op: "add-link", view: "d", from: "a", to: "b", cardinality: "one" })).toThrow('add-link: "cardinality" must be how many of each end there can be, `from`\'s then `to`\'s, like ["one", "zero-or-more"].');
    expect(() => parseOperations({ op: "add-attribute", view: "d", entity: "a" })).toThrow('add-attribute needs "name".');
    expect(() => parseOperations({ op: "update-attribute", view: "d", entity: "a", name: "x", keys: "pk" })).toThrow('update-attribute: "keys" must be a list of strings, or null to remove it.');
    expect(() => parseOperations({ op: "update-entity", view: "d", id: "a", at: [1] })).toThrow('update-entity: "at" must be a position, [x, y], or null to let the designer place it.');
  });
});
