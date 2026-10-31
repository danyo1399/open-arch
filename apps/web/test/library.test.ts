import "fake-indexeddb/auto";
import { emptyDocument, serializeDocument } from "@open-arch/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserHost, exampleHost } from "../src/hosts.js";
import { importProblem, workspaceTitle, WorkspaceLibrary, type LibraryChange } from "../src/library.js";

let dbCount = 0;
let library: WorkspaceLibrary;
let dbName: string;

beforeEach(() => {
  // Each test gets its own database, and Date.now ticks so "most recent first" is clear.
  dbName = `test-${++dbCount}`;
  library = new WorkspaceLibrary(dbName);
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now++);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const doc = (name: string) => serializeDocument(emptyDocument(name));

/** The next change another tab's library hears about. */
const nextChange = (other: WorkspaceLibrary) =>
  new Promise<LibraryChange>((resolve) => {
    const stop = other.onChange((change) => {
      stop();
      resolve(change);
    });
  });

describe("workspace library", () => {
  it("adds, lists, saves and removes workspaces", async () => {
    const a = await library.add("a.openarch", doc("A"));
    const b = await library.add("b.openarch", doc("B"));
    expect((await library.list()).map(workspaceTitle)).toEqual(["B", "A"]);

    await library.save(a.id, doc("A2"));
    const saved = await library.get(a.id);
    expect(saved).toMatchObject({ id: a.id, fileName: "a.openarch", text: doc("A2"), created: a.created });
    expect(saved!.updated).toBeGreaterThan(a.updated);
    expect((await library.list()).map((r) => r.id)).toEqual([a.id, b.id]);

    await library.remove(b.id);
    expect((await library.list()).map((r) => r.id)).toEqual([a.id]);
    expect(await library.get(b.id)).toBeUndefined();
  });

  it("keeps workspaces between page loads", async () => {
    const a = await library.add("a.openarch", doc("A"));
    const reopened = new WorkspaceLibrary(dbName);
    expect(await reopened.get(a.id)).toMatchObject({ text: doc("A") });
  });

  it("won't bring back a workspace deleted elsewhere by saving it", async () => {
    const a = await library.add("a.openarch", doc("A"));
    await library.remove(a.id);
    await expect(library.save(a.id, doc("A2"))).rejects.toThrow(/deleted/);
    expect(await library.list()).toEqual([]);
  });

  it("tells other tabs about changes", async () => {
    const otherTab = new WorkspaceLibrary(dbName);
    const added = nextChange(otherTab);
    const a = await library.add("a.openarch", doc("A"));
    expect(await added).toEqual({ type: "added", id: a.id });

    const saved = nextChange(otherTab);
    await library.save(a.id, doc("A2"));
    expect(await saved).toEqual({ type: "saved", id: a.id });

    const removed = nextChange(otherTab);
    await library.remove(a.id);
    expect(await removed).toEqual({ type: "removed", id: a.id });
  });
});

describe("browser host", () => {
  it("loads and saves a stored workspace", async () => {
    const a = await library.add("a.openarch", doc("A"));
    const host = new BrowserHost(library, a.id, a.fileName);
    expect(host).toMatchObject({ name: "a.openarch", storage: "browser" });
    expect(await host.load()).toBe(doc("A"));
    await host.save(doc("A2"));
    expect((await library.get(a.id))!.text).toBe(doc("A2"));
  });

  it("hears when another tab saves the same workspace", async () => {
    const a = await library.add("a.openarch", doc("A"));
    const b = await library.add("b.openarch", doc("B"));
    const otherTab = new WorkspaceLibrary(dbName);
    const heard: string[] = [];
    const stop = new BrowserHost(library, a.id, a.fileName).watch(() => heard.push("a"));
    await otherTab.save(b.id, doc("B2"));
    await otherTab.save(a.id, doc("A2"));
    await vi.waitFor(() => expect(heard).toEqual(["a"]));
    stop();
  });

  it("says so when the workspace is gone", async () => {
    await expect(new BrowserHost(library, "missing", "x.openarch").load()).rejects.toThrow(/isn't stored/);
  });
});

describe("importing", () => {
  it("lets in workspaces the designer can edit", async () => {
    expect(importProblem({ name: "shop.openarch", text: await exampleHost().load() })).toBeNull();
    expect(importProblem({ name: "bom.openarch", text: `﻿${doc("A")}` })).toBeNull();
  });

  it("refuses files that aren't workspaces", () => {
    expect(importProblem({ name: "notes.txt", text: "hello" })).toBe("notes.txt isn't an open-arch workspace.");
    expect(importProblem({ name: "package.json", text: '{"name":"x"}' })).toBe("package.json isn't an open-arch workspace.");
  });

  it("refuses workspaces with problems that stop them being edited", () => {
    const text = JSON.stringify({ openarch: 2, name: "A", elements: {}, views: {}, extra: true });
    expect(importProblem({ name: "a.openarch", text })).toMatch(/^a\.openarch has problems that stop it being edited \(at extra\): Unknown field "extra"\. .*import it again\.$/);
  });
});
