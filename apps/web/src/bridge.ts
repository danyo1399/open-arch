/**
 * Types shared by the web app and the Electron preload script: the bridge the
 * preload puts on `window.openArchDesktop`, and what it returns.
 */
import type { FileChange, InputFile } from "@open-arch/core";

export interface WorkspaceSnapshot {
  configText: string;
  files: InputFile[];
}

export type FindResult = { root: string; name: string } | { error: string; canCreate: boolean };

export interface DesktopBridge {
  /** Native folder picker. Null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** The workspace opened last time, if it still exists. */
  lastWorkspace(): Promise<string | null>;
  /** The workspace in or under `folder`, like the CLI finds it. */
  findWorkspace(folder: string): Promise<FindResult>;
  createWorkspace(folder: string): Promise<void>;
  load(root: string): Promise<WorkspaceSnapshot>;
  write(root: string, changes: FileChange[]): Promise<void>;
  /** Calls `onChange` when files in the workspace change. Returns a function that stops watching. */
  watch(root: string, onChange: () => void): () => void;
}
