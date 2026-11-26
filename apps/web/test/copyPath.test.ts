// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "../src/bridge.js";
import { Designer } from "../src/Designer.js";
import { FolderHost } from "../src/folders.js";
import { DesktopHost, MemoryHost, type WorkspaceHost } from "../src/hosts.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const shop = (docs?: string) =>
  JSON.stringify({
    openarch: 21,
    name: "Shop",
    ...(docs === undefined ? {} : { export: { docs } }),
    elements: { shop: { kind: "system", name: "Shop" } },
    views: { context: { title: "Shop context", level: "context", scope: "shop" } },
  });

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(done()).toBe(true);
};

afterEach(() => vi.restoreAllMocks());

/** The workspace open in the designer, on its one view, with the view's Export menu open. */
async function exportMenu(file: WorkspaceHost) {
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  await until(() => !!host.querySelector(".ws-name"));
  await click(button(host, "Export"));
  // The menu opens over the page, outside what the designer is drawn in.
  const items = () => [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')];
  return { host, labels: () => items().map((item) => item.textContent?.trim()), item: (label: string) => items().find((item) => item.textContent?.trim() === label)! };
}

describe("Copy path", () => {
  it("copies the path, in the folder opened, of the view's page in the docs, for an agent to read", async () => {
    const root = new FakeFolder("repo");
    root.put("arch/shop.openarch", shop("docs"));
    const written = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { host, labels, item } = await exportMenu(new FolderHost("f1", root, "arch/shop.openarch"));
    expect(labels()[0]).toBe("Copy path");
    expect(labels()[1]).toBe("Copy as Mermaid");
    await click(item("Copy path"));
    await until(() => !!host.textContent?.includes("Copied the path"));
    expect(written).toHaveBeenCalledWith("arch/docs/views/context.md");
    expect(host.textContent).toContain(
      "Copied the path to the page for “Shop context” in the docs, arch/docs/views/context.md. Paste it into a chat to have an agent, such as Claude, read it. It starts in repo, so start the agent there.",
    );
    // Nothing had written the docs since the file was made, so they're written now, and the file is left as it was.
    expect(root.files()["arch/docs/views/context.md"]).toContain("# Shop context");
    expect(root.files()["arch/shop.openarch"]).toBe(shop("docs"));
  });

  it("copies the full path in the desktop app, and has the app bring the docs up to date", async () => {
    const asked: [string, string][] = [];
    const bridge = {
      load: async () => shop("."),
      save: async () => ({ docs: null }),
      writeDocs: async (path: string, text: string) => (asked.push([path, text]), { dir: ".", written: 1, deleted: 0, skipped: [] }),
      watch: () => () => {},
    } as unknown as DesktopBridge;
    const written = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { host, item } = await exportMenu(new DesktopHost(bridge, "/work/shop.openarch", "shop.openarch"));
    await click(item("Copy path"));
    await until(() => !!host.textContent?.includes("Copied the path"));
    expect(written).toHaveBeenCalledWith("/work/views/context.md");
    expect(asked).toEqual([["/work/shop.openarch", shop(".")]]);
    expect(host.textContent).not.toContain("start the agent there");
  });

  it("says so when the docs couldn't be brought up to date, as the page may be missing or old", async () => {
    const root = new FakeFolder("repo");
    root.put("shop.openarch", shop("docs"));
    root.refuse.add("docs");
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { host, item } = await exportMenu(new FolderHost("f1", root, "shop.openarch"));
    await click(item("Copy path"));
    await until(() => !!host.textContent?.includes("Copied the path"));
    expect(host.textContent).toContain(
      "Copied the path to the page for “Shop context” in the docs, docs/views/context.md, but the docs couldn't be brought up to date, so it may be missing or out of date: Not allowed.",
    );
  });

  it("says so when the file at the page's path isn't one open-arch wrote, as it's left alone", async () => {
    const root = new FakeFolder("repo");
    root.put("shop.openarch", shop("docs"));
    root.put("docs/views/context.md", "My own notes.\n");
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { host, item } = await exportMenu(new FolderHost("f1", root, "shop.openarch"));
    await click(item("Copy path"));
    await until(() => !!host.textContent?.includes("Copied the path"));
    expect(host.textContent).toContain("docs/views/context.md, but open-arch didn't write the file there, so it was left alone and isn't the view's page.");
    expect(root.files()["docs/views/context.md"]).toBe("My own notes.\n");
  });

  it("isn't offered for a workspace that names no docs folder, as its saves write no page", async () => {
    const root = new FakeFolder("repo");
    root.put("shop.openarch", shop());
    const { labels } = await exportMenu(new FolderHost("f1", root, "shop.openarch"));
    expect(labels()[0]).toBe("Copy as Mermaid");
  });

  it("isn't offered for a workspace that isn't saved to a file, such as an example", async () => {
    const { labels } = await exportMenu(new MemoryHost("shop.openarch", shop("docs")));
    expect(labels()[0]).toBe("Copy as Mermaid");
  });
});
