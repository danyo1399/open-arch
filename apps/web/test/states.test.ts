// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { loopsRise, selfLoop, stateHeight } from "../src/canvas/stateLayout.js";
import { followRenames, shownInProperties, uniqueStateId, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, mount, select, type } from "./dom.js";

const doc: OpenArchDocument = {
  openarch: 11,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, customer: { kind: "person", name: "Customer" } },
  views: {
    "order-states": {
      title: "Order states",
      level: "state",
      scope: "shop",
      initial: "placed",
      states: { placed: { name: "Placed" }, paid: { name: "Paid", final: true } },
      transitions: [{ from: "placed", to: "paid", event: "Payment taken" }, { from: "paid", to: "paid", event: "Reminder" }],
    },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("order-states")!;

/** The details panel for the state view, showing what's selected, keeping the edits it sends and what it selects. */
function panel(selection: Selection) {
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
  return { host: mount(element), edits, selected };
}

describe("a state view in the designer", () => {
  it("shows a selected state or transition in the details, while it's there", () => {
    expect(shownInProperties(ws, view, { kind: "state", id: "paid" })).toMatchObject({ kind: "state", state: { id: "paid", final: true } });
    expect(shownInProperties(ws, view, { kind: "transition", number: 2 })).toMatchObject({ kind: "transition", transition: { from: "paid", to: "paid" } });
    expect(shownInProperties(ws, view, { kind: "state", id: "gone" })).toMatchObject({ kind: "view" });
  });

  it("has no boxes to show or hide", () => {
    expect(viewAction(ws, view, computeView(ws, view), "customer")).toBeNull();
  });

  it("makes new state IDs that the view doesn't have yet", () => {
    expect(uniqueStateId(view, "placed")).toBe("placed-2");
    expect(uniqueStateId(view, "placed", "placed")).toBe("placed");
    expect(uniqueStateId(view, "shipped")).toBe("shipped");
  });

  it("follows a renamed view in state operations, and leaves states' own IDs alone", () => {
    const renames = [{ op: "rename" as const, id: "order-states", to: "orders" }];
    expect(followRenames([{ op: "add-transition", view: "order-states", from: "placed", to: "paid" }], renames)).toEqual([{ op: "add-transition", view: "orders", from: "placed", to: "paid" }]);
  });

  it("draws a loop back to the same state above it, each one bigger, with room for its label", () => {
    const box = { x: 0, y: 100, w: 180, h: 46 };
    const [first, second] = [selfLoop(box, 0), selfLoop(box, 1)];
    expect(first.path.startsWith("M 116 100 C")).toBe(true);
    expect(first.end).toEqual({ x: 162, y: 100 });
    expect(second.label.y).toBeLessThan(first.label.y);
    expect(100 - loopsRise(1)).toBeLessThan(first.label.y - 10);
    expect(loopsRise(0)).toBe(0);
    expect(stateHeight({ description: "A description that wraps onto a second line." })).toBeGreaterThan(stateHeight({}));
  });
});

describe("a state's details", () => {
  it("rename it, with its ID following the name, and select it under its new ID", async () => {
    const { host, edits, selected } = panel({ kind: "state", id: "placed" });
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await type(name, "Waiting");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toEqual([[{ op: "update-state", view: "order-states", id: "placed", name: "Waiting", newId: "waiting" }]]);
    expect(selected).toEqual([{ kind: "state", id: "waiting" }]);
  });

  it("make it where the view starts, or where it can end, and add a transition from it", async () => {
    const { host, edits, selected } = panel({ kind: "state", id: "paid" });
    expect(checkbox(host, "It starts here (the initial state)").checked).toBe(false);
    await click(checkbox(host, "It starts here (the initial state)"));
    await click(checkbox(host, "It can end here (a final state)"));
    await choose(select(host, "Add a transition to"), "placed");
    expect(edits).toEqual([
      [{ op: "update-state", view: "order-states", id: "paid", initial: true }],
      [{ op: "update-state", view: "order-states", id: "paid", final: false }],
      [{ op: "add-transition", view: "order-states", from: "paid", to: "placed" }],
    ]);
    expect(selected).toEqual([{ kind: "transition", number: 3 }]);
    expect(host.textContent).toContain("↻ Paid Reminder← Placed Payment taken");
  });

  it("delete it, and its transitions with it", async () => {
    const { host, edits } = panel({ kind: "state", id: "paid" });
    await click(button(host, "Delete state"));
    expect(edits).toEqual([[{ op: "remove-state", view: "order-states", id: "paid" }]]);
  });
});

describe("a transition's details", () => {
  it("change its ends and move it", async () => {
    const { host, edits, selected } = panel({ kind: "transition", number: 1 });
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Event"]')!.value).toBe("Payment taken");
    await choose(select(host, "To"), "placed");
    await click(button(host, "Move down"));
    expect(edits).toEqual([
      [{ op: "update-transition", view: "order-states", transition: 1, to: "placed" }],
      [{ op: "update-transition", view: "order-states", transition: 1, newTransition: 2 }],
    ]);
    expect(selected).toEqual([{ kind: "transition", number: 2 }]);
  });
});

describe("the New view dialog", () => {
  it("makes a state view of an element, or of nothing in particular with a title", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "state");
    const of = select(host, "The states of");
    expect([...of.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Nothing in particular", "Customer [Person]", "Shop [System]"]);
    expect(button(host, "Create view").disabled).toBe(true);
    await choose(of, "shop");
    await click(button(host, "Create view"));
    expect(created).toEqual([{ op: "add-view", id: "shop-states", level: "state", scope: "shop", title: "Shop states" }]);
  });
});
