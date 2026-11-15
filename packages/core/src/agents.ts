/**
 * The section `open-arch init` adds to a project's AGENTS.md, telling AI agents the architecture is
 * an open-arch model and to change it only with the CLI. The CLI writes it, and so does the web app,
 * in an exported zip and in a folder opened from its start page.
 */

const SECTION_START = "<!-- open-arch:start -->";
const SECTION_END = "<!-- open-arch:end -->";

/**
 * The section, for a workspace at `workspace` and docs in `docs`, both relative to the project's
 * top. `version` is the CLI's, for agents without it installed. Its lines end in `eol`, the file's
 * own line ending (lineEnding). A path with a line break in it can't be named in the section, which
 * is read a line at a time, so it throws.
 */
export function agentsSection(workspace: string, docs: string | undefined, version: string, eol = "\n"): string {
  // Every character that ends a line where markers are looked for: \r, \n, and Unicode's line and paragraph separators.
  const breaks = /[\r\n\u2028\u2029]/;
  if (breaks.test(workspace)) throw new LineBreakInPath(workspace, "workspace");
  if (docs && breaks.test(docs)) throw new LineBreakInPath(docs, "docs");
  // Docs at the top of the project, beside AGENTS.md, have the path "".
  const docsFolder = docs === undefined ? undefined : code(`${docs || "."}/`);
  return [
    SECTION_START,
    "## Architecture",
    "",
    `This project's architecture is an open-arch model (C4: people, systems, containers, components and views) in ${code(workspace)}.${docsFolder ? ` Readable docs generated from it are in ${docsFolder}.` : ""}`,
    "",
    "- Load the `open-arch` skill before reading or changing the architecture. If your tool doesn't support skills, read `.agents/skills/open-arch/SKILL.md`.",
    `- Never edit ${code(workspace)}${docsFolder ? ` or ${docsFolder}` : ""} by hand. Read with \`open-arch show\`, and change the model only with \`open-arch\` commands; each one is checked before it's saved. If \`open-arch\` isn't installed, use \`npx -y open-arch@${version}\` instead.`,
    SECTION_END,
    "",
  ].join(eol);
}

/** What agentsSection throws for a path it can't name, as the section is read a line at a time. */
export class LineBreakInPath extends Error {
  /** `of` says whose path it is: the workspace file's, or its docs folder's. */
  constructor(
    readonly path: string,
    readonly of: "workspace" | "docs",
  ) {
    // Written so every break shows: JSON escapes \r and \n, but not Unicode's separators.
    const shown = JSON.stringify(path).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    super(`AGENTS.md's open-arch section can't name ${shown}: the ${of === "docs" ? "docs folder's" : "workspace's"} path has a line break in it.`);
  }
}

/** The line ending AGENTS.md's text uses: \r\n when it has any, as on Windows, else \n. */
export function lineEnding(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** A marker on a line of its own: which, and where its text starts and ends. */
interface Marker {
  start: boolean;
  at: number;
  end: number;
}

/**
 * Every marker in the text that's on a line of its own, in order. One quoted in a sentence doesn't
 * count. A line can end in \r\n, as on Windows, and the first can start with a byte-order mark.
 */
function markers(text: string): Marker[] {
  const found: Marker[] = [];
  for (const match of text.matchAll(/^\uFEFF?[ \t]*(<!-- open-arch:(start|end) -->)[ \t\r]*$/gm)) {
    const at = match.index + match[0].indexOf(match[1]!);
    found.push({ start: match[2] === "start", at, end: at + match[1]!.length });
  }
  return found;
}

/** The one section's markers, none, or why the file's markers can't be told apart safely. */
function section(text: string): [Marker, Marker] | null {
  const found = markers(text);
  if (found.length === 0) return null;
  const [first, second] = found;
  if (found.length === 2 && first!.start && !second!.start) return [first!, second!];
  // One end alone; a start alone, or after its end; or else more markers than one section has.
  const why =
    found.length === 1 && !first!.start
      ? `${SECTION_END} without ${SECTION_START} before it`
      : found.length === 1 || (found.length === 2 && !first!.start && second!.start)
        ? `${SECTION_START} without ${SECTION_END} after it`
        : "more than one open-arch section, or a marker without its pair";
  throw new Error(`AGENTS.md has ${why}, so it was left alone. Keep one open-arch section, with both its markers, or take them out.`);
}

/**
 * AGENTS.md's text with the section in it: in place of the one it has, or added at the end. The
 * rest is kept as it is, a byte-order mark included. Make the section with the file's line ending
 * (lineEnding), so the file keeps it. A section is marked by its two markers, each on a line of
 * its own, so a file that mentions them in a sentence keeps that sentence. A file whose markers
 * aren't exactly one start and then one end can't safely be told apart from someone's own text,
 * so it throws rather than risk replacing that text.
 */
export function withAgentsSection(text: string, replacement: string): string {
  const eol = lineEnding(text);
  const found = section(text);
  if (found) return text.slice(0, found[0].at) + replacement.trimEnd() + text.slice(found[1].end);
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = text.slice(bom.length);
  if (!rest.trim()) return bom + replacement;
  return `${bom}${rest.replace(/(\r?\n)*$/, eol)}${eol}${replacement}`;
}

/** The workspace file AGENTS.md's open-arch section names, or null when it has no section, or one that names none. */
export function agentsSectionWorkspace(text: string): string | null {
  let found;
  try {
    found = section(text);
  } catch {
    return null;
  }
  if (!found) return null;
  // A code span: a run of backticks, the name (padded with a space when it has backticks of its own), and the same run.
  const span = /open-arch model \([^)]*\) in (`+)(.*?)\1(?!`)\./.exec(text.slice(found[0].end, found[1].at));
  if (!span) return null;
  const name = span[2]!;
  return span[1]!.length > 1 && name.startsWith(" ") && name.endsWith(" ") ? name.slice(1, -1) : name;
}

/**
 * A name as Markdown code. One with backticks in it, which a file's name can have, is fenced with a
 * longer run of them and padded with spaces, as Markdown reads it, so it comes back whole.
 */
function code(name: string): string {
  if (!name.includes("`")) return `\`${name}\``;
  const fence = "`".repeat(Math.max(...(name.match(/`+/g) ?? [""]).map((run) => run.length)) + 1);
  return `${fence} ${name} ${fence}`;
}
