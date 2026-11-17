import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { PANEL_LIMITS, Settings } from "../src/settings.js";

let dbCount = 0;
/** Each test gets its own database. */
const fresh = () => `settings-test-${++dbCount}`;

describe("view settings", () => {
  it("sorts views by name until another order is chosen, and keeps the choice", async () => {
    const name = fresh();
    const settings = new Settings(name);
    expect(await settings.viewOrder()).toBe("name");
    await settings.setViewOrder("level");
    expect(await settings.viewOrder()).toBe("level");
    expect(await new Settings(name).viewOrder()).toBe("level");
  });

  it("pins and unpins views, for each workspace on its own", async () => {
    const name = fresh();
    const settings = new Settings(name);
    expect(await settings.pins("browser/a")).toEqual([]);
    expect(await settings.setPinned("browser/a", "landscape", true)).toEqual(["landscape"]);
    expect(await settings.setPinned("browser/a", "context", true)).toEqual(["landscape", "context"]);
    expect(await settings.setPinned("browser/a", "landscape", true)).toEqual(["context", "landscape"]);
    expect(await settings.pins("browser/b")).toEqual([]);

    expect(await settings.setPinned("browser/a", "context", false)).toEqual(["landscape"]);
    expect(await new Settings(name).pins("browser/a")).toEqual(["landscape"]);
    expect(await settings.setPinned("browser/a", "landscape", false)).toEqual([]);
    expect(await settings.pins("browser/a")).toEqual([]);
  });

  it("doesn't lose pins made in another tab", async () => {
    const name = fresh();
    const tab = new Settings(name);
    const other = new Settings(name);
    await tab.setPinned("file/shop.openarch", "landscape", true);
    expect(await other.setPinned("file/shop.openarch", "context", true)).toEqual(["landscape", "context"]);
  });

  it("follows pinned views when they're renamed", async () => {
    const settings = new Settings(fresh());
    await settings.setPinned("w", "context", true);
    await settings.setPinned("w", "containers", true);
    expect(
      await settings.renamePins("w", [
        { op: "rename", id: "context", to: "shop-context" },
        { op: "rename", id: "shop-context", to: "store-context" },
        { op: "rename", id: "api", to: "orders-api" },
      ]),
    ).toEqual(["store-context", "containers"]);
    expect(await settings.renamePins("w", [{ op: "rename", id: "api", to: "orders-api" }])).toEqual(["store-context", "containers"]);
    expect(await settings.renamePins("other", [{ op: "rename", id: "context", to: "x" }])).toEqual([]);
  });

  it("gives a saved copy the pins, and forgets a workspace's pins", async () => {
    const settings = new Settings(fresh());
    await settings.setPinned("memory/shop.openarch", "landscape", true);
    await settings.setPins("browser/new", await settings.pins("memory/shop.openarch"));
    expect(await settings.pins("browser/new")).toEqual(["landscape"]);

    await settings.forget("browser/new");
    expect(await settings.pins("browser/new")).toEqual([]);
    expect(await settings.pins("memory/shop.openarch")).toEqual(["landscape"]);
  });
});

describe("snap settings", () => {
  it("lines up with other boxes, and not the grid, until changed, and keeps the change", async () => {
    const name = fresh();
    const settings = new Settings(name);
    expect(await settings.snap()).toEqual({ guides: true, grid: false });
    await settings.setSnap({ guides: false, grid: true });
    expect(await settings.snap()).toEqual({ guides: false, grid: true });
    expect(await new Settings(name).snap()).toEqual({ guides: false, grid: true });
    expect(await settings.setSnap({ guides: true })).toEqual({ guides: true, grid: true });
    expect(await settings.snap()).toEqual({ guides: true, grid: true });
  });

  it("doesn't lose a change made in another tab", async () => {
    const name = fresh();
    const tab = new Settings(name);
    const other = new Settings(name);
    await tab.setSnap({ grid: true });
    expect(await other.setSnap({ guides: false })).toEqual({ guides: false, grid: true });
    expect(await tab.snap()).toEqual({ guides: false, grid: true });
  });
});

describe("panel settings", () => {
  it("has both panels open, at their usual size, until changed, and keeps the change", async () => {
    const name = fresh();
    const settings = new Settings(name);
    expect(await settings.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: false });
    await settings.setPanels({ browseCollapsed: true, browseWidth: 300 });
    expect(await settings.panels()).toEqual({ browseCollapsed: true, detailsCollapsed: false, browseWidth: 300 });
    expect(await new Settings(name).panels()).toEqual({ browseCollapsed: true, detailsCollapsed: false, browseWidth: 300 });
    expect(await settings.setPanels({ detailsHeight: 250 })).toEqual({ browseCollapsed: true, detailsCollapsed: false, browseWidth: 300, detailsHeight: 250 });
  });

  it("puts a size back to the usual one when it's set to undefined", async () => {
    const settings = new Settings(fresh());
    await settings.setPanels({ browseWidth: 300, detailsWidth: 400 });
    expect(await settings.setPanels({ browseWidth: undefined })).toEqual({ browseCollapsed: false, detailsCollapsed: false, detailsWidth: 400 });
  });

  it("keeps sizes within their limits, in whole pixels, and leaves out what it can't use", async () => {
    const settings = new Settings(fresh());
    expect(await settings.setPanels({ browseWidth: 10, detailsWidth: 9000, detailsHeight: 200.4 })).toEqual({
      browseCollapsed: false,
      detailsCollapsed: false,
      browseWidth: PANEL_LIMITS.browseWidth.min,
      detailsWidth: PANEL_LIMITS.detailsWidth.max,
      detailsHeight: 200,
    });
    expect(await settings.setPanels({ browseWidth: Number.NaN, browseCollapsed: "yes" as unknown as boolean })).toEqual({
      browseCollapsed: false,
      detailsCollapsed: false,
      detailsWidth: PANEL_LIMITS.detailsWidth.max,
      detailsHeight: 200,
    });
  });

  it("doesn't lose a change made in another tab", async () => {
    const name = fresh();
    const tab = new Settings(name);
    const other = new Settings(name);
    await tab.setPanels({ detailsCollapsed: true });
    expect(await other.setPanels({ browseWidth: 320 })).toEqual({ browseCollapsed: false, detailsCollapsed: true, browseWidth: 320 });
    expect(await tab.panels()).toEqual({ browseCollapsed: false, detailsCollapsed: true, browseWidth: 320 });
  });
});
