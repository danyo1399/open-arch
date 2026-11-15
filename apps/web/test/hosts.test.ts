import { buildWorkspace, checkWorkspace, loadWorkspace } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { exampleHost, tourHost, workspaceZip } from "../src/hosts.js";
import { SKILL_TARGETS, skillFiles } from "../src/skill.js";
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
  });

  it("zips the docs in <name>-docs when the workspace names no docs folder, or one outside its folder", () => {
    for (const docs of [undefined, "../docs", "/docs"]) {
      const text = JSON.stringify({ openarch: 11, name: "A", ...(docs ? { export: { docs } } : {}), elements: {}, views: {} });
      const files = Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)));
      expect(files).toContain("a/a-docs/README.md");
    }
    const text = JSON.stringify({ openarch: 11, name: "A", export: { docs: "./docs/arch/" }, elements: {}, views: {} });
    expect(Object.keys(unzipSync(workspaceZip(loadWorkspace(text), "a.openarch", text)))).toContain("a/docs/arch/README.md");
  });
});

describe("model helpers", () => {
  const ws = buildWorkspace({
    openarch: 11,
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
