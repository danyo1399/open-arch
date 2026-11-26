import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newDocument } from "../src/saving.js";

describe("a new desktop workspace", () => {
  it("is named after its file, with its docs in the file's own folder when it has the folder to itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "open-arch-new-"));
    try {
      mkdirSync(join(dir, ".agents"));
      expect(newDocument(join(dir, "payments-platform.openarch"))).toMatchObject({ name: "Payments Platform", export: { docs: "." } });
      expect(newDocument(join(dir, "-.openarch")).name).toBe("Architecture");
      // A file it's written over doesn't count.
      writeFileSync(join(dir, "old.openarch"), "{}");
      expect(newDocument(join(dir, "old.openarch")).export).toEqual({ docs: "." });
      // In a folder with other things in it, such as a README.md, the docs get a folder of their own.
      writeFileSync(join(dir, "README.md"), "# Mine\n");
      expect(newDocument(join(dir, "shop.openarch")).export).toEqual({ docs: "docs/architecture" });
      // Unless the file is in docs/architecture already, which that would nest.
      const own = join(dir, "docs", "architecture");
      mkdirSync(own, { recursive: true });
      writeFileSync(join(own, "overview.md"), "# Overview\n");
      expect(newDocument(join(own, "shop.openarch")).export).toEqual({ docs: "." });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
