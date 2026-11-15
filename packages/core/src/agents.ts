/**
 * The section `open-arch init` adds to a project's AGENTS.md, telling AI agents the architecture is
 * an open-arch model and to change it only with the CLI. The CLI writes it, and so does the web app,
 * in an exported zip and in a folder opened from its start page.
 */

const SECTION_START = "<!-- open-arch:start -->";
const SECTION_END = "<!-- open-arch:end -->";

/**
 * The section, for a workspace at `workspace` and docs in `docs`, both relative to the project's
 * top. `version` is the CLI's, for agents without it installed.
 */
export function agentsSection(workspace: string, docs: string | undefined, version: string): string {
  return `${SECTION_START}
## Architecture

This project's architecture is an open-arch model (C4: people, systems, containers, components and views) in \`${workspace}\`.${docs ? ` Readable docs generated from it are in \`${docs}/\`.` : ""}

- Load the \`open-arch\` skill before reading or changing the architecture. If your tool doesn't support skills, read \`.agents/skills/open-arch/SKILL.md\`.
- Never edit \`${workspace}\`${docs ? ` or \`${docs}/\`` : ""} by hand. Read with \`open-arch show\`, and change the model only with \`open-arch\` commands; each one is checked before it's saved. If \`open-arch\` isn't installed, use \`npx -y open-arch@${version}\` instead.
${SECTION_END}
`;
}

/** Where a marker is in the text, on a line of its own, or -1. One quoted in a sentence doesn't count. */
function markerAt(text: string, marker: string): number {
  // A line can end in \r\n, as on Windows, and the first can start with a byte-order mark, which stays where it is.
  const match = new RegExp(`^\\uFEFF?[ \\t]*${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t\\r]*$`, "m").exec(text);
  return match ? match.index + (match[0].startsWith("\uFEFF") ? 1 : 0) : -1;
}

/**
 * AGENTS.md's text with the section in it: in place of the one it has, or added at the end. The
 * rest is kept as it is. A section is marked by its two markers, each on a line of its own, so a
 * file that mentions them in a sentence keeps that sentence. When the file has one marker without
 * the other, or the end before the start, where the section ends can't be told, so it throws
 * rather than risk replacing someone's own text.
 */
export function withAgentsSection(text: string, section: string): string {
  // The section's lines end as the file's do.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  section = section.replace(/\r?\n/g, eol);
  const start = markerAt(text, SECTION_START);
  const end = markerAt(text, SECTION_END);
  if (start !== -1 && end > start) return text.slice(0, start) + section.trimEnd() + text.slice(text.indexOf(SECTION_END, end) + SECTION_END.length);
  if (start !== -1 || end !== -1) {
    throw new Error(`AGENTS.md has ${start === -1 ? `${SECTION_END} without ${SECTION_START} before it` : `${SECTION_START} without ${SECTION_END} after it`}, so it was left alone. Put the markers back round the open-arch section, or take them out.`);
  }
  if (!text.trim()) return section;
  return `${text.replace(/(\r?\n)*$/, eol)}${eol}${section}`;
}

/** The workspace file AGENTS.md's open-arch section names, or null when it has no section, or one that names none. */
export function agentsSectionWorkspace(text: string): string | null {
  const start = markerAt(text, SECTION_START);
  const end = markerAt(text, SECTION_END);
  if (start === -1 || end < start) return null;
  return /open-arch model \([^)]*\) in `([^`]+)`/.exec(text.slice(start, end))?.[1] ?? null;
}
