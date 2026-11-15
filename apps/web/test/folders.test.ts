// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { emptyDocument, GENERATED_MARKER, loadWorkspace, serializeDocument } from "@open-arch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowed, findWorkspaces, FolderHost, FolderList, writeDocs, type FileHandle, type FolderHandle } from "../src/folders.js";
import { exampleHost } from "../src/hosts.js";

const notFound = () => Object.assign(new Error("A requested file or directory could not be found."), { name: "NotFoundError" });

/** A folder on disk, in memory, with the parts of the File System Access API the host uses. */
class FakeFolder implements FolderHandle {
  readonly kind = "directory";
  readonly entries = new Map<string, FakeFile | FakeFolder>();
  permission: PermissionState = "granted";
  constructor(readonly name: string) {}

  async *values() {
    yield* this.entries.values();
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFile) return entry;
    if (entry) throw Object.assign(new Error("It's a folder."), { name: "TypeMismatchError" });
    if (!options?.create) throw notFound();
    const file = new FakeFile(name, "");
    this.entries.set(name, file);
    return file;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFolder) return entry;
    if (entry) throw Object.assign(new Error("It's a file."), { name: "TypeMismatchError" });
    if (!options?.create) throw notFound();
    const folder = new FakeFolder(name);
    this.entries.set(name, folder);
    return folder;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw notFound();
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionState> {
    return this.permission === "prompt" ? (this.permission = "granted") : this.permission;
  }

  /** Writes a file at a path, making the folders on the way. */
  put(path: string, text: string): void {
    const parts = path.split("/");
    let dir: FakeFolder = this;
    for (const part of parts.slice(0, -1)) {
      if (!dir.entries.has(part)) dir.entries.set(part, new FakeFolder(part));
      dir = dir.entries.get(part) as FakeFolder;
    }
    const name = parts[parts.length - 1]!;
    const file = dir.entries.get(name);
    if (file instanceof FakeFile) file.set(text);
    else dir.entries.set(name, new FakeFile(name, text));
  }

  /** Every file below, by path. */
  files(prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, entry] of this.entries) {
      if (entry instanceof FakeFile) out[prefix + name] = entry.text;
      else Object.assign(out, entry.files(`${prefix}${name}/`));
    }
    return out;
  }

  folders(prefix = ""): string[] {
    return [...this.entries].flatMap(([name, entry]) => (entry instanceof FakeFolder ? [prefix + name, ...entry.folders(`${prefix}${name}/`)] : []));
  }
}

let clock = 1;

class FakeFile implements FileHandle {
  readonly kind = "file";
  lastModified = clock++;
  constructor(
    readonly name: string,
    public text: string,
  ) {}
  set(text: string) {
    this.text = text;
    this.lastModified = clock++;
  }
  async getFile() {
    return { lastModified: this.lastModified, size: this.text.length, text: async () => this.text };
  }
  async createWritable() {
    let next = "";
    return {
      write: async (data: string) => void (next += data),
      close: async () => this.set(next),
    };
  }
}

const workspace = (name: string, docs?: string) => {
  const doc = emptyDocument(name);
  if (docs) doc.export = { docs };
  return serializeDocument(doc);
};

afterEach(() => {
  vi.useRealTimers();
});

describe("finding workspaces in a folder", () => {
  it("looks three folders deep, nearest first, and skips hidden folders and node_modules", async () => {
    const root = new FakeFolder("repo");
    root.put("b/b.openarch", "");
    root.put("a.openarch", "");
    root.put("docs/arch/deep.openarch", "");
    root.put("one/two/three/too-deep.openarch", "");
    root.put(".git/hidden.openarch", "");
    root.put("node_modules/pkg/dep.openarch", "");
    root.put("README.md", "");
    expect(await findWorkspaces(root)).toEqual(["a.openarch", "b/b.openarch", "docs/arch/deep.openarch"]);
  });
});

describe("a workspace in a folder", () => {
  it("loads the file and saves every edit to it, with its docs", async () => {
    const root = new FakeFolder("repo");
    root.put("architecture.openarch", workspace("Shop", "docs/architecture"));
    const host = new FolderHost("1", root, "architecture.openarch");
    expect(host).toMatchObject({ name: "architecture.openarch", storage: "file", syncsDocs: true, key: "folder/1", location: "repo/architecture.openarch" });
    expect(await host.load()).toBe(workspace("Shop", "docs/architecture"));

    const summary = await host.save(workspace("Shop 2", "docs/architecture"));
    expect(root.files()["architecture.openarch"]).toBe(workspace("Shop 2", "docs/architecture"));
    expect(root.files()["docs/architecture/README.md"]).toContain("Shop 2");
    expect(root.files()["docs/architecture/README.md"]!.startsWith(GENERATED_MARKER)).toBe(true);
    expect(summary).toEqual({ dir: "docs/architecture", written: 1, deleted: 0, skipped: [] });
  });

  it("writes the docs folder relative to the file, wherever it is in the folder", async () => {
    const root = new FakeFolder("repo");
    const text = await exampleHost().load();
    root.put("arch/shop.openarch", text);
    const docs = loadWorkspace(text).doc.export!.docs!;
    const summary = await new FolderHost("1", root, "arch/shop.openarch").save(text);
    expect(summary?.dir).toBe(docs);
    expect(Object.keys(root.files())).toContain(`arch/${docs}/views/shop-containers.md`);
    expect(root.files()[`arch/${docs}/README.md`]).toContain("shop.openarch");
  });

  it("refuses a docs folder outside the folder opened, and saves nothing", async () => {
    const root = new FakeFolder("arch");
    root.put("shop.openarch", workspace("Shop"));
    const host = new FolderHost("1", root, "shop.openarch");
    await expect(host.save(workspace("Shop 2", "../docs"))).rejects.toThrow("outside the folder you opened, arch");
    await expect(host.save(workspace("Shop 2", "/docs"))).rejects.toThrow("must be relative");
    expect(root.files()).toEqual({ "shop.openarch": workspace("Shop") });
    // A docs folder that goes up and back in is inside it.
    root.put("sub/shop.openarch", workspace("Shop"));
    await new FolderHost("2", root, "sub/shop.openarch").save(workspace("Shop", "../docs"));
    expect(Object.keys(root.files())).toContain("docs/README.md");
  });

  it("refuses to save a workspace with structural errors", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    await expect(new FolderHost("1", root, "a.openarch").save("{ not json")).rejects.toThrow("Refusing to save");
    expect(root.files()["a.openarch"]).toBe(workspace("A"));
  });

  it("saves only the file when the workspace names no docs folder", async () => {
    const root = new FakeFolder("repo");
    expect(await new FolderHost("1", root, "a.openarch").save(workspace("A"))).toBeNull();
    expect(root.files()).toEqual({ "a.openarch": workspace("A") });
  });

  it("says when the file isn't there any more", async () => {
    await expect(new FolderHost("1", new FakeFolder("repo"), "gone.openarch").load()).rejects.toThrow("repo/gone.openarch isn't there any more.");
  });
});

describe("keeping the docs folder", () => {
  const page = (text: string) => `${GENERATED_MARKER} from a.openarch. -->\n${text}`;

  it("rewrites generated pages, deletes stale ones and their empty folders, and leaves everything else alone", async () => {
    const docs = new FakeFolder("docs");
    docs.put("README.md", page("old"));
    docs.put("same.md", page("same"));
    docs.put("notes.md", "Written by a person.");
    docs.put("views/stale.md", page("stale"));
    docs.put("old/deep/stale.md", page("stale"));
    docs.put("kept/stale.md", page("stale"));
    docs.put("kept/mine.md", "Mine.");
    docs.entries.set("untouched", new FakeFolder("untouched"));

    const result = await writeDocs(docs, [
      { path: "README.md", content: page("new") },
      { path: "same.md", content: page("same") },
      { path: "notes.md", content: page("would overwrite") },
      { path: "elements/api.md", content: page("api") },
    ]);
    expect(result).toEqual({ written: ["README.md", "elements/api.md"], deleted: ["views/stale.md", "old/deep/stale.md", "kept/stale.md"], skipped: ["notes.md"] });
    expect(docs.files()).toEqual({
      "README.md": page("new"),
      "same.md": page("same"),
      "notes.md": "Written by a person.",
      "kept/mine.md": "Mine.",
      "elements/api.md": page("api"),
    });
    // Folders emptied by deleting pages go; a folder that was empty already stays.
    expect(docs.folders().sort()).toEqual(["elements", "kept", "untouched"]);
  });

  it("refuses a page path that leaves the docs folder", async () => {
    await expect(writeDocs(new FakeFolder("docs"), [{ path: "../escape.md", content: "x" }])).rejects.toThrow("Refusing to write");
  });
});

describe("watching a workspace in a folder", () => {
  it("notices changes made outside the designer, and the file going", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    const onChange = vi.fn();
    const onRemoved = vi.fn();
    const stop = host.watch(onChange, onRemoved);
    await vi.advanceTimersByTimeAsync(250);
    expect(onChange).not.toHaveBeenCalled();

    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);

    root.entries.delete("a.openarch");
    await vi.advanceTimersByTimeAsync(100);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    // It stops watching once the file's gone.
    root.put("a.openarch", workspace("C"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops when asked", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const onChange = vi.fn();
    const stop = new FolderHost("1", root, "a.openarch", 100).watch(onChange);
    await vi.advanceTimersByTimeAsync(150);
    stop();
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("permission to change a folder", () => {
  it("asks only when told to", async () => {
    const root = new FakeFolder("repo");
    root.permission = "prompt";
    expect(await allowed(root, false)).toBe(false);
    expect(await allowed(root, true)).toBe(true);
    root.permission = "denied";
    expect(await allowed(root, true)).toBe(false);
  });
});

describe("the folders opened", () => {
  let count = 0;

  it("lists them, most recent first, and forgets one", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now++);
    const list = new FolderList(`folders-${++count}`);
    const a = await list.add({ kind: "directory", name: "a" } as FolderHandle, "a.openarch");
    const b = await list.add({ kind: "directory", name: "b" } as FolderHandle, "arch/b.openarch");
    expect((await list.list()).map((r) => [r.root.name, r.path])).toEqual([
      ["b", "arch/b.openarch"],
      ["a", "a.openarch"],
    ]);
    expect((await list.get(a.id))?.path).toBe("a.openarch");
    await list.remove(b.id);
    expect((await list.list()).map((r) => r.id)).toEqual([a.id]);
    vi.restoreAllMocks();
  });

  it("opening the same workspace again keeps its place in the list", async () => {
    const list = new FolderList(`folders-${++count}`);
    const root = { kind: "directory", name: "repo" } as FolderHandle;
    const first = await list.add(root, "a.openarch");
    // The browser compares handles; the handle stored is a copy, so the test stubs the comparison.
    const stored = (await list.list())[0]!.root;
    vi.spyOn(list, "list").mockResolvedValue([{ ...first, root: { ...stored, isSameEntry: async (other) => other === root } }]);
    const again = await list.add(root, "a.openarch");
    vi.restoreAllMocks();
    expect(again.id).toBe(first.id);
    expect(await list.list()).toHaveLength(1);
    // Another file in the same folder is another entry.
    await list.add(root, "b.openarch");
    expect(await list.list()).toHaveLength(2);
  });
});
