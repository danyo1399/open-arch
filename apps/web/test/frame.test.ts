import type { ArchElement } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { withFrame } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, FrameFlowNode } from "../src/canvas/nodes.js";

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
});
