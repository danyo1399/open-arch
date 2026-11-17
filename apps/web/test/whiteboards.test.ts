import { buildWorkspace, computeView, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { boardItemsOf, followRenames, selectBoard, shownInProperties, viewAction, whiteboardDeleteOps, whiteboardSelectionLeft } from "../src/model.js";

const doc: OpenArchDocument = {
  openarch: 17,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" } },
  views: {
    ideas: {
      title: "Ideas",
      level: "whiteboard",
      shapes: [
        { id: "cache", kind: "rectangle", text: "Cache", at: [0, 0] },
        { id: "db", kind: "ellipse", at: [300, 0] },
      ],
      arrows: [{ id: "reads", from: "cache", to: "db" }],
      stickies: { note: { text: "Rough!" } },
    },
  },
};

const ws = buildWorkspace(doc);
const view = ws.views.get("ideas")!;

describe("the designer's model of a whiteboard view", () => {
  it("selects one shape, arrow or note on its own, two or more together, or nothing", () => {
    expect(selectBoard({ shapes: ["cache"], arrows: [], stickies: [] })).toEqual({ kind: "shape", id: "cache" });
    expect(selectBoard({ shapes: [], arrows: ["reads"], stickies: [] })).toEqual({ kind: "boardArrow", id: "reads" });
    expect(selectBoard({ shapes: [], arrows: [], stickies: ["note"] })).toEqual({ kind: "sticky", id: "note" });
    expect(selectBoard({ shapes: ["cache"], arrows: ["reads"], stickies: [] })).toEqual({ kind: "board", shapes: ["cache"], arrows: ["reads"], stickies: [] });
    expect(selectBoard({ shapes: [], arrows: [], stickies: [] })).toBeNull();
    expect(boardItemsOf({ kind: "shape", id: "cache" })).toEqual({ shapes: ["cache"], arrows: [], stickies: [] });
    expect(boardItemsOf({ kind: "element", id: "shop" })).toEqual({ shapes: [], arrows: [], stickies: [] });
  });

  it("shows a selected shape, arrow, or what's selected together, in the details, and the view once they're gone", () => {
    expect(shownInProperties(ws, view, { kind: "shape", id: "db" })).toEqual({ kind: "shape", view, shape: view.shapes[1] });
    expect(shownInProperties(ws, view, { kind: "boardArrow", id: "reads" })).toEqual({ kind: "boardArrow", view, arrow: view.arrows[0] });
    expect(shownInProperties(ws, view, { kind: "board", shapes: ["cache", "db"], arrows: ["gone"], stickies: ["note"] })).toEqual({
      kind: "board",
      view,
      shapes: view.shapes,
      arrows: [],
      stickies: view.stickies,
    });
    // What's left of it, if only one is.
    expect(shownInProperties(ws, view, { kind: "board", shapes: ["db", "gone"], arrows: [], stickies: [] })).toEqual({ kind: "shape", view, shape: view.shapes[1] });
    expect(shownInProperties(ws, view, { kind: "shape", id: "gone" })).toEqual({ kind: "view", view });
    expect(shownInProperties(ws, view, { kind: "boardArrow", id: "gone" })).toEqual({ kind: "view", view });
  });

  it("deletes what's selected: the arrows first, as a shape takes its arrows with it, then the shapes and notes", () => {
    expect(whiteboardDeleteOps(view, { kind: "shape", id: "cache" })).toEqual([{ op: "remove-shape", view: "ideas", id: "cache" }]);
    expect(whiteboardDeleteOps(view, { kind: "boardArrow", id: "reads" })).toEqual([{ op: "remove-arrow", view: "ideas", id: "reads" }]);
    expect(whiteboardDeleteOps(view, { kind: "board", shapes: ["cache", "gone"], arrows: ["reads"], stickies: ["note"] })).toEqual([
      { op: "remove-arrow", view: "ideas", id: "reads" },
      { op: "remove-shape", view: "ideas", id: "cache" },
      { op: "remove-sticky", view: "ideas", id: "note" },
    ]);
    expect(whiteboardDeleteOps(view, { kind: "sticky", id: "note" })).toEqual([]);
    expect(whiteboardDeleteOps(view, null)).toEqual([]);
    const other = buildWorkspace({ ...doc, views: { ...doc.views, land: { title: "Land", level: "landscape" } } }).views.get("land")!;
    expect(whiteboardDeleteOps(other, { kind: "shape", id: "cache" })).toEqual([]);
  });

  it("leaves out of a selection what's no longer on the whiteboard, and keeps a selection that's all still there", () => {
    const all = { kind: "board" as const, shapes: ["cache", "db"], arrows: ["reads"], stickies: [] };
    expect(whiteboardSelectionLeft(view, all)).toBe(all);
    expect(whiteboardSelectionLeft(view, { kind: "board", shapes: ["cache", "gone"], arrows: ["reads"], stickies: [] })).toEqual({ kind: "board", shapes: ["cache"], arrows: ["reads"], stickies: [] });
    expect(whiteboardSelectionLeft(view, { kind: "board", shapes: ["gone"], arrows: ["reads"], stickies: [] })).toEqual({ kind: "boardArrow", id: "reads" });
    expect(whiteboardSelectionLeft(view, { kind: "shape", id: "gone" })).toBeNull();
    expect(whiteboardSelectionLeft(undefined, { kind: "shape", id: "cache" })).toBeNull();
    const element = { kind: "element" as const, id: "shop" };
    expect(whiteboardSelectionLeft(view, element)).toBe(element);
  });

  it("follows a renamed view in edits to its shapes and arrows", () => {
    const renames = [{ op: "rename" as const, id: "ideas", to: "sketch" }];
    expect(followRenames([{ op: "add-shape", view: "ideas", id: "box", kind: "rectangle" }], renames)).toEqual([{ op: "add-shape", view: "sketch", id: "box", kind: "rectangle" }]);
    expect(followRenames([{ op: "update-arrow", view: "ideas", id: "reads", to: [1, 2] }], renames)).toEqual([{ op: "update-arrow", view: "sketch", id: "reads", to: [1, 2] }]);
    expect(followRenames([{ op: "remove-shape", view: "ideas", id: "db" }], renames)).toEqual([{ op: "remove-shape", view: "sketch", id: "db" }]);
  });

  it("has no elements to show or hide", () => {
    expect(viewAction(ws, view, computeView(ws, view), "shop")).toBeNull();
  });
});
