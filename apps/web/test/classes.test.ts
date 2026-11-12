import { buildWorkspace, type OpenArchDocument, type ViewEdge } from "@open-arch/core";
import { ReactFlowProvider, type EdgeProps } from "@xyflow/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addableKinds } from "../src/canvas/Canvas.js";
import { classHeight, splitMembers } from "../src/canvas/nodes.js";
import { RoutedEdge, type ArrowEdge } from "../src/canvas/RoutedEdge.js";

const code: OpenArchDocument = {
  openarch: 11,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    api: { kind: "container", name: "API", parent: "shop" },
    orders: { kind: "component", name: "Orders", parent: "api" },
    order: { kind: "class", name: "Order", parent: "orders", members: ["+id: OrderId", "+total(): Money", "-lines: OrderLine[]"] },
  },
  views: { classes: { title: "Classes", level: "class", scope: "orders" } },
};

describe("a class view", () => {
  it("adds classes to its component, components to their container, and people and systems", () => {
    const ws = buildWorkspace(code);
    expect(addableKinds(ws, ws.views.get("classes")!)).toEqual([
      { kind: "class", parent: "orders", label: "Class in Orders" },
      { kind: "component", parent: "api", label: "Component in API" },
      { kind: "person", label: "Person" },
      { kind: "system", label: "Software system" },
    ]);
  });
});

describe("a class's box", () => {
  it("lists attributes, then methods: the members with brackets", () => {
    expect(splitMembers(code.elements.order!.members!)).toEqual({ attributes: ["+id: OrderId", "-lines: OrderLine[]"], methods: ["+total(): Money"] });
  });

  it("is laid out taller for more members, a stereotype and a description", () => {
    const ws = buildWorkspace(code);
    const order = ws.elements.get("order")!;
    const taller = classHeight({ ...order, members: [...order.members, "+placedAt: Date"] });
    expect(taller).toBeGreaterThan(classHeight(order));
    expect(classHeight({ ...order, stereotype: "entity" })).toBeGreaterThan(classHeight(order));
    expect(classHeight({ ...order, description: "One customer's order." })).toBeGreaterThan(classHeight(order));
  });
});

describe("a class view's arrows", () => {
  const draw = (kind: ViewEdge["kind"], selected = false) => {
    const edge: ViewEdge = { from: "a", to: "b", kind, implied: false, bidirectional: false, sources: [] };
    const data = { edge, points: [{ x: 0, y: 0 }, { x: 0, y: 100 }], crossings: [], onSelect() {}, onEndDrag() {}, onEndDrop() {} };
    const props = { id: `a->b:${kind}`, data, selected, markerEnd: "url(#plain)" } as unknown as EdgeProps<ArrowEdge>;
    return renderToString(createElement(ReactFlowProvider, null, createElement("svg", null, createElement(RoutedEdge, props))));
  };

  it("draw UML's ends: a triangle at what's extended or implemented, and a diamond at the whole", () => {
    expect(draw("inheritance")).toMatch(/marker-end="url\(#uml-a-_62b_58inheritance-end\)"/);
    expect(draw("inheritance")).toContain('class="uml-marker uml-hollow"');
    expect(draw("inheritance")).not.toContain("marker-start");
    expect(draw("composition")).toMatch(/marker-start="url\(#uml-a-_62b_58composition-start\)"/);
    expect(draw("composition")).toContain('class="uml-marker uml-filled"');
    expect(draw("composition")).not.toContain("marker-end");
    expect(draw("aggregation", true)).toContain('class="uml-marker uml-hollow selected"');
    expect(draw("dependency")).toContain('class="uml-marker uml-open"');
  });

  it("dash dependencies and realizations, and leave associations to React Flow's arrowheads", () => {
    expect(draw("realization")).toMatch(/class="[^"]*arrow dashed/);
    expect(draw("dependency")).toMatch(/class="[^"]*arrow dashed/);
    expect(draw("inheritance")).not.toMatch(/arrow dashed/);
    expect(draw("association")).toContain('marker-end="url(#plain)"');
    expect(draw("association")).not.toContain("<marker");
  });
});
