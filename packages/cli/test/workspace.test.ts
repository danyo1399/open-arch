import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GENERATED_MARKER } from "@open-arch/core";
import { afterEach, describe, expect, it } from "vitest";
import { keepAgentsSection, keepSkill, repositoryRoot, writeDocs } from "../src/workspace.js";

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

describe("the agent skill and AGENTS.md beside a workspace", () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "open-arch-test-"));
    temps.push(dir);
    return dir;
  };

  it("finds the top of the Git repository a folder is in, or the folder outside one", () => {
    const repo = project();
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "arch", "deep"), { recursive: true });
    expect(repositoryRoot(join(repo, "arch", "deep"))).toBe(repo);
    const loose = project();
    expect(repositoryRoot(loose)).toBe(loose);
  });

  it("writes the skill's files with the version filled in, only those that differ, and leaves anything else alone", () => {
    const source = project();
    mkdirSync(join(source, "references"));
    writeFileSync(join(source, "SKILL.md"), "Run open-arch@{{version}}.\n");
    writeFileSync(join(source, "references", "format.md"), "Format.\n");
    const dest = join(project(), ".claude", "skills", "open-arch");
    expect(keepSkill(source, dest, "1.2.3").sort()).toEqual(["SKILL.md", "references/format.md"]);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("Run open-arch@1.2.3.\n");
    expect(keepSkill(source, dest, "1.2.3")).toEqual([]);
    writeFileSync(join(dest, "SKILL.md"), "edited");
    writeFileSync(join(dest, "mine.md"), "Mine.");
    expect(keepSkill(source, dest, "1.2.3")).toEqual(["SKILL.md"]);
    expect(readFileSync(join(dest, "mine.md"), "utf8")).toBe("Mine.");
  });

  it("puts the section in AGENTS.md, keeping the rest, its line endings and its byte-order mark", () => {
    const root = project();
    writeFileSync(join(root, "AGENTS.md"), "﻿# Rules\r\n");
    expect(keepAgentsSection(root, join(root, "arch", "a.openarch"), join(root, "arch", "docs"), "1")).toBe(true);
    const text = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(text.startsWith("﻿# Rules\r\n\r\n<!-- open-arch:start -->\r\n")).toBe(true);
    expect(text).toContain("in `arch/a.openarch`. Readable docs generated from it are in `arch/docs/`.");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    // Again, nothing to write.
    expect(keepAgentsSection(root, join(root, "arch", "a.openarch"), join(root, "arch", "docs"), "1")).toBe(false);
    // Without an AGENTS.md, it makes one.
    const empty = project();
    expect(keepAgentsSection(empty, join(empty, "a.openarch"), undefined, "1")).toBe(true);
    expect(readFileSync(join(empty, "AGENTS.md"), "utf8")).toContain("in `a.openarch`.");
  });

  it("leaves a section naming another workspace still there, but not one naming this one another way", () => {
    const root = project();
    writeFileSync(join(root, "a.openarch"), "{}");
    keepAgentsSection(root, join(root, "a.openarch"), undefined, "1");
    const first = readFileSync(join(root, "AGENTS.md"), "utf8");
    expect(keepAgentsSection(root, join(root, "b.openarch"), undefined, "1")).toBe(false);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe(first);
    // Named as ./a.openarch by hand: it's this workspace, and its docs folder is put in.
    writeFileSync(join(root, "AGENTS.md"), first.replace("`a.openarch`", "`./a.openarch`"));
    expect(keepAgentsSection(root, join(root, "a.openarch"), join(root, "docs"), "1")).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("in `a.openarch`. Readable docs generated from it are in `docs/`.");
    // One that's gone, or outside the project, isn't another's.
    rmSync(join(root, "a.openarch"));
    expect(keepAgentsSection(root, join(root, "b.openarch"), undefined, "1")).toBe(true);
    writeFileSync(join(root, "AGENTS.md"), readFileSync(join(root, "AGENTS.md"), "utf8").replace("`b.openarch`", "`../x.openarch`"));
    expect(keepAgentsSection(root, join(root, "b.openarch"), undefined, "1")).toBe(true);
  });

  it("leaves an AGENTS.md alone that isn't UTF-8 text, or whose section can't be told apart, and says why", () => {
    const root = project();
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(join(root, "AGENTS.md"), latin1);
    expect(() => keepAgentsSection(root, join(root, "a.openarch"), undefined, "1")).toThrow("AGENTS.md isn't UTF-8 text, so it was left alone.");
    expect(readFileSync(join(root, "AGENTS.md"))).toEqual(latin1);
    writeFileSync(join(root, "AGENTS.md"), "# Rules\n<!-- open-arch:start -->\nMine.\n");
    expect(() => keepAgentsSection(root, join(root, "a.openarch"), undefined, "1")).toThrow("without <!-- open-arch:end --> after it");
    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
  });
});
