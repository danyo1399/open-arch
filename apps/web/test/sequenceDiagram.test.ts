// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { SequenceDiagram } from "../src/canvas/SequenceDiagram.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, mount, press, select } from "./dom.js";

/** A shop whose web app calls a controller inside its API, and a mail system nothing uses. */
const shop: OpenArchDocument = {
  openarch: 5,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web-app", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    "web-app": { kind: "container", name: "Web App", parent: "shop", uses: [{ to: "controller", description: "Places orders" }] },
    api: { kind: "container", name: "API", parent: "shop" },
    controller: { kind: "component", name: "Controller", parent: "api" },
    mail: { kind: "system", name: "Mail" },
  },
  views: {
    order: {
      title: "Order",
      level: "sequence",
      steps: [
        { from: "customer", to: "web-app" },
        { from: "web-app", to: "api" },
        { from: "api", to: "web-app", reply: true, description: "Order number" },
      ],
    },
  },
};

/** The diagram of a sequence view. It keeps the edits it sends, and what it selects. */
function diagram(model: OpenArchDocument = shop, view = "order", selection: Selection = null) {
  const ws = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const host = mount(
    createElement(SequenceDiagram, {
      ws,
      computed: computeView(ws, ws.views.get(view)!),
      selection,
      onSelect: (s: Selection) => void selected.push(s),
      edit: async (e: Edit) => {
        edits.push(typeof e === "function" ? e(ws) : e);
        return true;
      },
      onElementMenu() {},
      onError() {},
    }),
  );
  return { host, edits, selected };
}

/** A select's options, by group: the group's label, or "" for options in none. */
function options(el: HTMLSelectElement): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const o of el.querySelectorAll("option")) {
    const group = o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : "";
    (out[group] ??= []).push(o.value);
  }
  return out;
}

describe("SequenceDiagram", () => {
  it("draws a heading for each element in its steps, and each step, numbered", () => {
    const { host } = diagram();
    expect([...host.querySelectorAll(".sequence-head .c4-name")].map((h) => h.textContent)).toEqual(["Customer", "Web App", "API"]);
    expect([...host.querySelectorAll(".step-label")].map((l) => l.textContent)).toEqual(["1 Buys things", "2 Places orders", "3 Order number"]);
    expect(host.querySelectorAll(".step-arrow.reply")).toHaveLength(1);
  });

  it("selects a step from its label or its arrow", async () => {
    const { host, selected } = diagram();
    await click(host.querySelectorAll(".step-label")[1]!);
    await click(host.querySelectorAll(".step-arrow")[2]!);
    expect(selected).toEqual([
      { kind: "step", number: 2 },
      { kind: "step", number: 3 },
    ]);
  });

  it("selects an element from its heading", async () => {
    const { host, selected } = diagram();
    await press(host.querySelectorAll(".sequence-head")[1]!);
    expect(selected).toEqual([{ kind: "element", id: "web-app" }]);
  });

  it("adds a note, and selects it", async () => {
    const { host, edits, selected } = diagram();
    await click(button(host, "Add note"));
    expect(edits).toEqual([[{ op: "add-sticky", view: "order", id: "note", text: "New note" }]]);
    expect(selected).toEqual([{ kind: "sticky", id: "note" }]);
  });
});

describe("+ Add step", () => {
  const open = async (model?: OpenArchDocument) => {
    const d = diagram(model);
    await click(button(d.host, "+ Add step"));
    return d;
  };

  it("lists the elements a call can go to: connected ones first, and not what's inside it or contains it", async () => {
    const { host } = await open();
    await choose(select(host, "From"), "web-app");
    // The web app uses the controller, inside the API. It's inside the shop, so no relationship can join them.
    expect(options(select(host, "Calls"))).toEqual({
      "Connected in the model": ["api", "controller"],
      "Not connected yet: adds a relationship": ["customer", "mail"],
    });
  });

  it("adds a call the model has, as the last step, and selects it", async () => {
    const { host, edits, selected } = await open();
    await choose(select(host, "From"), "web-app");
    await click(button(host, "Add step"));
    expect(edits).toEqual([[{ op: "add-step", view: "order", from: "web-app", to: "api", reply: undefined }]]);
    expect(selected).toEqual([{ kind: "step", number: 4 }]);
  });

  it("adds the relationship a call needs, one way or both", async () => {
    const { host, edits } = await open();
    await choose(select(host, "From"), "web-app");
    await choose(select(host, "Calls"), "mail");
    await click(checkbox(host, "The new relationship goes both ways"));
    await click(button(host, "Add relationship and step"));
    expect(edits).toEqual([
      [
        { op: "add-relationship", from: "web-app", to: "mail", bidirectional: true },
        { op: "add-step", view: "order", from: "web-app", to: "mail", reply: undefined },
      ],
    ]);
  });

  it("lists only the elements that use it for a reply", async () => {
    const { host, edits } = await open();
    await choose(select(host, "From"), "web-app");
    await click(checkbox(host, "It's a reply to an earlier call"));
    expect(options(select(host, "Replies to"))).toEqual({ "": ["customer"] });
    await click(button(host, "Add step"));
    expect(edits).toEqual([[{ op: "add-step", view: "order", from: "web-app", to: "customer", reply: true }]]);
  });
});
