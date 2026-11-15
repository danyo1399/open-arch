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

/** AGENTS.md's text with the section in it: in place of the one it has, or added at the end. The rest is kept as it is. */
export function withAgentsSection(text: string, section: string): string {
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  if (start !== -1 && end > start) return text.slice(0, start) + section.trimEnd() + text.slice(end + SECTION_END.length);
  if (!text.trim()) return section;
  return `${text.replace(/\n*$/, "\n")}\n${section}`;
}
