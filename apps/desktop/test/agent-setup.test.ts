import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSetup } from "../src/agent-setup.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-setup-"));
  temps.push(dir);
  return dir;
};

/** A Git repository with a workspace in arch/, a skill to copy, and the setup for it. */
function project(options: { inRepo?: boolean; home?: string } = {}) {
  const root = temp();
  if (options.inRepo !== false) mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "arch"));
  const file = join(root, "arch", "a.openarch");
  writeFileSync(file, "{}");
  const source = temp();
  writeFileSync(join(source, "SKILL.md"), "Run open-arch@{{version}}.\n");
  const skill = { source, version: "1.2.3" };
  const setup = new AgentSetup(() => skill, options.home ?? temp());
  const skillFile = join(root, ".claude", "skills", "open-arch", "SKILL.md");
  const agents = () => readFileSync(join(root, "AGENTS.md"), "utf8");
  return { root, file, skill, setup, skillFile, agents };
}

describe("setting up a repository for AI agents from the desktop app's saves", () => {
  it("brings the skill up to date on the first save after the file is opened, and again once it's opened again", () => {
    const { root, file, setup, skillFile } = project();
    expect(setup.keep(file, undefined)).toEqual({});
    expect(readFileSync(skillFile, "utf8")).toBe("Run open-arch@1.2.3.\n");
    expect(existsSync(join(root, ".agents", "skills", "open-arch", "SKILL.md"))).toBe(true);
    // Later saves leave it alone.
    rmSync(skillFile);
    setup.keep(file, undefined);
    expect(existsSync(skillFile)).toBe(false);
    // Opened again, the next save brings it back.
    setup.opened(file);
    setup.keep(file, undefined);
    expect(existsSync(skillFile)).toBe(true);
  });

  it("says when the skill can't be written, and tries again on each save until it is", () => {
    const { file, skill, setup, skillFile } = project();
    const source = skill.source;
    skill.source = join(source, "missing");
    expect(setup.keep(file, undefined).skillError).toContain("ENOENT");
    expect(setup.keep(file, undefined).skillError).toContain("ENOENT");
    skill.source = source;
    expect(setup.keep(file, undefined)).toEqual({});
    expect(existsSync(skillFile)).toBe(true);
  });

  it("writes the AGENTS.md section again only when the docs folder changes", () => {
    const { root, file, setup, agents } = project();
    setup.keep(file, join(root, "arch", "docs"));
    expect(agents()).toContain("in `arch/a.openarch`. Readable docs generated from it are in `arch/docs/`.");
    // While the docs folder stays the same, saves don't touch AGENTS.md.
    writeFileSync(join(root, "AGENTS.md"), "# Mine\n");
    setup.keep(file, join(root, "arch", "docs"));
    expect(agents()).toBe("# Mine\n");
    setup.keep(file, join(root, "manual"));
    expect(agents()).toContain("Readable docs generated from it are in `manual/`.");
  });

  it("says when the section can't be written, with how to fix a line break, and tries again", () => {
    const { root, file, setup, agents } = project();
    const docs = join(root, "do\ncs");
    expect(setup.keep(file, docs).agentsError).toBe(
      'AGENTS.md\'s open-arch section can\'t name "do\\ncs": the docs folder\'s path has a line break in it. Choose another docs folder in the workspace\'s details.',
    );
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(setup.keep(file, join(root, "docs"))).toEqual({});
    expect(agents()).toContain("in `docs/`.");
  });

  it("writes nothing outside a Git repository, or in the home folder", () => {
    const loose = project({ inRepo: false });
    expect(loose.setup.keep(loose.file, undefined)).toEqual({});
    expect(existsSync(loose.skillFile)).toBe(false);
    expect(existsSync(join(loose.root, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(loose.root, "arch", ".claude"))).toBe(false);

    // A home folder that's a Git repository itself, as some keep their settings.
    const home = temp();
    mkdirSync(join(home, ".git"));
    const inHome = join(home, "a.openarch");
    writeFileSync(inHome, "{}");
    const setup = new AgentSetup(() => ({ source: temp(), version: "1" }), home);
    expect(setup.keep(inHome, undefined)).toEqual({});
    expect(existsSync(join(home, ".claude"))).toBe(false);
    expect(existsSync(join(home, "AGENTS.md"))).toBe(false);
  });
});
