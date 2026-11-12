// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { StateDiagram } from "../src/canvas/StateDiagram.js";
import type { Edit } from "../src/state.js";
import { mount } from "./dom.js";

/** An order's states, each placed, so nothing waits for ELK. */
const shop: OpenArchDocument = {
  openarch: 11,
  name: "Shop",
  elements: { order: { kind: "system", name: "Orders" } },
  views: {
    "order-states": {
      title: "Order states",
      level: "state",
      scope: "order",
      initial: "placed",
      states: { placed: { name: "Placed", at: [0, 0] }, paid: { name: "Paid", final: true, at: [0, 300] } },
      transitions: [{ from: "placed", to: "paid", event: "Payment taken" }, { from: "placed", to: "placed", event: "Payment fails" }],
    },
  },
};

/** The diagram of the state view. It keeps the edits it sends, and what it selects. */
async function diagram(model: OpenArchDocument = shop) {
  const ws = buildWorkspace(model);
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const host = mount(
    createElement(
      ReactFlowProvider,
      null,
      createElement(StateDiagram, {
        computed: computeView(ws, ws.views.get("order-states")!),
        selection: null,
        onSelect: (s: Selection) => void selected.push(s),
        edit: async (e: Edit) => {
          edits.push(typeof e === "function" ? e(ws) : e);
          return true;
        },
        onError() {},
        exportItems: [],
      }),
    ),
  );
  // The states are drawn once their positions are worked out, an effect later.
  await act(async () => {});
  return { host, edits, selected };
  // React Flow draws arrows only once it has measured the states, which this page can't do, so
  // transitions are checked in the browser.
}

describe("StateDiagram", () => {
  it("draws each state, a start into the initial one, an end out of each final one, and the frame of what they're the states of", async () => {
    const { host } = await diagram();
    expect([...host.querySelectorAll(".state-name")].map((n) => n.textContent)).toEqual(["Placed", "Paid"]);
    expect(host.querySelector('.react-flow__node[data-id="placed"] [aria-label="Starts here"]')).not.toBeNull();
    expect(host.querySelector('.react-flow__node[data-id="paid"] [aria-label="Can end here"]')).not.toBeNull();
    expect(host.querySelector('.react-flow__node[data-id="placed"] [aria-label="Can end here"]')).toBeNull();
    expect(host.querySelector(".frame-label")?.textContent).toContain("Orders");
    expect(host.textContent).toContain("state view of Orders [System]");
  });

  it("says how to start when there are no states", async () => {
    const empty = { ...shop, views: { "order-states": { title: "Order states", level: "state" as const, states: {}, transitions: [] } } };
    const { host } = await diagram(empty);
    expect(host.querySelector(".empty-hint")?.textContent).toContain("This view has no states yet.");
  });
});
