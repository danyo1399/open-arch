import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { Settings } from "../src/settings.js";

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
