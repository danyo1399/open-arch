/** Paths inside a folder, with `/` between folders, as the folders and the zip lay files out. */

/** A path's folders, with `.` and `..` worked out. Null when it goes above the folder. */
export function segments(path: string): string[] | null {
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

/** Whether a path is absolute, on any system: `/docs`, `\docs` or `C:docs`. */
export const isAbsolutePath = (path: string) => /^([\\/]|[a-zA-Z]:)/.test(path);
