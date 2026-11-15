/**
 * Workspaces in a folder on this computer, such as a Git repository, opened from the web app in
 * Chrome or Edge with the File System Access API. The .openarch file stays in the folder and every
 * edit is saved to it, and the docs folder it names is rewritten, as the desktop app and the CLI
 * do. The first save after the folder is opened also brings the agent skill in it up to date, as
 * `open-arch init` installs it, writing only the files that changed, and puts the open-arch
 * section in its AGENTS.md, which a later save writes again when what it names changes. So the
 * changes are there to commit. The folders opened are remembered in IndexedDB: the browser can
 * keep a folder's handle, and asks again before the page may change it.
 */
import { agentsSection, agentsSectionWorkspace, applyOperations, DOCS_PAGE_FOLDERS, exportDocs, FILE_EXTENSION, generatedFrom, lineEnding, LineBreakInPath, loadWorkspace, serializeDocument, withAgentsSection, type ExportedFile, type Workspace } from "@open-arch/core";
import type { DocsSummary, SaveSummary } from "./bridge.js";
import { isAbsolutePath, segments } from "./paths.js";
import { isNamed, problemText } from "./problems.js";
import { CLI_VERSION, SKILL_TARGETS, skillFiles } from "./skill.js";
import type { WorkspaceHost } from "./hosts.js";
import { committed, done } from "./library.js";

// --- The parts of the File System Access API used here -------------------------------

export interface FileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<{ lastModified: number; size: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<Writable>;
}

export interface Writable {
  write(data: string): Promise<void>;
  /** Swaps the new content in. */
  close(): Promise<void>;
  /** Drops what was written, and leaves the file as it was. */
  abort?(): Promise<void>;
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
    if (isNamed(error, "AbortError")) return null;
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
 * The .openarch files in the folder and two levels of folders below it, as paths relative to it,
 * as the CLI finds them.
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

const isMissing = (error: unknown) => isNamed(error, "NotFoundError");

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

export interface DocsChanges {
  written: string[];
  deleted: string[];
  skipped: string[];
}

/**
 * Makes the docs folder hold exactly these generated pages, as the CLI's `writeDocs` does. Only
 * pages open-arch generated from the same file, from one no longer beside it (say before a rename),
 * or from no file named are overwritten or deleted: a page from another workspace still beside
 * this one, which `isWorkspace` tells, is left alone. Stale pages are only
 * looked for at the folder's top and in DOCS_PAGE_FOLDERS; anything else is left alone. It records
 * each change in `changes` as it makes it, so if it fails partway, they say how far it got.
 */
export async function writeDocs(
  dir: FolderHandle,
  files: ExportedFile[],
  changes: DocsChanges = { written: [], deleted: [], skipped: [] },
  isWorkspace?: (name: string) => Promise<boolean>,
): Promise<DocsChanges> {
  const { written, deleted, skipped } = changes;
  const targets = new Map(files.map((f) => [f.path, f.content]));
  // As the CLI does: a page generated from another workspace still beside this one, which
  // `isWorkspace` tells, is that one's, so two workspaces can share a docs folder. One from a file
  // that isn't there any more, say this one before it was renamed, or from no file named, is this one's.
  const source = files[0] ? generatedFrom(files[0].content) : null;
  const ours = async (text: string) => {
    const from = generatedFrom(text);
    if (from === null) return false;
    if (!from || source === null || from === source || !isWorkspace) return true;
    return !(await isWorkspace(from));
  };
  for (const [path, content] of targets) {
    if (segments(path)?.join("/") !== path) throw new Error(`Refusing to write ${JSON.stringify(path)}: it isn't a path inside the docs folder.`);
    let existing: string | null = null;
    try {
      existing = await readText(await fileAt(dir, path));
    } catch (error) {
      // A file in the way of a folder the page goes in, or a folder in the page's place, is left alone too.
      if (isNamed(error, "TypeMismatchError")) existing = "";
      else if (!isMissing(error)) throw error;
    }
    if (existing === content) continue;
    if (existing !== null && !(await ours(existing))) {
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
        // At the docs folder's top, only the folders open-arch writes pages into: it may be the
        // file's own folder, or the top of the folder opened, with other things in it.
        if (prefix === "" && !DOCS_PAGE_FOLDERS.includes(entry.name)) left++;
        else if (await sweep(entry, `${path}/`)) await folder.removeEntry(entry.name);
        else left++;
      } else if (entry.name.endsWith(".md") && !targets.has(path) && (await ours(await readText(entry)))) {
        await folder.removeEntry(entry.name);
        deleted.push(path);
      } else left++;
    }
    return left === 0 && deleted.some((d) => d.startsWith(prefix));
  };
  await sweep(dir, "");
  return changes;
}

/**
 * Writes the agent skill's files into the folder, only those that differ. Anything else in it,
 * such as a file someone put there, is left alone. Resolves to the paths it wrote.
 */
export async function writeSkill(dir: FolderHandle): Promise<string[]> {
  const written: string[] = [];
  for (const { path, content } of skillFiles) {
    let existing: string | null = null;
    try {
      existing = await readText(await fileAt(dir, path));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (existing === content) continue;
    await writeText(await fileAt(dir, path, true), content);
    written.push(path);
  }
  return written;
}

/** Whether a file is at this path in the folder. A path that can't be in it isn't. */
async function isFileIn(root: FolderHandle, path: string): Promise<boolean> {
  const parts = isAbsolutePath(path) ? null : segments(path);
  if (!parts?.length) return false;
  try {
    await fileAt(root, parts.join("/"));
    return true;
  } catch (error) {
    if (isMissing(error) || isNamed(error, "TypeMismatchError")) return false;
    throw error;
  }
}

/**
 * Puts the section for the workspace at `path`, with its docs in `docs`, in AGENTS.md at the top of the folder, or makes
 * AGENTS.md with it. The rest of the file is kept as it is. A section that names another workspace
 * still in the folder is left as it is: it's for one model, the one it was first written for, so
 * opening each of several workspaces doesn't rewrite it to name each in turn. One that names a
 * file no longer there, say after `git mv`, is written for this workspace.
 */
export async function writeAgentsSection(root: FolderHandle, path: string, docs: string | undefined): Promise<void> {
  let text = "";
  try {
    // From its bytes: the browser's text() drops a byte-order mark, and writing that back would
    // change the rest of the file. Bytes that aren't UTF-8 would be changed too, so it refuses those.
    const bytes = await (await (await fileAt(root, "AGENTS.md")).getFile()).arrayBuffer();
    try {
      text = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }).decode(bytes);
    } catch {
      throw new Error("AGENTS.md isn't UTF-8 text, so it was left alone.");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const named = agentsSectionWorkspace(text);
  // Compared as folders, so ./a.openarch or arch\a.openarch, written by hand, is this workspace too.
  if (named !== null && segments(named)?.join("/") !== path && (await isFileIn(root, named))) return;
  // With the file's own line ending, so the file keeps it, and names in it are written as they are.
  const next = withAgentsSection(text, agentsSection(path, docs, CLI_VERSION, lineEnding(text)));
  if (next !== text) await writeText(await fileAt(root, "AGENTS.md", true), next);
}

/** What exporting a workspace to a folder did beside writing the file. */
export interface FolderExport extends SaveSummary {
  /** The workspace AGENTS.md's section names, when it's another one in the folder, so it was left as it is. */
  agentsNamesOther?: string;
}

/**
 * Exports a copy of a workspace to a folder the user chose, such as a Git repository, as the
 * workspace it becomes there: the .openarch file at the folder's top, saved as a folder's first
 * save (FolderHost), so its docs, the skill and the AGENTS.md section are written as later saves
 * there keep them. So it can be opened from the start page and worked on there. A workspace that
 * names no docs folder has its copy keep them beside the file (`.`). One whose docs folder a save
 * there couldn't write, outside the folder or absolute, isn't exported; nor is one whose name the
 * folder has already.
 */
export async function exportToFolder(root: FolderHandle, ws: Workspace, fileName: string): Promise<FolderExport> {
  let taken = true;
  try {
    await root.getFileHandle(fileName);
  } catch (error) {
    if (isMissing(error)) taken = false;
    else if (!isNamed(error, "TypeMismatchError")) throw error;
  }
  if (taken) throw new Error(`${root.name} has a file or folder named ${fileName} already, so nothing was exported. Choose another folder, or open that one with Open folder.`);
  // An empty docs folder, written by hand, is none, as a save takes it.
  const named = ws.doc.export?.docs || undefined;
  if (named !== undefined && (isAbsolutePath(named) || segments(named) === null)) {
    throw new Error(`${fileName} keeps its docs in ${named}/, outside the folder it would be exported to, so nothing was exported. Choose a docs folder inside it in the workspace's details, or none.`);
  }
  const doc = named === undefined ? applyOperations(ws.doc, [{ op: "update-workspace", docs: "." }]).doc : ws.doc;
  const result: FolderExport = await new FolderHost("export", root, fileName).create(serializeDocument(doc));
  try {
    const other = agentsSectionWorkspace(await readText(await fileAt(root, "AGENTS.md")));
    if (other !== null && segments(other)?.join("/") !== fileName) result.agentsNamesOther = other;
  } catch {
    // No AGENTS.md: its problem, if any, is in agentsError.
  }
  return result;
}

// --- The workspace host --------------------------------------------------------------

/** How often the file is checked for changes made outside the designer, such as `git pull`. */
const POLL_MS = 1500;

/** A .openarch file in a folder the user opened. Every edit is saved to it, and its docs folder is rewritten. */
export class FolderHost implements WorkspaceHost {
  readonly storage = "file";
  readonly syncsDocs = true;
  readonly syncsSkill = true;
  readonly name: string;
  /** The file's text as the designer last read or wrote it. Saving over anything else would lose a change made outside. */
  private known: string | null = null;
  /** The last load, for the watcher to start from what it read. */
  private loading: Promise<string> | null = null;
  /** The watcher's `onChange`, to reload the file when a save finds it changed. */
  private reload: (() => void) | null = null;
  /** Whether a save brought the agent skill up to date since the folder was opened. Until one does, each save tries. */
  private skillKept = false;
  /** The section this host last wrote to AGENTS.md, or null before it has. */
  private agentsKept: string | null = null;

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

  load(): Promise<string> {
    this.loading = (async () => {
      try {
        this.known = await readText(await fileAt(this.root, this.path));
        return this.known;
      } catch (error) {
        if (isMissing(error)) throw new Error(`${this.location} isn't there any more.`);
        throw error;
      }
    })();
    return this.loading;
  }

  /**
   * Saves a new workspace, and its docs. Refuses if the file is there already. A file that appears
   * in the moment between that check and the write is still overwritten: the browser can't lock it.
   */
  async create(text: string): Promise<SaveSummary> {
    const there = await fileAt(this.root, this.path).then(
      () => true,
      (error) => {
        if (isMissing(error)) return false;
        throw error;
      },
    );
    if (there) throw new Error(`${this.location} is there already, so it wasn't created. Open the folder again to open it.`);
    return this.save(text);
  }

  /**
   * Saves the file, then rewrites its docs folder and, on the first save since the folder was
   * opened, brings the agent skill up to date in it, as `open-arch init` installs it, so agents
   * working in the folder know how to read and change the model. It also puts the open-arch
   * section in the folder's AGENTS.md, when what the section names changes. The file is saved by
   * then, so the docs, the skill or AGENTS.md failing is reported, not thrown.
   */
  async save(text: string): Promise<SaveSummary> {
    const ws = loadWorkspace(text);
    if (!ws.valid) throw new Error(`Refusing to save: the workspace has structural errors (${ws.diagnostics.map((d) => d.message).join(" ")})`);
    // Worked out before anything is written, so a docs folder it can't reach saves nothing.
    const docs = ws.doc.export?.docs;
    let docsParts: string[] | null = null;
    if (docs) {
      if (isAbsolutePath(docs)) throw new Error(`The docs folder must be relative to the ${FILE_EXTENSION} file, not ${JSON.stringify(docs)}.`);
      docsParts = segments(`${this.path.split("/").slice(0, -1).join("/")}/${docs}`);
      if (docsParts === null) throw new Error(`The docs folder ${docs}/ is outside the folder you opened, ${this.root.name}, so nothing was saved. Open the folder that holds it, or choose a docs folder inside ${this.root.name}.`);
    }
    // A change made outside since the designer read the file, by Git, an editor or an agent, is
    // kept: this save is refused, and the file reloads. The new text is written to the browser's
    // copy of the file first, and only swapped in after the check, which keeps the time an outside
    // change could slip in as short as the browser allows: it has no way to lock a file.
    const saved = serializeDocument(ws.doc);
    const gone = () => new Error(`${this.location} isn't there any more, so the change wasn't saved.`);
    let writable: Writable;
    try {
      // A file loaded and since deleted isn't made again; a new one is.
      writable = await (await fileAt(this.root, this.path, this.known === null)).createWritable();
    } catch (error) {
      throw isMissing(error) ? gone() : error;
    }
    try {
      await writable.write(saved);
      if (this.known !== null) {
        const now = await readText(await fileAt(this.root, this.path));
        if (now !== this.known) {
          this.reload?.();
          throw new Error(`${this.location} changed outside the designer, so this change wasn't saved, to keep that one. The file is reloaded: make the change again.`);
        }
      }
    } catch (error) {
      await writable.abort?.().catch(() => undefined);
      throw isMissing(error) ? gone() : error;
    }
    await writable.close();
    this.known = saved;
    const result: SaveSummary = { docs: docsParts && docs ? await this.saveDocs(ws, docs, docsParts) : null };
    // The section in AGENTS.md names the file and its docs, so it's written again whenever that changes.
    const docsPath = docsParts && docs ? docsParts.join("/") : undefined;
    try {
      const section = agentsSection(this.path, docsPath, CLI_VERSION);
      if (section !== this.agentsKept) {
        await writeAgentsSection(this.root, this.path, docsPath);
        this.agentsKept = section;
      }
    } catch (error) {
      result.agentsError = problemText(error);
      // Say how to put it right, too.
      if (error instanceof LineBreakInPath) result.agentsError += error.of === "docs" ? " Choose another docs folder in the workspace's details." : " Rename the file, or the folder in its path with the break, then open the folder again.";
    }
    // Once each time the folder is opened, not on every save: saves come as the user types.
    if (!this.skillKept) {
      try {
        for (const target of SKILL_TARGETS) await writeSkill(await folderAt(this.root, target.split("/"), true));
        this.skillKept = true;
      } catch (error) {
        result.skillError = problemText(error);
      }
    }
    return result;
  }

  /** Rewrites the docs folder. A docs folder that can't be written is reported, with what was changed before it stopped. */
  private async saveDocs(ws: Workspace, docs: string, parts: string[]): Promise<DocsSummary> {
    const summary: DocsSummary = { dir: docs.replace(/\\/g, "/").replace(/\/+$/, ""), written: 0, deleted: 0, skipped: [] };
    const changes: DocsChanges = { written: [], deleted: [], skipped: [] };
    const counts = () => ({ ...summary, written: changes.written.length, deleted: changes.deleted.length, skipped: changes.skipped });
    try {
      const fileDir = this.path.split("/").slice(0, -1);
      await writeDocs(await folderAt(this.root, parts, true), exportDocs(ws, this.name), changes, (name) => isFileIn(this.root, [...fileDir, name].join("/")));
      return counts();
    } catch (error) {
      return { ...counts(), error: problemText(error) };
    }
  }

  /**
   * Checks the file every so often while the page is showing, and as soon as it shows again, for
   * changes made outside the designer: an editor, the CLI, an agent, or Git. The first check
   * compares the file with the text loaded, so a change made in between is noticed too. Calls
   * `onRemoved` once it's been missing for a whole interval between checks. When the file
   * couldn't be loaded, it calls `onChange` as soon as it can read it, to load it then.
   */
  watch(onChange: () => void, onRemoved?: () => void, onProblem?: (text: string | null) => void): () => void {
    this.reload = onChange;
    let started = false;
    /** When a check first found no file, in the gap it's in now. */
    let missingSince: number | null = null;
    /** Whether the user was told the file can't be read, so they're told once, until it can be again. */
    let told = false;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (stopped || checking || (typeof document !== "undefined" && document.hidden)) return;
      checking = true;
      try {
        // The designer starts watching while the file is still loading, so the first check waits
        // for the load, and a change made after it read the file is noticed.
        if (!started) {
          await this.loading?.catch(() => undefined);
          started = true;
        }
        // The text, not the file's time and size: a change can keep both, on a file system
        // that keeps times to the second. The file is small, so reading it is cheap.
        const text = await readText(await fileAt(this.root, this.path));
        missingSince = null;
        if (told && !stopped) onProblem?.(null);
        told = false;
        // Compared with what the designer last loaded or saved, not with the last check: a reload
        // that fails, say because the file was moved aside for a moment, is asked for again. A
        // file the designer couldn't open at all is asked for as soon as it's there.
        const changed = this.known === null || text !== this.known;
        if (changed && !stopped) onChange();
      } catch (error) {
        // Editors, agents and Git can replace the file by moving it aside first, so it's only
        // gone once it's been missing for a whole interval between checks.
        if (!isMissing(error)) {
          // Such as the browser no longer letting the page read the folder. It keeps trying.
          if (!told && !stopped) onProblem?.(`Can't read ${this.location} to see changes made outside the designer: ${problemText(error)}`);
          told = true;
          return;
        }
        // A file the designer couldn't open isn't removed: it keeps waiting for it.
        if (this.known === null) return;
        missingSince ??= Date.now();
        if (Date.now() - missingSince >= this.pollMs && !stopped) {
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
      if (this.reload === onChange) this.reload = null;
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
    }).catch((error: unknown) => {
      this.db = null;
      throw new Error(`This browser won't let open-arch remember folders: ${problemText(error)}`);
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

// --- In the URL ----------------------------------------------------------------------

const FOLDER_PREFIX = "folder/";

/**
 * The web app names the open workspace in the URL's hash, so reloading the page reopens it. A
 * workspace in a folder is named by its place in the list of folders opened.
 */
export const hashForFolder = (host: FolderHost) => FOLDER_PREFIX + host.id;

/** The ID of the folder a URL's hash names, or null when it names none. */
export function folderIdInHash(hash: string): string | null {
  return hash.startsWith(FOLDER_PREFIX) && hash.length > FOLDER_PREFIX.length ? hash.slice(FOLDER_PREFIX.length) : null;
}

/**
 * The workspace in a folder that a URL's hash names, if the browser still lets the page change the
 * folder. If it has to ask, it can only do that after a click, so it's null, and the start page
 * lists the folder to open instead.
 */
export async function folderInUrl(hash: string, folders: Pick<FolderList, "get"> = folderList): Promise<FolderHost | null> {
  const id = folderIdInHash(hash);
  const record = id === null ? undefined : await folders.get(id);
  return record && (await allowed(record.root, false)) ? new FolderHost(record.id, record.root, record.path) : null;
}
