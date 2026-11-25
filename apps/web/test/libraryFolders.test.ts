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

/** The folders opened, kept in memory. A browser's IndexedDB keeps a handle's methods; fake-indexeddb's copy drops them. */
class MemoryFolders {
  records: StoredFolder[] = [];
  async list() {
    return [...this.records];
  }
  async get(id: string) {
    return this.records.find((r) => r.id === id);
  }
  /** Opening one again moves it to the top, as FolderList does. */
  async add(root: FolderHandle, path: string, name = this.records.find((r) => r.root === root && r.path === path)?.name) {
    const known = this.records.find((r) => r.root === root && r.path === path);
    const record = { id: known?.id ?? `f${this.records.length + 1}`, root, path, ...(name === undefined ? {} : { name }), opened: Date.UTC(2026, 0, 1) };
    this.records = [record, ...this.records.filter((r) => r !== known)];
    return record;
  }
  async rename(id: string, name: string) {
    this.records = this.records.map((r) => (r.id === id ? { ...r, name } : r));
  }
  async remove(id: string) {
    this.records = this.records.filter((r) => r.id !== id);
  }
}

const workspace = (name: string) => JSON.stringify({ openarch: 21, name, elements: {}, views: {} });

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
  it("says why the folders couldn't be listed even when what failed has no message", async () => {
    picker();
    const folders = new MemoryFolders();
    folders.list = () => Promise.reject(undefined);
    const { host } = page(folders);
    await until(host, "Something went wrong, and no reason was given.");
  });

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

  it("offers to create one where there's none, with the docs beside it, where open-arch init puts them", async () => {
    picker();
    const root = new FakeFolder("my-repo");
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "No workspace in my-repo");
    await click(button(host, "Create architecture.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    const doc = loadWorkspace(root.files()["architecture.openarch"]!).doc;
    expect(doc).toMatchObject({ name: "My Repo", export: { docs: "." } });
    // No agent skill or AGENTS.md: only the file and its docs.
    expect(Object.keys(root.files()).sort()).toEqual(["README.md", "architecture.openarch"]);
    expect(root.files()["README.md"]).toContain("# My Repo");
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["architecture.openarch"]);
  });

  it("creates it in a folder of its own at a Git repository's top, apart from the repository's README.md", async () => {
    picker();
    const root = new FakeFolder("my-repo");
    root.put(".git/HEAD", "ref: refs/heads/main");
    root.put("README.md", "# Mine");
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "Create architecture/architecture.openarch there, with its docs beside it?");
    await click(button(host, "Create architecture/architecture.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(loadWorkspace(root.files()["architecture/architecture.openarch"]!).doc).toMatchObject({ name: "My Repo", export: { docs: "." } });
    expect(root.files()["architecture/README.md"]).toContain("# My Repo");
    expect(root.files()["README.md"]).toBe("# Mine");
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["architecture/architecture.openarch"]);
  });

  it("creates it in a folder of its own in a folder with other things in it, and its docs in docs/architecture where that folder has things too", async () => {
    picker();
    const root = new FakeFolder("notes");
    root.put("README.md", "# Mine");
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "Create architecture/architecture.openarch there, with its docs beside it?");
    await click(button(host, "Create architecture/architecture.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(root.files()["README.md"]).toBe("# Mine");
    expect(root.files()["architecture/README.md"]).toContain("# Notes");
    expect(opened.map((h) => (h as FolderHost).path)).toEqual(["architecture/architecture.openarch"]);

    const busy = new FakeFolder("site");
    busy.put("architecture/README.md", "# Drawings");
    picked = busy;
    await click(button(host, "Open folder…"));
    await until(host, "Create architecture/architecture.openarch there, with its docs in docs/architecture/ beside it?");
    await click(button(host, "Create architecture/architecture.openarch"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(loadWorkspace(busy.files()["architecture/architecture.openarch"]!).doc.export).toEqual({ docs: "docs/architecture" });
    expect(busy.files()["architecture/README.md"]).toBe("# Drawings");
    expect(busy.files()["architecture/docs/architecture/README.md"]).toContain("# Site");
  });

  it("says plainly when a file named architecture is where the workspace's folder would go", async () => {
    picker();
    const root = new FakeFolder("site");
    root.put("index.html", "<p>Hi</p>");
    root.put("architecture", "notes");
    picked = root;
    const { host, opened } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "site has a file named architecture, so a folder of that name can't be made for the workspace. Rename that file, or open a folder of its own for the workspace.");
    expect(opened).toEqual([]);
    expect(Object.keys(root.files()).sort()).toEqual(["architecture", "index.html"]);
  });

  it("says so, and lists the new workspace to open, when its docs can't be written", async () => {
    picker();
    const root = new FakeFolder("repo");
    root.refuse.add("README.md");
    picked = root;
    const { host, opened, folders } = page();
    await until(host, "Folders");
    await click(button(host, "Open folder…"));
    await until(host, "No workspace in repo");
    await click(button(host, "Create architecture.openarch"));
    await until(host, "Created architecture.openarch in repo, but couldn't write its docs beside it: Not allowed. Open it from Folders once that's fixed.");
    expect(opened).toEqual([]);
    expect(Object.keys(root.files())).toEqual(["architecture.openarch"]);
    expect(folders.records.map((r) => r.path)).toEqual(["architecture.openarch"]);
    // By its name, with where it is.
    expect(host.querySelector(".library-open")?.textContent).toBe("Repo");
    expect(host.textContent).toContain("repo/architecture.openarch · opened");
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

  it("lists each by its workspace's name, with the folder and the path in it, to tell folders of the same name apart", async () => {
    picker();
    const folders = new MemoryFolders();
    const shop = new FakeFolder("docs");
    shop.put("arch/architecture.openarch", workspace("Shop"));
    const billing = new FakeFolder("docs");
    billing.put("architecture.openarch", workspace("Billing"));
    await folders.add(billing, "architecture.openarch", "Billing");
    // One listed before names were kept: it goes by its folder's name until it's opened.
    await folders.add(shop, "arch/architecture.openarch");
    const { host, opened } = page(folders);
    await until(host, "architecture.openarch · opened");
    const items = () => [...host.querySelectorAll('[aria-label="Folders"] li')].map((li) => [li.querySelector(".library-open")?.textContent, li.querySelector(".library-meta")?.textContent?.replace(/ · opened.*/, "")]);
    expect(items()).toEqual([
      ["docs", "docs/arch/architecture.openarch"],
      ["Billing", "docs/architecture.openarch"],
    ]);

    // Opened, the designer reads the file, and the list has its name from then on.
    await click(button(host, "docs"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    await opened[0]!.load();
    expect(folders.records.map((r) => r.name)).toEqual(["Shop", "Billing"]);
    const again = page(folders);
    await until(again.host, "architecture.openarch · opened");
    expect([...again.host.querySelectorAll(".library-open")].slice(0, 2).map((b) => b.textContent)).toEqual(["Shop", "Billing"]);
  });
});
