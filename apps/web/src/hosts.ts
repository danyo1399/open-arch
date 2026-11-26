/**
 * Where a workspace's .openarch text comes from and goes to. The designer only
 * talks to a WorkspaceHost, so the same UI runs in the browser (workspaces kept
 * in IndexedDB, and the examples in memory) and in Electron (Node's fs).
 */
import { exportDocs, FILE_EXTENSION, type Workspace } from "@open-arch/core";
import { strToU8, zipSync } from "fflate";
import exampleText from "../../../examples/shop/shop.openarch?raw";
import tourText from "../../../examples/food-delivery/food-delivery.openarch?raw";
import type { DesktopBridge, DocsSummary, SaveSummary } from "./bridge.js";
import { importProblem, type WorkspaceLibrary } from "./library.js";
import type { LinkParts, ShareClient } from "./share.js";
import { isAbsolutePath, segments } from "./paths.js";

export interface WorkspaceHost {
  /** File name, shown in the title bar. */
  name: string;
  /** Tells the workspace apart from others on this computer, the same each time it's opened. The designer keeps its settings for the workspace, like pinned views, by it. */
  key: string;
  /** "file": every edit is saved to the file. "browser": every edit is saved in the browser's storage. "memory": edits stay in this tab until saved. */
  storage: "file" | "browser" | "memory";
  /** Saving also refreshes the docs folder: on desktop, and for a workspace in a folder (folders.ts). */
  syncsDocs?: boolean;
  load(): Promise<string>;
  /** Save the file's new text. May report the docs folder it refreshed, the agent skill, and the section in AGENTS.md. */
  save(text: string): Promise<SaveSummary | void>;
  /**
   * Rewrites the docs folder from `text`, as a save does, without writing the file: for a host
   * that syncsDocs. Null when the workspace names no docs folder.
   */
  writeDocs?(text: string): Promise<DocsSummary | null>;
  /** Saving also keeps the agent skill and the AGENTS.md section up to date beside the workspace: on desktop. */
  syncsSkill?: boolean;
  /** For a workspace just made, what the save that made it did: anything that went wrong is said when it opens. */
  made?: SaveSummary;
  /**
   * Calls `onChange` when the workspace changes outside this window, and `onRemoved` when it's
   * deleted there. `onProblem` hears, once, when it can't tell any more, and null once it can
   * again. Returns a function that stops watching.
   */
  watch?(onChange: () => void, onRemoved?: () => void, onProblem?: (text: string | null) => void): () => void;
}

/**
 * Whether saving rewrites the docs folder now: the host does it, and edits still go to its file.
 * One whose file was deleted or moved only lives in the tab, so its docs are exported instead.
 */
export const savesDocs = (host: WorkspaceHost, storage: WorkspaceHost["storage"]) => !!host.syncsDocs && storage === "file";

/**
 * Where a save wrote a view's page in the docs, to paste into a chat with an agent so it can read
 * it. `file` is the .openarch file's path, with `/` or `\` between folders, and `docs` the docs
 * folder the workspace names, relative to the file. In a folder opened in the browser, `file` is
 * the path in that folder, and so is the answer. In the desktop app, both are full paths, with
 * the file's own separators. Null when saves write no page there: with no docs folder named, one
 * given as a full path, or one outside the folder opened (`inFolder`).
 */
export function viewDocsPath(file: string, docs: string | undefined, viewId: string, inFolder: boolean): string | null {
  if (!docs || isAbsolutePath(docs)) return null;
  const page = `${docs}/views/${viewId}.md`;
  const fileDir = file.split(/[\\/]/).slice(0, -1);
  if (inFolder) return segments([...fileDir, page].join("/"))?.join("/") ?? null;
  // A full path: `/` or `C:` on its own, or `\\server\share` for a share, is as high as it goes.
  const parts = [...fileDir];
  const top = /^[\\/]{2}[^\\/]/.test(file) ? 4 : 1;
  for (const part of page.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length > top) parts.pop();
  }
  const separator = /^[a-zA-Z]:|^\\/.test(file) ? "\\" : "/";
  return parts.join(separator);
}

/** Whether saving keeps the agent skill up to date now, by the same rule as the docs. */
export const savesSkill = (host: WorkspaceHost, storage: WorkspaceHost["storage"]) => !!host.syncsSkill && storage === "file";

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

/**
 * Puts text on the clipboard. Browsers only allow the clipboard on a secure page (HTTPS or
 * localhost); elsewhere, such as the dev server opened from another device, the older copy
 * command still works.
 */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Couldn't copy: this browser didn't allow the clipboard.");
}

/**
 * The text on the clipboard. The browser may ask the person first, and refuse if they say no.
 * Pressing Ctrl+V (⌘V on a Mac) pastes without asking.
 */
export async function pasteText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error("This browser doesn't let the page read the clipboard.");
  return navigator.clipboard.readText();
}

/**
 * Whether this browser can put a picture on the clipboard. Only a secure page (HTTPS or
 * localhost) can, in a browser that knows ClipboardItem.
 */
export function canCopyImages(): boolean {
  return typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
}

/**
 * Puts a PNG on the clipboard, to paste into a document, a slide or a chat. Call it as soon as
 * the user clicks, before anything else waits: Safari only allows the clipboard then. So it
 * takes the picture still being drawn, and the clipboard waits for it. If drawing it fails, the
 * error says why, not the clipboard's.
 */
export async function copyImage(png: Promise<Blob>): Promise<void> {
  // Handled at once, in case the clipboard throws before it takes the picture. Awaited below, it still says why it failed.
  png.catch(() => undefined);
  if (!canCopyImages()) throw new Error("Couldn't copy: this browser can't put a picture on the clipboard. Save it as a PNG instead.");
  const written = navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  // Handled at once: the clipboard can refuse while the picture is still being drawn.
  written.catch(() => undefined);
  await png;
  await written;
}

/** Where a workspace's file is in a folder opened from the start page: the folder's name, and the file's path in it. */
export interface FilePlace {
  folder: string;
  path: string;
}

/**
 * The workspace as a zip, with everything in one folder: the .openarch file (`text`) and its
 * generated markdown docs. Not the agent skill or AGENTS.md, which are for changing the model with
 * the CLI, usually not installed beside a workspace made here: `open-arch init` adds them.
 *
 * For a workspace from a folder (`place`), the zip's folder is that folder: the file is at its path
 * there, and the docs are where a save in the folder writes them. Otherwise the zip's folder is named
 * after the file and holds it, and the docs go where a save would put them beside it: a path that
 * goes up and comes back in, like `../<name>/docs`, is worked out from that folder.
 *
 * When the workspace names no docs folder, or one the zip has no place for, the docs go in the
 * file's own folder.
 */
export function workspaceZip(ws: Workspace, fileName: string, text: string, place?: FilePlace): Uint8Array {
  const base = fileName.replace(/\.openarch$/, "");
  const root = place?.folder ?? base;
  const fileDir = place ? place.path.split("/").slice(0, -1) : [];
  const named = ws.doc.export?.docs;
  let docsParts: string[] | null = null;
  if (named && !isAbsolutePath(named)) {
    // As a save does: from the file's folder, and never above the folder the zip holds.
    if (place) docsParts = segments([...fileDir, named].join("/"));
    else {
      const above = "\u0000"; // No real folder has this name.
      const parts = segments(`${above}/${base}/${named}`);
      docsParts = parts?.[0] === above && parts[1] === base ? parts.slice(2) : null;
    }
  }
  const prefix = (parts: string[]) => parts.map((part) => `${part}/`).join("");
  // With none, or one the zip has no place for, in the file's own folder.
  const docs = docsParts ? prefix(docsParts) : prefix(fileDir);
  const entries: Record<string, Uint8Array> = { [`${root}/${prefix(fileDir)}${fileName}`]: strToU8(text) };
  for (const f of exportDocs(ws, fileName)) entries[`${root}/${docs}${f.path}`] = strToU8(f.content);
  return zipSync(entries);
}

// --- Shared as a link ---------------------------------------------------------------

/**
 * A workspace someone shared as a link (share.ts). It's downloaded and decrypted when it's
 * opened, and edits stay in this tab, as an example's do: Save keeps a copy, in the browser or
 * as a file on desktop. Its name is the file name it was shared with, once it's loaded. A link to
 * an earlier version opens the latest, and the link becomes the latest version's.
 */
export class SharedHost implements WorkspaceHost {
  readonly storage = "memory";
  name = `shared${FILE_EXTENSION}`;
  private text: Promise<string> | null = null;
  private current: LinkParts;
  private readonly listeners = new Set<() => void>();

  /** `client` is null when this build has no share server. */
  constructor(
    private readonly client: ShareClient | null,
    link: LinkParts,
  ) {
    this.current = link;
  }

  /** The link to the version that's open: the one it was opened with, until it's loaded. */
  get link(): LinkParts {
    return this.current;
  }

  get key(): string {
    return `shared/${this.current.id}`;
  }

  /** Calls `listener` when the link changes to the version that opened. Returns a function that stops it. */
  onLinkChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(): Promise<string> {
    this.text ??= this.download();
    return this.text;
  }

  private async download(): Promise<string> {
    if (!this.client) throw new Error("This designer can't open shared links: it wasn't built with a share server.");
    const file = await this.client.open(this.current);
    const problem = importProblem(file);
    if (problem) throw new Error(problem);
    this.name = file.name;
    if (file.hash !== this.current.hash) {
      this.current = { ...this.current, hash: file.hash };
      for (const listener of this.listeners) listener();
    }
    return file.text;
  }

  async save(text: string): Promise<void> {
    this.text = Promise.resolve(text);
  }
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
  readonly syncsSkill = true;

  constructor(
    private readonly bridge: DesktopBridge,
    readonly path: string,
    readonly name: string,
    /** For a file the app just made, what the save that made it did, to say if something went wrong. */
    readonly made?: SaveSummary,
  ) {}

  get key(): string {
    return `file/${this.path}`;
  }

  load(): Promise<string> {
    return this.bridge.load(this.path);
  }

  save(text: string): Promise<SaveSummary> {
    return this.bridge.save(this.path, text);
  }

  writeDocs(text: string): Promise<DocsSummary | null> {
    return this.bridge.writeDocs(this.path, text);
  }

  watch(onChange: () => void): () => void {
    return this.bridge.watch(this.path, onChange);
  }
}
