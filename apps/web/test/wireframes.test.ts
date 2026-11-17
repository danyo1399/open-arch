import { buildWorkspace, computeView, type OpenArchDocument } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { followRenames, shownInProperties, viewAction, wireframeDeleteOps, wireframeSelectionGone } from "../src/model.js";

const doc: OpenArchDocument = {
  openarch: 16,
  name: "Shop",
  elements: { shop: { kind: "system", name: "Shop" }, web: { kind: "container", name: "Web App", parent: "shop" } },
  views: {
    checkout: {
      title: "Checkout",
      level: "wireframe",
      scope: "web",
      screens: [
        { id: "cart", name: "Cart", widgets: [{ id: "actions", kind: "row", widgets: [{ id: "pay", kind: "button", to: "done" }] }] },
        { id: "done", name: "Done" },
      ],
    },
  },
};

const ws = buildWorkspace(doc);
const view = ws.views.get("checkout")!;

describe("the designer's model of a wireframe view", () => {
  it("shows a selected screen or widget in the details, wherever the widget is, and the view once it's gone", () => {
    expect(shownInProperties(ws, view, { kind: "screen", id: "done" })).toEqual({ kind: "screen", view, screen: view.screens[1] });
    expect(shownInProperties(ws, view, { kind: "widget", id: "pay" })).toEqual({ kind: "widget", view, widget: view.screens[0]!.widgets[0]!.widgets[0] });
    expect(shownInProperties(ws, view, { kind: "widget", id: "gone" })).toEqual({ kind: "view", view });
    expect(shownInProperties(ws, view, { kind: "screen", id: "gone" })).toEqual({ kind: "view", view });
  });

  it("deletes a selected screen or widget, and nothing else", () => {
    expect(wireframeDeleteOps(view, { kind: "screen", id: "cart" })).toEqual([{ op: "remove-screen", view: "checkout", id: "cart" }]);
    expect(wireframeDeleteOps(view, { kind: "widget", id: "pay" })).toEqual([{ op: "remove-widget", view: "checkout", id: "pay" }]);
    expect(wireframeDeleteOps(view, { kind: "sticky", id: "note" })).toEqual([]);
    expect(wireframeDeleteOps(view, null)).toEqual([]);
  });

  it("knows when a selected screen or widget is no longer in the view", () => {
    expect(wireframeSelectionGone(view, { kind: "widget", id: "pay" })).toBe(false);
    expect(wireframeSelectionGone(view, { kind: "widget", id: "gone" })).toBe(true);
    expect(wireframeSelectionGone(view, { kind: "screen", id: "done" })).toBe(false);
    expect(wireframeSelectionGone(view, { kind: "screen", id: "gone" })).toBe(true);
    expect(wireframeSelectionGone(undefined, { kind: "widget", id: "pay" })).toBe(true);
    expect(wireframeSelectionGone(view, { kind: "sticky", id: "note" })).toBe(false);
  });

  it("follows a renamed view in edits to its screens and widgets", () => {
    const renames = [{ op: "rename" as const, id: "checkout", to: "buying" }];
    expect(followRenames([{ op: "add-screen", view: "checkout", id: "home" }], renames)).toEqual([{ op: "add-screen", view: "buying", id: "home" }]);
    expect(followRenames([{ op: "update-widget", view: "checkout", id: "pay", to: "done" }], renames)).toEqual([{ op: "update-widget", view: "buying", id: "pay", to: "done" }]);
    expect(followRenames([{ op: "remove-widget", view: "checkout", id: "pay" }], renames)).toEqual([{ op: "remove-widget", view: "buying", id: "pay" }]);
  });

  it("has no elements to show or hide", () => {
    const computed = computeView(ws, view);
    expect(viewAction(ws, view, computed, "shop")).toBeNull();
    expect(viewAction(ws, view, computed, "web")).toBeNull();
  });
});
