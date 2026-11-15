/** A folder on disk, in memory, for tests of workspaces in a folder (folders.ts). */
import type { FileHandle, FolderHandle } from "../src/folders.js";

const notFound = () => Object.assign(new Error("A requested file or directory could not be found."), { name: "NotFoundError" });

const notAllowed = () => Object.assign(new Error("Not allowed."), { name: "NotAllowedError" });

/** A folder, in memory, with the parts of the File System Access API the host uses. */
export class FakeFolder implements FolderHandle {
  readonly kind = "directory";
  readonly entries = new Map<string, FakeFile | FakeFolder>();
  permission: PermissionState = "granted";
  /** A folder the browser isn't allowed to list, like one only an administrator can read. */
  unreadable = false;
  /** Names the browser isn't allowed to create here, like in a folder that's read-only. */
  readonly refuse = new Set<string>();
  constructor(readonly name: string) {}

  async *values() {
    if (this.unreadable) throw notAllowed();
    yield* this.entries.values();
  }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFile) return entry;
    if (entry) throw Object.assign(new Error("It's a folder."), { name: "TypeMismatchError" });
    if (!options?.create) throw notFound();
    if (this.refuse.has(name)) throw notAllowed();
    const file = new FakeFile(name, "");
    this.entries.set(name, file);
    return file;
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle> {
    const entry = this.entries.get(name);
    if (entry instanceof FakeFolder) return entry;
    if (entry) throw Object.assign(new Error("It's a file."), { name: "TypeMismatchError" });
    if (!options?.create) throw notFound();
    if (this.refuse.has(name)) throw notAllowed();
    const folder = new FakeFolder(name);
    this.entries.set(name, folder);
    return folder;
  }
  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw notFound();
  }
  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }
  async requestPermission(): Promise<PermissionState> {
    return this.permission === "prompt" ? (this.permission = "granted") : this.permission;
  }

  /** Writes a file at a path, making the folders on the way. */
  put(path: string, text: string): void {
    const parts = path.split("/");
    let dir: FakeFolder = this;
    for (const part of parts.slice(0, -1)) {
      if (!dir.entries.has(part)) dir.entries.set(part, new FakeFolder(part));
      dir = dir.entries.get(part) as FakeFolder;
    }
    const name = parts[parts.length - 1]!;
    const file = dir.entries.get(name);
    if (file instanceof FakeFile) file.set(text);
    else dir.entries.set(name, new FakeFile(name, text));
  }

  /** Every file below, by path. */
  files(prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, entry] of this.entries) {
      if (entry instanceof FakeFile) out[prefix + name] = entry.text;
      else Object.assign(out, entry.files(`${prefix}${name}/`));
    }
    return out;
  }

  folders(prefix = ""): string[] {
    return [...this.entries].flatMap(([name, entry]) => (entry instanceof FakeFolder ? [prefix + name, ...entry.folders(`${prefix}${name}/`)] : []));
  }
}

let clock = 1;

export class FakeFile implements FileHandle {
  readonly kind = "file";
  lastModified = clock++;
  constructor(
    readonly name: string,
    public text: string,
  ) {}
  set(text: string) {
    this.text = text;
    this.lastModified = clock++;
  }
  async getFile() {
    return { lastModified: this.lastModified, size: this.text.length, text: async () => this.text };
  }
  async createWritable() {
    let next = "";
    return {
      write: async (data: string) => void (next += data),
      close: async () => this.set(next),
      abort: async () => void (next = ""),
    };
  }
}

