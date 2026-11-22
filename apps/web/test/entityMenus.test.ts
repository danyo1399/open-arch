// @vitest-environment happy-dom
import { buildWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";

import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import { canLink } from "../src/canvas/EntityDiagram.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** A shop's data, each entity placed, so nothing waits for ELK, with a note beside them. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    "orders-data": {
      title: "Orders data",
      level: "entity",
      entities: [
        { id: "customer", name: "Customer", attributes: [{ name: "id", type: "uuid", keys: ["pk"] }, { name: "email", type: "text" }, { name: "referred_by", type: "uuid", keys: ["fk"] }], at: [0, 0] },
        { id: "order", name: "Order", attributes: [{ name: "id", type: "uuid", keys: ["pk"] }, { name: "customer_id", type: "uuid", keys: ["fk"] }], at: [600, 0] },
        { id: "line", name: "Line", at: [600, 500] },
      ],
      links: [
        { from: "customer", to: "order", text: "places" },
        { from: "order", to: "line", text: "has" },
      ],
      stickies: { note: { text: "Read me", at: [1200, 0] } },
    },
  },
};

/** The whole designer, open on the entity view, with its entities measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "orders-data", file);
/** The row an entity's box draws for one of its attributes. */
const row = (d: Awaited<ReturnType<typeof designer>>, entity: string, attribute: string) => d.node(entity)!.querySelector(`[data-attribute="${attribute}"]`)!;

describe("the links an entity view can have", () => {
  const view = buildWorkspace(doc).views.get("orders-data")!;

  it("aren't ones it has already, with the same ends and text, and can go from an entity to itself", () => {
    expect(canLink(view, "customer", "order")).toBe(true);
    expect(canLink(view, "customer", "order", "places")).toBe(false);
    expect(canLink(view, "order", "customer", "places")).toBe(true);
    expect(canLink(view, "customer", "customer")).toBe(true);
    // The link that's being changed can stay what it is.
    expect(canLink(view, "customer", "order", "places", view.links[0])).toBe(true);
    expect(canLink(view, "customer", "order", "places", view.links[1])).toBe(false);
  });
});

describe("an entity's right-click menu", () => {
  it("selects the entity, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("order")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Entity");
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Order");
    expect(d.labels()).toEqual(["Add attribute", "Add link to", "Lay out again", "Delete entity"]);
  });

  it("adds an attribute at its end, and selects it to give it a name", async () => {
    const d = await designer();
    await d.rightClick(d.node("order")!);
    await d.pick("Add attribute");
    expect((await d.saved()).entities[1]!.attributes.map((a) => a.name)).toEqual(["id", "customer_id", "new_attribute"]);
    expect(d.details()).toContain("Attribute");
    expect(document.activeElement).toBe(d.host.querySelector('input[aria-label="Name"]'));
  });

  it("adds a link to another entity, or to itself, and selects it", async () => {
    const d = await designer();
    await d.rightClick(d.node("customer")!);
    await d.pick("Add link to");
    expect(d.labels()).toEqual(["Customer (itself)", "Order", "Line"]);
    await d.pick("Customer (itself)");
    expect((await d.saved()).links.at(-1)).toMatchObject({ number: 3, from: "customer", to: "customer" });
    expect(d.details()).toBe("Link 3of 3");
    // A second link to itself that says nothing would be refused, so it isn't offered.
    await d.rightClick(d.node("customer")!);
    await d.pick("Add link to");
    expect(d.labels()).toEqual(["Order", "Line"]);
  });

  it("lays an entity out again and deletes it, with its links", async () => {
    const d = await designer();
    await d.rightClick(d.node("line")!);
    await d.pick("Lay out again");
    expect((await d.saved()).entities[2]!.at).toBeUndefined();
    await d.rightClick(d.node("line")!);
    expect(d.labels()).not.toContain("Lay out again");
    await d.pick("Delete entity");
    const view = await d.saved();
    expect(view.entities.map((e) => e.id)).toEqual(["customer", "order"]);
    expect(view.links.map((l) => l.text)).toEqual(["places"]);
    expect(d.details()).toBe("View");
  });
});

describe("an attribute's right-click menu", () => {
  it("selects the attribute whose row was clicked, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(row(d, "customer", "email"));
    expect(d.details()).toContain("Attribute");
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("email");
    expect(d.labels()).toEqual(["Add attribute after", "Make it a key", "Move up, to attribute 1", "Move down, to attribute 3", "Delete attribute"]);
    // One that's a key can stop being one, and the first has no way up.
    await d.rightClick(row(d, "customer", "id"));
    expect(d.labels()).toEqual(["Add attribute after", "Make it a key", "No longer a key", "Move down, to attribute 2", "Delete attribute"]);
  });

  it("adds an attribute after it, and selects that one", async () => {
    const d = await designer();
    await d.rightClick(row(d, "customer", "id"));
    await d.pick("Add attribute after");
    expect((await d.saved()).entities[0]!.attributes.map((a) => a.name)).toEqual(["id", "new_attribute", "email", "referred_by"]);
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("new_attribute");
  });

  it("makes it a key, or no longer one", async () => {
    const d = await designer();
    await d.rightClick(row(d, "customer", "id"));
    await d.pick("Make it a key");
    expect(d.labels()).toEqual(["Foreign key (FK)", "Unique (UK)"]);
    await d.pick("Unique (UK)");
    expect((await d.saved()).entities[0]!.attributes[0]!.keys).toEqual(["pk", "uk"]);
    await d.rightClick(row(d, "customer", "id"));
    await d.pick("No longer a key");
    expect(d.labels()).toEqual(["Primary key (PK)", "Unique (UK)"]);
    await d.pick("Primary key (PK)");
    expect((await d.saved()).entities[0]!.attributes[0]!.keys).toEqual(["uk"]);
  });

  it("moves it up or down its entity, staying on it, and deletes it, leaving its entity selected", async () => {
    const d = await designer();
    await d.rightClick(row(d, "customer", "email"));
    await d.pick("Move down, to attribute 3");
    expect((await d.saved()).entities[0]!.attributes.map((a) => a.name)).toEqual(["id", "referred_by", "email"]);
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("email");
    await d.rightClick(row(d, "customer", "email"));
    await d.pick("Delete attribute");
    expect((await d.saved()).entities[0]!.attributes.map((a) => a.name)).toEqual(["id", "referred_by"]);
    expect(d.details()).toBe("Entity");
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Customer");
  });
});

describe("a link's right-click menu", () => {
  it("selects the link, from its line or its text, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("link:1")!);
    expect(d.details()).toBe("Link 1of 2");
    expect(d.labels()).toEqual(["Change from", "Change to", "From: how many Customer", "To: how many Order", "Move down, to link 2", "Delete link"]);
    await key(document.activeElement!, "Escape");
    const text = [...d.host.querySelectorAll(".arrow-label")].find((l) => l.textContent === "has")!;
    await d.rightClick(text);
    expect(d.details()).toBe("Link 2of 2");
  });

  it("moves either end to another entity, and says how many of each end there can be", async () => {
    const d = await designer();
    await d.rightClick(d.edge("link:1")!);
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Customer", "Line"]);
    await d.pick("Line");
    expect((await d.saved()).links[0]).toMatchObject({ from: "customer", to: "line" });
    // Not to make a link the view has already: from the customer's line, another from the order to the line that says "has".
    const same = structuredClone(doc);
    same.views["orders-data"]!.links![0] = { from: "customer", to: "line", text: "has" };
    const taken = await designer(same);
    await taken.rightClick(taken.edge("link:1")!);
    await taken.pick("Change from");
    expect(taken.labels()).toEqual(["Line"]);

    await d.rightClick(d.edge("link:1")!);
    await d.pick("From: how many Customer");
    // It's exactly one of the customer already.
    expect(d.labels()).toEqual(["Zero or one", "One or more", "Zero or more"]);
    await d.pick("Zero or one");
    expect((await d.saved()).links[0]!.cardinality).toEqual(["zero-or-one", "zero-or-more"]);
    await d.rightClick(d.edge("link:1")!);
    await d.pick("To: how many Line", "One or more");
    expect((await d.saved()).links[0]!.cardinality).toEqual(["zero-or-one", "one-or-more"]);
  });

  it("moves it up or down the list, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("link:1")!);
    await d.pick("Move down, to link 2");
    expect((await d.saved()).links.map((l) => l.text)).toEqual(["has", "places"]);
    expect(d.details()).toBe("Link 2of 2");
    await d.rightClick(d.edge("link:2")!);
    await d.pick("Delete link");
    expect((await d.saved()).links.map((l) => l.text)).toEqual(["has"]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menus of an entity view's notes and background", () => {
  it("has a sticky note's menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Edit text");
    expect(document.activeElement).toBe(d.node("sticky:note")!.querySelector("textarea"));
    await key(document.activeElement!, "Escape");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and adds an entity or a sticky note where it was clicked", async () => {
    const d = await designer();
    await click(d.node("order")!);
    await d.rightClick(d.pane(), { x: 1500, y: 900 });
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Auto layout", "Export"]);
    await d.pick("Add");
    // An attribute is added from its entity's menu, not the background's.
    expect(d.labels()).toEqual(["Entity", "Sticky note"]);
    await d.pick("Entity");
    expect((await d.saved()).entities.at(-1)).toMatchObject({ id: "new-entity", at: [1390, 860] });
    expect(d.details()).toBe("Entity");

    await d.rightClick(d.pane(), { x: 3000, y: 1500 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.at(-1)).toMatchObject({ text: "New note", at: [3000 - STICKY.width / 2, 1450] });
  });

  it("lays the entities out again from the background, on the frame too", async () => {
    const scoped = structuredClone(doc);
    scoped.views["orders-data"]!.scope = "shop";
    const d = await designer(scoped);
    expect((d.node("__frame") as HTMLElement).style.pointerEvents).toBe("none");
    await d.rightClick(d.pane());
    await d.pick("Auto layout");
    const view = await d.saved();
    expect(view.entities.map((e) => e.at)).not.toEqual([[0, 0], [600, 0], [600, 500]]);
    expect(view.stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.pane());
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });
});

describe("an entity view's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("order")!, 300, 420);
    await d.menuKey(d.node("order")!);
    expect(d.details()).toBe("Entity");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the attribute under the new name typed for it", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(row(d, "customer", "email"));
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "e_mail");
    await d.rightClick(row(d, "customer", "email"));
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("e_mail");
    await d.pick("Delete attribute");
    expect((await d.saved()).entities[0]!.attributes.map((a) => a.name)).toEqual(["id", "referred_by"]);
  });

  it("opens on an attribute of an entity whose new ID, from its name, lands first", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(d.node("order")!);
    file.hold = true;
    // Its ID follows its name.
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "Purchase");
    await d.rightClick(row(d, "order", "customer_id"));
    file.release();
    await d.settle();
    expect(d.node("purchase")).not.toBeNull();
    await d.pick("Delete attribute");
    expect((await d.saved()).entities[1]).toMatchObject({ id: "purchase", attributes: [{ name: "id" }] });
  });

  it("doesn't open on an attribute added under the name of the one right-clicked, deleted just before", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    await click(row(d, "customer", "email"));
    file.hold = true;
    await click(button(d.host, "Delete attribute"));
    // Another is given its name.
    await click(row(d, "customer", "referred_by"));
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "email");
    await d.rightClick(row(d, "customer", "email"));
    file.release();
    await d.settle();
    expect((await d.saved()).entities[0]!.attributes.map((a) => [a.name, a.type])).toEqual([["id", "uuid"], ["email", "uuid"]]);
    expect(d.menuOpen()).toBe(false);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const file = new SlowHost("shop.openarch", serializeDocument(doc));
    const d = await designer(doc, file);
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "What's kept");
    await d.rightClick(d.edge("link:2")!);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Link 2of 2");
    await d.pick("Delete link");
    expect((await d.saved("what-s-kept")).links.map((l) => l.text)).toEqual(["places"]);
  });
});
