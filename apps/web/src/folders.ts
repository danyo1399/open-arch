/**
 * Workspaces in a folder on this computer, such as a Git repository, opened from the web app in
 * Chrome or Edge with the File System Access API. The .openarch file stays in the folder and every
 * edit is saved to it, and the docs folder it names is rewritten, as the desktop app and the CLI
 * do. So the changes are there to commit. The folders opened are remembered in IndexedDB: the
 * browser can keep a folder's handle, and asks again before the page may change it.
 */
import { exportDocs, FILE_EXTENSION, GENERATED_MARKER, loadWorkspace, serializeDocument, type ExportedFile } from "@open-arch/core";
import type { DocsSummary } from "./bridge.js";
import type { WorkspaceHost } from "./hosts.js";
import { committed, done } from "./library.js";

// --- The parts of the File System Access API used here -------------------------------

export interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ lastModified: number; size: number; text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export interface FolderHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<FileHandle | FolderHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
  removeEntry(name: string): Promise<void>;
  isSameEntry?(other: FolderHandle): Promise<boolean>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

type DirectoryPicker = { showDirectoryPicker(options: object): Promise<FolderHandle> };

/** Chrome and Edge can open a folder and change the files in it; Firefox and Safari can't. */
export function canOpenFolders(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Asks the user for a folder this page may change. Null when they cancel. */
export async function pickFolder(): Promise<FolderHandle | null> {
  try {
    return await (window as unknown as DirectoryPicker).showDirectoryPicker({ id: "open-arch-folder", mode: "readwrite" });
  } catch (error) {
    if ((error as Error).name === "AbortError") return null;
    throw error;
  }
}

/**
 * Whether the page may change the folder. With `ask`, the browser asks the user if it needs to,
 * which it only does straight after a click.
 */
export async function allowed(root: FolderHandle, ask: boolean): Promise<boolean> {
  const mode = { mode: "readwrite" } as const;
  if (!root.queryPermission) return true;
  if ((await root.queryPermission(mode)) === "granted") return true;
  return ask && !!root.requestPermission && (await root.requestPermission(mode)) === "granted";
}

const SEARCH_DEPTH = 3;

/**
 * The .openarch files in the folder and the folders below it, three deep, as paths relative to it.
 * Like the CLI, it skips hidden folders, such as .git, and node_modules, and folders it can't read.
 */
export async function findWorkspaces(root: FolderHandle): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: FolderHandle, prefix: string, depth: number) => {
    for await (const entry of dir.values()) {
      if (entry.kind === "file" && entry.name.endsWith(FILE_EXTENSION)) found.push(prefix + entry.name);
      else if (entry.kind === "directory" && depth < SEARCH_DEPTH && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        await walk(entry, `${prefix}${entry.name}/`, depth + 1).catch(() => undefined);
      }
    }
  };
  await walk(root, "", 1);
  // The ones nearest the top first.
  return found.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

// --- Paths inside the folder ---------------------------------------------------------

const isMissing = (error: unknown) => (error as Error)?.name === "NotFoundError";

/** A path's folders, with `.` and `..` worked out. Null when it goes above the folder. */
function segments(path: string): string[] | null {
  const out: string[] = [];
  for (const part of path.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out;
}

async function folderAt(root: FolderHandle, parts: string[], create: boolean): Promise<FolderHandle> {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}

async function fileAt(root: FolderHandle, path: string, create = false): Promise<FileHandle> {
  const parts = path.split("/");
  const dir = await folderAt(root, parts.slice(0, -1), create);
  return dir.getFileHandle(parts[parts.length - 1]!, { create });
}

async function readText(file: FileHandle): Promise<string> {
  return (await file.getFile()).text();
}

async function writeText(file: FileHandle, text: string): Promise<void> {
  // The browser writes to a copy and swaps it in on close, so a crash never leaves half a file.
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
}

/**
 * Makes the docs folder hold exactly these generated pages, as the CLI's `writeDocs` does. Only
 * pages carrying the generated marker are ever overwritten or deleted; anything else is left alone.
 */
export async function writeDocs(dir: FolderHandle, files: ExportedFile[]): Promise<{ written: string[]; deleted: string[]; skipped: string[] }> {
  const written: string[] = [];
  const deleted: string[] = [];
  const skipped: string[] = [];
  const targets = new Map(files.map((f) => [f.path, f.content]));
  for (const [path, content] of targets) {
    if (segments(path)?.join("/") !== path) throw new Error(`Refusing to write ${JSON.stringify(path)}: it isn't a path inside the docs folder.`);
    let existing: string | null = null;
    try {
      existing = await readText(await fileAt(dir, path));
    } catch (error) {
      // A file in the way of a folder the page goes in, or a folder in the page's place, is left alone too.
      if ((error as Error).name === "TypeMismatchError") existing = "";
      else if (!isMissing(error)) throw error;
    }
    if (existing === content) continue;
    if (existing !== null && !existing.startsWith(GENERATED_MARKER)) {
      skipped.push(path);
      continue;
    }
    await writeText(await fileAt(dir, path, true), content);
    written.push(path);
  }
  /** Deletes stale generated pages below `folder`. Resolves to whether the folder is empty after. */
  const sweep = async (folder: FolderHandle, prefix: string): Promise<boolean> => {
    let left = 0;
    const entries: (FileHandle | FolderHandle)[] = [];
    for await (const entry of folder.values()) entries.push(entry);
    for (const entry of entries) {
      const path = prefix + entry.name;
      if (entry.kind === "directory") {
        if (await sweep(entry, `${path}/`)) await folder.removeEntry(entry.name);
        else left++;
      } else if (entry.name.endsWith(".md") && !targets.has(path) && (await readText(entry)).startsWith(GENERATED_MARKER)) {
        await folder.removeEntry(entry.name);
        deleted.push(path);
      } else left++;
    }
    return left === 0 && deleted.some((d) => d.startsWith(prefix));
  };
  await sweep(dir, "");
  return { written, deleted, skipped };
}

// --- The workspace host --------------------------------------------------------------

/** How often the file is checked for changes made outside the designer, such as `git pull`. */
const POLL_MS = 1500;

/** A .openarch file in a folder the user opened. Every edit is saved to it, and its docs folder is rewritten. */
export class FolderHost implements WorkspaceHost {
  readonly storage = "file";
  readonly syncsDocs = true;
  readonly name: string;
  /** The file's text as the designer last read or wrote it. Saving over anything else would lose a change made outside. */
  private known: string | null = null;

  /** `path` is the file's, relative to `root`, with `/` between folders. */
  constructor(
    readonly id: string,
    readonly root: FolderHandle,
    readonly path: string,
    private readonly pollMs = POLL_MS,
  ) {
    this.name = path.split("/").pop()!;
  }

  get key(): string {
    return `folder/${this.id}`;
  }

  /** Where the file is, for display: the folder's name, then the path in it. */
  get location(): string {
    return `${this.root.name}/${this.path}`;
  }

  async load(): Promise<string> {
    try {
      this.known = await readText(await fileAt(this.root, this.path));
      return this.known;
    } catch (error) {
      if (isMissing(error)) throw new Error(`${this.location} isn't there any more.`);
      throw error;
    }
  }

  async save(text: string): Promise<DocsSummary | null> {
    const ws = loadWorkspace(text);
    if (!ws.valid) throw new Error(`Refusing to save: the workspace has structural errors (${ws.diagnostics.map((d) => d.message).join(" ")})`);
    // Worked out before anything is written, so a docs folder it can't reach saves nothing.
    const docs = ws.doc.export?.docs;
    let docsParts: string[] | null = null;
    if (docs) {
      if (/^([\\/]|[a-zA-Z]:)/.test(docs)) throw new Error(`The docs folder must be relative to the ${FILE_EXTENSION} file, not ${JSON.stringify(docs)}.`);
      docsParts = segments(`${this.path.split("/").slice(0, -1).join("/")}/${docs}`);
      if (docsParts === null) throw new Error(`The docs folder ${docs}/ is outside the folder you opened, ${this.root.name}, so nothing was saved. Open the folder that holds it, or choose a docs folder inside ${this.root.name}.`);
    }
    // A change made outside since the designer read the file, by Git, an editor or an agent, is
    // kept: this save is refused, and the watcher reloads the file.
    if (this.known !== null) {
      let now: string;
      try {
        now = await readText(await fileAt(this.root, this.path));
      } catch (error) {
        if (isMissing(error)) throw new Error(`${this.location} isn't there any more, so the change wasn't saved.`);
        throw error;
      }
      if (now !== this.known) throw new Error(`${this.location} changed outside the designer, so this change wasn't saved, to keep that one. The file is reloaded: make the change again.`);
    }
    const saved = serializeDocument(ws.doc);
    await writeText(await fileAt(this.root, this.path, true), saved);
    this.known = saved;
    if (!docsParts || !docs) return null;
    const summary: DocsSummary = { dir: docs.replace(/\\/g, "/").replace(/\/+$/, ""), written: 0, deleted: 0, skipped: [] };
    // The file is saved by now, so a docs folder that can't be written is reported, not thrown.
    try {
      const result = await writeDocs(await folderAt(this.root, docsParts, true), exportDocs(ws, this.name));
      return { ...summary, written: result.written.length, deleted: result.deleted.length, skipped: result.skipped };
    } catch (error) {
      return { ...summary, error: (error as Error).message };
    }
  }

  /**
   * Checks the file every so often while the page is showing, and as soon as it shows again, for
   * changes made outside the designer: an editor, the CLI, an agent, or Git. The first check
   * compares the file with the text loaded, so a change made in between is noticed too. Calls
   * `onRemoved` once when it's gone.
   */
  watch(onChange: () => void, onRemoved?: () => void): () => void {
    let seen: string | null = null;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking || (typeof document !== "undefined" && document.hidden)) return;
      checking = true;
      try {
        const file = await (await fileAt(this.root, this.path)).getFile();
        const stamp = `${file.lastModified}/${file.size}`;
        const changed = seen === null ? this.known !== null && (await file.text()) !== this.known : stamp !== seen;
        seen = stamp;
        if (changed && !stopped) onChange();
      } catch (error) {
        if (isMissing(error) && !stopped) {
          stop();
          onRemoved?.();
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), this.pollMs);
    const onShow = () => void check();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
    void check();
    const stop = () => {
      stopped = true;
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
    };
    return stop;
  }
}

// --- The folders opened before ------------------------------------------------------

export interface StoredFolder {
  id: string;
  root: FolderHandle;
  /** The .openarch file's path in the folder. */
  path: string;
  /** Milliseconds since the epoch. */
  opened: number;
}

const STORE = "folders";

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** The workspaces opened from folders, so the start page can list them and a reload reopens one. */
export class FolderList {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = "open-arch-folders") {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        db.onclose = () => {
          this.db = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error: Error) => {
      this.db = null;
      throw new Error(`This browser won't let open-arch remember folders: ${error.message}`);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  /** Most recently opened first. */
  async list(): Promise<StoredFolder[]> {
    const all = await done((await this.store("readonly")).getAll() as IDBRequest<StoredFolder[]>);
    return all.sort((a, b) => b.opened - a.opened);
  }

  async get(id: string): Promise<StoredFolder | undefined> {
    return done((await this.store("readonly")).get(id) as IDBRequest<StoredFolder | undefined>);
  }

  /** Remembers a workspace in a folder, or marks it opened now if it's remembered already. */
  async add(root: FolderHandle, path: string): Promise<StoredFolder> {
    let record: StoredFolder | undefined;
    for (const known of await this.list()) {
      if (known.path === path && (await (known.root.isSameEntry?.(root) ?? Promise.resolve(false)).catch(() => false))) record = known;
    }
    record = { id: record?.id ?? newId(), root, path, opened: Date.now() };
    const store = await this.store("readwrite");
    store.put(record);
    await committed(store.transaction);
    return record;
  }

  /** Forgets it. The folder and its files stay as they are. */
  async remove(id: string): Promise<void> {
    const store = await this.store("readwrite");
    store.delete(id);
    await committed(store.transaction);
  }
}

export const folderList = new FolderList();
