// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { addScreenOp, addWidgetOps, leadOps, WireframeDiagram } from "../src/canvas/WireframeDiagram.js";
import { SNAP_DEFAULTS } from "../src/settings.js";
import type { Edit } from "../src/state.js";
import { button, click, mount } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 18,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, web: { kind: "container", name: "Web App", parent: "shop" } },
  views: {
    checkout: {
      title: "Checkout",
      description: "From the cart to paying.",
      level: "wireframe",
      scope: "web",
      screens: [
        {
          id: "cart",
          name: "Cart",
          device: "phone",
          widgets: [
            { id: "title", kind: "heading", text: "Your cart" },
            { id: "items", kind: "table", text: "Item | Price\nShoes | $5" },
            { id: "actions", kind: "row", widgets: [{ id: "pay", kind: "button", text: "Pay", to: "payment", description: "Opens the payment screen." }] },
          ],
        },
        { id: "payment", name: "Payment", widgets: [{ id: "card", kind: "panel", text: "Card" }, { id: "blank", kind: "text" }] },
      ],
      stickies: { note: { text: "Read it left to right." } },
    },
  },
};

const view = (model: OpenArchDocument = shop) => buildWorkspace(model).views.get("checkout")!;

/** The diagram of the wireframe view. It keeps the edits it sends, and what it selects. */
async function diagram(model: OpenArchDocument = shop, selection: Selection = null) {
  const ws = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: { selection: Selection; isNew?: boolean }[] = [];
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(WireframeDiagram, {
        computed: computeView(ws, ws.views.get("checkout")!),
        selection,
        onSelect: (s: Selection, options?: { isNew?: boolean }) => void selected.push({ selection: s, ...options }),
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return true;
        },
        exportItems: [],
        snap: { settings: SNAP_DEFAULTS, set() {} },
      }),
    ),
  );
  // The screens and widgets are drawn an effect later.
  await act(async () => {});
  return { host, edits, selected };
  // React Flow draws arrows only once it has measured the screens and widgets, which this page
  // can't do, so arrows and dragging are checked in the browser. Where they go, and the edits
  // they send, are tested in wireframeLayout.test.ts and below.
}

describe("WireframeDiagram", () => {
  it("draws each screen with its name and device, and each widget on it, inside its row or panel", async () => {
    const { host } = await diagram();
    expect([...host.querySelectorAll(".wf-screen-name")].map((n) => n.textContent)).toEqual(["CartPhone", "Payment"]);
    const node = (id: string) => host.querySelector(`.react-flow__node[data-id="widget:${id}"]`)!;
    expect(node("title").textContent).toBe("Your cart");
    expect(node("title").querySelector(".wf-heading")).not.toBeNull();
    expect([...node("items").querySelectorAll("tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))).toEqual([
      ["Item", "Price"],
      ["Shoes", "$5"],
    ]);
    expect(node("pay").querySelector(".wf-button")!.textContent).toBe("Pay");
    expect(node("pay").querySelector(".wf-widget")!.getAttribute("title")).toBe("Opens the payment screen.");
    expect(node("card").querySelector(".wf-holder-title")!.textContent).toBe("Card");
    expect(node("card").textContent).toContain("Empty panel");
    // A text without any is grey lines.
    expect(node("blank").querySelectorAll(".wf-lines span")).toHaveLength(3);
    expect(host.querySelector(".sticky-text")!.textContent).toBe("Read it left to right.");
    expect(host.textContent).toContain("wireframe view of Web App");
    expect(host.textContent).toContain("From the cart to paying.");
    expect(host.querySelector(".empty-hint")).toBeNull();
  });

  it("marks the screen and the widget that are selected", async () => {
    const screen = await diagram(shop, { kind: "screen", id: "payment" });
    expect([...screen.host.querySelectorAll(".wf-screen.selected")].map((n) => n.textContent)).toEqual(["Payment"]);
    const widget = await diagram(shop, { kind: "widget", id: "pay" });
    expect([...widget.host.querySelectorAll(".wf-widget.selected")].map((n) => n.textContent)).toEqual(["Pay"]);
  });

  it("adds any kind of widget, a screen or a note from + Add, and selects a new widget or screen", async () => {
    const { host, edits, selected } = await diagram(shop, { kind: "widget", id: "title" });
    // The menu opens over the page, not inside the diagram.
    const item = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')].find((b) => b.textContent === text)!;
    await click(button(host, "+ Add"));
    expect([...document.querySelectorAll('.context-menu [role="menuitem"]')].map((b) => b.textContent)).toEqual([
      "Heading",
      "Text",
      "Button",
      "Link",
      "Text field",
      "Checkbox",
      "Drop-down",
      "Image",
      "List",
      "Table",
      "Tabs",
      "Divider",
      "Panel",
      "Row",
      "Screen",
      "Sticky note",
    ]);
    await click(item("Text field"));
    await click(button(host, "+ Add"));
    await click(item("Screen"));
    expect(edits).toEqual([
      [{ op: "add-widget", view: "checkout", id: "input", kind: "input", screen: "cart", position: 2 }],
      [{ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen", device: "phone", position: 2 }],
    ]);
    expect(selected).toEqual([
      { selection: { kind: "widget", id: "input" }, isNew: true },
      { selection: { kind: "screen", id: "new-screen" }, isNew: true },
    ]);
  });

  it("says how to start when there's nothing in it", async () => {
    const empty = structuredClone(shop);
    empty.views.checkout = { title: "Checkout", level: "wireframe", screens: [] };
    const { host } = await diagram(empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This view has no screens yet.");
  });
});

describe("adding to a wireframe", () => {
  it("adds a widget into the selected row or panel, after the selected widget, or at the end of the selected screen or the last one", () => {
    const v = view();
    const add = (selection: Selection) => addWidgetOps(v, "button", selection).ops;
    expect(add({ kind: "widget", id: "actions" })).toEqual([{ op: "add-widget", view: "checkout", id: "button", kind: "button", in: "actions" }]);
    expect(add({ kind: "widget", id: "pay" })).toEqual([{ op: "add-widget", view: "checkout", id: "button", kind: "button", in: "actions", position: 2 }]);
    expect(add({ kind: "screen", id: "cart" })).toEqual([{ op: "add-widget", view: "checkout", id: "button", kind: "button", screen: "cart" }]);
    expect(add(null)).toEqual([{ op: "add-widget", view: "checkout", id: "button", kind: "button", screen: "payment" }]);
    // A new ID is one no widget on any screen has.
    expect(addWidgetOps(v, "heading", null).id).toBe("heading");
    expect(addWidgetOps(v, "text", null).id).toBe("text");
    const titled = structuredClone(shop);
    titled.views.checkout!.screens![1]!.widgets!.push({ id: "button", kind: "button" });
    expect(addWidgetOps(view(titled), "button", null).id).toBe("button-2");
  });

  it("adds a screen first when there are none, for the widget to go on", () => {
    const empty = structuredClone(shop);
    empty.views.checkout!.screens = [];
    expect(addWidgetOps(view(empty), "heading", null).ops).toEqual([
      { op: "add-screen", view: "checkout", id: "new-screen", name: "New screen" },
      { op: "add-widget", view: "checkout", id: "heading", kind: "heading", screen: "new-screen" },
    ]);
  });

  it("adds a screen after the selected one, or the selected widget's, for the same device, or else at the end", () => {
    const v = view();
    expect(addScreenOp(v, { kind: "widget", id: "pay" })).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen", device: "phone", position: 2 });
    expect(addScreenOp(v, { kind: "screen", id: "payment" })).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen" });
    expect(addScreenOp(v, null)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen" });
  });

  it("makes a widget lead to the screen an arrow from it is dropped on, or onto a widget on, but not its own or where it leads already", () => {
    const v = view();
    expect(leadOps(v, "widget:title", "screen:payment")).toEqual([{ op: "update-widget", view: "checkout", id: "title", to: "payment" }]);
    expect(leadOps(v, "widget:title", "widget:card")).toEqual([{ op: "update-widget", view: "checkout", id: "title", to: "payment" }]);
    expect(leadOps(v, "widget:title", "screen:cart")).toEqual([]);
    expect(leadOps(v, "widget:title", "widget:items")).toEqual([]);
    expect(leadOps(v, "widget:pay", "screen:payment")).toEqual([]);
    expect(leadOps(v, "screen:cart", "screen:payment")).toEqual([]);
    expect(leadOps(v, "widget:title", "sticky:note")).toEqual([]);
    expect(leadOps(v, "widget:title", null)).toEqual([]);
  });
});
