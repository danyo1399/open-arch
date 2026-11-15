// @vitest-environment happy-dom
import { emptyDocument, serializeDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { DocsSummary } from "../src/bridge.js";
import type { WorkspaceHost } from "../src/hosts.js";
import { docsProblem, useWorkspace, type WorkspaceState } from "../src/state.js";
import { mount } from "./dom.js";
import { FakeFile, FakeFolder } from "./fakeFolder.js";
import { FolderHost } from "../src/folders.js";

const text = (name: string) => serializeDocument(emptyDocument(name));

/** A host the test drives: it says when the workspace changes or goes, and what saving does. */
class TestHost implements WorkspaceHost {
  name = "a.openarch";
  key = "test/a";
  file = text("A");
  changed = () => {};
  removed = () => {};
  problem: (text: string | null) => void = () => {};
  save: (next: string) => Promise<DocsSummary | null | void> = async (next) => void (this.file = next);
  constructor(readonly storage: WorkspaceHost["storage"]) {}
  async load() {
    return this.file;
  }
  watch(onChange: () => void, onRemoved?: () => void, onProblem?: (text: string | null) => void) {
    this.changed = onChange;
    this.removed = onRemoved ?? (() => {});
    this.problem = onProblem ?? (() => {});
    return () => {};
  }
}

/** Renders the workspace state for a host, and returns a function that reads its latest. */
async function workspaceFor(host: WorkspaceHost) {
  let latest: WorkspaceState | null = null;
  const Probe = () => {
    latest = useWorkspace(host);
    return null;
  };
  mount(createElement(Probe));
  await settle();
  return () => latest!;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

describe("the open workspace", () => {
  it("says a workspace's file was deleted or moved, and keeps it in the tab", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    await act(async () => host.removed());
    await settle();
    expect(state().message?.text).toContain("The workspace file was deleted or moved. It's still open here, but only in this tab");
    expect(state().storage).toBe("memory");
  });

  it("says when the host can't tell about outside changes any more", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    await act(async () => host.problem("Can't read repo/a.openarch to see changes made outside the designer: Not allowed."));
    expect(state().message).toEqual({ kind: "error", text: "Can't read repo/a.openarch to see changes made outside the designer: Not allowed." });
    expect(state().storage).toBe("file");
    // Once it can, the message comes down; another message shown since stays.
    await act(async () => host.problem(null));
    expect(state().message).toBeNull();
    await act(async () => host.problem("Can't read it."));
    await act(async () => state().notify({ kind: "info", text: "Copied." }));
    await act(async () => host.problem(null));
    expect(state().message).toEqual({ kind: "info", text: "Copied." });
  });

  it("drops a reload that fails, without an unhandled rejection", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    host.load = async () => {
      throw new Error("repo/a.openarch isn't there any more.");
    };
    await act(async () => host.changed());
    await settle();
    process.off("unhandledRejection", onRejection);
    expect(rejections).toEqual([]);
    expect(state().ws?.doc.name).toBe("A");
    expect(state().message).toBeNull();
  });

  it("says a workspace kept in the browser was deleted in another tab", async () => {
    const host = new TestHost("browser");
    const state = await workspaceFor(host);
    await act(async () => host.removed());
    await settle();
    expect(state().message?.text).toContain("This workspace was deleted in another tab.");
  });

  it("says when the file was saved but the docs weren't", async () => {
    const host = new TestHost("file");
    host.save = async (next) => {
      host.file = next;
      return { dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." };
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().message).toEqual({ kind: "error", text: "Saved, but the docs in docs/ weren't updated: It's a file." });
    expect(state().docs?.error).toBe("It's a file.");
    expect(state().canUndo).toBe(true);
  });

  it("forgets what an earlier save said about the docs, once a save has no docs folder", async () => {
    const host = new TestHost("file");
    const summaries: (DocsSummary | null)[] = [{ dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." }, null];
    host.save = async (next) => {
      host.file = next;
      return summaries.shift();
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().docs?.error).toBe("It's a file.");
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "C" }])));
    expect(state().docs).toBeNull();
  });

  it("takes down what a save said went wrong once a save goes through", async () => {
    const host = new TestHost("file");
    const summaries: (DocsSummary | null)[] = [{ dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." }, { dir: "docs", written: 1, deleted: 0, skipped: [] }];
    host.save = async (next) => {
      host.file = next;
      return summaries.shift();
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().message?.text).toContain("weren't updated");
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "C" }])));
    expect(state().message).toBeNull();

    // A refused save's message too, but not another message shown since.
    host.save = async () => {
      throw new Error("It changed outside.");
    };
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "D" }])));
    expect(state().message?.text).toBe("Couldn't save: It changed outside.");
    host.save = async (next) => void (host.file = next);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "E" }])));
    expect(state().message).toBeNull();
    await act(async () => state().notify({ kind: "error", text: "Couldn't copy." }));
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "F" }])));
    expect(state().message?.text).toBe("Couldn't copy.");
  });

  it("says how far the docs got when writing them stopped partway", () => {
    expect(docsProblem({ dir: "docs", written: 2, deleted: 1, skipped: [], error: "Not allowed." })).toBe("Saved, but updating the docs in docs/ stopped partway, after 3 pages: Not allowed.");
    expect(docsProblem({ dir: "docs", written: 0, deleted: 0, skipped: [], error: "Not allowed." })).toBe("Saved, but the docs in docs/ weren't updated: Not allowed.");
  });

  it("keeps a refused save's message up when the file then reloads", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    host.file = text("Pulled");
    host.save = async () => {
      throw new Error("a.openarch changed outside the designer, so this change wasn't saved.");
    };
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "Mine" }])));
    await act(async () => host.changed());
    await settle();
    expect(state().ws?.doc.name).toBe("Pulled");
    expect(state().message).toEqual({ kind: "error", text: "Couldn't save: a.openarch changed outside the designer, so this change wasn't saved." });
  });

  it("says so when Undo can't be saved", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    host.save = async () => {
      throw new Error("The folder is gone.");
    };
    await act(async () => state().undo());
    await settle();
    expect(state().message).toEqual({ kind: "error", text: "Couldn't save: The folder is gone." });
    expect(state().ws?.doc.name).toBe("B");
    expect(state().canUndo).toBe(true);
  });

  it("reloads a workspace in a folder on the watcher's next check, when a reload fails", async () => {
    const root = new FakeFolder("repo");
    root.put("a.openarch", text("A"));
    const host = new FolderHost("1", root, "a.openarch", 20);
    const state = await workspaceFor(host);
    expect(state().ws?.doc.name).toBe("A");
    const file = root.entries.get("a.openarch") as FakeFile;
    // Changed outside; the watcher sees it, and the file can't be read for the reload that follows.
    file.set(text("Pulled"));
    file.afterRead = () => {
      file.unreadable = true;
      setTimeout(() => (file.unreadable = false), 30);
    };
    for (let i = 0; i < 100 && state().ws?.doc.name !== "Pulled"; i++) await settle();
    expect(state().ws?.doc.name).toBe("Pulled");
  });
});
