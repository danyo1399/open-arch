import type { ArchElement } from "@open-arch/core";
import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { frameAt, withFrame } from "../src/canvas/Canvas.js";
import { nodeTypes, type ElementFlowNode, type FrameFlowNode } from "../src/canvas/nodes.js";

describe("withFrame", () => {
  const system = { id: "shop", kind: "system", name: "Shop" } as ArchElement;
  const box = (id: string, x: number): ElementFlowNode => ({
    id,
    type: "element",
    position: { x, y: 0 },
    data: { element: { id, kind: "container", name: id, parent: "shop" } as ArchElement, problems: 0 },
  });
  const frameOf = (nodes: ReturnType<typeof withFrame>) => nodes.find((n): n is FrameFlowNode => n.type === "frame")!;

  it("keeps a selected frame under the boxes inside it", () => {
    // React Flow lifts a node it thinks is selected above the others, where the frame would take the boxes' clicks.
    const frame = frameOf(withFrame([box("web", 0), box("api", 300)], system, true));
    expect(frame).toMatchObject({ selectable: false, zIndex: -1, data: { selected: true } });
    expect(frame.selected).toBeFalsy();
  });

  it("keeps the frame's highlight while boxes move, until the selection changes", () => {
    const selected = withFrame([box("web", 0)], system, true);
    const moved = withFrame([frameOf(selected), box("web", 50)], system);
    expect(frameOf(moved).position.x).toBe(50 - 40);
    expect(frameOf(moved).data.selected).toBe(true);
    expect(frameOf(withFrame(moved, system, false)).data.selected).toBe(false);
  });

  it("lets a drag that starts on the frame reach the background, to draw a selection box", () => {
    // React Flow gives a node it can click pointer events in its own style, which the node's style overrides.
    const nodes = withFrame([{ ...box("web", 0), width: 200, height: 90 }], system);
    const flow = createElement(ReactFlow, { nodes, nodeTypes, onNodeClick: () => {} });
    const html = renderToString(createElement(ReactFlowProvider, { initialNodes: nodes, initialWidth: 1000, initialHeight: 800, children: flow }));
    const style = (id: string) => html.match(new RegExp(`<div [^>]*style="([^"]*)"[^>]*data-id="${id}"`))?.[1];
    expect(style("__frame")).toContain("pointer-events:none");
    expect(style("web")).toContain("pointer-events:all");
  });

  it("finds the frame under a click on the background", () => {
    const nodes = withFrame([box("web", 0), box("api", 300)], system);
    // Round the boxes: 40 either side, 56 above and 40 below.
    expect(frameAt(nodes, { x: -40, y: -56 })).toBe(frameOf(nodes));
    expect(frameAt(nodes, { x: 250, y: 100 })).toBe(frameOf(nodes));
    expect(frameAt(nodes, { x: -41, y: 0 })).toBeUndefined();
    expect(frameAt(nodes, { x: 0, y: 200 })).toBeUndefined();
    expect(frameAt([box("web", 0)], { x: 0, y: 0 })).toBeUndefined();
  });
});
