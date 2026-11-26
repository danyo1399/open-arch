// @vitest-environment happy-dom
import { buildWorkspace, computeView, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Designer, detailsName } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, key, mount } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 22,
  name: "Shop",
  elements: {},
  views: {
    checkout: {
      title: "Checkout",
      level: "wireframe",
      screens: [
        {
          id: "cart",
          name: "Cart",
          widgets: [
            { id: "title", kind: "heading", text: "Your cart" },
            { id: "card", kind: "panel", text: "Card", widgets: [{ id: "number", kind: "input", text: "Number" }] },
            { id: "pay", kind: "button", text: "Pay", to: "done" },
          ],
        },
        { id: "done", name: "Thank you", widgets: [{ id: "thanks", kind: "text", text: "Thanks!" }] },
      ],
    },
  },
};

/** The whole designer, open on the workspace's wireframe view, once it has loaded. */
async function designer() {
  const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", serializeDocument(doc)), onClose() {}, onHostChange() {} }));
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  await settle();
  return {
    host,
    settle,
    screens: () => [...host.querySelectorAll(".wf-screen-name")].map((n) => n.textContent),
    widgets: () => [...host.querySelectorAll('.react-flow__node[data-id^="widget:"]')].map((n) => n.getAttribute("data-id")!.slice("widget:".length)),
    /** What the details panel is headed with: the kind of thing it shows. */
    details: () => host.querySelector(".properties .props-header")?.textContent,
    node: (id: string) => host.querySelector(`.react-flow__node[data-id="${id}"]`)!,
    select: (label: string) => [...host.querySelectorAll<HTMLLabelElement>(".properties label.field")].find((l) => l.querySelector(".field-label")?.textContent === label)!.querySelector("select")!,
  };
  // React Flow draws arrows only once it has measured the screens, which this page can't do, so
  // clicking an arrow, dragging a widget and dragging a new arrow are checked in the browser. The
  // edits they send are tested in wireframeDiagram.test.ts and wireframeLayout.test.ts.
}

/** Picks an option in a list, as a person would. */
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("the designer, on a wireframe view", () => {
  it("shows a clicked widget in the details, and Delete removes it, with what's inside it", async () => {
    const d = await designer();
    expect(d.screens()).toEqual(["Cart", "Thank you"]);
    expect(d.widgets()).toEqual(["title", "card", "number", "pay", "thanks"]);
    await click(d.node("widget:card"));
    expect(d.details()).toBe("Panel2 of 3 on Cart");
    expect(d.host.querySelector(".properties")!.textContent).toContain("Inside itText field: Number");
    await key(document.body, "Delete");
    await d.settle();
    expect(d.widgets()).toEqual(["title", "pay", "thanks"]);
    // Nothing is selected any more, so the details are the view's.
    expect(d.details()).toBe("View");
  });

  it("shows a clicked screen in the details, and Delete removes it, with what's on it, and the arrow to it", async () => {
    const d = await designer();
    await click(d.node("screen:done"));
    expect(d.details()).toBe("Screen 2of 2");
    expect(d.host.querySelector(".properties")!.textContent).toContain("Led to fromCart: Button: Pay");
    await key(document.body, "Delete");
    await d.settle();
    expect(d.screens()).toEqual(["Cart"]);
    expect(d.widgets()).toEqual(["title", "card", "number", "pay"]);
    await click(d.node("widget:pay"));
    expect(d.select("Leads to").value).toBe("");
  });

  it("changes a widget from the details: where it leads, its kind, and where it is", async () => {
    const d = await designer();
    await click(d.node("widget:title"));
    await choose(d.select("Leads to"), "done");
    await choose(d.select("Kind"), "text");
    await choose(d.select("In"), "card");
    await d.settle();
    expect(d.details()).toBe("Text2 of 2 in panel “Card”");
    expect(d.widgets()).toEqual(["card", "number", "title", "pay", "thanks"]);
    await choose(d.select("Screen"), "done");
    await d.settle();
    expect(d.details()).toBe("Text2 of 2 on Thank you");
    // A panel with a widget in it can't be made something that holds none.
    await click(d.node("widget:card"));
    const kinds = [...d.select("Kind").options].filter((o) => !o.disabled).map((o) => o.value);
    expect(kinds).toEqual(["panel", "row"]);
    await click(button(d.host, "Move down"));
    await d.settle();
    expect(d.details()).toBe("Panel2 of 2 on Cart");
  });

  it("stops showing a widget that Undo takes away again", async () => {
    const d = await designer();
    await click(button(d.host, "+ Add"));
    await click([...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === "Checkbox")!);
    await d.settle();
    expect(d.widgets()).toEqual(["title", "card", "number", "pay", "thanks", "checkbox"]);
    expect(d.details()).toBe("Checkbox2 of 2 on Thank you");
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.widgets()).toEqual(["title", "card", "number", "pay", "thanks"]);
    expect(d.details()).toBe("View");
  });

  it("names what the details show: a screen, or a widget by its kind and screen", () => {
    const ws = buildWorkspace(doc);
    const view = ws.views.get("checkout")!;
    const computed = computeView(ws, view);
    expect(detailsName(ws, view, computed, { kind: "screen", id: "done" })).toBe("Thank you");
    expect(detailsName(ws, view, computed, { kind: "widget", id: "number" })).toBe("Text field on Cart");
    expect(detailsName(ws, view, computed, { kind: "widget", id: "gone" })).toBe("This view");
  });
});
