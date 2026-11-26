/**
 * Types shared by the web app and the Electron preload script: the bridge the
 * preload puts on `window.openArchDesktop`.
 */

export interface OpenedFile {
  /** Absolute path, used to talk to the bridge. */
  path: string;
  /** File name, for display. */
  name: string;
  /** For a file the app made (New workspace, Save as), what the save that made it did beside writing it. */
  saved?: SaveSummary;
}

export interface DocsSummary {
  /** The docs folder, for display. */
  dir: string;
  written: number;
  deleted: number;
  /** Files in the folder open-arch didn't generate, left alone. */
  skipped: string[];
  /** Why the docs couldn't be written, when the file was saved but they weren't. */
  error?: string;
}

/** What a save did beside writing the file. */
export interface SaveSummary {
  /** What it did to the docs folder: null when the workspace names none. */
  docs: DocsSummary | null;
  /** Why the agent skill wasn't kept up to date, when the file was saved but it wasn't. */
  skillError?: string;
  /** Why the section in AGENTS.md wasn't kept up to date, when the file was saved but it wasn't. */
  agentsError?: string;
}

export interface DesktopBridge {
  /** Native open dialog for a .openarch file. Null when cancelled. */
  openFile(): Promise<OpenedFile | null>;
  /** Native save dialog; creates an empty workspace there. Null when cancelled. */
  newFile(): Promise<OpenedFile | null>;
  /** Native save dialog; writes `text` there. Null when cancelled. */
  saveAs(text: string): Promise<OpenedFile | null>;
  /** The file opened last time, if it still exists. */
  lastFile(): Promise<OpenedFile | null>;
  load(path: string): Promise<string>;
  /** Write the file, then refresh its docs folder if it names one, and the agent skill and AGENTS.md section beside it. */
  save(path: string, text: string): Promise<SaveSummary>;
  /** Refresh the file's docs folder from `text`, without writing the file. Null when it names none. */
  writeDocs(path: string, text: string): Promise<DocsSummary | null>;
  /** Calls `onChange` when the file changes on disk. Returns a function that stops watching. */
  watch(path: string, onChange: () => void): () => void;
  /** The AI agent, when the app has one. */
  agent?: AgentBridge;
}

/** Where the user is in the designer, for the agent's context. */
export interface AgentContext {
  /** The view open in the designer, and its level. */
  viewId?: string;
  viewLevel?: string;
  /** Everything selected, each as the agent is told it, with its IDs in backticks: "`shop`", "the sticky note `n1`", "step 3". */
  selection: string[];
}

export type AgentEvent =
  | { type: "progress"; text: string }
  /** A piece of the agent's message as it's written, which goes on the end of the pieces before it (the web app's Ask AI). */
  | { type: "delta"; text: string }
  /** The agent changed the workspace: its file's text just before the change, and after it (the web app's Ask AI). */
  | { type: "changed"; before: string; after: string }
  /** The agent wants to do something that needs the user's approval. */
  | { type: "permission"; id: string; description: string }
  /** A permission request was answered, here or elsewhere. */
  | { type: "permission-replied"; id: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

/** Asks an AI agent to change a file. The agent edits it on disk, so the designer sees its changes through `watch`. */
export interface AgentBridge {
  /** Run one request against an opened file. Calls `onEvent` with progress, then once with "done" or "error", and resolves after that. */
  run(path: string, prompt: string, context: AgentContext, onEvent: (event: AgentEvent) => void): Promise<void>;
  /** Approve or deny a permission request from the running request. */
  reply(permissionId: string, allow: boolean): Promise<void>;
  /** Stop the running request. */
  cancel(): Promise<void>;
}
