import { buildWorkspace, checkWorkspace, loadWorkspace } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { docsZip, exampleHost, FileHandleHost, hostFromFile, MemoryHost, type FileHandle } from "../src/hosts.js";
import { deletePlan, relationshipRef, uniqueId } from "../src/model.js";

class FakeFileHandle implements FileHandle {
  writes = 0;
  constructor(
    readonly name: string,
    public text: string,
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
        this.writes++;
      },
    };
  }
}

describe("hosts", () => {
  it("bundles a clean example", async () => {
    const ws = loadWorkspace(await exampleHost().load());
    expect(ws.elements.size).toBe(10);
    expect(checkWorkspace(ws)).toEqual([]);
  });

  it("reads and writes a file through its handle", async () => {
    const handle = new FakeFileHandle("shop.openarch", "{}");
    const host = new FileHandleHost(handle);
    expect(host).toMatchObject({ name: "shop.openarch", storage: "file" });
    expect(await host.load()).toBe("{}");
    await host.save('{"x":1}');
    expect(handle).toMatchObject({ text: '{"x":1}', writes: 1 });
  });

  it("keeps edits in memory for files opened without write access", async () => {
    const host = await hostFromFile(new File(['{"openarch":1}'], "mine.openarch"));
    expect(host).toBeInstanceOf(MemoryHost);
    expect(host.name).toBe("mine.openarch");
    await host.save("changed");
    expect(await host.load()).toBe("changed");
  });

  it("zips the generated docs into one folder", async () => {
    const ws = loadWorkspace(await exampleHost().load());
    const files = unzipSync(docsZip(ws, "shop.openarch"));
    expect(Object.keys(files)).toContain("shop-docs/README.md");
    expect(Object.keys(files)).toContain("shop-docs/views/shop-containers.md");
    expect(strFromU8(files["shop-docs/views/shop-containers.md"]!)).toContain("```mermaid");
  });
});

describe("model helpers", () => {
  const ws = buildWorkspace({
    openarch: 1,
    name: "T",
    elements: {
      shop: { kind: "system", name: "Shop" },
      api: { kind: "container", name: "API", parent: "shop" },
      db: { kind: "container", name: "DB", parent: "shop" },
      web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "db", description: "a" }, { to: "api" }, { to: "db", description: "b" }] },
      handler: { kind: "component", name: "Handler", parent: "api" },
    },
    views: { "api-components": { title: "A", level: "component", scope: "api" } },
  });

  it("names a relationship by its target and which one it is", () => {
    const web = ws.elements.get("web")!;
    expect(relationshipRef(web, 2)).toEqual({ from: "web", to: "db", index: 1 });
    expect(relationshipRef(web, 1)).toEqual({ from: "web", to: "api", index: 0 });
  });

  it("works out what deleting an element removes", () => {
    const plan = deletePlan(ws, "api");
    expect(plan.inside.map((e) => e.id)).toEqual(["handler"]);
    expect(plan.views.map((v) => v.id)).toEqual(["api-components"]);
    expect(plan.affected.map((e) => e.id)).toEqual(["web"]);
  });

  it("finds a free ID", () => {
    expect(uniqueId(ws, "cache")).toBe("cache");
    expect(uniqueId(ws, "api")).toBe("api-2");
    expect(uniqueId(ws, "api-components")).toBe("api-components-2");
  });
});
