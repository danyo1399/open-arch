/**
 * The open-arch agent skill, which teaches AI agents to read and change a workspace with the
 * open-arch CLI, or, where it isn't installed, as usually beside a workspace made here, to read it
 * and say what to change in the designer. The web app puts it beside a workspace, as `open-arch
 * init` installs it: in an exported zip, and in a folder opened from the start page.
 */

/** Where agents look for project skills, as `open-arch init` installs them (SKILL_TARGETS there). Claude Code reads `.claude/skills`; most others read `.agents/skills`. */
export const SKILL_TARGETS = [".agents/skills/open-arch", ".claude/skills/open-arch"];

const raw = import.meta.glob<string>("../../../packages/skill/open-arch/**/*", { query: "?raw", import: "default", eager: true });

/** The skill's files, by their path in the skill's folder, as `open-arch init` copies them. */
export const skillFiles: { path: string; content: string }[] = Object.entries(raw)
  .map(([path, content]) => ({ path: path.slice(path.indexOf("/open-arch/") + "/open-arch/".length), content }))
  .sort((a, b) => a.path.localeCompare(b.path));
