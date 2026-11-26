import { describe, expect, it } from "vitest";
import { agentsSection, agentsSectionWorkspace, exportDocs, generatedFrom, lineEnding, loadWorkspace, withAgentsSection } from "../src/index.js";

describe("the AGENTS.md section", () => {
  it("names the workspace and its docs", () => {
    const section = agentsSection("arch/shop.openarch", "docs/architecture");
    expect(section.startsWith("<!-- open-arch:start -->\n## Architecture")).toBe(true);
    expect(section.endsWith("<!-- open-arch:end -->\n")).toBe(true);
    expect(section).toContain("in `arch/shop.openarch`. Readable docs generated from it are in `docs/architecture/`.");
    expect(section).toContain("Never edit `arch/shop.openarch` or `docs/architecture/` by hand.");
    expect(section).toContain("Read the docs, or `arch/shop.openarch`, and when asked to change the architecture, say what to change in the open-arch designer.");
    // Without docs, it doesn't mention them.
    expect(agentsSection("a.openarch", undefined)).not.toContain("docs");
    expect(agentsSection("a.openarch", undefined)).toContain("Read `a.openarch`, and when asked");
  });

  it("tells agents without the CLI to say what to change in the designer, not to look for the CLI or install it", () => {
    // A workspace made in the web app usually has no CLI beside it, and the CLI isn't published to install.
    const section = agentsSection("a.openarch", "docs");
    expect(section).toContain("If the `open-arch` command runs here (try `open-arch --version`), or you were given another command that runs it, read with `open-arch show`, and change the model only with `open-arch` commands");
    expect(section).toContain("If neither, there's no command to change it with here: don't look for one, and don't try to install one.");
    expect(section).not.toContain("npx");
  });

  it("goes in place of the one there, keeps the rest, and is added at the end of a file without one", () => {
    const first = agentsSection("a.openarch", undefined);
    const second = agentsSection("b.openarch", "docs");
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
    const section = agentsSection("a.openarch", undefined);
    const notes = "Use `<!-- open-arch:start -->` to begin the section.\nMy rule one.\nMy rule two.\nUse `<!-- open-arch:end -->` to end it.\n";
    expect(withAgentsSection(notes, section)).toBe(`${notes}\n${section}`);
    // Indented markers on their own lines still count.
    const indented = withAgentsSection(`# Rules\n\n  ${section.trimEnd().replace(/\n/g, "\n  ")}\n`, agentsSection("b.openarch", undefined));
    expect(indented).toContain("in `b.openarch`");
    expect(indented).not.toContain("in `a.openarch`");
  });

  it("keeps a file's Windows line endings, and finds its markers", () => {
    const file = "# Rules\r\n\r\nUse tabs.\r\n";
    expect(lineEnding(file)).toBe("\r\n");
    expect(lineEnding("# Rules\n")).toBe("\n");
    const first = agentsSection("a.openarch", undefined, lineEnding(file));
    const added = withAgentsSection(file, first);
    expect(added).toBe(`# Rules\r\n\r\nUse tabs.\r\n\r\n${first}`);
    expect(added.replace(/\r\n/g, "")).not.toContain("\n");
    const replaced = withAgentsSection(added, agentsSection("b.openarch", undefined, lineEnding(added)));
    expect(replaced).toContain("in `b.openarch`");
    expect(replaced).not.toContain("in `a.openarch`");
    expect(replaced.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("finds a marker on the first line after a byte-order mark, and keeps the mark", () => {
    const old = agentsSection("a.openarch", undefined);
    const replaced = withAgentsSection(`\uFEFF${old}\n# Rules\n`, agentsSection("b.openarch", undefined));
    expect(replaced.startsWith("\uFEFF<!-- open-arch:start -->")).toBe(true);
    expect(replaced).toContain("in `b.openarch`");
    expect(replaced).not.toContain("in `a.openarch`");
    expect(replaced.endsWith("\n# Rules\n")).toBe(true);
    expect(agentsSectionWorkspace(`\uFEFF${old}`)).toBe("a.openarch");
  });

  it("refuses a file with more than one section, rather than leave one naming an old place", () => {
    const one = agentsSection("a.openarch", undefined);
    expect(() => withAgentsSection(`${one}\n# Rules\n\n${one}`, agentsSection("b.openarch", undefined))).toThrow("AGENTS.md has more than one open-arch section, or a marker without its pair, so it was left alone.");
  });

  it("refuses a stray start marker above a whole section, rather than replace the text between them", () => {
    const one = agentsSection("a.openarch", undefined);
    expect(() => withAgentsSection(`# Rules\n<!-- open-arch:start -->\nMy own notes.\n\n${one}`, agentsSection("b.openarch", "docs"))).toThrow(
      "AGENTS.md has more than one open-arch section, or a marker without its pair, so it was left alone.",
    );
    expect(() => withAgentsSection(`${one}\nMy own notes.\n<!-- open-arch:end -->\n`, one)).toThrow("or a marker without its pair");
  });

  it("keeps a byte-order mark on a file with nothing else in it", () => {
    const one = agentsSection("a.openarch", undefined);
    expect(withAgentsSection("\uFEFF", one)).toBe(`\uFEFF${one}`);
    expect(withAgentsSection("\uFEFF\n", one)).toBe(`\uFEFF${one}`);
  });

  it("writes a name with backticks so it reads back whole", () => {
    for (const name of ["a`b.openarch", "``x``.openarch", "plain.openarch"]) {
      const section = agentsSection(name, "do`cs");
      expect(agentsSectionWorkspace(section)).toBe(name);
    }
    expect(agentsSection("a`b.openarch", undefined)).toContain("in `` a`b.openarch ``.");
  });

  it("refuses to name a path with a line break in it, as the section is read a line at a time", () => {
    const cases = [
      ["a\nb.openarch", undefined],
      ["a.openarch", "do\r\ncs"],
      ["a.openarch", "x\n<!-- open-arch:end -->"],
      // Unicode's line and paragraph separators end a line too, where markers are looked for.
      ["a\u2028<!-- open-arch:end -->\u2028b.openarch", undefined],
      ["a.openarch", "do\u2029cs"],
    ] as const;
    for (const [workspace, docs] of cases) {
      expect(() => agentsSection(workspace, docs)).toThrow(`the ${docs ? "docs folder's" : "workspace's"} path has a line break in it.`);
    }
    // The path it names shows every break, Unicode's separators too.
    expect(() => agentsSection("a\u2028b.openarch", undefined)).toThrow('can\'t name "a\\u2028b.openarch"');
  });

  it("names the pages of docs at the top of the project, beside AGENTS.md, so the rest of it can still be edited", () => {
    const section = agentsSection("shop.openarch", "");
    expect(section).toContain("in `shop.openarch`. Readable docs generated from it are beside it, at the top of the project: the pages in `elements/` and `views/`, and `README.md` unless the folder has its own.");
    expect(section).toContain("Never edit `shop.openarch` or a page generated from it (one that starts with `<!-- Generated by open-arch`) by hand.");
    expect(section).not.toContain("`./`");
    // So are they for a file below the top.
    const below = agentsSection("arch/shop.openarch", "");
    expect(below).toContain("in `arch/shop.openarch`. Readable docs generated from it are at the top of the project: the pages in `elements/` and `views/`, and `README.md` unless the folder has its own.");
    expect(below).toContain("Never edit `arch/shop.openarch` or a page generated from it (one that starts with `<!-- Generated by open-arch`) by hand.");
    expect(below).not.toContain("`/`");
  });

  it("tells which workspace a section names", () => {
    expect(agentsSectionWorkspace(withAgentsSection("# Rules\n", agentsSection("arch/a.openarch", "docs")))).toBe("arch/a.openarch");
    expect(agentsSectionWorkspace("# Rules\n")).toBeNull();
    expect(agentsSectionWorkspace("<!-- open-arch:start -->\nSomething else.\n<!-- open-arch:end -->\n")).toBeNull();
  });

  it("refuses a file with one marker without the other, or the end before the start, rather than replace someone's own text", () => {
    const section = agentsSection("a.openarch", undefined);
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:start -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:start --> without <!-- open-arch:end --> after it, so it was left alone.");
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:end -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:end --> without <!-- open-arch:start --> before it");
    expect(() => withAgentsSection("<!-- open-arch:end -->\nMine.\n<!-- open-arch:start -->\n", section)).toThrow("without <!-- open-arch:end --> after it");
  });
});

describe("the file a generated page came from", () => {
  it("is read from the page's first line, and is null for a page open-arch didn't generate", () => {
    const page = exportDocs(loadWorkspace(JSON.stringify({ openarch: 22, name: "A", elements: {}, views: {} })), "arch/a.openarch")[0]!.content;
    expect(generatedFrom(page)).toBe("arch/a.openarch");
    expect(generatedFrom("# Mine\n")).toBeNull();
    // A page generated before its first line said to change the model in open-arch.
    expect(generatedFrom("<!-- Generated by open-arch from a.openarch. Don't edit: change the model in the designer or with the open-arch CLI, and this page is rewritten. -->\n")).toBe("a.openarch");
  });
});
