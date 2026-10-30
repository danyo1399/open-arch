/**
 * Where a workspace's .openarch file comes from and goes to. The designer only
 * talks to a WorkspaceHost, so the same UI runs in the browser (File System
 * Access API, or in memory with downloads) and in Electron (Node's fs).
 */
import { exportDocs, FILE_EXTENSION, type Workspace } from "@open-arch/core";
import { strToU8, zipSync } from "fflate";
import exampleText from "../../../examples/shop/shop.openarch?raw";
import tourText from "../../../examples/food-delivery/food-delivery.openarch?raw";
import type { DesktopBridge, DocsSummary } from "./bridge.js";

export interface WorkspaceHost {
  /** File name, shown in the title bar. */
  name: string;
  /** "file": every edit is saved to the file. "memory": edits stay in this tab until saved or downloaded. */
  storage: "file" | "memory";
  /** Desktop only: saving also refreshes the docs folder. */
  syncsDocs?: boolean;
  load(): Promise<string>;
  /** Save the file's new text. May report the docs folder it refreshed. */
  save(text: string): Promise<DocsSummary | null | void>;
  /** Calls `onChange` when the file changes outside the app. Returns a function that stops watching. */
  watch?(onChange: () => void): () => void;
}

const FILE_TYPES = [{ description: "open-arch workspace", accept: { "application/json": [FILE_EXTENSION] } }];

// --- In memory: the example, new workspaces, and files opened without write access ---

export class MemoryHost implements WorkspaceHost {
  readonly storage = "memory";
  constructor(
    public name: string,
    private text: string,
  ) {}
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

/** A file picked with <input type="file">: readable, but saving means downloading. */
export async function hostFromFile(file: File): Promise<MemoryHost> {
  return new MemoryHost(file.name, await file.text());
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

// --- On disk, through the File System Access API (Chrome, Edge) ---------------------

/** The parts of FileSystemFileHandle used here, so tests can fake it. */
export interface FileHandle {
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string>; lastModified: number; size: number }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface Pickers {
  showOpenFilePicker(options: object): Promise<FileHandle[]>;
  showSaveFilePicker(options: object): Promise<FileHandle>;
}

export function canSaveFiles(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window;
}

async function picked<T>(pick: () => Promise<T>): Promise<T | null> {
  try {
    return await pick();
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    throw error;
  }
}

export function pickFileToOpen(): Promise<FileHandle | null> {
  const w = window as unknown as Pickers;
  return picked(async () => (await w.showOpenFilePicker({ id: "open-arch", types: FILE_TYPES, multiple: false }))[0]!);
}

export function pickFileToSave(suggestedName: string): Promise<FileHandle | null> {
  const w = window as unknown as Pickers;
  return picked(() => w.showSaveFilePicker({ id: "open-arch", suggestedName, types: FILE_TYPES }));
}

export class FileHandleHost implements WorkspaceHost {
  readonly storage = "file";
  readonly name: string;
  private lastSeen = "";

  constructor(private readonly handle: FileHandle) {
    this.name = handle.name;
  }

  async load(): Promise<string> {
    const file = await this.handle.getFile();
    this.lastSeen = `${file.size}:${file.lastModified}`;
    return file.text();
  }

  async save(text: string): Promise<void> {
    const writable = await this.handle.createWritable();
    await writable.write(text);
    await writable.close();
    const file = await this.handle.getFile();
    this.lastSeen = `${file.size}:${file.lastModified}`;
  }

  watch(onChange: () => void): () => void {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const file = await this.handle.getFile();
        const seen = `${file.size}:${file.lastModified}`;
        if (seen !== this.lastSeen) {
          this.lastSeen = seen;
          onChange();
        }
      } catch {
        // The file may be mid-write; try again next tick.
      } finally {
        busy = false;
      }
    }, 2000);
    return () => clearInterval(timer);
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
