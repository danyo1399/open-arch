import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeChanges } from "../src/workspace.js";

const temps: string[] = [];

/** A workspace folder with a sibling file it must never touch. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-test-"));
  temps.push(dir);
  const root = join(dir, "arch");
  mkdirSync(join(root, "model"), { recursive: true });
  writeFileSync(join(dir, "victim.md"), "keep me\n");
  return { dir, root };
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeChanges", () => {
  it("writes nested files, and moves them, cleaning up empty folders", () => {
    const { root } = setup();
    writeChanges(root, [{ path: "model/shop/api/handler.md", content: "one\n" }]);
    expect(readFileSync(join(root, "model/shop/api/handler.md"), "utf8")).toBe("one\n");

    writeChanges(root, [{ path: "model/shop/handler.md", content: "two\n", from: "model/shop/api/handler.md" }]);
    expect(readFileSync(join(root, "model/shop/handler.md"), "utf8")).toBe("two\n");
    expect(existsSync(join(root, "model/shop/api"))).toBe(false);
  });

  it("refuses `..` paths before writing anything", () => {
    const { dir, root } = setup();
    const ok = { path: "model/ok.md", content: "fine\n" };
    for (const bad of [
      { path: "../outside.md", content: "x" },
      { path: "../victim.md", content: null },
      { path: "model/../../victim.md", content: "x" },
      { path: "model\\..\\..\\victim.md", content: "x" },
      { path: "model/../model/inside.md", content: "x" },
      { path: "model/moved.md", content: "x", from: "../victim.md" },
    ]) {
      expect(() => writeChanges(root, [ok, bad]), bad.path).toThrow(/Refusing to write .*`\.\.`/);
    }
    expect(existsSync(join(root, "model/ok.md"))).toBe(false);
    expect(existsSync(join(dir, "outside.md"))).toBe(false);
    expect(readFileSync(join(dir, "victim.md"), "utf8")).toBe("keep me\n");
  });

  it("refuses absolute paths before writing anything", () => {
    const { dir, root } = setup();
    const ok = { path: "model/ok.md", content: "fine\n" };
    for (const bad of [
      { path: join(dir, "victim.md"), content: "x" },
      { path: join(dir, "victim.md"), content: null },
      { path: "/etc/open-arch.md", content: "x" },
      { path: "C:/Windows/open-arch.md", content: "x" },
      { path: "\\\\server\\share\\open-arch.md", content: "x" },
      { path: "model/moved.md", content: "x", from: join(dir, "victim.md") },
    ]) {
      expect(() => writeChanges(root, [ok, bad]), bad.path).toThrow(/Refusing to write .*must be relative/);
    }
    expect(existsSync(join(root, "model/ok.md"))).toBe(false);
    expect(readFileSync(join(dir, "victim.md"), "utf8")).toBe("keep me\n");
  });

  it("refuses paths that aren't files in the workspace", () => {
    const { root } = setup();
    for (const path of ["", "nul\0.md", 42 as unknown as string]) {
      expect(() => writeChanges(root, [{ path, content: "x" }])).toThrow(/Refusing to write/);
    }
  });
});
