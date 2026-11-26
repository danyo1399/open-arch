// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import type { FolderList, StoredFolder } from "../src/folders.js";
import { button, click, mount, type } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const workspace = JSON.stringify({ openarch: 22, name: "Repo", elements: {}, views: {} });

/** The folders opened, with one: repo/a.openarch, as f1. */
function foldersWith(root: FakeFolder) {
  const records: StoredFolder[] = [{ id: "f1", root, path: "a.openarch", opened: 1 }];
  return {
    list: async () => records,
    get: async (id: string) => records.find((r) => r.id === id),
    add: async (root: FakeFolder, path: string) => {
      const record = { id: `f${records.length + 1}`, root, path, opened: 2 };
      records.unshift(record);
      return record;
    },
    rename: async (id: string, name: string) => {
      const record = records.find((r) => r.id === id);
      if (record) record.name = name;
    },
    remove: async () => {},
  } as unknown as FolderList;
}

/** Lets the app's work finish, until `done` says so. */
const until = async (done: () => boolean, tries = 200) => {
  for (let i = 0; i < tries && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};

afterEach(() => {
  history.replaceState(null, "", "/");
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("reloading the page with a workspace in a folder open", () => {
  it("names a folder opened from the start page in the URL", async () => {
    const root = new FakeFolder("other");
    root.put("b.openarch", workspace);
    Object.assign(window, { showDirectoryPicker: async () => root });
    const host = mount(createElement(App, { folders: foldersWith(new FakeFolder("repo")) }));
    await until(() => !!host.textContent?.includes("Open folder…"));
    expect(location.hash).toBe("");
    await click(button(host, "Open folder…"));
    await until(() => !!host.querySelector(".ws-name"));
    expect(location.hash).toBe("#folder/f2");
  });

  it("reopens it when the browser still allows it, and keeps it in the URL", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace);
    history.replaceState(null, "", "/#folder/f1");
    const folders = foldersWith(root);
    const host = mount(createElement(App, { folders }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".ws-name")?.textContent).toBe("Repo");
    expect(host.querySelector(".storage")?.textContent).toBe("Saved");
    expect(location.hash).toBe("#folder/f1");
    // The start page lists it by its name from now on.
    expect((await folders.list())[0]?.name).toBe("Repo");
  });

  it("says it couldn't open a file that's gone, and opens it once it's back", async () => {
    const root = new FakeFolder("repo");
    history.replaceState(null, "", "/#folder/f1");
    const host = mount(createElement(App, { folders: foldersWith(root) }));
    await until(() => !!host.textContent?.includes("Couldn't open the workspace"));
    expect(host.textContent).toContain("repo/a.openarch isn't there any more.");
    root.put("a.openarch", workspace);
    await until(() => !!host.querySelector(".ws-name"), 1000);
    expect(host.querySelector(".ws-name")?.textContent).toBe("Repo");
  }, 10_000);

  it("shows the start page, with the folder listed, when the browser would have to ask", async () => {
    Object.assign(window, { showDirectoryPicker: async () => null });
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace);
    root.permission = "prompt";
    history.replaceState(null, "", "/#folder/f1");
    const host = mount(createElement(App, { folders: foldersWith(root) }));
    await until(() => !!host.textContent?.includes("a.openarch · opened"));
    expect(host.querySelector(".ws-name")).toBeNull();
    expect(location.hash).toBe("");
    expect(root.permission).toBe("prompt");
  });

  it("shows the start page for a folder that was forgotten", async () => {
    history.replaceState(null, "", "/#folder/gone");
    const host = mount(createElement(App, { folders: foldersWith(new FakeFolder("repo")) }));
    await until(() => !!host.textContent?.includes("Your workspaces"));
    expect(host.querySelector(".ws-name")).toBeNull();
    expect(location.hash).toBe("");
  });
});

describe("the designer with a workspace in a folder", () => {
  const withDocs = JSON.stringify({ openarch: 22, name: "Repo", export: { docs: "docs" }, elements: {}, views: {} });

  /** Opens repo/a.openarch, as reloading the page with it open does. */
  async function open(root: FakeFolder, folders = foldersWith(root)) {
    history.replaceState(null, "", "/#folder/f1");
    const host = mount(createElement(App, { folders }));
    await until(() => !!host.querySelector(".ws-name"));
    return host;
  }
  const status = (host: HTMLElement) => host.querySelector(".storage")?.textContent;
  const hasButton = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === text);

  it("says where the docs are, or that they weren't written, and doesn't offer a zip", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", withDocs);
    const folders = foldersWith(root);
    const host = await open(root, folders);
    expect(status(host)).toBe("Saved · docs in docs/");
    expect(hasButton(host, "Export zip")).toBe(false);
    await click(host.querySelector(".ws-name")!);
    // Its details name the file as the top bar does.
    expect(host.querySelector(".properties .props-header code")?.textContent).toBe("repo/a.openarch");
    // A folder's saves don't write the agent skill or AGENTS.md, so its details don't say they do.
    expect(host.querySelector(".properties")?.textContent).not.toContain("agent skill");

    // The docs folder can't be made, so a save writes the file but not the docs.
    root.refuse.add("docs");
    const field = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Name");
    const name = field!.querySelector("input")!;
    await type(name, "Repo 2");
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await until(() => !!host.querySelector('.properties [role="alert"]'));
    expect(JSON.parse(root.files()["a.openarch"]!).name).toBe("Repo 2");
    // The start page lists it by the new name.
    expect((await folders.list())[0]?.name).toBe("Repo 2");
    expect(status(host)).toBe("Saved");
    expect(host.querySelector('.properties [role="alert"]')?.textContent).toBe("Saved, but the docs in docs/ weren't updated: Not allowed.");
    // The message bar says so too.
    expect(host.textContent).toContain("Saved, but the docs in docs/ weren't updated: Not allowed.×");
  });

  it("names the file with its folder and the path in it, in the top bar, which starts with the workspace's name", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", withDocs);
    const host = await open(root);
    expect(host.querySelector(".file-name")?.textContent).toBe("repo/a.openarch");
    expect(host.querySelector(".topbar")?.firstElementChild?.className).toContain("ws-name");
    expect(host.querySelector(".topbar")?.textContent?.startsWith("Reporepo/a.openarch")).toBe(true);
  });

  it("names the file the same way in the More menu on a narrow screen, where the top bar has no room for it", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const root = new FakeFolder("repo");
      root.put("a.openarch", withDocs);
      const host = await open(root);
      expect(host.querySelector(".file-name")).toBeNull();
      await click(host.querySelector('button[aria-label="More"]')!);
      expect(document.querySelector(".context-menu")?.textContent).toContain("repo/a.openarch · Saved · docs in docs/");
    } finally {
      window.matchMedia = real;
    }
  });

  it("leaves the file's name in the top bar at every width without the More menu, for as long as there's room", () => {
    // The More menu names the file only on a narrow screen (NARROW, in Designer.tsx), where the
    // top bar doesn't draw it. At any wider one it's the top bar's to show, so no rule that names
    // it, alone or with others, may hide it at some width: it gives way to the rest instead.
    const css = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].filter(([, selector]) => selector!.includes(".file-name"));
    expect(rules.length).toBeGreaterThan(0);
    for (const [, selector, body] of rules) expect(`${selector!.trim()} {${body}}`).not.toMatch(/display:\s*none/);
  });

  it("offers to export a zip once the file's gone, as nothing saves them any more", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", withDocs);
    const host = await open(root);
    root.entries.delete("a.openarch");
    // Gone once it's missing for a whole interval between checks, which are 1.5 seconds apart.
    await until(() => status(host) !== "Saved · docs in docs/", 1000);
    expect(host.textContent).toContain("The workspace file was deleted or moved.");
    expect(hasButton(host, "Export zip")).toBe(true);
    // It's zipped as the folder, with the docs where its saves put them.
    const blobs: Blob[] = [];
    const names: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => (blobs.push(blob as Blob), "blob:zip"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    await click(button(host, "Export zip"));
    expect(names).toEqual(["repo.zip"]);
    const files = Object.keys(unzipSync(new Uint8Array(await blobs[0]!.arrayBuffer())));
    expect(files).toContain("repo/a.openarch");
    expect(files).toContain("repo/docs/README.md");
    vi.restoreAllMocks();
  }, 10_000);
});
