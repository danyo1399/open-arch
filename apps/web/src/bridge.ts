/**
 * Types shared by the web app and the Electron preload script: the bridge the
 * preload puts on `window.openArchDesktop`.
 */

export interface OpenedFile {
  /** Absolute path, used to talk to the bridge. */
  path: string;
  /** File name, for display. */
  name: string;
}

export interface DocsSummary {
  /** The docs folder, for display. */
  dir: string;
  written: number;
  deleted: number;
  /** Files in the folder open-arch didn't generate, left alone. */
  skipped: string[];
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
  /** Write the file, then refresh its docs folder if it names one. */
  save(path: string, text: string): Promise<DocsSummary | null>;
  /** Calls `onChange` when the file changes on disk. Returns a function that stops watching. */
  watch(path: string, onChange: () => void): () => void;
  /** The AI agent, when the app has one. */
  agent?: AgentBridge;
}

/** Where the user is in the designer, for the agent's context. */
export interface AgentContext {
  /** The view open in the designer. */
  viewId?: string;
  /** IDs of the selected elements. */
  selection: string[];
}

export type AgentEvent =
  | { type: "progress"; text: string }
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
