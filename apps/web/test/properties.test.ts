// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, mount, select } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 10,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things", notes: "Pays by **card**." }] },
    shop: { kind: "system", name: "Shop" },
  },
  views: { landscape: { title: "Landscape", description: "Everything.", level: "landscape", notes: "Drawn for **new starters**." } },
};

/** The details panel for a view of this model, showing what's selected. It keeps the edits it sends, and what it selects. */
function panel(model: OpenArchDocument, viewId: string, selection: Selection) {
  const ws = buildWorkspace(model);
  const view = ws.views.get(viewId)!;
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection,
    isNew: false,
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
  return { element, edits, selected };
}

/** The details panel, with the landscape view open, showing what's selected. */
function render(selection: Selection): string {
  return renderToString(panel(doc, "landscape", selection).element);
}

/** The text in the box with this label. */
function box(html: string, label: string): string | undefined {
  return new RegExp(`<textarea[^>]*aria-label="${label}"[^>]*>([^<]*)</textarea>`).exec(html)?.[1];
}

describe("Properties", () => {
  it("shows a view's description and notes, to edit", () => {
    const html = render(null);
    expect(box(html, "Description")).toBe("Everything.");
    expect(box(html, "Notes")).toBe("Drawn for **new starters**.");
  });

  it("shows an arrow's relationship notes, to edit", () => {
    expect(box(render({ kind: "arrow", from: "customer", to: "shop" }), "Notes")).toBe("Pays by **card**.");
  });
});

describe("Goes both ways", () => {
  const twoWay: OpenArchDocument = {
    ...doc,
    elements: {
      site: { kind: "system", name: "Site", uses: [{ to: "cms", description: "Syncs pages with", bidirectional: true }, { to: "mail" }] },
      cms: { kind: "system", name: "CMS" },
      mail: { kind: "system", name: "Mail" },
    },
  };

  it("on an arrow's details, makes its relationship go one way, or both", async () => {
    const both = panel(twoWay, "landscape", { kind: "arrow", from: "site", to: "cms" });
    const shown = checkbox(mount(both.element), "Goes both ways");
    expect(shown.checked).toBe(true);
    await click(shown);
    expect(both.edits).toEqual([[{ op: "update-relationship", from: "site", to: "cms", index: 0, bidirectional: false }]]);

    const one = panel(twoWay, "landscape", { kind: "arrow", from: "site", to: "mail" });
    const box = checkbox(mount(one.element), "Goes both ways");
    expect(box.checked).toBe(false);
    await click(box);
    expect(one.edits).toEqual([[{ op: "update-relationship", from: "site", to: "mail", index: 0, bidirectional: true }]]);
  });

  it("in an element's Uses, changes the relationship it's beside", async () => {
    const { element, edits } = panel(twoWay, "landscape", { kind: "element", id: "site" });
    const host = mount(element);
    const boxes = [...host.querySelectorAll("ul.rels li")].map((li) => li.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    await click(boxes[1]!);
    await click(boxes[0]!);
    expect(edits).toEqual([
      [{ op: "update-relationship", from: "site", to: "mail", index: 0, bidirectional: true }],
      [{ op: "update-relationship", from: "site", to: "cms", index: 0, bidirectional: false }],
    ]);
  });
});

describe("a step's details", () => {
  const sequence: OpenArchDocument = {
    ...doc,
    elements: {
      customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things", technology: "HTTPS" }] },
      shop: { kind: "system", name: "Shop" },
      mail: { kind: "system", name: "Mail" },
    },
    views: {
      order: {
        title: "Order",
        level: "sequence",
        steps: [{ from: "customer", to: "shop" }, { from: "shop", to: "customer", reply: true, description: "Receipt" }, { from: "shop", to: "mail" }],
      },
    },
  };
  const step = (number: number) => panel(sequence, "order", { kind: "step", number });
  const placeholder = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === label)?.querySelector<HTMLInputElement>("input, textarea")?.placeholder;

  it("shows a call's ends, and the relationship it goes along", () => {
    const host = mount(step(1).element);
    expect(select(host, "From").value).toBe("customer");
    expect(select(host, "Calls").value).toBe("shop");
    expect(checkbox(host, "A reply to an earlier call, drawn dashed").checked).toBe(false);
    // Without a description of its own, a call shows its relationship's.
    expect(placeholder(host, "Description")).toBe("Buys things (from the relationship)");
    expect(placeholder(host, "Technology")).toBe("HTTPS (from the relationship)");
    expect(host.querySelector("h3 + ul.plain")?.textContent).toContain("Customer → Shop Buys things");
    expect(host.textContent).not.toContain("The model has no relationship");
  });

  it("shows a reply as one, answering the element it goes back to", () => {
    const host = mount(step(2).element);
    expect(select(host, "Replies to").value).toBe("customer");
    expect(checkbox(host, "A reply to an earlier call, drawn dashed").checked).toBe(true);
    expect(placeholder(host, "Description")).toBe("e.g. Submits the order");
  });

  it("changes a step's ends, and whether it's a reply", async () => {
    const { element, edits } = step(1);
    const host = mount(element);
    await choose(select(host, "Calls"), "mail");
    await click(checkbox(host, "A reply to an earlier call, drawn dashed"));
    expect(edits).toEqual([
      [{ op: "update-step", view: "order", step: 1, to: "mail" }],
      [{ op: "update-step", view: "order", step: 1, reply: true }],
    ]);
  });

  it("warns when the model has no relationship for a step, and offers to add one", async () => {
    const { element, edits } = step(3);
    const host = mount(element);
    expect(host.textContent).toContain("The model has no relationship for this step to go along.");
    await click(button(host, "Add Shop → Mail"));
    await click(button(host, "Add Shop ↔ Mail"));
    expect(edits).toEqual([[{ op: "add-relationship", from: "shop", to: "mail" }], [{ op: "add-relationship", from: "shop", to: "mail", bidirectional: true }]]);
  });

  it("moves a step up or down, keeping it selected, and deletes it", async () => {
    const first = step(1);
    let host = mount(first.element);
    expect(button(host, "Move up").disabled).toBe(true);
    await click(button(host, "Move down"));
    await click(button(host, "Delete step"));
    expect(first.edits).toEqual([[{ op: "update-step", view: "order", step: 1, newStep: 2 }], [{ op: "remove-step", view: "order", step: 1 }]]);
    expect(first.selected).toEqual([{ kind: "step", number: 2 }, null]);

    const last = step(3);
    host = mount(last.element);
    expect(button(host, "Move down").disabled).toBe(true);
    await click(button(host, "Move up"));
    expect(last.edits).toEqual([[{ op: "update-step", view: "order", step: 3, newStep: 2 }]]);
    expect(last.selected).toEqual([{ kind: "step", number: 2 }]);
  });
});

describe("a class's details", () => {
  const code: OpenArchDocument = {
    ...doc,
    elements: {
      shop: { kind: "system", name: "Shop" },
      api: { kind: "container", name: "API", parent: "shop" },
      orders: { kind: "component", name: "Orders", parent: "api" },
      order: { kind: "class", name: "Order", parent: "orders", stereotype: "entity", members: ["+id: OrderId", "+total(): Money"], uses: [{ to: "line", kind: "composition", description: "Holds" }] },
      line: { kind: "class", name: "Order line", parent: "orders", uses: [{ to: "order", description: "Belongs to", bidirectional: true }, { to: "api", description: "Calls" }] },
    },
    views: { classes: { title: "Classes", level: "class", scope: "orders" } },
  };

  it("shows its stereotype and members, one per line, and no shape", () => {
    const host = mount(panel(code, "classes", { kind: "element", id: "order" }).element);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Stereotype"]')!.value).toBe("entity");
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Members"]')!.value).toBe("+id: OrderId\n+total(): Money");
    expect(() => select(host, "Shape")).toThrow();
  });

  it("saves its members, a line each, and removes them all when the box is emptied", async () => {
    const { element, edits } = panel(code, "classes", { kind: "element", id: "order" });
    const members = mount(element).querySelector<HTMLTextAreaElement>('textarea[aria-label="Members"]')!;
    const leave = async (text: string) => {
      members.value = text;
      await act(async () => void members.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    };
    await leave("+id: OrderId\n+placedAt: Date");
    await leave("  ");
    expect(edits).toEqual([[{ op: "update-element", id: "order", members: ["+id: OrderId", "+placedAt: Date"] }], [{ op: "update-element", id: "order", members: null }]]);
  });

  it("gives a relationship between classes a kind, keeping its arrow selected, and one way only", async () => {
    const arrow = panel(code, "classes", { kind: "arrow", from: "order", to: "line", relation: "composition" });
    const host = mount(arrow.element);
    expect(host.textContent).toContain("Composition (is made of)");
    expect(() => checkbox(host, "Goes both ways")).toThrow();
    await choose(select(host, "Kind"), "aggregation");
    expect(arrow.edits).toEqual([[{ op: "update-relationship", from: "order", to: "line", index: 0, kind: "aggregation" }]]);
    expect(arrow.selected).toEqual([{ kind: "arrow", from: "order", to: "line", relation: "aggregation" }]);

    const both = panel(code, "classes", { kind: "arrow", from: "line", to: "order" });
    await choose(select(mount(both.element), "Kind"), "inheritance");
    expect(both.edits).toEqual([[{ op: "update-relationship", from: "line", to: "order", index: 0, kind: "inheritance", bidirectional: false }]]);
  });

  it("offers a kind only for relationships between classes", () => {
    const host = mount(panel(code, "classes", { kind: "element", id: "line" }).element);
    expect([...host.querySelectorAll("ul.rels li")].map((li) => !!li.querySelector("select"))).toEqual([true, false]);
  });
});
