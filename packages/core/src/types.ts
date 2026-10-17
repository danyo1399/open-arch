export const ELEMENT_KINDS = ["person", "system", "container", "component"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const VIEW_LEVELS = ["landscape", "context", "container", "component"] as const;
export type ViewLevel = (typeof VIEW_LEVELS)[number];

/** Element and view IDs: lowercase kebab-case, taken from the file name. */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Relationship {
  to: string;
  description?: string;
  technology?: string;
  tags: string[];
  /** Position in the file's `uses` list (entries that fail to parse are skipped, so it can differ from the array index). */
  index: number;
  /** 1-based line of the `to` value in the element file. */
  line?: number;
}

export interface ArchElement {
  id: string;
  /** Workspace-relative path, always with `/` separators. */
  path: string;
  kind: ElementKind;
  name: string;
  parent?: string;
  description?: string;
  technology?: string;
  external: boolean;
  tags: string[];
  uses: Relationship[];
  /** 1-based line of each frontmatter field, for diagnostics. */
  lines: Record<string, number | undefined>;
}

export interface ViewDef {
  id: string;
  path: string;
  title: string;
  description?: string;
  level: ViewLevel;
  scope?: string;
  include: string[];
  exclude: string[];
  lines: Record<string, number | undefined>;
  /** Line of each include/exclude entry, by list and index. */
  listLines: { include: (number | undefined)[]; exclude: (number | undefined)[] };
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** Stable rule name, e.g. `relationship-unknown-target`. */
  rule: string;
  message: string;
  /** Workspace-relative path of the file the problem is in. */
  path: string;
  line?: number;
  /** How to fix it, phrased as an instruction. */
  fix?: string;
}

export interface WorkspaceConfig {
  version: 1;
  /** Folder holding element files, relative to the workspace root. */
  model: string;
  /** Folder holding view files, relative to the workspace root. */
  views: string;
  /** Whether view files carry a generated Mermaid preview. */
  preview: "mermaid" | "none";
}

export const DEFAULT_CONFIG: WorkspaceConfig = {
  version: 1,
  model: "model",
  views: "views",
  preview: "mermaid",
};

/** A file as read from disk: workspace-relative path and its text. */
export interface InputFile {
  path: string;
  text: string;
}

/**
 * A change to write back. `content: null` deletes the file. `from` marks a
 * move: write `path`, then delete `from`.
 */
export interface FileChange {
  path: string;
  content: string | null;
  from?: string;
}
