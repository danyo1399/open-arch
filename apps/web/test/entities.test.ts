// @vitest-environment happy-dom
import { buildWorkspace, CARDINALITIES, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { canAutoLayout, type Selection } from "../src/canvas/Canvas.js";
import { addAttributeOps, addEntityOps, autoLayoutEntityOps, clickedOn, connectOps, EntityDiagram, entityLayout, moveOps, pinOps, type DrawnItem } from "../src/canvas/EntityDiagram.js";
import { CROW_FOOT, crowFoot, ENTITY_W, entityHeight, entityWidth, keyColumns } from "../src/canvas/entityLayout.js";
import { followRenames, LEVEL_NAMES, shownInProperties, viewAction, viewLevelsOf } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, key, mount, select, type, menusFor } from "./dom.js";

/** What the shop's DB keeps: customers and their orders, with a customer referring another. Each entity is placed, so nothing waits for ELK. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    db: { kind: "container", name: "DB", parent: "shop", shape: "database" },
    customer: { kind: "person", name: "Customer" },
  },
  views: {
    data: {
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
            { name: "email", type: "text", keys: ["uk"] },
            { name: "referred_by", type: "uuid", keys: ["fk"] },
          ],
          at: [0, 0],
        },
        {
          id: "order",
          name: "Order",
          attributes: [
            { name: "id", type: "uuid", keys: ["pk"] },
            { name: "customer_id", type: "uuid", keys: ["fk"], description: "Who placed it" },
          ],
          at: [400, 0],
        },
        { id: "product", name: "Product", at: [400, 300] },
      ],
      links: [
        { from: "customer", to: "order", text: "places" },
        { from: "customer", to: "customer", cardinality: ["zero-or-one", "zero-or-more"], text: "refers" },
      ],
    },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("data")!;

/** Keeps the edits sent, and what's selected. */
function recorder() {
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const edit = async (e: Edit) => {
    edits.push(typeof e === "function" ? e(ws) : e);
    return true;
  };
  return { edits, selected, edit, onSelect: (s: Selection) => void selected.push(s) };
}

/** The diagram of the entity view, with this selected. */
async function diagram(selection: Selection = null, model: OpenArchDocument = doc) {
  const built = buildWorkspace(model);
  const r = recorder();
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(EntityDiagram, {
        computed: computeView(built, built.views.get("data")!),
        selection,
        onSelect: r.onSelect,
        edit: r.edit,
        menus: menusFor("data"),
        onError() {},
        exportItems: [],
        snap: { settings: SNAP_DEFAULTS, set() {} },
      }),
    ),
  );
  // The entities are drawn once their positions are worked out, an effect later.
  await act(async () => {});
  return { host, ...r };
  // React Flow draws links only once it has measured the entities, which this page can't do, so
  // links are checked in the browser.
}

/** The details panel for the entity view, showing what's selected. */
function panel(selection: Selection, isNew = false) {
  const r = recorder();
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection,
    isNew,
    syncsDocs: false,
    syncsSkill: false,
    docs: null,
    fileName: "shop.openarch",
    edit: r.edit,
    onSelect: r.onSelect,
    onHide() {},
    onDelete() {},
    onFindUsages() {},
    onNewView() {},
    onNewLibrary: async () => {},
    onBuild() {},
    onAddSticky() {},
    onDeleteView() {},
    onEditNotes() {},
  });
  return { host: mount(element), ...r };
}

/** Types into a box and leaves it, which saves it. */
async function write(box: HTMLTextAreaElement | HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), "value")!.set!.call(box, text);
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve));
}

const input = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

describe("EntityDiagram", () => {
  it("draws each entity as a table, a row for each attribute with its keys and type, in the frame of the element whose data it is", async () => {
    const { host } = await diagram();
    const boxes = [...host.querySelectorAll<HTMLElement>(".entity-box")];
    expect(boxes.map((b) => b.querySelector(".entity-name")!.textContent)).toEqual(["Customer", "Order", "Product"]);
    expect(boxes[0]!.querySelector(".entity-desc")!.textContent).toBe("Someone who shops");
    const rows = [...boxes[0]!.querySelectorAll<HTMLElement>(".entity-attr")];
    expect(rows.map((r) => [r.dataset.attribute, r.querySelector(".entity-keys")!.textContent, r.querySelector(".entity-attr-name")!.textContent, r.querySelector(".entity-attr-type")!.textContent])).toEqual([
      ["id", "PK", "id", "uuid"],
      ["email", "UK", "email", "text"],
      ["referred_by", "FK", "referred_by", "uuid"],
    ]);
    expect(boxes[1]!.querySelector('[data-attribute="customer_id"]')!.getAttribute("title")).toBe("customer_id: uuid (FK)\nWho placed it");
    expect(boxes[2]!.querySelector(".entity-empty")!.textContent).toBe("No attributes yet");
    expect(boxes[0]!.style.width).toBe(`${entityWidth(view.entities[0]!)}px`);
    expect(host.querySelector(".frame-label")?.textContent).toContain("DB");
    expect(host.textContent).toContain("entity view of DB [Container]");
  });

  it("marks the entity or the attribute selected", async () => {
    const entity = await diagram({ kind: "entity", id: "order" });
    expect([...entity.host.querySelectorAll(".entity-box.selected .entity-name")].map((n) => n.textContent)).toEqual(["Order"]);
    const attribute = await diagram({ kind: "attribute", entity: "customer", name: "email" });
    expect(attribute.host.querySelector(".entity-box.selected")).toBeNull();
    expect([...attribute.host.querySelectorAll<HTMLElement>(".entity-attr.selected")].map((r) => r.dataset.attribute)).toEqual(["email"]);
  });

  it("says how to start when there are no entities", async () => {
    const empty: OpenArchDocument = { ...doc, views: { data: { title: "Data", level: "entity", entities: [], links: [] } } };
    const { host } = await diagram(null, empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This entity view has no entities yet.");
    expect(host.textContent).toContain("entity view");
  });

  it("adds an entity, or with one selected, an attribute of it, from + Add, and selects it to name it", async () => {
    const none = await diagram();
    await click(button(none.host, "+ Add"));
    expect([...document.querySelectorAll('.context-menu [role="menuitem"]')].map((b) => b.textContent)).toEqual(["Entity", "Sticky note"]);
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Entity")!);
    await new Promise((resolve) => setTimeout(resolve));
    expect(none.edits).toHaveLength(1);
    expect(none.edits[0]![0]).toMatchObject({ op: "add-entity", view: "data", id: "new-entity", name: "New entity" });
    expect(none.selected).toEqual([{ kind: "entity", id: "new-entity" }]);
    await click(document.body);

    const { host, edits, selected } = await diagram({ kind: "attribute", entity: "customer", name: "id" });
    await click(button(host, "+ Add"));
    const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual(["Entity", "Attribute of Customer", "Sticky note"]);
    await click(items.find((b) => b.textContent === "Attribute of Customer")!);
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toEqual([[{ op: "add-attribute", view: "data", entity: "customer", name: "new_attribute", position: 2 }]]);
    expect(selected).toEqual([{ kind: "attribute", entity: "customer", name: "new_attribute" }]);
  });
});

describe("adding to an entity view", () => {
  it("gives a new entity an ID no entity has, and a new attribute a name its entity doesn't have, after the attribute selected", () => {
    expect(addEntityOps(view, [5, 6])).toEqual({ id: "new-entity", ops: [{ op: "add-entity", view: "data", id: "new-entity", name: "New entity", at: [5, 6] }] });
    const taken = buildWorkspace({
      ...doc,
      views: { data: { ...doc.views.data!, entities: [{ id: "new-entity", name: "New entity", attributes: [{ name: "new_attribute" }, { name: "x" }] }] } },
    }).views.get("data")!;
    expect(addEntityOps(taken, [0, 0]).id).toBe("new-entity-2");
    expect(addAttributeOps(taken, { kind: "entity", id: "new-entity" })).toEqual({ entity: "new-entity", name: "new_attribute_2", ops: [{ op: "add-attribute", view: "data", entity: "new-entity", name: "new_attribute_2" }] });
    // After the last one, it goes at the end.
    expect(addAttributeOps(view, { kind: "attribute", entity: "order", name: "customer_id" })!.ops).toEqual([{ op: "add-attribute", view: "data", entity: "order", name: "new_attribute" }]);
    expect(addAttributeOps(view, { kind: "attribute", entity: "customer", name: "id" })!.ops).toEqual([{ op: "add-attribute", view: "data", entity: "customer", name: "new_attribute", position: 2 }]);
    expect(addAttributeOps(view, null)).toBeNull();
    expect(addAttributeOps(view, { kind: "link", number: 1 })).toBeNull();
  });

  it("selects the attribute whose row is clicked, or else the entity", () => {
    const box = document.createElement("div");
    box.innerHTML = '<div class="entity-head"><span>Customer</span></div><div data-attribute="email"><span class="name">email</span></div>';
    expect(clickedOn("customer", box.querySelector(".name"))).toEqual({ kind: "attribute", entity: "customer", name: "email" });
    expect(clickedOn("customer", box.querySelector("span"))).toEqual({ kind: "entity", id: "customer" });
    expect(clickedOn("customer", null)).toEqual({ kind: "entity", id: "customer" });
  });
});

describe("dragging on an entity view", () => {
  // Two entities the designer placed, one with a position, and a note.
  const drawn: DrawnItem[] = [
    { kind: "entity", id: "customer", position: { x: 10.4, y: 20.6 }, placed: true },
    { kind: "entity", id: "order", position: { x: 400, y: 0 } },
    { kind: "entity", id: "product", position: { x: 5, y: 300 }, placed: true },
    { kind: "sticky", id: "note", position: { x: 700, y: 0 } },
  ];

  it("keeps the entities the designer placed where they are", () => {
    expect(pinOps(view, drawn)).toEqual([
      { op: "update-entity", view: "data", id: "customer", at: [10, 21] },
      { op: "update-entity", view: "data", id: "product", at: [5, 300] },
    ]);
    expect(pinOps(view, drawn, new Set(["customer"]))).toEqual([{ op: "update-entity", view: "data", id: "product", at: [5, 300] }]);
  });

  it("moves the entities and notes let go of, and keeps the rest of the placed entities where they are", () => {
    const dragged: DrawnItem[] = [
      { kind: "entity", id: "product", position: { x: 50.2, y: 350 }, placed: true },
      { kind: "sticky", id: "note", position: { x: 720, y: 10 } },
    ];
    expect(moveOps(view, drawn, dragged)).toEqual([
      { op: "update-entity", view: "data", id: "customer", at: [10, 21] },
      { op: "update-entity", view: "data", id: "product", at: [50, 350] },
      { op: "update-sticky", view: "data", id: "note", at: [720, 10] },
    ]);
  });

  it("adds a link dragged from one entity to another, numbered after the rest, with the placed entities kept where they are", () => {
    expect(connectOps(view, drawn, "order", "product")).toEqual({
      ops: [
        { op: "update-entity", view: "data", id: "customer", at: [10, 21] },
        { op: "update-entity", view: "data", id: "product", at: [5, 300] },
        { op: "add-link", view: "data", from: "order", to: "product" },
      ],
      number: 3,
    });
    expect(connectOps(view, drawn, "order", "order")).toBeNull();
    expect(connectOps(view, drawn, "order", "note")).toBeNull();
  });
});

describe("laying out an entity view", () => {
  it("goes left to right, a link's from before its to, each entity as wide as it's drawn", async () => {
    const at = await entityLayout(
      [
        { id: "line", inside: false, width: 300, height: 120 },
        { id: "order", inside: false, width: 200, height: 80 },
        { id: "customer", inside: false, width: 260, height: 100 },
      ],
      [
        { from: "customer", to: "order" },
        { from: "order", to: "line" },
      ],
    );
    expect(at.customer!.x + 260).toBeLessThan(at.order!.x);
    expect(at.order!.x + 200).toBeLessThan(at.line!.x);
  });

  it("is done again by Auto layout: every entity where ELK put it, and the sticky notes back beside the diagram, as one edit", async () => {
    const noted = buildWorkspace({ ...doc, views: { data: { ...doc.views.data!, stickies: { placed: { text: "Here", at: [900, 900] }, loose: { text: "Beside" } } } } });
    const ops = autoLayoutEntityOps(noted, "data", { customer: { x: 0.4, y: 10.6 }, order: { x: 300, y: 0 }, gone: { x: 9, y: 9 } });
    expect(ops).toEqual([
      { op: "update-entity", view: "data", id: "customer", at: [0, 11] },
      { op: "update-entity", view: "data", id: "order", at: [300, 0] },
      { op: "update-sticky", view: "data", id: "placed", at: null },
    ]);
    expect(autoLayoutEntityOps(noted, "nope", { customer: { x: 0, y: 0 } })).toEqual([]);
    // It's offered on an entity view with an entity, in its toolbar.
    expect(canAutoLayout(computeView(ws, view))).toBe(true);
    const empty = buildWorkspace({ ...doc, views: { data: { title: "Empty", level: "entity", entities: [], links: [] } } });
    expect(canAutoLayout(computeView(empty, empty.views.get("data")!))).toBe(false);
    const { host } = await diagram();
    expect(button(host, "Auto layout").disabled).toBe(false);
  });
});

describe("an entity's size and a link's crow's feet", () => {
  it("are as wide as an entity's name or widest row, within limits, and as tall as its rows", () => {
    const small = { name: "A", description: undefined, attributes: [] };
    expect(entityWidth(small)).toBe(ENTITY_W.min);
    const wide = { name: "Order", attributes: [{ path: "", number: 1, name: "a_very_long_attribute_name_indeed", type: "varchar(255)", keys: ["pk" as const, "fk" as const] }] };
    expect(entityWidth(wide)).toBe(ENTITY_W.max);
    expect(keyColumns(wide)).toBe(2);
    expect(entityHeight(small)).toBe(entityHeight({ ...small, attributes: [{ path: "", number: 1, name: "x", keys: [] }] }));
    const three = entityHeight({ ...small, attributes: [1, 2, 3].map((n) => ({ path: "", number: n, name: `a${n}`, keys: [] })) });
    expect(three - entityHeight(small)).toBe(44);
    expect(entityHeight({ ...small, description: "Someone who shops, or who did" })).toBeGreaterThan(entityHeight(small));
  });

  it("draw each cardinality its own way: bars for one, a crow's foot for more, a circle for zero", () => {
    const shape = (c: (typeof CARDINALITIES)[number]) => {
      const { paths, circle } = crowFoot(c);
      return { bars: paths.filter((p) => /^M [\d.]+ 1 V/.test(p)).length, foot: paths.some((p) => p.includes(` L ${CROW_FOOT.w} 1`)), circle: !!circle };
    };
    expect(Object.fromEntries(CARDINALITIES.map((c) => [c, shape(c)]))).toEqual({
      one: { bars: 2, foot: false, circle: false },
      "zero-or-one": { bars: 1, foot: false, circle: true },
      "one-or-more": { bars: 1, foot: true, circle: false },
      "zero-or-more": { bars: 0, foot: true, circle: true },
    });
    // Everything stays inside the marker, with the circle clear of the crow's foot.
    const circle = crowFoot("zero-or-more").circle!;
    expect(circle.cx - circle.r).toBeGreaterThanOrEqual(0);
    expect(circle.cx + circle.r).toBeLessThan(CROW_FOOT.w - 12);
  });
});

describe("an entity view in the designer", () => {
  it("shows a selected entity, attribute or link in the details, while it's there", () => {
    expect(shownInProperties(ws, view, { kind: "entity", id: "order" })).toMatchObject({ kind: "entity", entity: { id: "order", name: "Order" } });
    expect(shownInProperties(ws, view, { kind: "attribute", entity: "order", name: "customer_id" })).toMatchObject({ kind: "attribute", entity: { id: "order" }, attribute: { name: "customer_id", keys: ["fk"] } });
    expect(shownInProperties(ws, view, { kind: "link", number: 2 })).toMatchObject({ kind: "link", link: { from: "customer", to: "customer", cardinality: ["zero-or-one", "zero-or-more"] } });
    expect(shownInProperties(ws, view, { kind: "entity", id: "gone" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "attribute", entity: "order", name: "gone" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "link", number: 3 })).toMatchObject({ kind: "view" });
  });

  it("has no boxes to show or hide, is named in menus, and is offered for systems, containers, components and libraries", () => {
    expect(viewAction(ws, view, computeView(ws, view), "customer")).toBeNull();
    expect(LEVEL_NAMES.entity).toBe("Entity view");
    expect(viewLevelsOf(ws.elements.get("db")!)).toContain("entity");
    expect(viewLevelsOf(ws.elements.get("shop")!)).toContain("entity");
    expect(viewLevelsOf(ws.elements.get("customer")!)).not.toContain("entity");
  });

  it("follows a renamed view in entity, attribute and link operations", () => {
    const renames = [{ op: "rename" as const, id: "data", to: "orders-data" }];
    expect(followRenames([{ op: "add-link", view: "data", from: "customer", to: "order" }], renames)).toEqual([{ op: "add-link", view: "orders-data", from: "customer", to: "order" }]);
    expect(followRenames([{ op: "update-attribute", view: "data", entity: "order", name: "id", type: "int" }], renames)).toEqual([{ op: "update-attribute", view: "orders-data", entity: "order", name: "id", type: "int" }]);
    expect(followRenames([{ op: "remove-entity", view: "data", id: "order" }], renames)).toEqual([{ op: "remove-entity", view: "orders-data", id: "order" }]);
  });
});

describe("an entity's details", () => {
  it("change its name, with its ID following it, and select it under its new ID", async () => {
    const { host, edits, selected } = panel({ kind: "entity", id: "order" }, true);
    const name = input(host, "Name");
    expect(document.activeElement).toBe(name);
    await write(name, "Purchase");
    expect(edits).toEqual([[{ op: "update-entity", view: "data", id: "order", name: "Purchase", newId: "purchase" }]]);
    expect(selected).toEqual([{ kind: "entity", id: "purchase" }]);
    // An entity needs a name, so none puts it back.
    await write(name, " ");
    expect(edits).toHaveLength(1);
    expect(name.value).toBe("Order");
  });

  it("list its attributes and links, add an attribute, add a link to itself, lay it out again, and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "entity", id: "customer" });
    expect(host.textContent).toContain("PK id: uuidUK email: textFK referred_by: uuid");
    expect(host.textContent).toContain("→ Order places→ itself refers");
    await click(button(host, "UK email: text"));
    const add = input(host, "Add an attribute");
    await type(add, " phone ");
    await key(add, "Enter");
    expect(add.value).toBe("");
    expect([...select(host, "Add a link to").options].map((o) => o.textContent)).toEqual(["Choose an entity…", "Customer (itself)", "Order", "Product"]);
    await choose(select(host, "Add a link to"), "customer");
    await new Promise((resolve) => setTimeout(resolve));
    await click(button(host, "Lay out again"));
    await click(button(host, "Delete entity"));
    expect(edits).toEqual([
      [{ op: "add-attribute", view: "data", entity: "customer", name: "phone" }],
      [{ op: "add-link", view: "data", from: "customer", to: "customer" }],
      [{ op: "update-entity", view: "data", id: "customer", at: null }],
      [{ op: "remove-entity", view: "data", id: "customer" }],
    ]);
    expect(selected).toEqual([{ kind: "attribute", entity: "customer", name: "email" }, { kind: "link", number: 3 }, null]);
  });
});

describe("an attribute's details", () => {
  it("rename it and select it under its new name, change its type, keys and description, move it, and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "attribute", entity: "customer", name: "email" }, true);
    const name = input(host, "Name");
    expect(document.activeElement).toBe(name);
    expect(host.textContent).toContain("Attribute 2of 3, in Customer");
    expect(checkbox(host, "Unique (UK)").checked).toBe(true);
    await write(name, " mail ");
    await write(input(host, "Type"), "");
    await click(checkbox(host, "Primary key (PK)"));
    await click(checkbox(host, "Unique (UK)"));
    await write(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!, "Where receipts go");
    await click(button(host, "Move up"));
    await click(button(host, "Delete attribute"));
    expect(edits).toEqual([
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", newName: "mail" }],
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", type: null }],
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", keys: ["pk", "uk"] }],
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", keys: [] }],
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", description: "Where receipts go" }],
      [{ op: "update-attribute", view: "data", entity: "customer", name: "email", position: 1 }],
      [{ op: "remove-attribute", view: "data", entity: "customer", name: "email" }],
    ]);
    expect(selected).toEqual([{ kind: "attribute", entity: "customer", name: "mail" }, { kind: "entity", id: "customer" }]);
    // An attribute needs a name, so none puts it back.
    await write(name, "");
    expect(edits).toHaveLength(7);
    await click(button(host, "Customer"));
    expect(selected.at(-1)).toEqual({ kind: "entity", id: "customer" });
  });
});

describe("a link's details", () => {
  it("change its ends, how many of each there can be, and its text, move it and delete it", async () => {
    const { host, edits, selected } = panel({ kind: "link", number: 1 });
    expect(input(host, "Text").value).toBe("places");
    expect(select(host, "How many Customer").value).toBe("one");
    expect(select(host, "How many Order").value).toBe("zero-or-more");
    expect(host.textContent).toContain("For each Order. Drawn at the Customer end.");
    expect([...select(host, "How many Order").options].map((o) => o.textContent)).toEqual(["Exactly one", "Zero or one", "One or more", "Zero or more"]);
    await choose(select(host, "How many Order"), "one-or-more");
    await choose(select(host, "How many Customer"), "zero-or-one");
    await choose(select(host, "To"), "product");
    await write(input(host, "Text"), "");
    await click(button(host, "Move down"));
    await click(button(host, "Delete link"));
    expect(edits).toEqual([
      [{ op: "update-link", view: "data", link: 1, cardinality: ["one", "one-or-more"] }],
      [{ op: "update-link", view: "data", link: 1, cardinality: ["zero-or-one", "zero-or-more"] }],
      [{ op: "update-link", view: "data", link: 1, to: "product" }],
      [{ op: "update-link", view: "data", link: 1, text: null }],
      [{ op: "update-link", view: "data", link: 1, newLink: 2 }],
      [{ op: "remove-link", view: "data", link: 1 }],
    ]);
    expect(selected).toEqual([{ kind: "link", number: 2 }, null]);
  });
});

describe("the view's details", () => {
  it("say what's in it and how to add to it, without a choice of new elements", () => {
    const { host } = panel(null);
    expect(host.textContent).toContain("LevelentityThe data ofDBEntities3Links2");
    expect(host.textContent).toContain("An entity view is an entity-relationship diagram");
    expect(host.textContent).not.toContain("New elements");
  });
});

describe("the New view dialog", () => {
  it("makes an entity view of a system, container, component or library, or of nothing in particular with a title", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "entity");
    const of = select(host, "The data of");
    expect([...of.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Nothing in particular", "DB [Container]", "Shop [System]"]);
    expect(host.querySelector<HTMLInputElement>("input")!.placeholder).toBe("e.g. Orders data");
    expect(host.textContent).toContain("An entity view is an entity-relationship diagram (ERD)");
    expect(button(host, "Create view").disabled).toBe(true);
    await choose(of, "db");
    await click(button(host, "Create view"));
    expect(created).toEqual([{ op: "add-view", id: "db-entities", level: "entity", scope: "db", title: "DB entities" }]);
  });
});
