// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Designer } from "../src/Designer.js";
import { FolderHost } from "../src/folders.js";
import type { DesktopBridge } from "../src/bridge.js";
import { DesktopHost, MemoryHost } from "../src/hosts.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const shop = (docs: string) =>
  JSON.stringify({
    openarch: 21,
    name: "Shop",
    export: { docs },
    elements: { shop: { kind: "system", name: "Shop" } },
    views: { context: { title: "Shop context", level: "context", scope: "shop" } },
  });

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(done()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

const NESTED = "The docs folder, docs/architecture/, is relative to the workspace file, which is in docs/architecture/ already, so the docs would go in docs/architecture/docs/architecture/. They aren't written there.";

describe("a docs folder that repeats the file's own folder, in the designer", () => {
  it("is a problem, said in the workspace's details, which keeps the docs beside the file in one click", async () => {
    const root = new FakeFolder("repo");
    root.put("docs/architecture/shop.openarch", shop("docs/architecture"));
    const host = mount(createElement(Designer, { host: new FolderHost("f1", root, "docs/architecture/shop.openarch"), onClose() {}, onHostChange() {} }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".problems .count.warn")?.textContent).toBe("1");
    // The status doesn't say the docs are kept where nothing writes them.
    expect(host.querySelector(".storage")?.textContent).toBe("Saved");
    // No page is written for Copy path to point to, so it says why, copies nothing, and shows the fix.
    const written = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await click(button(host, "Export"));
    const items = () => [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')];
    const labels = () => items().map((item) => item.textContent?.trim());
    expect(labels()).toContain("Copy path");
    await click(items().find((item) => item.textContent?.trim() === "Copy path")!);
    expect(written).not.toHaveBeenCalled();
    expect(host.textContent).toContain(`There's no page for “Shop context” to copy the path of, as the docs aren't written. ${NESTED} Keep docs beside the file, in the workspace's details, fixes it.`);
    expect(host.querySelector(".props-header .badge")?.textContent).toBe("Workspace");
    expect(Object.keys(root.files())).toEqual(["docs/architecture/shop.openarch"]);
    // Opening the problem shows the workspace's details, which say it and offer the fix.
    if (!host.querySelector(".problem")) await click(button(host, "Problems"));
    await click(host.querySelector<HTMLButtonElement>(".problem")!);
    expect(host.querySelector(".props-header .badge")?.textContent).toBe("Workspace");
    expect(host.querySelector(".props-header")?.parentElement?.textContent).toContain(NESTED);
    await click(button(host, "Keep docs beside the file"));
    await until(() => !!root.files()["docs/architecture/README.md"]);
    expect(JSON.parse(root.files()["docs/architecture/shop.openarch"]!).export).toEqual({ docs: "." });
    expect(root.files()["docs/architecture/views/context.md"]).toContain("# Shop context");
    expect(Object.keys(root.files()).some((path) => path.startsWith("docs/architecture/docs/"))).toBe(false);
    const details = () => host.querySelector(".props-header")?.parentElement?.textContent;
    expect(details()).not.toContain(NESTED);
    expect(details()).not.toContain("Keep docs beside the file");
    expect(host.querySelector(".problems .count")?.textContent).toBe("0");
    expect(host.querySelector(".storage")?.textContent).toBe("Saved · docs in ./");
    await click(button(host, "Export"));
    await click(items().find((item) => item.textContent?.trim() === "Copy path")!);
    await until(() => !!host.textContent?.includes("Copied the path"));
    expect(written).toHaveBeenCalledWith("docs/architecture/views/context.md");
  });

  it("is a problem in the desktop app, from the file's folder in its repository the app gives", async () => {
    let text = shop("docs/architecture");
    const bridge = {
      load: async () => text,
      save: async (_path: string, next: string) => {
        text = next;
        return { docs: { dir: ".", written: 1, deleted: 0, skipped: [] } };
      },
      watch: () => () => {},
    } as unknown as DesktopBridge;
    const file = "C:\\work\\shop\\docs\\architecture\\shop.openarch";
    const host = mount(createElement(Designer, { host: new DesktopHost(bridge, file, "shop.openarch", undefined, "docs/architecture"), onClose() {}, onHostChange() {} }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".problems .count.warn")?.textContent).toBe("1");
    await click(host.querySelector<HTMLButtonElement>(".ws-name")!);
    expect(host.textContent).toContain(NESTED);
    await click(button(host, "Keep docs beside the file"));
    await until(() => JSON.parse(text).export.docs === ".");
    await until(() => host.querySelector(".problems .count")?.textContent === "0");
  });

  it("isn't one for folders above the repository, which the desktop app leaves out", async () => {
    const bridge = { load: async () => shop("docs/architecture"), watch: () => () => {} } as unknown as DesktopBridge;
    const host = mount(createElement(Designer, { host: new DesktopHost(bridge, "/home/me/docs/architecture/shop.openarch", "shop.openarch", undefined, ""), onClose() {}, onHostChange() {} }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".problems .count")?.textContent).toBe("0");
  });

  it("isn't a problem where nothing writes the docs", async () => {
    const host = mount(createElement(Designer, { host: new MemoryHost("shop.openarch", shop("docs/architecture")), onClose() {}, onHostChange() {} }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".problems .count")?.textContent).toBe("0");
    await click(host.querySelector<HTMLButtonElement>(".ws-name")!);
    expect(host.querySelector(".props-header .badge")?.textContent).toBe("Workspace");
    expect(host.textContent).not.toContain("aren't written there");
  });
});
