/**
 * The web app's workspaces, kept in the browser's IndexedDB: one record per
 * workspace, holding its .openarch text. Files only come in by import and go
 * out by export (providers.ts). Other tabs hear about changes over a
 * BroadcastChannel, so a workspace open in two tabs stays in step.
 */
import { parseDocument } from "@open-arch/core";

export interface StoredWorkspace {
  id: string;
  /** The name it's exported under: the file it was imported from, or a default for a new one. */
  fileName: string;
  text: string;
  /** Milliseconds since the epoch. */
  created: number;
  updated: number;
}

/** A change made in another tab. */
export interface LibraryChange {
  type: "added" | "saved" | "removed";
  id: string;
}

const STORE = "workspaces";

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The browser didn't save the change."));
  });
}

// Short enough for the URL, and unlike crypto.randomUUID it doesn't need HTTPS.
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export class WorkspaceLibrary {
  private db: Promise<IDBDatabase> | null = null;
  private channel: BroadcastChannel | null = null;
  private readonly listeners = new Set<(change: LibraryChange) => void>();

  constructor(private readonly dbName = "open-arch") {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => {
        const db = request.result;
        // Let a newer version of the app, open in another tab, upgrade the database.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error: Error) => {
      this.db = null;
      throw new Error(`This browser won't let open-arch store workspaces: ${error.message}`);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  private tell(change: LibraryChange): void {
    this.channel ??= this.listen();
    this.channel.postMessage(change);
  }

  private listen(): BroadcastChannel {
    const channel = new BroadcastChannel(this.dbName);
    channel.onmessage = (event: MessageEvent<LibraryChange>) => {
      for (const listener of this.listeners) listener(event.data);
    };
    return channel;
  }

  /** Every workspace, the most recently changed first. */
  async list(): Promise<StoredWorkspace[]> {
    const all = await done((await this.store("readonly")).getAll() as IDBRequest<StoredWorkspace[]>);
    return all.sort((a, b) => b.updated - a.updated);
  }

  async get(id: string): Promise<StoredWorkspace | undefined> {
    return done((await this.store("readonly")).get(id) as IDBRequest<StoredWorkspace | undefined>);
  }

  async add(fileName: string, text: string): Promise<StoredWorkspace> {
    const now = Date.now();
    const record: StoredWorkspace = { id: newId(), fileName, text, created: now, updated: now };
    const store = await this.store("readwrite");
    store.add(record);
    await committed(store.transaction);
    this.tell({ type: "added", id: record.id });
    void keepStorage();
    return record;
  }

  /** Replace a workspace's text. Fails if it was deleted, rather than bringing it back. */
  async save(id: string, text: string): Promise<void> {
    const store = await this.store("readwrite");
    const record = await done(store.get(id) as IDBRequest<StoredWorkspace | undefined>);
    if (!record) throw new Error("It was deleted from this browser, maybe in another tab.");
    store.put({ ...record, text, updated: Date.now() });
    await committed(store.transaction);
    this.tell({ type: "saved", id });
  }

  async remove(id: string): Promise<void> {
    const store = await this.store("readwrite");
    store.delete(id);
    await committed(store.transaction);
    this.tell({ type: "removed", id });
  }

  /** Calls `listener` when another tab changes the library. Returns a function that stops listening. */
  onChange(listener: (change: LibraryChange) => void): () => void {
    this.channel ??= this.listen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The workspaces this browser keeps. */
export const browserLibrary = new WorkspaceLibrary();

/**
 * The browser may clear site data when the disk fills up, and the workspaces
 * only live here, so ask it to keep them. Chrome decides by itself; Firefox
 * asks the user once.
 */
async function keepStorage(): Promise<void> {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (!storage?.persist || (await storage.persisted())) return;
  await storage.persist().catch(() => false);
}

/** The workspace's name, for listing it. */
export function workspaceTitle(record: StoredWorkspace): string {
  return parseDocument(record.text).doc.name;
}

/**
 * Why a file can't be imported, or null when it can. Only files the designer
 * can edit are let in: a workspace in the browser can't be fixed by hand.
 */
export function importProblem(file: { name: string; text: string }): string | null {
  const text = file.text.replace(/^﻿/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  if (typeof raw !== "object" || raw === null || !("openarch" in raw)) return `${file.name} isn't an open-arch workspace.`;
  const { diagnostics, valid } = parseDocument(text);
  if (valid) return null;
  const first = diagnostics[0]!;
  return `${file.name} has problems that stop it being edited${first.path ? ` (at ${first.path})` : ""}: ${first.message} Fix the file, then import it again.`;
}
