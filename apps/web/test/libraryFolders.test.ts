// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { loadWorkspace } from "@open-arch/core";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderHost, type FolderHandle, type FolderList, type StoredFolder } from "../src/folders.js";
import type { WorkspaceHost } from "../src/hosts.js";
import { WorkspaceLibrary } from "../src/library.js";
import { LibraryPage } from "../src/LibraryPage.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

/** The folders opened, kept in memory: IndexedDB here can't keep a handle's methods, as a browser does. */
class MemoryFolders {
  records: StoredFolder[] = [];
  async list() {
    return [...this.records];
  }
  async get(id: string) {
    return this.records.find((r) => r.id === id);
  }
  /** Opening one again moves it to the top, as FolderList does. */
  async add(root: FolderHandle, path: string) {
    const known = this.records.find((r) => r.root === root && r.path === path);
    const record = { id: known?.id ?? `f${this.records.length + 1}`, root, path, opened: Date.UTC(2026, 0, 1) };
    this.records = [record, ...this.records.filter((r) => r !== known)];
    return record;
  }
  async remove(id: string) {
    this.records = this.records.filter((r) => r.id !== id);
  }
}

const workspace = (name: string) => JSON.stringify({ openarch: 11, name, elements: {}, views: {} });

let picked: FolderHandle | null = null;
const picker = () => Object.assign(window, { showDirectoryPicker: vi.fn(async () => picked) });

afterEach(() => {
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  picked = null;
});

/** Lets the page's work finish, until it shows `text`. */
const until = async (host: HTMLElement, text: string) => {
  for (let i = 0; i < 200 && !host.textContent?.includes(text); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(host.textContent).toContain(text);
};

function page(folders = new MemoryFolders()) {
  const opened: WorkspaceHost[] = [];
  const host = mount(createElement(LibraryPage, { library: new WorkspaceLibrary(`library-${Math.random()}`), folders: folders as unknown as FolderList, onOpen: (h: WorkspaceHost) => opened.push(h) }));
  return { host, opened, folders };
}

describe("opening a folder from the start page", () => {
  it("isn't offered where the browser can't change a folder's files", async () => {
    const { host } = page();
    await until(host, "Your workspaces");
    expect(host.textContent).not.toContain("Open folder…");
    expect(host.querySelector('[aria-label="Folders"]')).toBeNull();
  });

  it("opens the one workspace in the folder, and remembers it", async () => {
    picker();
    const root = new FakeFolder("repo");
    root.put("docs/arch.openarch", workspace("Repo"));
    picked = root;
    const { host, opened, folders } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toBeInstanceOf(FolderHost);
    expect(opened[0]).toMatchObject({ path: "docs/arch.openarch", root });
    expect(folders.records.map((r) => r.path)).toEqual(["docs/arch.openarch"]);
  });

  it("does nothing when the user cancels", async () => {
    picker();
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(opened).toEqual([]);
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("asks which, when there are several", async () => {
    picker();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    root.put("arch/b.openarch", workspace("B"));
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "Which workspace in repo?");
    await click(button(host, "arch/b.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["arch/b.openarch"]);
  });

  it("offers to create one where there's none, with the docs where open-arch init puts them", async () => {
    picker();
    const root = new FakeFolder("my-repo");
    root.put("README.md", "# Mine");
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "No workspace in my-repo");
    await click(button(host, "Create architecture.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const doc = loadWorkspace(root.files()["architecture.openarch"]!).doc;
    expect(doc).toMatchObject({ name: "My Repo", export: { docs: "docs/architecture" } });
    expect(Object.keys(root.files()).sort()).toEqual(["README.md", "architecture.openarch", "docs/architecture/README.md"]);
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["architecture.openarch"]);
  });

  it("says so, and lists the new workspace to open, when its docs can't be written", async () => {
    picker();
    const root = new FakeFolder("repo");
    root.put("README.md", "# Mine");
    root.refuse.add("docs");
    picked = root;
    const { host, opened, folders } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "No workspace in repo");
    await click(button(host, "Create architecture.openarch"));
    await until(host, "Created architecture.openarch in repo. Saved, but the docs in docs/architecture/ weren't updated: Not allowed. Open it from Folders once that's fixed.");
    expect(opened).toEqual([]);
    expect(Object.keys(root.files()).sort()).toEqual(["README.md", "architecture.openarch"]);
    expect(folders.records.map((r) => r.path)).toEqual(["architecture.openarch"]);
    expect(host.textContent).toContain("architecture.openarch · opened");
  });

  it("lists the folders opened, reopens one with the browser's permission, and forgets one", async () => {
    picker();
    const folders = new MemoryFolders();
    const repo = new FakeFolder("repo");
    repo.put("a.openarch", workspace("A"));
    repo.permission = "prompt";
    const locked = new FakeFolder("locked");
    locked.permission = "denied";
    await folders.add(locked, "l.openarch");
    await folders.add(repo, "a.openarch");
    const { host, opened } = page(folders);
    await until(host, "a.openarch · opened");
    expect(host.textContent).toContain("l.openarch · opened");

    await click(button(host, "repo"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(repo.permission).toBe("granted");
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["a.openarch"]);

    await click(button(host, "locked"));
    await until(host, "open-arch wasn't allowed to change the files in locked");
    expect(opened).toHaveLength(1);

    const item = [...host.querySelectorAll("li")].find((li) => li.textContent?.includes("l.openarch"))!;
    await click(button(item as HTMLElement, "Forget"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(folders.records.map((r) => r.path)).toEqual(["a.openarch"]);
    expect(host.textContent).not.toContain("l.openarch");
    // The folder itself is left as it was.
    expect(locked.files()).toEqual({});
  });
});
