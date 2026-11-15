// @vitest-environment happy-dom
import { emptyDocument, serializeDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { DocsSummary } from "../src/bridge.js";
import type { WorkspaceHost } from "../src/hosts.js";
import { useWorkspace, type WorkspaceState } from "../src/state.js";
import { mount } from "./dom.js";

const text = (name: string) => serializeDocument(emptyDocument(name));

/** A host the test drives: it says when the workspace changes or goes, and what saving does. */
class TestHost implements WorkspaceHost {
  name = "a.openarch";
  key = "test/a";
  file = text("A");
  changed = () => {};
  removed = () => {};
  save: (next: string) => Promise<DocsSummary | null | void> = async (next) => void (this.file = next);
  constructor(readonly storage: WorkspaceHost["storage"]) {}
  async load() {
    return this.file;
  }
  watch(onChange: () => void, onRemoved?: () => void) {
    this.changed = onChange;
    this.removed = onRemoved ?? (() => {});
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
});
