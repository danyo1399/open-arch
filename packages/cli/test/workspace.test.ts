import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENERATED_MARKER } from "@open-arch/core";
import { afterEach, describe, expect, it } from "vitest";
import { writeDocs } from "../src/workspace.js";

const temps: string[] = [];

/** A docs folder with a sibling file it must never touch. */
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-test-"));
  temps.push(dir);
  const docs = join(dir, "docs");
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(dir, "victim.md"), "keep me\n");
  return { dir, docs };
}

const page = (body: string) => `${GENERATED_MARKER} from x.openarch. -->\n\n${body}\n`;

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeDocs", () => {
  it("writes pages, then removes generated pages that are no longer exported, and empty folders", () => {
    const { docs } = setup();
    const first = writeDocs(docs, [
      { path: "README.md", content: page("index") },
      { path: "elements/a.md", content: page("a") },
    ]);
    expect(first.written).toEqual(["README.md", "elements/a.md"]);
    const second = writeDocs(docs, [{ path: "README.md", content: page("index") }]);
    expect(second).toMatchObject({ written: [], deleted: ["elements/a.md"], skipped: [] });
    expect(existsSync(join(docs, "elements"))).toBe(false);
  });

  it("never overwrites or deletes files open-arch didn't generate", () => {
    const { docs } = setup();
    writeFileSync(join(docs, "README.md"), "# My own notes\n");
    writeFileSync(join(docs, "extra.md"), "mine\n");
    const result = writeDocs(docs, [{ path: "README.md", content: page("index") }]);
    expect(result).toMatchObject({ written: [], deleted: [], skipped: ["README.md"] });
    expect(readFileSync(join(docs, "README.md"), "utf8")).toBe("# My own notes\n");
    expect(readFileSync(join(docs, "extra.md"), "utf8")).toBe("mine\n");
  });

  it("refuses paths that would land outside the folder before writing anything", () => {
    const { dir, docs } = setup();
    for (const bad of ["../victim.md", "elements/../../victim.md", "/etc/passwd", "C:\\x.md", ""]) {
      expect(() => writeDocs(docs, [{ path: "ok.md", content: page("ok") }, { path: bad, content: page("x") }])).toThrow(/Refusing to write/);
    }
    expect(existsSync(join(docs, "ok.md"))).toBe(false);
    expect(readFileSync(join(dir, "victim.md"), "utf8")).toBe("keep me\n");
  });

  it("reports what it would do without writing, for --check", () => {
    const { docs } = setup();
    const result = writeDocs(docs, [{ path: "README.md", content: page("index") }], { dryRun: true });
    expect(result.written).toEqual(["README.md"]);
    expect(existsSync(join(docs, "README.md"))).toBe(false);
  });
});
