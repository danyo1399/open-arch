import { describe, expect, it } from "vitest";
import { agentsSection, withAgentsSection } from "../src/index.js";

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

  it("refuses a file with one marker without the other, or the end before the start, rather than replace someone's own text", () => {
    const section = agentsSection("a.openarch", undefined, "1");
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:start -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:start --> without <!-- open-arch:end --> after it, so it was left alone.");
    expect(() => withAgentsSection("# Rules\n<!-- open-arch:end -->\nMine.\n", section)).toThrow("AGENTS.md has <!-- open-arch:end --> without <!-- open-arch:start --> before it");
    expect(() => withAgentsSection("<!-- open-arch:end -->\nMine.\n<!-- open-arch:start -->\n", section)).toThrow("without <!-- open-arch:end --> after it");
  });
});
