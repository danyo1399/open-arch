import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "@open-arch/core";
import { SKILL_TARGETS as INIT_TARGETS } from "../../../packages/cli/src/commands/init.js";
import { SKILL_TARGETS, skillFiles } from "../src/skill.js";

const skillDir = fileURLToPath(new URL("../../../packages/skill/open-arch/", import.meta.url));

describe("the agent skill the designer has, for Ask AI and the desktop app's saves", () => {
  it("is the skill open-arch init installs, in the same places", () => {
    expect(SKILL_TARGETS).toEqual(INIT_TARGETS);
    // Every file init copies, not only the pages.
    const onDisk = (readdirSync(skillDir, { recursive: true, encoding: "utf8" }) as string[])
      .filter((path) => statSync(join(skillDir, path)).isFile())
      .map((path) => ({ path: relative(skillDir, join(skillDir, path)).split("\\").join("/"), content: readFileSync(join(skillDir, path), "utf8") }))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(skillFiles).toEqual(onDisk);
    expect(skillFiles.map((f) => f.path)).toContain("SKILL.md");
  });

  it("tells agents without the CLI to say what to change in the designer, not to install the CLI", () => {
    const skill = skillFiles.find((f) => f.path === "SKILL.md")!.content;
    expect(skill).toContain("## Without the `open-arch` command");
    expect(skill).toContain("If it doesn't, there's no command to change the model with here: don't look for one, and don't try to install one.");
    expect(skill).toContain("When asked to change the architecture, say what to change in the open-arch designer");
    // Only a save to the workspace's file rewrites the docs.
    expect(skill).toContain("The designer rewrites the docs when it saves the workspace to its file, opened from its folder or in the desktop app. A copy edited in the browser has to be exported again.");
    // The CLI isn't published, so an npx command would fail.
    expect(skillFiles.some((f) => f.content.includes("npx"))).toBe(false);
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
