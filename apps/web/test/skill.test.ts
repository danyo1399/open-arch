import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "@open-arch/core";
import { SKILL_TARGETS as INIT_TARGETS } from "../../../packages/cli/src/commands/init.js";
import { VERSION } from "../../../packages/cli/src/io.js";
import { SKILL_TARGETS, skillFiles } from "../src/skill.js";

const skillDir = fileURLToPath(new URL("../../../packages/skill/open-arch/", import.meta.url));

describe("the agent skill the web app puts beside a workspace", () => {
  it("is the skill open-arch init installs, in the same places, with the CLI's version filled in", () => {
    expect(SKILL_TARGETS).toEqual(INIT_TARGETS);
    // Every file init copies, not only the pages.
    const onDisk = (readdirSync(skillDir, { recursive: true, encoding: "utf8" }) as string[])
      .filter((path) => statSync(join(skillDir, path)).isFile())
      .map((path) => {
        const text = readFileSync(join(skillDir, path), "utf8");
        return { path: relative(skillDir, join(skillDir, path)).split("\\").join("/"), content: path.endsWith(".md") ? text.replaceAll("{{version}}", VERSION) : text };
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(skillFiles).toEqual(onDisk);
    expect(skillFiles.map((f) => f.path)).toContain("SKILL.md");
    expect(skillFiles.some((f) => f.content.includes("{{version}}"))).toBe(false);
  });

  it("names the format version the tools write, wherever its format page gives one", () => {
    const format = skillFiles.find((f) => f.path === "references/format.md")!.content;
    const older = FORMAT_VERSION - 1;
    expect(format).toContain(`# The open-arch workspace (format version ${FORMAT_VERSION})`);
    expect(format).toContain(`"openarch": ${FORMAT_VERSION},`);
    expect(format).toContain(`| \`openarch\` | Format version, always \`${FORMAT_VERSION}\` |`);
    expect(format).toContain(`Tools read version 1 to ${older} files too, and write them back as version ${FORMAT_VERSION}.`);
    expect(format).toContain(`| \`version-unsupported\` | error | \`openarch\` is missing, or not \`${FORMAT_VERSION}\` (or \`1\` to \`${older}\`, which are upgraded) |`);
  });
});
