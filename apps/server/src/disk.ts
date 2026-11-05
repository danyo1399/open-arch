/**
 * Encrypted files in a folder on disk, through the same interface as Cloudflare's R2 (sql.ts).
 * A key like `workspaces/<id>/<hash>` is a file at that path inside the folder.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Bucket } from "./sql.js";

/** Keys are made of the IDs and hashes the handler checked, but the bucket doesn't count on it. */
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/?$/;

export function diskBucket(folder: string): Bucket {
  const path = (key: string) => {
    if (!KEY.test(key)) throw new Error(`Not a file key: ${key}`);
    return join(folder, ...key.split("/"));
  };
  const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

  return {
    // Written beside it, then renamed into place, so a reader never sees half a file.
    async put(key, value) {
      const file = path(key);
      await mkdir(dirname(file), { recursive: true });
      const partial = `${file}.${randomBytes(6).toString("hex")}.partial`;
      await writeFile(partial, value);
      await rename(partial, file);
    },
    async get(key) {
      try {
        const bytes = await readFile(path(key));
        return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
      } catch (error) {
        if (missing(error)) return null;
        throw error;
      }
    },
    async delete(keys) {
      const folders = new Set<string>();
      for (const key of [keys].flat()) {
        await rm(path(key), { force: true });
        folders.add(dirname(path(key)));
      }
      // A workspace's folder goes with its last file.
      for (const dir of folders) await rmdir(dir).catch(() => undefined);
    },
    // The files in one folder whose names start with what follows its last "/": all of them, at once.
    async list({ prefix }) {
      const cut = prefix.lastIndexOf("/") + 1;
      const dir = prefix.slice(0, cut);
      let names: string[];
      try {
        names = await readdir(cut ? path(dir) : folder);
      } catch (error) {
        if (missing(error)) return { objects: [], truncated: false };
        throw error;
      }
      const start = prefix.slice(cut);
      return { objects: names.filter((n) => n.startsWith(start) && !n.endsWith(".partial")).map((n) => ({ key: dir + n })), truncated: false };
    },
  };
}
