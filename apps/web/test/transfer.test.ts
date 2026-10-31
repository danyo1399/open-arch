import "fake-indexeddb/auto";
import { emptyDocument, serializeDocument } from "@open-arch/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exampleHost } from "../src/hosts.js";
import { WorkspaceLibrary, type StoredWorkspace } from "../src/library.js";
import type { PickedFile } from "../src/providers.js";
import { importFiles, importProblem, unpack, workspacesZip } from "../src/transfer.js";

let dbCount = 0;
const newLibrary = () => new WorkspaceLibrary(`transfer-test-${++dbCount}`);

const doc = (name: string) => serializeDocument(emptyDocument(name));
const file = (name: string, text: string): PickedFile => ({ name, data: strToU8(text) });
const zip = (name: string, entries: Record<string, string>): PickedFile => ({
  name,
  data: zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]))),
});
const record = (fileName: string, text: string): StoredWorkspace => ({ id: fileName, fileName, text, created: 0, updated: 0 });

describe("import problems", () => {
  it("lets in workspaces the designer can edit", async () => {
    expect(importProblem({ name: "shop.openarch", text: await exampleHost().load() })).toBeNull();
    expect(importProblem({ name: "bom.openarch", text: `\uFEFF${doc("A")}` })).toBeNull();
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

describe("zips of workspaces", () => {
  it("puts every workspace in one zip, under names that don't clash", () => {
    const records = [record("shop.openarch", doc("Shop")), record("Shop.openarch", doc("Shop 2")), record("architecture.openarch", doc("A")), record("architecture.openarch", doc("B"))];
    const exported = workspacesZip(records, new Date(2026, 9, 31));
    expect(exported.name).toBe("open-arch-workspaces-2026-10-31.zip");
    const entries = unzipSync(exported.data as Uint8Array);
    expect(Object.keys(entries)).toEqual(["shop.openarch", "Shop-2.openarch", "architecture.openarch", "architecture-2.openarch"]);
    expect(strFromU8(entries["architecture-2.openarch"]!)).toBe(doc("B"));
  });

  it("reads the workspaces back out of one", () => {
    const exported = workspacesZip([record("a.openarch", doc("A")), record("b.openarch", doc("B"))]);
    const { workspaces, problems } = unpack([{ name: exported.name, data: exported.data as Uint8Array }]);
    expect(workspaces).toEqual([
      { name: "a.openarch", text: doc("A") },
      { name: "b.openarch", text: doc("B") },
    ]);
    expect(problems).toEqual([]);
  });

  it("finds workspaces in folders, and skips other files and macOS's copies", () => {
    const picked = zip("backup.zip", {
      "backup/payments.openarch": doc("Payments"),
      "backup/README.md": "# notes",
      "__MACOSX/backup/._payments.openarch": "junk",
      "backup/._payments.openarch": "junk",
    });
    expect(unpack([picked]).workspaces).toEqual([{ name: "payments.openarch", text: doc("Payments") }]);
  });

  it("says when a zip has no workspaces, can't be read, or holds a broken one", () => {
    const broken = { name: "broken.zip", data: new Uint8Array([0x50, 0x4b, 1, 2, 3]) };
    const { workspaces, problems } = unpack([zip("empty.zip", { "notes.txt": "hi" }), broken, zip("mixed.zip", { "good.openarch": doc("Good"), "bad.openarch": "{" })]);
    expect(workspaces.map((w) => w.name)).toEqual(["good.openarch"]);
    expect(problems).toEqual(["empty.zip has no .openarch files in it.", "broken.zip isn't a zip file that can be read.", "bad.openarch isn't an open-arch workspace."]);
  });

  it("reads single workspace files too, without a byte order mark", () => {
    expect(unpack([file("a.openarch", `\uFEFF${doc("A")}`)]).workspaces).toEqual([{ name: "a.openarch", text: doc("A") }]);
  });
});

describe("importing into the library", () => {
  it("adds each workspace in the files", async () => {
    const library = newLibrary();
    const result = await importFiles(library, [file("a.openarch", doc("A")), zip("more.zip", { "b.openarch": doc("B"), "c.openarch": doc("C") })]);
    expect(result.added.map((r) => r.fileName)).toEqual(["a.openarch", "b.openarch", "c.openarch"]);
    expect(result.existing).toEqual([]);
    expect((await library.list()).length).toBe(3);
  });

  it("doesn't add a workspace it already has word for word", async () => {
    const library = newLibrary();
    const a = await library.add("a.openarch", doc("A"));
    const backup = workspacesZip([a, record("b.openarch", doc("B"))]);
    const result = await importFiles(library, [{ name: backup.name, data: backup.data as Uint8Array }, file("b-again.openarch", doc("B"))]);
    expect(result.added.map((r) => r.fileName)).toEqual(["b.openarch"]);
    expect(result.existing.map((r) => r.id)).toEqual([a.id]);
    expect((await library.list()).length).toBe(2);
  });

  it("reports the files it couldn't import, and imports the rest", async () => {
    const library = newLibrary();
    const result = await importFiles(library, [file("notes.txt", "hello"), file("a.openarch", doc("A"))]);
    expect(result.added.map((r) => r.fileName)).toEqual(["a.openarch"]);
    expect(result.problems).toEqual(["notes.txt isn't an open-arch workspace."]);
  });
});
