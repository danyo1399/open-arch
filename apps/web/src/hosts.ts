/**
 * Where a workspace's .openarch text comes from and goes to. The designer only
 * talks to a WorkspaceHost, so the same UI runs in the browser (workspaces kept
 * in IndexedDB, and the examples in memory) and in Electron (Node's fs).
 */
import { exportDocs, FILE_EXTENSION, type Workspace } from "@open-arch/core";
import { strToU8, zipSync } from "fflate";
import exampleText from "../../../examples/shop/shop.openarch?raw";
import tourText from "../../../examples/food-delivery/food-delivery.openarch?raw";
import type { DesktopBridge, DocsSummary } from "./bridge.js";
import type { WorkspaceLibrary } from "./library.js";

export interface WorkspaceHost {
  /** File name, shown in the title bar. */
  name: string;
  /** Tells the workspace apart from others on this computer, the same each time it's opened. The designer keeps its settings for the workspace, like pinned views, by it. */
  key: string;
  /** "file": every edit is saved to the file. "browser": every edit is saved in the browser's storage. "memory": edits stay in this tab until saved. */
  storage: "file" | "browser" | "memory";
  /** Desktop only: saving also refreshes the docs folder. */
  syncsDocs?: boolean;
  load(): Promise<string>;
  /** Save the file's new text. May report the docs folder it refreshed. */
  save(text: string): Promise<DocsSummary | null | void>;
  /** Calls `onChange` when the workspace changes outside this window, and `onRemoved` when it's deleted there. Returns a function that stops watching. */
  watch?(onChange: () => void, onRemoved?: () => void): () => void;
}

// --- In memory: the examples ------------------------------------------------------

export class MemoryHost implements WorkspaceHost {
  readonly storage = "memory";
  constructor(
    public name: string,
    private text: string,
  ) {}
  get key(): string {
    return `memory/${this.name}`;
  }
  async load(): Promise<string> {
    return this.text;
  }
  async save(text: string): Promise<void> {
    this.text = text;
  }
}

export function exampleHost(): MemoryHost {
  return new MemoryHost(`shop${FILE_EXTENSION}`, exampleText);
}

/** A bigger example whose sticky notes explain C4 diagrams to people new to them. */
export function tourHost(): MemoryHost {
  return new MemoryHost(`food-delivery${FILE_EXTENSION}`, tourText);
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The generated markdown docs as a zip, with everything in one folder. */
export function docsZip(ws: Workspace, fileName: string): Uint8Array {
  const folder = `${fileName.replace(/\.openarch$/, "")}-docs`;
  const entries: Record<string, Uint8Array> = {};
  for (const f of exportDocs(ws, fileName)) entries[`${folder}/${f.path}`] = strToU8(f.content);
  return zipSync(entries);
}

// --- In the browser's storage ------------------------------------------------------

/** The key of a workspace kept in the browser, by its ID in the library. */
export const browserKey = (id: string) => `browser/${id}`;

/** A workspace kept in the browser (library.ts). Every edit is saved there. */
export class BrowserHost implements WorkspaceHost {
  readonly storage = "browser";

  constructor(
    private readonly library: WorkspaceLibrary,
    readonly id: string,
    readonly name: string,
  ) {}

  get key(): string {
    return browserKey(this.id);
  }

  async load(): Promise<string> {
    const record = await this.library.get(this.id);
    if (!record) throw new Error("It isn't stored in this browser any more.");
    return record.text;
  }

  save(text: string): Promise<void> {
    return this.library.save(this.id, text);
  }

  /** Hears about edits made to the same workspace in another tab, and about it being deleted there. */
  watch(onChange: () => void, onRemoved?: () => void): () => void {
    return this.library.onChange((change) => {
      if (change.id !== this.id) return;
      if (change.type === "saved") onChange();
      if (change.type === "removed") onRemoved?.();
    });
  }
}

// --- In the desktop app ------------------------------------------------------------

export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { openArchDesktop?: DesktopBridge }).openArchDesktop;
}

export class DesktopHost implements WorkspaceHost {
  readonly storage = "file";
  readonly syncsDocs = true;

  constructor(
    private readonly bridge: DesktopBridge,
    readonly path: string,
    readonly name: string,
  ) {}

  get key(): string {
    return `file/${this.path}`;
  }

  load(): Promise<string> {
    return this.bridge.load(this.path);
  }

  save(text: string): Promise<DocsSummary | null> {
    return this.bridge.save(this.path, text);
  }

  watch(onChange: () => void): () => void {
    return this.bridge.watch(this.path, onChange);
  }
}
