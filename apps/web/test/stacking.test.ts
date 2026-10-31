import type { ArchElement, Sticky } from "@open-arch/core";
import { ReactFlowProvider, useStore } from "@xyflow/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SELECTED_LIFT, STICKY_Z, withFrame } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, FrameFlowNode, StickyFlowNode } from "../src/canvas/nodes.js";

/** The z-index React Flow draws each node at, once it has lifted the selected one. */
function stacking(nodes: (ElementFlowNode | FrameFlowNode | StickyFlowNode)[]): Record<string, number> {
  const z: Record<string, number> = {};
  function Read() {
    for (const [id, node] of useStore((s) => s.nodeLookup)) z[id] = node.internals.z;
    return null;
  }
  renderToString(createElement(ReactFlowProvider, { initialNodes: nodes, children: createElement(Read) }));
  return z;
}

describe("stacking", () => {
  const system = { id: "shop", kind: "system", name: "Shop" } as ArchElement;
  // Built as the canvas builds them.
  const box = (id: string, selected = false): ElementFlowNode => ({
    id,
    type: "element",
    position: { x: 0, y: 0 },
    data: { element: { id, kind: "container", name: id, parent: "shop" } as ArchElement, problems: 0 },
    selected,
  });
  const note = (id: string, selected = false): StickyFlowNode => ({
    id: `sticky:${id}`,
    type: "sticky",
    position: { x: 0, y: 0 },
    data: { sticky: { id, path: `views.v.stickies.${id}`, text: id, color: "yellow" } satisfies Sticky, editing: false, onEdit() {}, onDone() {} },
    selected,
    connectable: false,
    zIndex: STICKY_Z,
  });

  it("knows how far React Flow lifts a selected node", () => {
    expect(stacking([box("web", true)]).web).toBe(SELECTED_LIFT);
  });

  it("keeps a note over a selected box under it", () => {
    // React Flow lifts the box it has selected, which would then cover the note and take its clicks.
    const z = stacking(withFrame([box("web", true), box("api"), note("todo")], system, true));
    expect(z["sticky:todo"]).toBeGreaterThan(z.web!);
    // The box is still lifted over the other boxes, so one being dragged passes over them.
    expect(z.web).toBeGreaterThan(z.api!);
    expect(z.api).toBeGreaterThan(z.__frame!);
  });

  it("lifts a selected note over the other notes", () => {
    const z = stacking([box("web"), note("todo", true), note("later")]);
    expect(z["sticky:todo"]).toBeGreaterThan(z["sticky:later"]!);
    expect(z["sticky:later"]).toBeGreaterThan(z.web!);
  });
});
