import { describe, expect, it } from "vitest";
import { agentsSection, agentsSectionWorkspace, lineEnding, withAgentsSection } from "../src/index.js";

describe("the AGENTS.md section", () => {
  it("names the workspace, its docs and the CLI's version", () => {
    const section = agentsSection("arch/shop.openarch", "docs/architecture", "1.2.3");
    expect(section.startsWith("<!-- open-arch:start -->\n## Architecture")).toBe(true);
    expect(section.endsWith("<!-- open-arch:end -->\n")).toBe(true);
    expect(section).toContain("in `arch/shop.openarch`. Readable docs generated from it are in `docs/architecture/`.");
    expect(section).toContain("Never edit `arch/shop.openarch` or `docs/architecture/` by hand.");
    expect(section).toContain("npx -y open-arch@1.2.3");
    // Without docs, it doesn't mention them.
    expect(agentsSection("a.openarch", undefined, "1.2.3")).not.toContain("docs");
  });

  it("goes in place of the one there, keeps the rest, and is added at the end of a file without one", () => {
    const first = agentsSection("a.openarch", undefined, "1");
    const second = agentsSection("b.openarch", "docs", "1");
    expect(withAgentsSection("", first)).toBe(first);
    expect(withAgentsSection("  \n", first)).toBe(first);
    const added = withAgentsSection("# Rules\n\nUse tabs.", first);
    expect(added).toBe(`# Rules\n\nUse tabs.\n\n${first}`);
    const replaced = withAgentsSection(`${added}\n## More\n`, second);
    expect(replaced).toBe(`# Rules\n\nUse tabs.\n\n${second.trimEnd()}\n\n## More\n`);
    // Again with the same section, nothing changes.
    expect(withAgentsSection(replaced, second)).toBe(replaced);
  });

  it("counts a marker only on a line of its own, so one quoted in a sentence is kept as it is", () => {
    const section = agentsSection("a.openarch", undefined, "1");
    const notes = "Use `<!-- open-arch:start -->` to begin the section.\nMy rule one.\nMy rule two.\nUse `<!-- open-arch:end -->` to end it.\n";
    expect(withAgentsSection(notes, section)).toBe(`${notes}\n${section}`);
    // Indented markers on their own lines still count.
    const indented = withAgentsSection(`# Rules\n\n  ${section.trimEnd().replace(/\n/g, "\n  ")}\n`, agentsSection("b.openarch", undefined, "1"));
    expect(indented).toContain("in `b.openarch`");
    expect(indented).not.toContain("in `a.openarch`");
  });

  it("keeps a file's Windows line endings, and finds its markers", () => {
    const file = "# Rules\r\n\r\nUse tabs.\r\n";
    expect(lineEnding(file)).toBe("\r\n");
    expect(lineEnding("# Rules\n")).toBe("\n");
    const first = agentsSection("a.openarch", undefined, "1", lineEnding(file));
    const added = withAgentsSection(file, first);
    expect(added).toBe(`# Rules\r\n\r\nUse tabs.\r\n\r\n${first}`);
    expect(added.replace(/\r\n/g, "")).not.toContain("\n");
    const replaced = withAgentsSection(added, agentsSection("b.openarch", undefined, "1", lineEnding(added)));
    expect(replaced).toContain("in `b.openarch`");
    expect(replaced).not.toContain("in `a.openarch`");
    expect(replaced.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("finds a marker on the first line after a byte-order mark, and keeps the mark", () => {
    const old = agentsSection("a.openarch", undefined, "1");
    const replaced = withAgentsSection(`\uFEFF${old}\n# Rules\n`, agentsSection("b.openarch", undefined, "1"));
    expect(replaced.startsWith("\uFEFF<!-- open-arch:start -->")).toBe(true);
    expect(replaced).toContain("in `b.openarch`");
    expect(replaced).not.toContain("in `a.openarch`");
    expect(replaced.endsWith("\n# Rules\n")).toBe(true);
    expect(agentsSectionWorkspace(`\uFEFF${old}`)).toBe("a.openarch");
  });

  it("refuses a file with more than one section, rather than leave one naming an old place", () => {
    const one = agentsSection("a.openarch", undefined, "1");
    expect(() => withAgentsSection(`${one}\n# Rules\n\n${one}`, agentsSection("b.openarch", undefined, "1"))).toThrow("AGENTS.md has more than one open-arch section, or a marker without its pair, so it was left alone.");
  });

  it("refuses a stray start marker above a whole section, rather than replace the text between them", () => {
    const one = agentsSection("a.openarch", undefined, "1");
    expect(() => withAgentsSection(`# Rules\n<!-- open-arch:start -->\nMy own notes.\n\n${one}`, agentsSection("b.openarch", "docs", "1"))).toThrow(
      "AGENTS.md has more than one open-arch section, or a marker without its pair, so it was left alone.",
    );
    expect(() => withAgentsSection(`${one}\nMy own notes.\n<!-- open-arch:end -->\n`, one)).toThrow("or a marker without its pair");
  });

  it("keeps a byte-order mark on a file with nothing else in it", () => {
    const one = agentsSection("a.openarch", undefined, "1");
    expect(withAgentsSection("\uFEFF", one)).toBe(`\uFEFF${one}`);
    expect(withAgentsSection("\uFEFF\n", one)).toBe(`\uFEFF${one}`);
  });

  it("writes a name with backticks or line breaks so it reads back whole", () => {
    for (const name of ["a`b.openarch", "``x``.openarch", "plain.openarch", "a\nb.openarch", "a\r\nb.openarch"]) {
      const section = agentsSection(name, "do`cs", "1");
      expect(agentsSectionWorkspace(section)).toBe(name);
    }
    expect(agentsSection("a`b.openarch", undefined, "1")).toContain("in `` a`b.openarch ``.");
  });

  it("keeps the line breaks in a name, whatever the file's line endings", () => {
    for (const file of ["# Rules\n", "# Rules\r\n"]) {
      for (const name of ["a\nb.openarch", "a\r\nb.openarch"]) {
        const written = withAgentsSection(file, agentsSection(name, undefined, "1", lineEnding(file)));
        expect(agentsSectionWorkspace(written)).toBe(name);
      }
    }
  });

  it("tells which workspace a section names", () => {
    expect(agentsSectionWorkspace(withAgentsSection("# Rules\n", agentsSection("arch/a.openarch", "docs", "1")))).toBe("arch/a.openarch");
    expect(agentsSectionWorkspace("# Rules\n")).toBeNull();
    expect(agentsSectionWorkspace("<!-- open-arch:start -->\nSomething else.\n<!-- open-arch:end -->\n")).toBeNull();
  });

  it("refuses a file with one marker without the other, or the end before the start, rather than replace someone's own text", () => {
    const section = agentsSection("a.openarch", undefined, "1");
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:start -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:start --> without <!-- open-arch:end --> after it, so it was left alone.");
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:end -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:end --> without <!-- open-arch:start --> before it");
    expect(() => withAgentsSection("<!-- open-arch:end -->\nMine.\n<!-- open-arch:start -->\n", section)).toThrow("without <!-- open-arch:end --> after it");
  });
});
