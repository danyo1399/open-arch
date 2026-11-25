/**
 * What the desktop app's saves set up for AI agents beside a workspace, as the web app's folder
 * saves do: the agent skill and the open-arch section in AGENTS.md, at the top of the Git
 * repository the file is in. Outside a repository, and in the home folder even when it is one,
 * nothing is written: the user only picked a file, and the home folder's .claude/ and .agents/
 * hold their own skills for every project.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LineBreakInPath } from "@open-arch/core";
import { keepAgentsSection, keepSkill, repositoryRoot, SKILL_TARGETS } from "open-arch/workspace";
import { problemText } from "../../web/src/problems.js";

export interface AgentSetupResult {
  /** Why the skill wasn't brought up to date, when it wasn't. */
  skillError?: string;
  /** Why the AGENTS.md section wasn't, when it wasn't. */
  agentsError?: string;
}

/** Whether two paths name the same folder: resolved, and without regard to case where the file system ignores it, as on Windows and macOS. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return platform === "win32" || platform === "darwin" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export class AgentSetup {
  /** Files whose skill a save brought up to date since they were opened. */
  private readonly skillKept = new Set<string>();
  /** The docs folder each file's AGENTS.md section was last written with since it was opened. */
  private readonly agentsKept = new Map<string, string>();

  /** `skill` gives the bundled skill's folder; `home` is the user's home folder. */
  constructor(
    private readonly skill: () => string,
    private readonly home = homedir(),
  ) {}

  /** The file was opened: its next save brings the skill and the section up to date again. */
  opened(file: string): void {
    this.skillKept.delete(file);
    this.agentsKept.delete(file);
  }

  /** Where the agent files go for this file: the top of its Git repository, or nowhere. */
  root(file: string): string | undefined {
    const root = repositoryRoot(dirname(file));
    return root === undefined || samePath(root, this.home) ? undefined : root;
  }

  /**
   * After a save of `file`, whose docs folder is `docs`: the first save since it was opened brings
   * the skill up to date, and a save writes the section again when the docs folder changes. A
   * failure is reported, and the next save tries again.
   */
  keep(file: string, docs: string | undefined): AgentSetupResult {
    const root = this.root(file);
    if (root === undefined) return {};
    const result: AgentSetupResult = {};
    if (!this.skillKept.has(file)) {
      try {
        const source = this.skill();
        for (const target of SKILL_TARGETS) keepSkill(source, join(root, ...target.split("/")));
        this.skillKept.add(file);
      } catch (error) {
        result.skillError = problemText(error);
      }
    }
    const key = docs ?? "";
    if (this.agentsKept.get(file) !== key) {
      try {
        keepAgentsSection(root, file, docs);
        this.agentsKept.set(file, key);
      } catch (error) {
        result.agentsError = problemText(error);
        if (error instanceof LineBreakInPath) result.agentsError += error.of === "docs" ? " Choose another docs folder in the workspace's details." : " Rename the file, or the folder in its path with the break, then open it again.";
      }
    }
    return result;
  }
}
