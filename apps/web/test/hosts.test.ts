import { describe, expect, it } from "vitest";
import { exampleHost, findWorkspace, FolderHost, hostFromFileList, type DirHandle, type FileHandle } from "../src/hosts.js";
import { chain, diffFiles, parseSnapshot } from "../src/state.js";
import { checkWorkspace, newElement, setLayout } from "@open-arch/core";

class FakeFile implements FileHandle {
  readonly kind = "file";
  constructor(
    readonly name: string,
    public text = "",
    public lastModified = 1,
  ) {}
  async getFile() {
    return { text: async () => this.text, lastModified: this.lastModified, size: this.text.length };
  }
  async createWritable() {
    let buffer = "";
    return {
      write: async (data: string) => void (buffer += data),
      close: async () => {
        this.text = buffer;
        this.lastModified++;
      },
    };
  }
}

class FakeDir implements DirHandle {
  readonly kind = "directory";
  readonly children = new Map<string, FakeDir | FakeFile>();
  constructor(readonly name: string) {}
  async *entries(): AsyncGenerator<[string, FakeDir | FakeFile]> {
    yield* [...this.children.entries()];
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) this.children.set(name, (child = new FakeDir(name)));
    if (!(child instanceof FakeDir)) throw new Error(`NotFoundError: ${name}`);
    return child;
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let child = this.children.get(name);
    if (!child && options?.create) this.children.set(name, (child = new FakeFile(name)));
    if (!(child instanceof FakeFile)) throw new Error(`NotFoundError: ${name}`);
    return child;
  }
  async removeEntry(name: string) {
    if (!this.children.delete(name)) throw new Error(`NotFoundError: ${name}`);
  }
  /** Every file below, as path → text. */
  dump(prefix = ""): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, child] of this.children) {
      if (child instanceof FakeFile) out[prefix + name] = child.text;
      else Object.assign(out, child.dump(`${prefix}${name}/`));
    }
    return out;
  }
}

function tree(files: Record<string, string>): FakeDir {
  const root = new FakeDir("project");
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.children.has(part)) dir.children.set(part, new FakeDir(part));
      dir = dir.children.get(part) as FakeDir;
    }
    dir.children.set(parts[parts.length - 1]!, new FakeFile(parts[parts.length - 1]!, text));
  }
  return root;
}

const element = (kind: string, name: string, extra = "") => `---\nkind: ${kind}\nname: ${name}\n${extra}---\n\n# ${name}\n`;

describe("FolderHost", () => {
  const files = {
    "README.md": "# Project",
    "docs/arch/open-arch.yaml": "version: 1\n",
    "docs/arch/model/shop.md": element("system", "Shop"),
    "docs/arch/model/shop/api.md": element("container", "API", "parent: shop\n"),
    "docs/arch/model/.draft.md": "ignored",
    "docs/arch/model/notes.txt": "ignored",
    "docs/arch/views/landscape.md": "---\nkind: view\ntitle: L\nlevel: landscape\n---\n",
  };

  it("finds a workspace below the picked folder and reads its files", async () => {
    const root = tree(files);
    const found = await findWorkspace(root);
    expect(found?.dir.name).toBe("arch");
    const snapshot = await new FolderHost(found!.dir).load();
    expect(snapshot.configText).toBe("version: 1\n");
    expect(snapshot.files.map((f) => f.path).sort()).toEqual(["model/shop.md", "model/shop/api.md", "views/landscape.md"]);
  });

  it("returns null when there's no workspace", async () => {
    expect(await findWorkspace(tree({ "a/b.md": "x" }))).toBeNull();
  });

  it("writes, moves and deletes files, removing folders left empty", async () => {
    const root = tree(files);
    const dir = (await findWorkspace(root))!.dir as FakeDir;
    const host = new FolderHost(dir);
    await host.load();
    await host.write([
      { path: "model/shop/db.md", content: "db" },
      { path: "model/shop/api/handler.md", content: "handler" },
    ]);
    await host.write([
      { path: "model/shop/orders-api/handler.md", content: "moved", from: "model/shop/api/handler.md" },
      { path: "model/shop/db.md", content: null },
    ]);
    const after = dir.dump();
    expect(after["model/shop/orders-api/handler.md"]).toBe("moved");
    expect(after["model/shop/db.md"]).toBeUndefined();
    expect((dir.children.get("model") as FakeDir).children.get("shop") instanceof FakeDir).toBe(true);
    expect(((dir.children.get("model") as FakeDir).children.get("shop") as FakeDir).children.has("api")).toBe(false);
  });
});

describe("in-memory hosts", () => {
  it("bundles a clean example", async () => {
    const workspace = parseSnapshot(await exampleHost().load());
    expect(workspace.elements.size).toBe(10);
    expect(checkWorkspace(workspace)).toEqual([]);
  });

  it("reads a folder picked with webkitdirectory", async () => {
    const file = (path: string, text: string) => Object.defineProperty(new File([text], path.split("/").pop()!), "webkitRelativePath", { value: path });
    const host = await hostFromFileList([
      file("repo/arch/open-arch.yaml", "version: 1\n"),
      file("repo/arch/model/shop.md", element("system", "Shop")),
      file("repo/src/index.md", "not part of the workspace"),
    ]);
    expect("error" in host).toBe(false);
    if ("error" in host) return;
    expect(host.name).toBe("arch");
    expect((await host.load()).files.map((f) => f.path)).toEqual(["model/shop.md"]);
    expect(host.zip().byteLength).toBeGreaterThan(0);
    expect(await hostFromFileList([file("x/y.md", "")])).toEqual({ error: expect.stringContaining("no open-arch.yaml") });
  });
});

describe("chain and diffFiles", () => {
  it("combines several edits into one set of changes", async () => {
    const ws = parseSnapshot(await exampleHost().load());
    const changes = chain(
      ws,
      (w) => newElement(w, { id: "cache", kind: "container", parent: "shop" }),
      (w) => setLayout(w, "shop-containers", { cache: { x: 1, y: 2 } }),
    );
    expect(changes.map((c) => c.path).sort()).toEqual(["model/shop/cache.md", "views/shop-containers.md"]);
    expect(diffFiles(ws.inputs, ws.inputs)).toEqual([]);
    expect(diffFiles(ws.inputs, ws.inputs.slice(1))).toEqual([{ path: ws.inputs[0]!.path, content: null }]);
  });
});
