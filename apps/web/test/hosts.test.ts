import { buildWorkspace, checkWorkspace, loadWorkspace } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exampleHost, tourHost, workspaceZip } from "../src/hosts.js";
import { SKILL_TARGETS, skillFiles } from "../src/skill.js";
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

  it("zips the workspace file, its docs where it names them, and the agent skill, in one folder", async () => {
    const text = await exampleHost().load();
    const ws = loadWorkspace(text);
    const docs = ws.doc.export!.docs!;
    const files = unzipSync(workspaceZip(ws, "shop.openarch", text));
    expect(strFromU8(files["shop/shop.openarch"]!)).toBe(text);
    expect(Object.keys(files)).toContain(`shop/${docs}/README.md`);
    expect(strFromU8(files[`shop/${docs}/views/shop-containers.md`]!)).toContain("```mermaid");
    for (const target of SKILL_TARGETS) {
      expect(strFromU8(files[`shop/${target}/SKILL.md`]!)).toBe(skillFiles.find((f) => f.path === "SKILL.md")!.content);
      expect(Object.keys(files)).toContain(`shop/${target}/references/commands.md`);
    }
    expect(Object.keys(files).every((path) => path.startsWith("shop/"))).toBe(true);
    // AGENTS.md, with the section open-arch init adds, naming the file and its docs in the zip.
    const agents = strFromU8(files["shop/AGENTS.md"]!);
    expect(agents.startsWith("<!-- open-arch:start -->")).toBe(true);
    expect(agents).toContain(`in \`shop.openarch\`. Readable docs generated from it are in \`${docs}/\`.`);
  });

  it("leaves AGENTS.md out of the zip when the file's name has a line break in it", () => {
    const text = JSON.stringify({ openarch: 12, name: "A", elements: {}, views: {} });
    const files = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a\nb.openarch", text)));
    expect(files).toContain("a\nb/a\nb.openarch");
    expect(files.some((path) => path.endsWith("AGENTS.md"))).toBe(false);
    // Or its docs folder's.
    const docsText = JSON.stringify({ openarch: 12, name: "A", export: { docs: "do\u2029cs" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(docsText), "a.openarch", docsText))).some((path) => path.endsWith("AGENTS.md"))).toBe(false);
  });

  it("says docs in the file's own folder are in ./, in the zip's AGENTS.md", () => {
    const text = JSON.stringify({ openarch: 12, name: "A", export: { docs: "." }, elements: {}, views: {} });
    const files = unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text));
    expect(Object.keys(files)).toContain("a/README.md");
    expect(strFromU8(files["a/AGENTS.md"]!)).toContain("Readable docs generated from it are in `./`.");
  });

  it("zips the docs in <name>-docs when the workspace names no docs folder, or one outside its folder", () => {
    for (const docs of [undefined, "../docs", "/docs"]) {
      const text = JSON.stringify({ openarch: 12, name: "A", ...(docs ? { export: { docs } } : {}), elements: {}, views: {} });
      const files = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)));
      expect(files).toContain("a/a-docs/README.md");
    }
    const text = JSON.stringify({ openarch: 12, name: "A", export: { docs: "./docs/arch/" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)))).toContain("a/docs/arch/README.md");
  });

  it("zips a workspace from a folder as that folder, with the docs where a save puts them", async () => {
    const cases: [string, string][] = [
      ["../arch/docs", "repo/arch/docs/"],
      ["../docs", "repo/docs/"],
      ["docs", "repo/arch/docs/"],
      ["../../out", "repo/arch/a-docs/"],
    ];
    for (const [docs, where] of cases) {
      const text = JSON.stringify({ openarch: 12, name: "A", export: { docs }, elements: {}, views: {} });
      // Where a save in the folder writes them, when it can.
      const root = new FakeFolder("repo");
      root.put("arch/a.openarch", text);
      const saved = await new FolderHost("1", root, "arch/a.openarch").save(text).catch(() => null);
      if (saved) expect(Object.keys(root.files())).toContain(`${where.slice("repo/".length)}README.md`);
      const zipped = unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text, { folder: "repo", path: "arch/a.openarch" }));
      const files = Object.keys(zipped);
      expect(files).toContain(`${where}README.md`);
      expect(strFromU8(zipped["repo/AGENTS.md"]!)).toContain(`in \`arch/a.openarch\`. Readable docs generated from it are in \`${where.slice("repo/".length)}\`.`);
      expect(files).toContain("repo/arch/a.openarch");
      expect(files).toContain("repo/AGENTS.md");
      for (const target of SKILL_TARGETS) expect(files).toContain(`repo/${target}/SKILL.md`);
    }
  });

  it("works out a docs folder from the file's folder, as a save does, so one that goes up and comes back in is kept", async () => {
    const text = JSON.stringify({ openarch: 12, name: "A", export: { docs: "../a/docs" }, elements: {}, views: {} });
    // In a folder, with the file in a/, a save writes these docs to a/docs/.
    const root = new FakeFolder("repo");
    root.put("a/a.openarch", text);
    await new FolderHost("1", root, "a/a.openarch").save(text);
    expect(Object.keys(root.files())).toContain("a/docs/README.md");
    // The zip's one folder is named after the file, and the docs land in the same place in it.
    const zipped = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)));
    expect(zipped).toContain("a/docs/README.md");
    expect(zipped.some((path) => path.startsWith("a/a-docs/"))).toBe(false);
    // Up and into another folder isn't inside the file's folder: the zip has no place for it.
    const other = JSON.stringify({ openarch: 12, name: "A", export: { docs: "../arch/docs" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(other), "a.openarch", other)))).toContain("a/a-docs/README.md");
  });
});

describe("model helpers", () => {
  const ws = buildWorkspace({
    openarch: 12,
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
