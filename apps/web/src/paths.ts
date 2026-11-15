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

/**
 * Where a workspace's docs go when its file is at the top of a folder named `folder`, as in the
 * zip and a folder it's exported to: the docs folder the workspace names, worked out from the file's
 * folder as a save does, so a path that goes up and comes back in, like `../<folder>/docs`, stays
 * inside. With none named, or one outside, in the file's own folder. As parts of a path from there.
 */
export function docsPlace(named: string | undefined, folder: string): string[] {
  if (!named || isAbsolutePath(named)) return [];
  const above = "\u0000"; // No real folder has this name.
  const parts = segments(`${above}/${folder}/${named}`);
  return parts?.[0] === above && parts[1] === folder ? parts.slice(2) : [];
}
