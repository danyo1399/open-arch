/**
 * Saving a workspace from the desktop app: the file, its docs folder, and, as the web app's folder
 * saves do, the agent skill and the AGENTS.md section (AgentSetup). Kept apart from the Electron
 * main process, so it can be tested.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { emptyDocument, FILE_EXTENSION, loadWorkspace, nameFromFileName, type OpenArchDocument, type Workspace } from "@open-arch/core";
import { docsFolder, syncDocs, writeWorkspaceFile } from "open-arch/workspace";
import type { DocsSummary, OpenedFile, SaveSummary } from "../../web/src/bridge.js";
import type { AgentSetup } from "./agent-setup.js";

/** A new, empty workspace for `file`: named after it, with its docs in the file's own folder. */
export function newDocument(file: string): OpenArchDocument {
  const doc = emptyDocument(nameFromFileName(basename(file, FILE_EXTENSION)) || "Architecture");
  doc.export = { docs: "." };
  return doc;
}

export class Saver {
  constructor(private readonly setup: AgentSetup) {}

  /** Write the document and refresh its docs folder. Returns what happened to the docs, for the UI. */
  write(file: string, doc: OpenArchDocument): { ws: Workspace; docs: DocsSummary | null } {
    writeWorkspaceFile(file, doc);
    const ws = loadWorkspace(readFileSync(file, "utf8"));
    const docs = syncDocs(file, ws);
    return { ws, docs: docs ? { dir: relative(dirname(file), docs.dir) || ".", written: docs.written.length, deleted: docs.deleted.length, skipped: docs.skipped } : null };
  }

  /**
   * Save a document from the designer: write it and its docs, and set up the agent skill and the
   * AGENTS.md section. The file is saved by then, so a failure there is reported, not thrown.
   */
  save(file: string, doc: OpenArchDocument): SaveSummary {
    const { ws, docs } = this.write(file, doc);
    return { docs, ...this.setup.keep(file, docsFolder(file, ws.doc)) };
  }

  /**
   * Make a new file (New workspace, Save as): save it as the first save after it's opened, so the
   * skill and AGENTS.md are set up at once, as the web app's create does. Only once it's saved is
   * it opened with `open`, which remembers it as the last file: a save that fails leaves the file
   * remembered before as it was. What the save did comes back with the file, for the designer to say.
   */
  make(file: string, doc: OpenArchDocument, open: (file: string) => OpenedFile): OpenedFile {
    this.setup.opened(file);
    const saved = this.save(file, doc);
    return { ...open(file), saved };
  }
}
