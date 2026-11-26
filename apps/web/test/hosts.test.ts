import { buildWorkspace, checkWorkspace, loadWorkspace } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { DesktopBridge } from "../src/bridge.js";
import { DesktopHost, exampleHost, tourHost, viewDocsPath, workspaceZip } from "../src/hosts.js";
import { FolderHost } from "../src/folders.js";
import { FakeFolder } from "./fakeFolder.js";
import { deletePlan, relationshipRef, uniqueId } from "../src/model.js";

describe("hosts", () => {
  it("bundles a clean example", async () => {
    const ws = loadWorkspace(await exampleHost().load());
    expect(ws.elements.size).toBe(17);
    expect(checkWorkspace(ws)).toEqual([]);
  });

  // Only a wide window has the views on the left and the details on the right. A phone has
  // them on tabs, so a note that points at a side of the screen is wrong there.
  it("bundles examples whose notes are true at every window size", async () => {
    for (const host of [exampleHost(), tourHost()]) {
      const ws = loadWorkspace(await host.load());
      const notes = [...[...ws.views.values()].flatMap((v) => v.stickies.map((s) => s.text)), ...[...ws.elements.values()].flatMap((e) => e.notes ?? [])];
      expect(notes.filter((text) => /on the (left|right)|sidebar/i.test(text))).toEqual([]);
    }
  });

  it("keeps an example's edits in memory", async () => {
    const host = exampleHost();
    expect(host).toMatchObject({ name: "shop.openarch", storage: "memory" });
    await host.save("changed");
    expect(await host.load()).toBe("changed");
  });

  it("zips the workspace file and its docs where it names them, in one folder, with nothing for agents", async () => {
    const text = await exampleHost().load();
    const ws = loadWorkspace(text);
    const docs = ws.doc.export!.docs!;
    const files = unzipSync(workspaceZip(ws, "shop.openarch", text));
    expect(strFromU8(files["shop/shop.openarch"]!)).toBe(text);
    expect(Object.keys(files)).toContain(`shop/${docs}/README.md`);
    expect(strFromU8(files[`shop/${docs}/views/shop-containers.md`]!)).toContain("```mermaid");
    expect(Object.keys(files).every((path) => path.startsWith("shop/"))).toBe(true);
    // No agent skill or AGENTS.md: they're for the CLI, which usually isn't installed beside a workspace made here.
    expect(Object.keys(files).some((path) => path.includes("/.agents/") || path.includes("/.claude/") || path.endsWith("AGENTS.md"))).toBe(false);
  });

  it("zips the docs beside the file when they're in the file's own folder", () => {
    const text = JSON.stringify({ openarch: 22, name: "A", export: { docs: "." }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)))).toContain("a/README.md");
  });

  it("zips the docs beside the file, with no folder of their own, when the workspace names no docs folder, or one outside its folder", () => {
    for (const docs of [undefined, "../docs", "/docs"]) {
      const text = JSON.stringify({ openarch: 22, name: "A", ...(docs ? { export: { docs } } : {}), elements: {}, views: {} });
      const files = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)));
      expect(files).toContain("a/README.md");
      expect(files).toContain("a/a.openarch");
      expect(files.some((path) => path.startsWith("a/a-docs/"))).toBe(false);
    }
    const text = JSON.stringify({ openarch: 22, name: "A", export: { docs: "./docs/arch/" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)))).toContain("a/docs/arch/README.md");
  });

  it("zips a workspace from a folder as that folder, with the docs where a save puts them", async () => {
    const cases: [string, string][] = [
      ["../arch/docs", "repo/arch/docs/"],
      ["../docs", "repo/docs/"],
      ["docs", "repo/arch/docs/"],
      ["../../out", "repo/arch/"],
      ["..", "repo/"],
    ];
    for (const [docs, where] of cases) {
      const text = JSON.stringify({ openarch: 22, name: "A", export: { docs }, elements: {}, views: {} });
      // Where a save in the folder writes them, when it can.
      const root = new FakeFolder("repo");
      root.put("arch/a.openarch", text);
      const saved = await new FolderHost("1", root, "arch/a.openarch").save(text).catch(() => null);
      if (saved) expect(Object.keys(root.files())).toContain(`${where.slice("repo/".length)}README.md`);
      const zipped = unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text, { folder: "repo", path: "arch/a.openarch" }));
      const files = Object.keys(zipped);
      expect(files).toContain(`${where}README.md`);
      expect(files).toContain("repo/arch/a.openarch");
    }
  });

  it("works out a docs folder from the file's folder, as a save does, so one that goes up and comes back in is kept", async () => {
    const text = JSON.stringify({ openarch: 22, name: "A", export: { docs: "../a/docs" }, elements: {}, views: {} });
    // In a folder, with the file in a/, a save writes these docs to a/docs/.
    const root = new FakeFolder("repo");
    root.put("a/a.openarch", text);
    await new FolderHost("1", root, "a/a.openarch").save(text);
    expect(Object.keys(root.files())).toContain("a/docs/README.md");
    // The zip's one folder is named after the file, and the docs land in the same place in it.
    const zipped = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)));
    expect(zipped).toContain("a/docs/README.md");
    expect(zipped).not.toContain("a/README.md");
    // Up and into another folder isn't inside the file's folder: the zip has no place for it.
    const other = JSON.stringify({ openarch: 22, name: "A", export: { docs: "../arch/docs" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(other), "a.openarch", other)))).toContain("a/README.md");
  });
});

describe("the path to a view's page in the docs", () => {
  const context = { title: "Context", level: "context", scope: "shop" };
  const shop = (docs?: string) =>
    JSON.stringify({ openarch: 22, name: "Shop", ...(docs === undefined ? {} : { export: { docs } }), elements: { shop: { kind: "system", name: "Shop" } }, views: { context } });

  it("is where a save in a folder writes the page, as the path in the folder", async () => {
    for (const [path, docs, page] of [
      ["a.openarch", "docs", "docs/views/context.md"],
      ["a.openarch", ".", "views/context.md"],
      ["arch/a.openarch", ".", "arch/views/context.md"],
      ["arch/a.openarch", "../docs/arch", "docs/arch/views/context.md"],
    ] as const) {
      const root = new FakeFolder("repo");
      root.put(path, shop(docs));
      await new FolderHost("1", root, path).save(shop(docs));
      expect(viewDocsPath(path, docs, "context", true)).toBe(page);
      expect(Object.keys(root.files())).toContain(page);
    }
  });

  it("is none when saves write no page: with no docs folder, a full path, or one outside the folder", () => {
    expect(viewDocsPath("a.openarch", undefined, "context", true)).toBeNull();
    expect(viewDocsPath("a.openarch", "", "context", true)).toBeNull();
    expect(viewDocsPath("a.openarch", "/docs", "context", true)).toBeNull();
    expect(viewDocsPath("a.openarch", "C:docs", "context", false)).toBeNull();
    expect(viewDocsPath("arch/a.openarch", "../../docs", "context", true)).toBeNull();
  });

  it("is a full path in the desktop app, with the file's own separators", () => {
    expect(viewDocsPath("/repo/a.openarch", "docs", "context", false)).toBe("/repo/docs/views/context.md");
    expect(viewDocsPath("/repo/arch/a.openarch", "../docs/./arch", "context", false)).toBe("/repo/docs/arch/views/context.md");
    expect(viewDocsPath("/a.openarch", "../docs", "context", false)).toBe("/docs/views/context.md");
    expect(viewDocsPath("C:\\repo\\a.openarch", "docs/arch", "context", false)).toBe("C:\\repo\\docs\\arch\\views\\context.md");
    expect(viewDocsPath("C:\\a.openarch", "..", "context", false)).toBe("C:\\views\\context.md");
    expect(viewDocsPath("\\\\server\\share\\a.openarch", "../docs", "context", false)).toBe("\\\\server\\share\\docs\\views\\context.md");
    // On Linux and macOS, as there, `\` is part of a name, not a separator.
    expect(viewDocsPath("/repo/a.openarch", "docs\\arch", "context", false)).toBe("/repo/docs\\arch/views/context.md");
    expect(viewDocsPath("/re\\po/a.openarch", "docs", "context", false)).toBe("/re\\po/docs/views/context.md");
    expect(viewDocsPath("C:\\repo\\a.openarch", "docs\\arch", "context", false)).toBe("C:\\repo\\docs\\arch\\views\\context.md");
  });
});

describe("the desktop app's host", () => {
  it("passes on all a save did, the skill and AGENTS.md too, and what the save that made it did", async () => {
    const saved = { docs: { dir: "docs", written: 1, deleted: 0, skipped: [] }, skillError: "No.", agentsError: "Locked." };
    const bridge = { save: async () => saved } as unknown as DesktopBridge;
    const host = new DesktopHost(bridge, "/repo/a.openarch", "a.openarch", { docs: null, agentsError: "Locked." });
    expect(await host.save("{}")).toEqual(saved);
    expect(host.made).toEqual({ docs: null, agentsError: "Locked." });
    expect(host.syncsSkill).toBe(true);
  });
});

describe("model helpers", () => {
  const ws = buildWorkspace({
    openarch: 22,
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
