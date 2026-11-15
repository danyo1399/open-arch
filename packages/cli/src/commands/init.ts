import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { agentsSection, buildWorkspace, emptyDocument, FILE_EXTENSION, lineEnding, LineBreakInPath, nameFromFileName, withAgentsSection } from "@open-arch/core";
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

export function init(io: Io, opts: InitOptions): number {
  let file = resolve(io.cwd, opts.file ?? `architecture${FILE_EXTENSION}`);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, `architecture${FILE_EXTENSION}`);
  if (!file.endsWith(FILE_EXTENSION)) throw new CliError(`The workspace file must end in ${FILE_EXTENSION}.`, 2);
  const shown = displayPath(io.cwd, file);

  if (existsSync(file)) {
    io.out(`kept ${shown}\n`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    const doc = emptyDocument(opts.name?.trim() || nameFromFileName(basename(projectRoot(io.cwd, dirname(file)))) || "Architecture");
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
    let text: string;
    try {
      // As the designer does: a byte-order mark is kept, and bytes that aren't UTF-8 would be changed, so they're refused.
      let before = "";
      if (existed) {
        let bytes;
        try {
          bytes = readFileSync(agentsMd);
        } catch (error) {
          throw new Error(`Couldn't read AGENTS.md: ${(error as Error).message}.`);
        }
        try {
          before = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(bytes);
        } catch {
          throw new Error("AGENTS.md isn't UTF-8 text, so it was left alone.");
        }
      }
      text = withAgentsSection(before, agentsSection(workspace, docsPath, VERSION, lineEnding(before)));
    } catch (error) {
      const inPlace = opts.noSkills ? "The workspace and its docs are" : "The workspace, its docs and the skill are";
      // A path with a line break is fixed by renaming it, not by changing AGENTS.md.
      const fix = error instanceof LineBreakInPath ? "rename it so its path has no line break, then run open-arch init again" : "run open-arch init again once AGENTS.md is fixed";
      throw new CliError(`${(error as Error).message} ${inPlace} in place: ${fix}.`);
    }
    writeFileSync(agentsMd, text);
    io.out(`${existed ? "updated" : "created"} ${displayPath(io.cwd, agentsMd)}\n`);
  }
  io.out("\nNext: add elements with `open-arch add-element <id> --kind system --name \"...\"`, or open the file in the desktop app. In Chrome or Edge, the web app's Open folder… edits it too; other browsers edit a copy: import the file, then export it back.\n");
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
