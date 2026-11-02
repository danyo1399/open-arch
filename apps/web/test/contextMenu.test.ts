import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextMenu, placeMenu } from "../src/panels/ContextMenu.js";

describe("placeMenu", () => {
  const screen = { width: 1000, height: 800 };
  const size = { width: 200, height: 150 };

  it("opens a menu at the point when it fits", () => {
    expect(placeMenu({ x: 300, y: 200 }, size, screen)).toEqual({ x: 300, y: 200 });
  });

  it("moves a menu by the edge of the screen onto it", () => {
    expect(placeMenu({ x: 950, y: 780 }, size, screen)).toEqual({ x: 796, y: 646 });
    expect(placeMenu({ x: -20, y: 0 }, size, screen)).toEqual({ x: 4, y: 4 });
  });

  it("opens a submenu on the right of its list when there's room", () => {
    expect(placeMenu({ x: 500, y: 300, before: 340 }, size, screen)).toEqual({ x: 500, y: 300 });
  });

  it("opens a submenu on the left of its list when there's no room on the right", () => {
    // Its right edge goes where the list starts.
    expect(placeMenu({ x: 900, y: 300, before: 740 }, size, screen)).toEqual({ x: 540, y: 300 });
  });

  it("moves a submenu by the bottom of the screen up, still beside its list", () => {
    expect(placeMenu({ x: 500, y: 700, before: 340 }, size, screen)).toEqual({ x: 500, y: 646 });
  });

  describe("on a phone with a notch and a home indicator", () => {
    const insets = { top: 47, right: 44, bottom: 34, left: 44 };

    it("opens a menu at the point when it fits clear of them", () => {
      expect(placeMenu({ x: 300, y: 200 }, size, screen, insets)).toEqual({ x: 300, y: 200 });
    });

    it("keeps a menu by the bottom above the home indicator", () => {
      expect(placeMenu({ x: 300, y: 780 }, size, screen, insets)).toEqual({ x: 300, y: 612 });
    });

    it("keeps a menu by the sides or the top clear of the notch", () => {
      expect(placeMenu({ x: 950, y: 0 }, size, screen, insets)).toEqual({ x: 752, y: 51 });
      expect(placeMenu({ x: 10, y: 300 }, size, screen, insets)).toEqual({ x: 48, y: 300 });
    });

    it("opens a submenu on the left of its list when the notch leaves no room on the right", () => {
      // 200 wide at 760 would fit the screen, but not clear of the notch on the right.
      expect(placeMenu({ x: 760, y: 300, before: 600 }, size, screen, insets)).toEqual({ x: 400, y: 300 });
    });
  });
});

describe("ContextMenu", () => {
  const render = (items: Parameters<typeof ContextMenu>[0]["items"]) => renderToString(createElement(ContextMenu, { x: 0, y: 0, items, onClose: () => {} }));

  it("marks an item with a submenu as opening one, closed until it's chosen", () => {
    const html = render([{ label: "Add", items: [{ label: "Person", onSelect: () => {} }] }]);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Person");
  });

  it("draws a line above an item that starts a group", () => {
    const html = render([
      { label: "Person", onSelect: () => {} },
      { label: "Sticky note", divider: true, onSelect: () => {} },
    ]);
    expect(html.indexOf("<hr")).toBeGreaterThan(html.indexOf("Person"));
    expect(html.indexOf("<hr")).toBeLessThan(html.indexOf("Sticky note"));
  });
});
