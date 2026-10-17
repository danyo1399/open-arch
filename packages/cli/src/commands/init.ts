import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_FILE, DEFAULT_CONFIG_TEXT, parseConfig } from "@open-arch/core";
import { skillDir } from "@open-arch/skill";
import { VERSION, type Io } from "../io.js";

export interface InitOptions {
  dir?: string;
  noSkills?: boolean;
  noAgentsMd?: boolean;
}

/** Where agents look for project skills. Claude Code reads only `.claude/skills`; most others read `.agents/skills`. */
export const SKILL_TARGETS = [".agents/skills/open-arch", ".claude/skills/open-arch"];

const SECTION_START = "<!-- open-arch:start -->";
const SECTION_END = "<!-- open-arch:end -->";

const FOLDER_READMES: Record<string, string> = {
  model: `# Model

One markdown file per person, system, container and component. The file name is the element's ID.
See the \`open-arch\` skill (\`.agents/skills/open-arch/references/format.md\`) for the format.
`,
  views: `# Views

One markdown file per diagram. Each view picks elements from the model and keeps its own box positions.
`,
};

export function init(io: Io, opts: InitOptions): number {
  const target = resolve(io.cwd, opts.dir ?? ".");
  const show = (p: string) => relative(io.cwd, p) || ".";
  mkdirSync(target, { recursive: true });

  const configPath = join(target, CONFIG_FILE);
  if (existsSync(configPath)) {
    io.out(`kept ${show(configPath)}\n`);
  } else {
    writeFileSync(configPath, DEFAULT_CONFIG_TEXT);
    io.out(`created ${show(configPath)}\n`);
  }
  const { config } = parseConfig(readFileSync(configPath, "utf8"));
  for (const [key, folder] of [["model", config.model], ["views", config.views]] as const) {
    const dir = join(target, ...folder.split("/"));
    mkdirSync(dir, { recursive: true });
    const readme = join(dir, "README.md");
    if (!existsSync(readme) && readdirSync(dir).length === 0) {
      writeFileSync(readme, FOLDER_READMES[key]!);
      io.out(`created ${show(readme)}\n`);
    }
  }

  const project = projectRoot(io.cwd, target);
  if (!opts.noSkills) {
    for (const rel of SKILL_TARGETS) {
      const dest = join(project, ...rel.split("/"));
      installSkill(dest);
      io.out(`installed skill in ${show(dest)}\n`);
    }
  }
  if (!opts.noAgentsMd) {
    const agentsMd = join(project, "AGENTS.md");
    const existed = existsSync(agentsMd);
    const workspace = relative(project, target).split(sep).join("/");
    writeFileSync(agentsMd, withSection(existed ? readFileSync(agentsMd, "utf8") : "", agentsSection(workspace, config.model, config.views)));
    io.out(`${existed ? "updated" : "created"} ${show(agentsMd)}\n`);
  }
  io.out("\nNext: add elements with `open-arch new element <id> --kind system`, then run `open-arch check`.\n");
  return 0;
}

/** The repository root above `target`, else the current folder if `target` is inside it, else `target`. */
function projectRoot(cwd: string, target: string): string {
  for (let dir = target; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) break;
  }
  const rel = relative(cwd, target);
  return rel.startsWith("..") || isAbsolute(rel) ? target : resolve(cwd);
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

function agentsSection(workspace: string, model: string, views: string): string {
  const at = (p: string) => (workspace ? `${workspace}/${p}` : p);
  const where = workspace ? `\`${workspace}/\`` : "this folder";
  return `${SECTION_START}
## Architecture

This project's architecture is an open-arch model in ${where}: one markdown file per person, system, container and component in \`${at(model)}/\`, and one file per diagram in \`${at(views)}/\`.

- Before reading or changing it, load the \`open-arch\` skill. If your tool doesn't support skills, read \`.agents/skills/open-arch/SKILL.md\`.
- After any change, run \`open-arch fmt\` and then \`open-arch check\`, and fix every error. If \`open-arch\` isn't installed, use \`npx -y open-arch@${VERSION}\` instead.
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
