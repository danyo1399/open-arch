import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { buildWorkspace, emptyDocument, FILE_EXTENSION } from "@open-arch/core";
import { skillDir } from "@open-arch/skill";
import { CliError, VERSION, type Io } from "../io.js";
import { displayPath, readWorkspaceFile, syncDocs, writeWorkspaceFile } from "../workspace.js";
import { describeDocs } from "./export.js";

export interface InitOptions {
  file?: string;
  name?: string;
  docs?: string;
  noSkills?: boolean;
  noAgentsMd?: boolean;
}

/** Where agents look for project skills. Claude Code reads only `.claude/skills`; most others read `.agents/skills`. */
export const SKILL_TARGETS = [".agents/skills/open-arch", ".claude/skills/open-arch"];

const SECTION_START = "<!-- open-arch:start -->";
const SECTION_END = "<!-- open-arch:end -->";

/** "my-repo_name" → "My Repo Name" */
function titleCase(text: string): string {
  return text
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export function init(io: Io, opts: InitOptions): number {
  let file = resolve(io.cwd, opts.file ?? `architecture${FILE_EXTENSION}`);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, `architecture${FILE_EXTENSION}`);
  if (!file.endsWith(FILE_EXTENSION)) throw new CliError(`The workspace file must end in ${FILE_EXTENSION}.`, 2);
  const shown = displayPath(io.cwd, file);

  if (existsSync(file)) {
    io.out(`kept ${shown}\n`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    const doc = emptyDocument(opts.name?.trim() || titleCase(basename(projectRoot(io.cwd, dirname(file)))) || "Architecture");
    doc.export = { docs: (opts.docs ?? "docs/architecture").replace(/\\/g, "/") };
    writeWorkspaceFile(file, doc);
    io.out(`created ${shown}\n`);
    const docs = syncDocs(file, buildWorkspace(doc));
    if (docs) io.out(describeDocs(io, docs) + "\n");
  }

  const project = projectRoot(io.cwd, dirname(file));
  if (!opts.noSkills) {
    for (const rel of SKILL_TARGETS) {
      const dest = join(project, ...rel.split("/"));
      installSkill(dest);
      io.out(`installed skill in ${displayPath(io.cwd, dest)}\n`);
    }
  }
  if (!opts.noAgentsMd) {
    const agentsMd = join(project, "AGENTS.md");
    const existed = existsSync(agentsMd);
    const workspace = relative(project, file).split(sep).join("/");
    const docsDir = readWorkspaceFile(file).doc.export?.docs;
    const docsPath = docsDir ? relative(project, resolve(dirname(file), docsDir)).split(sep).join("/") : undefined;
    writeFileSync(agentsMd, withSection(existed ? readFileSync(agentsMd, "utf8") : "", agentsSection(workspace, docsPath)));
    io.out(`${existed ? "updated" : "created"} ${displayPath(io.cwd, agentsMd)}\n`);
  }
  io.out("\nNext: add elements with `open-arch add-element <id> --kind system --name \"...\"`, or open the file in the desktop app. The web app edits a copy: import the file, then export it back.\n");
  return 0;
}

/** The repository root above `dir`, else the current folder if `dir` is inside it, else `dir`. */
function projectRoot(cwd: string, dir: string): string {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) break;
  }
  const rel = relative(cwd, dir);
  return rel.startsWith("..") || isAbsolute(rel) ? dir : resolve(cwd);
}

/** Copy the skill, filling in the CLI version so agents run a matching `npx` command. */
function installSkill(dest: string): void {
  rmSync(dest, { recursive: true, force: true });
  cpSync(skillDir, dest, { recursive: true });
  const fill = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) fill(p);
      else if (name.endsWith(".md")) writeFileSync(p, readFileSync(p, "utf8").replaceAll("{{version}}", VERSION));
    }
  };
  fill(dest);
}

function agentsSection(workspace: string, docs: string | undefined): string {
  return `${SECTION_START}
## Architecture

This project's architecture is an open-arch model (C4: people, systems, containers, components and views) in \`${workspace}\`.${docs ? ` Readable docs generated from it are in \`${docs}/\`.` : ""}

- Load the \`open-arch\` skill before reading or changing the architecture. If your tool doesn't support skills, read \`.agents/skills/open-arch/SKILL.md\`.
- Never edit \`${workspace}\`${docs ? ` or \`${docs}/\`` : ""} by hand. Read with \`open-arch show\`, and change the model only with \`open-arch\` commands; each one is checked before it's saved. If \`open-arch\` isn't installed, use \`npx -y open-arch@${VERSION}\` instead.
${SECTION_END}
`;
}

function withSection(text: string, section: string): string {
  const start = text.indexOf(SECTION_START);
  const end = text.indexOf(SECTION_END);
  if (start !== -1 && end > start) return text.slice(0, start) + section.trimEnd() + text.slice(end + SECTION_END.length);
  if (!text.trim()) return section;
  return `${text.replace(/\n*$/, "\n")}\n${section}`;
}
