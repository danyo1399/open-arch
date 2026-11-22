// @vitest-environment happy-dom
import { emptyDocument, serializeDocument, type Operation, type Workspace } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { DocsSummary, SaveSummary } from "../src/bridge.js";
import type { WorkspaceHost } from "../src/hosts.js";
import { changeLabel, docsProblem, saveProblem, useWorkspace, type WorkspaceState } from "../src/state.js";
import { mount } from "./dom.js";
import { FakeFile, FakeFolder } from "./fakeFolder.js";
import { FolderHost } from "../src/folders.js";

const text = (name: string) => serializeDocument(emptyDocument(name));

/** A host the test drives: it says when the workspace changes or goes, and what saving does. */
class TestHost implements WorkspaceHost {
  made?: SaveSummary;
  name = "a.openarch";
  key = "test/a";
  file = text("A");
  changed = () => {};
  removed = () => {};
  problem: (text: string | null) => void = () => {};
  save: (next: string) => Promise<SaveSummary | void> = async (next) => void (this.file = next);
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

/** Renders the workspace state for a host, and returns a function that reads its latest. `onApplied` hears what it applies. */
async function workspaceFor(host: WorkspaceHost, onApplied?: (ops: Operation[], before?: Workspace) => void) {
  let latest: WorkspaceState | null = null;
  const Probe = () => {
    latest = useWorkspace(host, onApplied);
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

  it("looks at the workspace once the edits queued before have landed, even when its file has errors", async () => {
    const host = new TestHost("file");
    // Each save takes a moment, so the look waits for it.
    host.save = (next) => new Promise((resolve) => setTimeout(() => resolve(void (host.file = next)), 30));
    const state = await workspaceFor(host);
    const seen: (string | undefined)[] = [];
    await act(async () => {
      void state().edit([{ op: "update-workspace", name: "B" }]);
      await state().afterEdits((ws) => void seen.push(ws?.doc.name));
    });
    expect(seen).toEqual(["B"]);

    // A file with errors, here an element of a kind the format doesn't have, can't be changed, but can be looked at.
    host.file = JSON.stringify({ ...JSON.parse(host.file), elements: { api: { kind: "box", name: "API" } } });
    await act(async () => host.changed());
    await settle();
    let valid: boolean | undefined;
    await act(() => state().afterEdits((ws) => void (valid = ws?.valid)));
    expect(valid).toBe(false);
    expect(await act(() => state().edit([{ op: "update-workspace", name: "D" }]))).toBe(false);
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

  it("says what went wrong beside saving a workspace just made, when it opens", async () => {
    const host = new TestHost("file");
    host.made = { docs: { dir: "docs", written: 2, deleted: 0, skipped: [] }, skillError: "Not allowed." };
    const state = await workspaceFor(host);
    expect(state().docs).toEqual({ dir: "docs", written: 2, deleted: 0, skipped: [] });
    expect(state().message).toEqual({ kind: "error", text: "Saved, but the agent skill in .agents/skills/open-arch/ and .claude/skills/open-arch/ wasn't updated: Not allowed." });
    // A save that goes through takes it down.
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
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
      return { docs: { dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." } };
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
      return { docs: summaries.shift() ?? null };
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
      return { docs: summaries.shift() ?? null };
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

  it("says when the file was saved but the agent skill wasn't", async () => {
    const host = new TestHost("file");
    host.save = async (next) => {
      host.file = next;
      return { docs: null, skillError: "Not allowed." };
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().message).toEqual({ kind: "error", text: "Saved, but the agent skill in .agents/skills/open-arch/ and .claude/skills/open-arch/ wasn't updated: Not allowed." });
    host.save = async (next) => {
      host.file = next;
      return { docs: null };
    };
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "C" }])));
    expect(state().message).toBeNull();
  });

  it("says when both the docs and the agent skill weren't written", async () => {
    const host = new TestHost("file");
    host.save = async (next) => {
      host.file = next;
      return { docs: { dir: "docs", written: 0, deleted: 0, skipped: [], error: "It's a file." }, skillError: "Not allowed." };
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().message?.text).toBe("Saved, but the docs in docs/ weren't updated: It's a file. Also, the agent skill in .agents/skills/open-arch/ and .claude/skills/open-arch/ wasn't updated: Not allowed.");
    expect(saveProblem({ docs: null })).toBeNull();
    expect(saveProblem({ docs: null, agentsError: "Locked." })).toBe("Saved, but the open-arch section in AGENTS.md wasn't updated: Locked.");
    expect(saveProblem({ docs: null, skillError: "No.", agentsError: "Locked." })).toBe(
      "Saved, but the agent skill in .agents/skills/open-arch/ and .claude/skills/open-arch/ wasn't updated: No. Also, the open-arch section in AGENTS.md wasn't updated: Locked.",
    );
    expect(saveProblem({ docs: { dir: "docs", written: 0, deleted: 0, skipped: [], error: "Full." }, agentsError: "Locked." })).toBe(
      "Saved, but the docs in docs/ weren't updated: Full. Also, the open-arch section in AGENTS.md wasn't updated: Locked.",
    );
    expect(saveProblem(undefined)).toBeNull();
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

  it("says why a workspace couldn't be opened even when what failed has no message", async () => {
    const host = new TestHost("file");
    host.load = async () => {
      throw new Error("");
    };
    const state = await workspaceFor(host);
    expect(state().loadError).toBe("Something went wrong, and no reason was given.");
  });

  it("says why a save failed even when what failed has no message", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    host.save = async () => {
      throw new Error("");
    };
    await act(async () => void (await state().edit([{ op: "update-workspace", name: "B" }])));
    expect(state().message?.text).toBe("Couldn't save: Something went wrong, and no reason was given.");
  });

  it("hands back what a change did, or why it was refused, without showing it, for whoever asked to read", async () => {
    const host = new TestHost("browser");
    const heard: Operation[][] = [];
    const state = await workspaceFor(host, (ops) => heard.push(ops));
    const ops: Operation[] = [
      { op: "add-element", id: "shop", kind: "system", name: "Shop" },
      { op: "add-element", id: "customer", kind: "person", name: "Customer" },
      { op: "add-relationship", from: "customer", to: "shop" },
    ];
    const opened = host.file;
    let done = await act(() => state().change(ops));
    // What each operation did, the warnings they brought, and the file just before them and as they left it.
    expect(done).toEqual({
      ok: true,
      summary: ["added system shop", "added person customer", "added relationship customer -> shop"],
      warnings: [expect.objectContaining({ rule: "relationship-description", severity: "warning" })],
      before: opened,
      after: host.file,
    });
    expect(host.file).not.toBe(opened);
    // One that changes nothing leaves the file as it was, and says so.
    expect(await act(() => state().change([{ op: "update-element", id: "shop", name: "Shop" }]))).toMatchObject({ ok: true, before: host.file, after: host.file });
    expect(state().versions).toHaveLength(2);
    expect(host.file).toContain('"customer"');
    expect(state().ws?.elements.has("shop")).toBe(true);
    expect(heard).toEqual([ops]);
    // It's one change in the history, as an edit is, which Undo takes back.
    expect(state().versions.map((v) => v.change)).toEqual([null, "Added system shop, and 2 more changes"]);
    await act(async () => state().undo());
    await settle();
    expect(state().ws?.elements.size).toBe(0);

    // Refused: nothing changes, and it's said to the caller, not shown.
    const before = host.file;
    done = await act(() => state().change([{ op: "add-element", id: "api", kind: "container", name: "API", parent: "nowhere" }]));
    expect(done).toEqual({ ok: false, error: expect.stringContaining("nowhere") });
    expect(host.file).toBe(before);
    expect(state().message).toBeNull();
    // The same operations as an edit are shown.
    expect(await act(() => state().edit([{ op: "add-element", id: "api", kind: "container", name: "API", parent: "nowhere" }]))).toBe(false);
    expect(state().message).toEqual({ kind: "error", text: (done as { error: string }).error });
  });

  it("refuses a change to a file with errors, and says a change couldn't be saved to the caller and on screen", async () => {
    const broken = new TestHost("browser");
    broken.file = JSON.stringify({ openarch: 20, name: "A", elements: { shop: { kind: "system" } }, views: {} });
    const state = await workspaceFor(broken);
    const done = await act(() => state().change([{ op: "update-workspace", name: "B" }]));
    expect(done).toEqual({ ok: false, error: "This file has errors that stop it being changed safely. Fix it by hand (the Problems list says where), or restore it from version control." });
    expect(state().message).toBeNull();
    // As an edit, the same is shown.
    await act(() => state().edit([{ op: "update-workspace", name: "B" }]));
    expect(state().message?.text).toBe((done as { error: string }).error);

    const host = new TestHost("browser");
    host.save = () => Promise.reject(new Error("The disk is full."));
    const failing = await workspaceFor(host);
    expect(await act(() => failing().change([{ op: "update-workspace", name: "B" }]))).toEqual({ ok: false, error: "Couldn't save: The disk is full." });
    expect(failing().message).toEqual({ kind: "error", text: "Couldn't save: The disk is full." });
    expect(failing().versions).toHaveLength(1);
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
    const host = new FolderHost("1", root, "a.openarch", { pollMs: 20 });
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

  it("opens a workspace in a folder once its file is back, after it couldn't be opened", async () => {
    const root = new FakeFolder("repo");
    const host = new FolderHost("1", root, "a.openarch", { pollMs: 20 });
    const state = await workspaceFor(host);
    expect(state().loadError).toBe("repo/a.openarch isn't there any more.");
    expect(state().ws).toBeNull();
    // Back, say after a git checkout.
    root.put("a.openarch", text("Back"));
    for (let i = 0; i < 100 && state().ws === null; i++) await settle();
    expect(state().ws?.doc.name).toBe("Back");
    expect(state().loadError).toBeNull();
    expect(state().message).toBeNull();
    expect(state().storage).toBe("file");
  });
});

describe("the History list", () => {
  /** Renames the workspace, as one change. */
  const name = (state: () => WorkspaceState, to: string) => act(async () => void (await state().edit([{ op: "update-workspace", name: to }])));
  /** What the list says each version's change did, oldest first. */
  const changes = (state: () => WorkspaceState) => state().versions.map((v) => v.change);

  it("says what an edit did: its first change, and how many more came with it", () => {
    expect(changeLabel(["added container cache"])).toBe("Added container cache");
    expect(changeLabel(["added container cache", "showed cache in view containers"])).toBe("Added container cache, and 1 more change");
    expect(changeLabel(["added container cache", "showed cache in view containers", "saved positions in view containers"])).toBe("Added container cache, and 2 more changes");
    expect(changeLabel([])).toBe("Changed the workspace");
  });

  it("starts with the workspace as it was opened, and lists each change made, with when", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    expect(state().versions).toEqual([{ number: 0, change: null, at: null }]);
    expect(state().version).toBe(0);
    const before = Date.now();
    await act(
      async () =>
        void (await state().edit([
          { op: "add-element", id: "shop", kind: "system" },
          { op: "add-view", id: "context", level: "context", scope: "shop" },
        ])),
    );
    await name(state, "B");
    expect(changes(state)).toEqual([null, "Added system shop, and 1 more change", "Updated workspace"]);
    expect(state().versions.map((v) => v.number)).toEqual([0, 1, 2]);
    expect(state().version).toBe(2);
    const at = state().versions[2]!.at!;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("goes back to any version in one save, and forward again, and Undo and Redo carry on from there", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    for (const to of ["B", "C", "D"]) await name(state, to);
    const saves: string[] = [];
    host.save = async (next) => {
      host.file = next;
      saves.push(JSON.parse(next).name);
    };

    await act(async () => state().goTo(1));
    await settle();
    expect(saves).toEqual(["B"]);
    expect(state().ws?.doc.name).toBe("B");
    expect(state().version).toBe(1);
    // The changes gone back over stay in the list, to make again.
    expect(state().versions.map((v) => v.number)).toEqual([0, 1, 2, 3]);
    expect([state().canUndo, state().canRedo]).toEqual([true, true]);

    await act(async () => state().redo());
    await settle();
    expect(state().ws?.doc.name).toBe("C");
    await act(async () => state().goTo(0));
    await settle();
    expect(state().ws?.doc.name).toBe("A");
    expect([state().canUndo, state().canRedo]).toEqual([false, true]);
    await act(async () => state().goTo(3));
    await settle();
    expect(state().ws?.doc.name).toBe("D");
    expect([state().canUndo, state().canRedo]).toEqual([true, false]);
    await act(async () => state().undo());
    await settle();
    expect(state().version).toBe(2);
    expect(saves).toEqual(["B", "C", "A", "D", "C"]);

    // The version showing now is already there, so nothing is saved.
    await act(async () => state().goTo(2));
    await settle();
    expect(saves).toHaveLength(5);
  });

  it("drops the changes that were undone once another is made, and never uses their numbers again", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    for (const to of ["B", "C", "D"]) await name(state, to);
    await act(async () => state().goTo(1));
    await settle();
    await name(state, "E");
    expect(state().versions.map((v) => v.number)).toEqual([0, 1, 4]);
    expect(state().version).toBe(4);
    // A version that's gone from the list isn't gone to.
    await act(async () => state().goTo(3));
    await settle();
    expect(state().ws?.doc.name).toBe("E");
    await act(async () => state().undo());
    await settle();
    expect(state().ws?.doc.name).toBe("B");
  });

  it("takes back the renames of every change it goes back over, last first, and makes them again going forward", async () => {
    const host = new TestHost("file");
    const heard: Operation[][] = [];
    const state = await workspaceFor(host, (ops) => void heard.push(ops));
    await act(async () => void (await state().edit([{ op: "add-element", id: "shop", kind: "system" }])));
    await act(async () => void (await state().edit([{ op: "rename", id: "shop", to: "store" }])));
    await act(async () => void (await state().edit([{ op: "rename", id: "store", to: "market" }])));
    heard.length = 0;
    await act(async () => state().goTo(1));
    await settle();
    expect(Object.keys(state().ws!.doc.elements)).toEqual(["shop"]);
    await act(async () => state().goTo(3));
    await settle();
    expect(Object.keys(state().ws!.doc.elements)).toEqual(["market"]);
    expect(heard).toEqual([
      [
        { op: "rename", id: "market", to: "store" },
        { op: "rename", id: "store", to: "shop" },
      ],
      [
        { op: "rename", id: "shop", to: "store" },
        { op: "rename", id: "store", to: "market" },
      ],
    ]);
  });

  it("tells what hears an edit which workspace it was made on, and not for Undo, which writes a whole version", async () => {
    const host = new TestHost("file");
    const heard: { ops: Operation[]; before: string[] | undefined }[] = [];
    const state = await workspaceFor(host, (ops, before) => void heard.push({ ops, before: before && Object.keys(before.doc.elements) }));
    await act(async () => void (await state().edit([{ op: "add-element", id: "shop", kind: "system" }])));
    await act(async () => void (await state().edit([{ op: "rename", id: "shop", to: "store" }])));
    await act(async () => state().undo());
    await settle();
    expect(heard).toEqual([
      { ops: [{ op: "add-element", id: "shop", kind: "system" }], before: [] },
      { ops: [{ op: "rename", id: "shop", to: "store" }], before: ["shop"] },
      { ops: [{ op: "rename", id: "store", to: "shop" }], before: undefined },
    ]);
  });

  it("lists an earlier version put back as a change of its own, called what it's given", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    await name(state, "B");
    await act(async () => void (await state().restore(text("A"), "Undid the AI's change")));
    expect(changes(state)).toEqual([null, "Updated workspace", "Undid the AI's change"]);
    expect(state().ws?.doc.name).toBe("A");
    await act(async () => state().goTo(1));
    await settle();
    expect(state().ws?.doc.name).toBe("B");
  });

  it("keeps a hundred changes, and starts from the version before the oldest of them", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    for (let i = 1; i <= 102; i++) await name(state, `N${i}`);
    expect(state().versions).toHaveLength(101);
    expect(state().versions[0]).toEqual({ number: 2, change: null, at: null });
    expect(state().version).toBe(102);
    // The oldest version left is the workspace as the second change left it.
    await act(async () => state().goTo(2));
    await settle();
    expect(state().ws?.doc.name).toBe("N2");
    expect(state().canUndo).toBe(false);
    await act(async () => state().goTo(0));
    await settle();
    expect(state().ws?.doc.name).toBe("N2");
  });

  it("stays where it is, and says so, to whoever asked too, when going to a version can't be saved", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    for (const to of ["B", "C"]) await name(state, to);
    host.save = async () => {
      throw new Error("The folder is gone.");
    };
    let went: string | null = null;
    await act(async () => void (went = await state().goTo(0)));
    expect(went).toBe("Couldn't save: The folder is gone.");
    expect(state().message).toEqual({ kind: "error", text: "Couldn't save: The folder is gone." });
    expect(state().ws?.doc.name).toBe("C");
    expect(state().version).toBe(2);
    // One that goes through, or goes nowhere, has nothing to say.
    host.save = async (next) => void (host.file = next);
    await act(async () => void (went = await state().goTo(0)));
    expect(went).toBeNull();
    expect(state().ws?.doc.name).toBe("A");
    await act(async () => void (went = await state().goTo(99)));
    expect(went).toBeNull();
  });

  it("starts again when the file changes outside this window, from a version with a new number", async () => {
    const host = new TestHost("file");
    const state = await workspaceFor(host);
    for (const to of ["B", "C"]) await name(state, to);
    await act(async () => state().undo());
    await settle();
    host.file = text("Pulled");
    await act(async () => host.changed());
    await settle();
    expect(state().versions).toEqual([{ number: 3, change: null, at: null }]);
    expect(state().version).toBe(3);
    expect([state().canUndo, state().canRedo]).toEqual([false, false]);
    // A version from before the reload isn't there to go to.
    await act(async () => state().goTo(0));
    await settle();
    expect(state().ws?.doc.name).toBe("Pulled");
  });

  it("is kept in memory only: nothing of it is in what's saved, and it's gone when the workspace is opened again", async () => {
    const host = new TestHost("browser");
    const saved: string[] = [];
    host.save = async (next) => {
      host.file = next;
      saved.push(next);
    };
    const state = await workspaceFor(host);
    await act(async () => void (await state().edit([{ op: "add-element", id: "secret-system", kind: "system" }])));
    await act(async () => void (await state().edit([{ op: "remove-element", id: "secret-system" }])));
    await name(state, "B");
    await act(async () => state().goTo(1));
    await settle();
    await act(async () => state().goTo(3));
    await settle();
    expect(changes(state)).toEqual([null, "Added system secret-system", "Removed secret-system", "Updated workspace"]);
    // Each save is the workspace as it is then, and nothing else: the last has no trace of what was removed.
    expect(saved).toHaveLength(5);
    for (const file of saved) expect(file).toBe(serializeDocument(JSON.parse(file)));
    expect(host.file).toBe(text("B"));
    expect(host.file).not.toContain("secret-system");
    // Nothing is put in the browser's own storage either.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    const reopened = await workspaceFor(host);
    expect(reopened().ws?.doc.name).toBe("B");
    expect(reopened().versions).toEqual([{ number: 0, change: null, at: null }]);
    expect([reopened().canUndo, reopened().canRedo]).toEqual([false, false]);
  });
});
