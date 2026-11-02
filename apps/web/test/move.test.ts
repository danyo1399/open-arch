import { applyOperations, buildWorkspace, loadWorkspace, serializeDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { moveOps } from "../src/canvas/Canvas.js";

describe("moveOps", () => {
  const ws = buildWorkspace({
    openarch: 5,
    name: "Shop",
    elements: { web: { kind: "system", name: "Web" }, db: { kind: "system", name: "DB" } },
    views: { landscape: { title: "Landscape", level: "landscape", layout: { web: [0, 0], db: [300, 0] }, stickies: { a: { text: "A" }, b: { text: "B", at: [0, 200] } } } },
  });

  it("saves boxes and notes dragged together as one edit, so one Undo takes it back", () => {
    const ops = moveOps("landscape", { web: [50, 50], db: [350, 50] }, { a: [600, 0], b: [50, 250] });
    expect(ops).toEqual([
      { op: "set-layout", view: "landscape", positions: { web: [50, 50], db: [350, 50] } },
      { op: "update-sticky", view: "landscape", id: "a", at: [600, 0] },
      { op: "update-sticky", view: "landscape", id: "b", at: [50, 250] },
    ]);
    const view = loadWorkspace(serializeDocument(applyOperations(ws.doc, ops).doc)).views.get("landscape")!;
    expect(view.layout).toEqual({ web: [50, 50], db: [350, 50] });
    expect(view.stickies.map((s) => s.at)).toEqual([[600, 0], [50, 250]]);
  });

  it("leaves the boxes as they are when only notes moved", () => {
    expect(moveOps("landscape", null, { a: [600, 0] })).toEqual([{ op: "update-sticky", view: "landscape", id: "a", at: [600, 0] }]);
  });
});
