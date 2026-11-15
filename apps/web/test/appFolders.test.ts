// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import type { FolderList, StoredFolder } from "../src/folders.js";
import { mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const workspace = JSON.stringify({ openarch: 11, name: "Repo", elements: {}, views: {} });

/** The folders opened, with one: repo/a.openarch, as f1. */
function foldersWith(root: FakeFolder) {
  const records: StoredFolder[] = [{ id: "f1", root, path: "a.openarch", opened: 1 }];
  return {
    list: async () => records,
    get: async (id: string) => records.find((r) => r.id === id),
    add: async () => records[0]!,
    remove: async () => {},
  } as unknown as FolderList;
}

/** Lets the app's work finish, until `done` says so. */
const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};

afterEach(() => {
  history.replaceState(null, "", "/");
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("reloading the page with a workspace in a folder open", () => {
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
