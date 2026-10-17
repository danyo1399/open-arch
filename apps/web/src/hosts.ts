/**
 * Where a workspace's files come from and go to. The designer only talks to
 * a WorkspaceHost, so the same UI runs as a static web app (File System
 * Access API, or in memory) and inside the Electron app (Node's fs).
 */
import { CONFIG_FILE, DEFAULT_CONFIG_TEXT, parseConfig, type FileChange, type InputFile } from "@open-arch/core";
import { strToU8, zipSync } from "fflate";
import type { WorkspaceSnapshot } from "./bridge.js";

export type { WorkspaceSnapshot } from "./bridge.js";

export interface WorkspaceHost {
  /** Folder name, shown in the title bar. */
  name: string;
  /** "disk": edits are saved to the folder. "memory": edits stay in this tab until downloaded. */
  storage: "disk" | "memory";
  load(): Promise<WorkspaceSnapshot>;
  write(changes: FileChange[]): Promise<void>;
  /** Calls `onChange` when files change outside the app. Returns a function that stops watching. */
  watch?(onChange: () => void): () => void;
  close?(): void;
}

// --- In memory: the bundled example, and folders opened read-only ------------

export class MemoryHost implements WorkspaceHost {
  readonly storage = "memory";
  private files: Map<string, string>;

  constructor(
    readonly name: string,
    private configText: string,
    files: InputFile[],
  ) {
    this.files = new Map(files.map((f) => [f.path, f.text]));
  }

  async load(): Promise<WorkspaceSnapshot> {
    return { configText: this.configText, files: [...this.files].map(([path, text]) => ({ path, text })) };
  }

  async write(changes: FileChange[]): Promise<void> {
    for (const c of changes) {
      if (c.from && c.from !== c.path) this.files.delete(c.from);
      if (c.content === null) this.files.delete(c.path);
      else this.files.set(c.path, c.content);
    }
  }

  /** The whole workspace as a zip file. */
  zip(): Uint8Array {
    const entries: Record<string, Uint8Array> = { [`${this.name}/${CONFIG_FILE}`]: strToU8(this.configText) };
    for (const [path, text] of this.files) entries[`${this.name}/${path}`] = strToU8(text);
    return zipSync(entries);
  }
}

export function downloadZip(host: MemoryHost): void {
  const bytes = host.zip();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${host.name}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The example workspace bundled into the app at build time. */
export function exampleHost(): MemoryHost {
  const raw = import.meta.glob("../../../examples/shop/**/*.{md,yaml}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const prefix = "../../../examples/shop/";
  let configText = DEFAULT_CONFIG_TEXT;
  const files: InputFile[] = [];
  for (const [key, text] of Object.entries(raw)) {
    const path = key.slice(prefix.length);
    if (path === CONFIG_FILE) configText = text;
    else files.push({ path, text });
  }
  return new MemoryHost("shop", configText, files);
}

/**
 * A folder picked with `<input type="file" webkitdirectory>`, for browsers
 * without the File System Access API. Edits stay in memory.
 */
export async function hostFromFileList(list: FileList | File[]): Promise<MemoryHost | { error: string }> {
  const all = [...list].map((file) => ({ file, path: (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name }));
  const configs = all.filter((f) => f.path.split("/").pop() === CONFIG_FILE).sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  const config = configs[0];
  if (!config) return { error: `That folder has no ${CONFIG_FILE}. Pick the folder of an open-arch workspace.` };
  const base = config.path.slice(0, config.path.length - CONFIG_FILE.length);
  const configText = await config.file.text();
  const { config: parsed } = parseConfig(configText);
  const files: InputFile[] = [];
  for (const { file, path } of all) {
    if (!path.startsWith(base) || !path.endsWith(".md")) continue;
    const rel = path.slice(base.length);
    if (rel.startsWith(parsed.model + "/") || rel.startsWith(parsed.views + "/")) files.push({ path: rel, text: await file.text() });
  }
  const name = base.replace(/\/$/, "").split("/").pop() || "workspace";
  return new MemoryHost(name, configText, files);
}

// --- On disk, through the File System Access API (Chrome, Edge) ---------------

/** The parts of FileSystemDirectoryHandle and FileSystemFileHandle used here, so tests can fake them. */
export interface DirHandle {
  readonly kind: "directory";
  readonly name: string;
  entries(): AsyncIterable<[string, DirHandle | FileHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string>; lastModified: number; size: number }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export function canOpenFolders(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Ask the user for a folder. Returns null if they cancel. */
export async function pickFolder(): Promise<DirHandle | null> {
  try {
    const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker;
    return await picker({ id: "open-arch", mode: "readwrite" });
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    throw error;
  }
}

const SEARCH_DEPTH = 3;

/** The folder holding open-arch.yaml: the picked folder, or the only one up to three levels below it. */
export async function findWorkspace(root: DirHandle): Promise<{ dir: DirHandle; found: number } | null> {
  const found: DirHandle[] = [];
  const walk = async (dir: DirHandle, depth: number) => {
    const subdirs: DirHandle[] = [];
    let hasConfig = false;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && name === CONFIG_FILE) hasConfig = true;
      if (handle.kind === "directory" && !name.startsWith(".") && name !== "node_modules") subdirs.push(handle);
    }
    if (hasConfig) {
      found.push(dir);
      return;
    }
    if (depth < SEARCH_DEPTH) for (const sub of subdirs) await walk(sub, depth + 1);
  };
  await walk(root, 1);
  return found[0] ? { dir: found[0], found: found.length } : null;
}

/** Make `dir` a new, empty workspace. */
export async function createWorkspace(dir: DirHandle): Promise<void> {
  await writeText(dir, [CONFIG_FILE], DEFAULT_CONFIG_TEXT);
  await dir.getDirectoryHandle("model", { create: true });
  await dir.getDirectoryHandle("views", { create: true });
}

export class FolderHost implements WorkspaceHost {
  readonly storage = "disk";
  readonly name: string;
  private folders: string[] = ["model", "views"];
  private signature = "";

  constructor(private readonly dir: DirHandle) {
    this.name = dir.name;
  }

  async load(): Promise<WorkspaceSnapshot> {
    const configText = await (await (await this.dir.getFileHandle(CONFIG_FILE)).getFile()).text();
    const { config } = parseConfig(configText);
    this.folders = [config.model, config.views];
    const files: InputFile[] = [];
    for (const folder of this.folders) {
      const handle = await getDir(this.dir, folder.split("/"));
      if (handle) await readTree(handle, folder, files);
    }
    this.signature = await this.computeSignature();
    return { configText, files };
  }

  async write(changes: FileChange[]): Promise<void> {
    for (const c of changes) if (c.content !== null) await writeText(this.dir, c.path.split("/"), c.content);
    for (const c of changes) {
      const gone = c.content === null ? c.path : c.from && c.from !== c.path ? c.from : undefined;
      if (gone) await removeFile(this.dir, gone.split("/"));
    }
    this.signature = await this.computeSignature();
  }

  watch(onChange: () => void): () => void {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const next = await this.computeSignature();
        if (next !== this.signature) {
          this.signature = next;
          onChange();
        }
      } catch {
        // The folder may be mid-change; try again next tick.
      } finally {
        busy = false;
      }
    }, 2000);
    return () => clearInterval(timer);
  }

  /** Path, size and modified time of every file that matters, to notice outside edits cheaply. */
  private async computeSignature(): Promise<string> {
    const parts: string[] = [];
    const config = await (await this.dir.getFileHandle(CONFIG_FILE)).getFile();
    parts.push(`${CONFIG_FILE}:${config.size}:${config.lastModified}`);
    for (const folder of this.folders) {
      const handle = await getDir(this.dir, folder.split("/"));
      if (handle) await statTree(handle, folder, parts);
    }
    return parts.sort().join("\n");
  }
}

async function readTree(dir: DirHandle, path: string, out: InputFile[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    if (handle.kind === "directory") await readTree(handle, `${path}/${name}`, out);
    else if (name.endsWith(".md")) out.push({ path: `${path}/${name}`, text: await (await handle.getFile()).text() });
  }
}

async function statTree(dir: DirHandle, path: string, out: string[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith(".")) continue;
    if (handle.kind === "directory") await statTree(handle, `${path}/${name}`, out);
    else if (name.endsWith(".md")) {
      const file = await handle.getFile();
      out.push(`${path}/${name}:${file.size}:${file.lastModified}`);
    }
  }
}

async function getDir(root: DirHandle, segments: string[], create = false): Promise<DirHandle | null> {
  let dir = root;
  for (const segment of segments) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

async function writeText(root: DirHandle, segments: string[], text: string): Promise<void> {
  const dir = await getDir(root, segments.slice(0, -1), true);
  if (!dir) throw new Error(`Can't create the folder for ${segments.join("/")}.`);
  const writable = await (await dir.getFileHandle(segments[segments.length - 1]!, { create: true })).createWritable();
  await writable.write(text);
  await writable.close();
}

/** Remove a file, then any folders it leaves empty (never the workspace folder itself). */
async function removeFile(root: DirHandle, segments: string[]): Promise<void> {
  const chain: DirHandle[] = [root];
  for (const segment of segments.slice(0, -1)) {
    const next = await getDir(chain[chain.length - 1]!, [segment]);
    if (!next) return;
    chain.push(next);
  }
  try {
    await chain[chain.length - 1]!.removeEntry(segments[segments.length - 1]!);
  } catch {
    return;
  }
  for (let i = chain.length - 1; i > 0; i--) {
    let empty = true;
    for await (const _ of chain[i]!.entries()) {
      empty = false;
      break;
    }
    if (!empty) return;
    await chain[i - 1]!.removeEntry(segments[i - 1]!);
  }
}
