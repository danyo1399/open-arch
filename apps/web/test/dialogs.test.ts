// @vitest-environment happy-dom
import { buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { button, choose, click, key, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 6,
  name: "Shop",
  elements: { customer: { kind: "person", name: "Customer" }, shop: { kind: "system", name: "Shop" } },
  views: {},
};

/** The New view dialog for this model. It keeps the views it creates. */
function dialog(model: OpenArchDocument = shop) {
  const created: { op: Operation; id: string }[] = [];
  const host = mount(createElement(NewViewDialog, { ws: buildWorkspace(model), onCreate: (op: Operation, id: string) => void created.push({ op, id }), onClose() {} }));
  const level = host.querySelector("select")!;
  const title = host.querySelector<HTMLInputElement>("input")!;
  return { host, created, level, title, create: button(host, "Create view") };
}

describe("NewViewDialog", () => {
  it("needs a title for a sequence view", async () => {
    const { created, level, title, create } = dialog();
    await choose(level, "sequence");
    expect(title.placeholder).toBe("e.g. Placing an order");
    expect(create.disabled).toBe(true);
    await key(title, "Enter");
    expect(created).toEqual([]);

    await type(title, "Placing an order");
    expect(create.disabled).toBe(false);
    await click(create);
    expect(created).toEqual([{ op: { op: "add-view", id: "placing-an-order", level: "sequence", scope: undefined, title: "Placing an order" }, id: "placing-an-order" }]);
  });

  it("gives other views the title in the box when it's left empty", async () => {
    const { created, level, title } = dialog();
    expect(title.placeholder).toBe("Shop containers");
    await choose(level, "landscape");
    expect(title.placeholder).toBe("System landscape");
    await key(title, "Enter");
    expect(created).toEqual([{ op: { op: "add-view", id: "system-landscape", level: "landscape", scope: undefined, title: "System landscape" }, id: "system-landscape" }]);
  });

  it("makes a class view of a component, named after it", async () => {
    const model: OpenArchDocument = {
      ...shop,
      elements: { ...shop.elements, api: { kind: "container", name: "API", parent: "shop" }, orders: { kind: "component", name: "Orders", parent: "api" } },
    };
    const { host, created, level, title } = dialog(model);
    await choose(level, "class");
    expect(host.textContent).toContain("Of which component");
    expect(title.placeholder).toBe("Orders classes");
    await key(title, "Enter");
    expect(created).toEqual([{ op: { op: "add-view", id: "orders-classes", level: "class", scope: "orders", title: "Orders classes" }, id: "orders-classes" }]);
  });

  it("creates nothing when the level needs a scope the model doesn't have", async () => {
    const { host, created, level, title, create } = dialog();
    await choose(level, "component");
    expect(host.textContent).toContain("There are no containers yet.");
    expect(create.disabled).toBe(true);
    await type(title, "Parts");
    expect(create.disabled).toBe(true);
    await key(title, "Enter");
    expect(created).toEqual([]);
  });
});
