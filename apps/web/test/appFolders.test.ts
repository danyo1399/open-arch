// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { FolderList, StoredFolder } from "../src/folders.js";
import { button, click, mount, type } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const workspace = JSON.stringify({ openarch: 11, name: "Repo", elements: {}, views: {} });

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
    const host = mount(createElement(App, { folders: foldersWith(root) }));
    await until(() => !!host.querySelector(".ws-name"));
    expect(host.querySelector(".ws-name")?.textContent).toBe("Repo");
    expect(host.querySelector(".storage")?.textContent).toBe("Saved");
    expect(location.hash).toBe("#folder/f1");
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
  const withDocs = JSON.stringify({ openarch: 11, name: "Repo", export: { docs: "docs" }, elements: {}, views: {} });

  /** Opens repo/a.openarch, as reloading the page with it open does. */
  async function open(root: FakeFolder) {
    history.replaceState(null, "", "/#folder/f1");
    const host = mount(createElement(App, { folders: foldersWith(root) }));
    await until(() => !!host.querySelector(".ws-name"));
    return host;
  }
  const status = (host: HTMLElement) => host.querySelector(".storage")?.textContent;
  const hasButton = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === text);

  it("says where the docs are, or that they weren't written, and doesn't offer to export them", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", withDocs);
    const host = await open(root);
    expect(status(host)).toBe("Saved · docs in docs/");
    expect(hasButton(host, "Export docs")).toBe(false);

    // The docs folder can't be made, so a save writes the file but not the docs.
    root.refuse.add("docs");
    await click(host.querySelector(".ws-name")!);
    const field = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Name");
    const name = field!.querySelector("input")!;
    await type(name, "Repo 2");
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await until(() => !!host.querySelector('.properties [role="alert"]'));
    expect(JSON.parse(root.files()["a.openarch"]!).name).toBe("Repo 2");
    expect(status(host)).toBe("Saved");
    expect(host.querySelector('.properties [role="alert"]')?.textContent).toBe("Saved, but the docs in docs/ weren't updated: Not allowed.");
    // The message bar says so too.
    expect(host.textContent).toContain("Saved, but the docs in docs/ weren't updated: Not allowed.×");
  });

  it("offers to export the docs once the file's gone, as nothing saves them any more", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", withDocs);
    const host = await open(root);
    root.entries.delete("a.openarch");
    // Gone once it's missing for a whole interval between checks, which are 1.5 seconds apart.
    await until(() => status(host) !== "Saved · docs in docs/", 1000);
    expect(host.textContent).toContain("The workspace file was deleted or moved.");
    expect(hasButton(host, "Export docs")).toBe(true);
  }, 10_000);
});
