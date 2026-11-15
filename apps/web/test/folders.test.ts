// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { emptyDocument, GENERATED_MARKER, loadWorkspace, serializeDocument } from "@open-arch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowed, findWorkspaces, problemText, writeSkill, folderIdInHash, FolderHost, folderInUrl, hashForFolder, FolderList, writeDocs, type FolderHandle, type StoredFolder } from "../src/folders.js";
import { exampleHost, MemoryHost, savesDocs, savesSkill } from "../src/hosts.js";
import { skillFiles } from "../src/skill.js";
import { FakeFile, FakeFolder, skillInFolder } from "./fakeFolder.js";

const workspace = (name: string, docs?: string) => {
  const doc = emptyDocument(name);
  if (docs) doc.export = { docs };
  return serializeDocument(doc);
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("finding workspaces in a folder", () => {
  it("looks in the folder and two levels below it, as the CLI does, nearest first, and skips hidden folders and node_modules", async () => {
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

  it("skips a folder it isn't allowed to read, as the CLI does", async () => {
    const root = new FakeFolder("repo");
    root.put("locked/hidden.openarch", "");
    root.put("arch/a.openarch", "");
    (root.entries.get("locked") as FakeFolder).unreadable = true;
    expect(await findWorkspaces(root)).toEqual(["arch/a.openarch"]);
  });
});

describe("a workspace in a folder", () => {
  it("loads the file and saves every edit to it, with its docs", async () => {
    const root = new FakeFolder("repo");
    root.put("architecture.openarch", workspace("Shop", "docs/architecture"));
    const host = new FolderHost("1", root, "architecture.openarch");
    expect(host).toMatchObject({ name: "architecture.openarch", storage: "file", syncsDocs: true, key: "folder/1", location: "repo/architecture.openarch" });
    expect(await host.load()).toBe(workspace("Shop", "docs/architecture"));

    const { docs: summary } = await host.save(workspace("Shop 2", "docs/architecture"));
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
    const { docs: summary } = await new FolderHost("1", root, "arch/shop.openarch").save(text);
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
    expect(await new FolderHost("1", root, "a.openarch").save(workspace("A"))).toEqual({ docs: null });
    expect(root.files()).toEqual({ "a.openarch": workspace("A"), ...skillInFolder() });
  });

  it("refuses to save over a change made outside since it was loaded, and saves once it's reloaded", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch");
    await host.load();
    root.put("a.openarch", workspace("Pulled"));
    await expect(host.save(workspace("Mine"))).rejects.toThrow("repo/a.openarch changed outside the designer, so this change wasn't saved");
    expect(root.files()["a.openarch"]).toBe(workspace("Pulled"));
    expect(await host.load()).toBe(workspace("Pulled"));
    await host.save(workspace("Mine"));
    expect(root.files()["a.openarch"]).toBe(workspace("Mine"));
    // Its own saves don't count as outside changes.
    await host.save(workspace("Mine 2"));
    await host.save(workspace("Mine again"));
    expect(root.files()["a.openarch"]).toBe(workspace("Mine again"));
  });

  it("reloads the file when it refuses a save, even when the change kept the file's size and time", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 60_000);
    const onChange = vi.fn(async () => void (await host.load()));
    const stop = host.watch(onChange);
    await host.load();
    const file = root.entries.get("a.openarch") as FakeFile;
    const { lastModified } = file;
    file.set(workspace("B"));
    file.lastModified = lastModified;
    await expect(host.save(workspace("Mine"))).rejects.toThrow("The file is reloaded");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(file.text).toBe(workspace("B"));
    // Reloaded, the next save goes ahead.
    await onChange.mock.results[0]!.value;
    await host.save(workspace("Mine"));
    expect(file.text).toBe(workspace("Mine"));
    stop();
  });

  it("refuses to save once the file's gone, rather than make it again", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch");
    await host.load();
    root.entries.delete("a.openarch");
    await expect(host.save(workspace("B"))).rejects.toThrow("isn't there any more, so the change wasn't saved");
    expect(root.files()).toEqual({});
  });

  it("saves the file and says why, when the docs can't be written", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A", "docs"));
    // A file where the docs folder should be.
    root.put("docs", "not a folder");
    const host = new FolderHost("1", root, "a.openarch");
    await host.load();
    const { docs: summary } = await host.save(workspace("B", "docs"));
    expect(summary).toMatchObject({ dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." });
    expect(root.files()["a.openarch"]).toBe(workspace("B", "docs"));
    // The next save goes ahead: the file holds what this one wrote.
    root.entries.delete("docs");
    expect(await host.save(workspace("C", "docs"))).toEqual({ docs: { dir: "docs", written: 1, deleted: 0, skipped: [] } });
  });

  it("says how far the docs got when writing them stopped partway", async () => {
    const root = new FakeFolder("repo");
    const text = await exampleHost().load();
    const docs = loadWorkspace(text).doc.export!.docs!;
    root.put("shop.openarch", text);
    root.put(`${docs}/old.md`, "");
    (root.entries.get(docs) as FakeFolder).refuse.add("elements");
    const { docs: summary } = await new FolderHost("1", root, "shop.openarch").save(text);
    expect(summary?.error).toBe("Not allowed.");
    expect(summary?.written).toBeGreaterThan(0);
    // It got as far as the index and the view pages, and stopped at the first element's page. The
    // sweep that deletes stale pages never ran, so the old page is still there.
    const files = Object.keys(root.files()).filter((p) => p.startsWith(`${docs}/`));
    const views = files.filter((p) => p.startsWith(`${docs}/views/`));
    expect(files.sort()).toEqual([`${docs}/README.md`, ...views, `${docs}/old.md`].sort());
    expect(views.length).toBe(loadWorkspace(text).views.size);
    expect(summary?.written).toBe(views.length + 1);
  });

  it("creates a new workspace, but never over a file that's there", async () => {
    const root = new FakeFolder("repo");
    expect((await new FolderHost("1", root, "architecture.openarch").create(workspace("A", "docs"))).docs).toMatchObject({ written: 1 });
    expect(root.files()["architecture.openarch"]).toBe(workspace("A", "docs"));
    // Pulled in after the folder was searched, say.
    root.put("other.openarch", workspace("Pulled"));
    await expect(new FolderHost("2", root, "other.openarch").create(workspace("B"))).rejects.toThrow("repo/other.openarch is there already, so it wasn't created.");
    expect(root.files()["other.openarch"]).toBe(workspace("Pulled"));
  });

  it("says when the file isn't there any more", async () => {
    await expect(new FolderHost("1", new FakeFolder("repo"), "gone.openarch").load()).rejects.toThrow("repo/gone.openarch isn't there any more.");
  });
});

describe("keeping the agent skill", () => {
  it("makes the folder hold exactly the skill, writing only what differs", async () => {
    const dir = new FakeFolder("open-arch");
    const skill = Object.fromEntries(skillFiles.map((f) => [f.path, f.content]));
    expect((await writeSkill(dir)).sort()).toEqual(Object.keys(skill).sort());
    expect(dir.files()).toEqual(skill);
    // Up to date, it writes nothing.
    const before = (dir.entries.get("SKILL.md") as FakeFile).lastModified;
    expect(await writeSkill(dir)).toEqual([]);
    expect((dir.entries.get("SKILL.md") as FakeFile).lastModified).toBe(before);
    // A changed page is put back, and a file or folder the skill doesn't have goes, as open-arch init replaces the folder.
    dir.put("SKILL.md", "edited");
    dir.put("old/stale.md", "from an older skill");
    expect((await writeSkill(dir)).sort()).toEqual(["SKILL.md", "old/stale.md"]);
    expect(dir.files()).toEqual(skill);
    expect(dir.folders()).toEqual(["references"]);
  });

  it("says the skill or the docs weren't written even when what failed has no message", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const make = root.getDirectoryHandle.bind(root);
    root.getDirectoryHandle = async (name, options) => {
      if (name === ".agents") throw new Error("");
      if (name === "docs") throw "The folder is locked.";
      return make(name, options);
    };
    const saved = await new FolderHost("1", root, "a.openarch").save(workspace("B", "docs"));
    expect(saved.skillError).toBe("Error");
    expect(saved.docs?.error).toBe("The folder is locked.");
    expect(problemText(undefined)).toBe("undefined");
    expect(problemText(new Error("Not allowed."))).toBe("Not allowed.");
  });

  it("is kept in the folder opened by every save, and said when it can't be", async () => {
    const root = new FakeFolder("repo");
    root.put("arch/a.openarch", workspace("A"));
    root.put(".claude/settings.json", "{}");
    const host = new FolderHost("1", root, "arch/a.openarch");
    expect(await host.save(workspace("B"))).toEqual({ docs: null });
    expect(root.files()).toEqual({ "arch/a.openarch": workspace("B"), ".claude/settings.json": "{}", ...skillInFolder() });
    // The skill's folder is gone, and can't be made again.
    const agents = root.entries.get(".agents") as FakeFolder;
    agents.entries.delete("skills");
    agents.refuse.add("skills");
    expect(await host.save(workspace("C"))).toEqual({ docs: null, skillError: "Not allowed." });
    expect(root.files()["arch/a.openarch"]).toBe(workspace("C"));
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

  it("leaves a folder alone where a page would go", async () => {
    const docs = new FakeFolder("docs");
    docs.put("README.md/mine.md", "Mine.");
    expect(await writeDocs(docs, [{ path: "README.md", content: page("index") }])).toEqual({ written: [], deleted: [], skipped: ["README.md"] });
    expect(docs.files()).toEqual({ "README.md/mine.md": "Mine." });
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
    await host.load();
    // As the designer does, a change reloads the file.
    const onChange = vi.fn(() => void host.load());
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
    // Only gone once a second check doesn't find it either.
    expect(onRemoved).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    // It stops watching once the file's gone.
    root.put("a.openarch", workspace("C"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledTimes(1);
    stop();
  });

  it("notices a change that keeps the file's time and size", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    const onChange = vi.fn();
    const stop = host.watch(onChange);
    await vi.advanceTimersByTimeAsync(150);
    const file = root.entries.get("a.openarch") as FakeFile;
    const { lastModified } = file;
    file.set(workspace("B"));
    file.lastModified = lastModified;
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps watching a file that's moved aside for a moment, as editors and Git do", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    const onChange = vi.fn();
    const onRemoved = vi.fn();
    const stop = host.watch(onChange, onRemoved);
    await vi.advanceTimersByTimeAsync(50);
    root.entries.delete("a.openarch");
    await vi.advanceTimersByTimeAsync(100);
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
    // A later gap of one check is forgiven too.
    root.entries.delete("a.openarch");
    await vi.advanceTimersByTimeAsync(100);
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onRemoved).not.toHaveBeenCalled();
    stop();
  });

  it("notices a change made after loading, when watching starts before the load is done, as the designer does", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    // Changed straight after the load reads it, before the first check.
    (root.entries.get("a.openarch") as FakeFile).afterRead = () => root.put("a.openarch", workspace("B"));
    const loading = host.load();
    const onChange = vi.fn();
    const stop = host.watch(onChange);
    expect(await loading).toBe(workspace("A"));
    await vi.advanceTimersByTimeAsync(10);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("doesn't take two checks close together in one gap as the file being gone", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    const onRemoved = vi.fn();
    const stop = host.watch(() => {}, onRemoved);
    await vi.advanceTimersByTimeAsync(50);
    root.entries.delete("a.openarch");
    await vi.advanceTimersByTimeAsync(50);
    // The tab shows again straight after a check that missed it.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5);
    expect(onRemoved).not.toHaveBeenCalled();
    root.put("a.openarch", workspace("A"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onRemoved).not.toHaveBeenCalled();
    stop();
  });

  it("notices a change made between loading the file and the first check", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    root.put("a.openarch", workspace("B"));
    const onChange = vi.fn(() => void host.load());
    const stop = host.watch(onChange);
    await vi.advanceTimersByTimeAsync(10);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("asks again for a reload that failed, until one goes through", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    let reloads = 0;
    // The first reload fails, as when the file is moved aside between the check and the load.
    const onChange = vi.fn(() => {
      if (++reloads > 1) void host.load();
    });
    const stop = host.watch(onChange);
    await vi.advanceTimersByTimeAsync(50);
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    // The next check asks again, and that reload goes through, so it stops asking.
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  it("says once when it can't read the file any more, and again only after it could", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    const onChange = vi.fn();
    const onRemoved = vi.fn();
    const onProblem = vi.fn();
    const stop = host.watch(onChange, onRemoved, onProblem);
    await vi.advanceTimersByTimeAsync(50);
    const file = root.entries.get("a.openarch") as FakeFile;
    file.unreadable = true;
    await vi.advanceTimersByTimeAsync(300);
    expect(onProblem.mock.calls).toEqual([["Can't read repo/a.openarch to see changes made outside the designer: Not allowed."]]);
    expect(onRemoved).not.toHaveBeenCalled();
    // It keeps trying, and sees changes again once it can read the file.
    file.unreadable = false;
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onProblem.mock.calls[1]).toEqual([null]);
    file.unreadable = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(onProblem).toHaveBeenCalledTimes(3);
    stop();
  });

  it("waits for a file it couldn't load, rather than calling it removed, and asks for it once it's there", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    const host = new FolderHost("1", root, "a.openarch", 100);
    await expect(host.load()).rejects.toThrow("isn't there any more");
    const onChange = vi.fn(() => void host.load().catch(() => undefined));
    const onRemoved = vi.fn();
    const stop = host.watch(onChange, onRemoved);
    await vi.advanceTimersByTimeAsync(500);
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    root.put("a.openarch", workspace("A"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);
    // Loaded, it's watched as usual.
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops when asked", async () => {
    vi.useFakeTimers();
    const root = new FakeFolder("repo");
    root.put("a.openarch", workspace("A"));
    const host = new FolderHost("1", root, "a.openarch", 100);
    await host.load();
    const onChange = vi.fn();
    const stop = host.watch(onChange);
    await vi.advanceTimersByTimeAsync(150);
    stop();
    root.put("a.openarch", workspace("B"));
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a workspace in a folder in the URL", () => {
  const stored = (root: FolderHandle): StoredFolder => ({ id: "f1", root, path: "arch/a.openarch", opened: 1 });

  it("names the folder's place in the list, and reads it back", () => {
    expect(hashForFolder(new FolderHost("f1", new FakeFolder("repo"), "a.openarch"))).toBe("folder/f1");
    expect(folderIdInHash("folder/f1")).toBe("f1");
    expect(folderIdInHash("folder/")).toBeNull();
    expect(folderIdInHash("abc123")).toBeNull();
  });

  it("reopens it when the browser still allows it, and not when it would have to ask", async () => {
    const root = new FakeFolder("repo");
    const folders = { get: async (id: string) => (id === "f1" ? stored(root) : undefined) };
    expect(await folderInUrl("folder/f1", folders)).toMatchObject({ id: "f1", root, path: "arch/a.openarch" });
    expect(await folderInUrl("folder/f2", folders)).toBeNull();
    expect(await folderInUrl("abc123", folders)).toBeNull();
    root.permission = "prompt";
    expect(await folderInUrl("folder/f1", folders)).toBeNull();
    // It didn't ask: that needs a click.
    expect(root.permission).toBe("prompt");
  });
});

describe("saving docs", () => {
  it("stops once a workspace's file is gone, when it only lives in the tab", () => {
    const host = new FolderHost("1", new FakeFolder("repo"), "a.openarch");
    expect(savesDocs(host, "file")).toBe(true);
    expect(savesDocs(host, "memory")).toBe(false);
    expect(savesDocs(new MemoryHost("a.openarch", ""), "memory")).toBe(false);
    // The agent skill, by the same rule.
    expect(savesSkill(host, "file")).toBe(true);
    expect(savesSkill(host, "memory")).toBe(false);
    expect(savesSkill(new MemoryHost("a.openarch", ""), "memory")).toBe(false);
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
  });

  it("opening the same workspace again keeps its place in the list", async () => {
    const list = new FolderList(`folders-${++count}`);
    const root = { kind: "directory", name: "repo" } as FolderHandle;
    const first = await list.add(root, "a.openarch");
    // The browser tells whether two handles are the same folder. What IndexedDB gives back here is
    // a plain copy without that, so the list it reads is given a handle that can tell.
    const sameFolder = { kind: "directory", name: "repo", isSameEntry: async (other: FolderHandle) => other === root } as FolderHandle;
    vi.spyOn(list, "list").mockResolvedValueOnce([{ ...first, root: sameFolder }]);
    const again = await list.add(root, "a.openarch");
    expect(again.id).toBe(first.id);
    expect(await list.list()).toHaveLength(1);
    // Another file in the same folder is another entry.
    await list.add(root, "b.openarch");
    expect(await list.list()).toHaveLength(2);
  });
});
