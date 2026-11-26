// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { FolderHost } from "../src/folders.js";
import { MemoryHost } from "../src/hosts.js";
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

const NESTED = "The docs folder, docs/architecture/, is relative to the workspace file, which is in docs/architecture/ already, so the docs would go in docs/architecture/docs/architecture/. They aren't written there.";

describe("a docs folder that repeats the file's own folder, in the designer", () => {
  it("is a problem, said in the workspace's details, which keeps the docs beside the file in one click", async () => {
    const root = new FakeFolder("repo");
    root.put("docs/architecture/shop.openarch", shop("docs/architecture"));
    const host = mount(createElement(Designer, { host: new FolderHost("f1", root, "docs/architecture/shop.openarch"), onClose() {}, onHostChange() {} }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".problems .count.warn")?.textContent).toBe("1");
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
    expect(host.textContent).not.toContain(NESTED);
    expect(host.textContent).not.toContain("Keep docs beside the file");
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
