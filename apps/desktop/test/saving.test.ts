import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDocument, serializeDocument } from "@open-arch/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSetup } from "../src/agent-setup.js";
import { Saver } from "../src/saving.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-saving-"));
  temps.push(dir);
  return dir;
};

/** A Git repository, a skill to copy, and a Saver for them. */
function repository() {
  const root = temp();
  mkdirSync(join(root, ".git"));
  const source = temp();
  writeFileSync(join(source, "SKILL.md"), "Run open-arch.\n");
  const saver = new Saver(new AgentSetup(() => source, temp()));
  const doc = emptyDocument("Shop");
  doc.export = { docs: "shop-docs" };
  return { root, saver, doc, skillFile: join(root, ".claude", "skills", "open-arch", "SKILL.md") };
}

describe("making a workspace in the desktop app", () => {
  it("saves it, sets up the skill and AGENTS.md at once, then opens it, with what the save did", () => {
    const { root, saver, doc, skillFile } = repository();
    const file = join(root, "shop.openarch");
    const open = vi.fn((made: string) => {
      // Opened only once it's saved.
      expect(existsSync(made)).toBe(true);
      return { path: made, name: "shop.openarch" };
    });
    const made = saver.make(file, doc, open);
    expect(open).toHaveBeenCalledWith(file);
    expect(made).toEqual({ path: file, name: "shop.openarch", saved: { docs: { dir: "shop-docs", written: 1, deleted: 0, skipped: [] } } });
    expect(readFileSync(skillFile, "utf8")).toBe("Run open-arch.\n");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("in `shop.openarch`. Readable docs generated from it are in `shop-docs/`.");
    // The designer's first save after that doesn't write the skill again.
    rmSync(skillFile);
    saver.save(file, doc);
    expect(existsSync(skillFile)).toBe(false);
  });

  it("doesn't open, or remember, a file whose save failed", () => {
    const { root, saver, doc } = repository();
    const open = vi.fn();
    expect(() => saver.make(join(root, "missing", "shop.openarch"), doc, open)).toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it("says what went wrong setting up agents, with the file saved", () => {
    const { root, saver, doc } = repository();
    mkdirSync(join(root, "AGENTS.md"));
    const made = saver.make(join(root, "shop.openarch"), doc, (file) => ({ path: file, name: "shop.openarch" }));
    expect(made.saved?.agentsError).toContain("Couldn't read AGENTS.md");
    expect(existsSync(join(root, "shop.openarch"))).toBe(true);
  });
});

describe("refreshing the docs from the desktop app", () => {
  it("rewrites the docs folder without writing the file, the skill or AGENTS.md", () => {
    const { root, saver, doc, skillFile } = repository();
    const file = join(root, "shop.openarch");
    doc.elements = { shop: { kind: "system", name: "Shop" } };
    doc.views = { context: { title: "Context", level: "context", scope: "shop" } };
    // A file as written by hand, not as a save writes it.
    const text = JSON.stringify(doc);
    writeFileSync(file, text);
    expect(saver.docs(file, text)).toEqual({ dir: "shop-docs", written: 3, deleted: 0, skipped: [] });
    expect(readFileSync(join(root, "shop-docs", "views", "context.md"), "utf8")).toContain("# Context");
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(existsSync(skillFile)).toBe(false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    // Pages already up to date are left as they are.
    expect(saver.docs(file, text)).toEqual({ dir: "shop-docs", written: 0, deleted: 0, skipped: [] });
    // As a save writes it, after an edit.
    writeFileSync(file, serializeDocument(doc));
    expect(saver.docs(file, text)).toEqual({ dir: "shop-docs", written: 0, deleted: 0, skipped: [] });
  });

  it("doesn't write the docs from the designer's copy once the file changed outside", () => {
    const { root, saver, doc } = repository();
    const file = join(root, "shop.openarch");
    writeFileSync(file, serializeDocument({ ...doc, name: "Shop 2" }));
    expect(() => saver.docs(file, serializeDocument(doc))).toThrow("shop.openarch changed outside the designer, so the docs weren't brought up to date");
    expect(existsSync(join(root, "shop-docs"))).toBe(false);
  });

  it("does nothing for a workspace that names no docs folder", () => {
    const { root, saver, doc } = repository();
    doc.export = undefined;
    const file = join(root, "shop.openarch");
    writeFileSync(file, serializeDocument(doc));
    expect(saver.docs(file, serializeDocument(doc))).toBeNull();
  });
});
