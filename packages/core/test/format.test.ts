import { describe, expect, it } from "vitest";
import { checkWorkspace, DEFAULT_CONFIG, formatWorkspace, loadWorkspace } from "../src/index.js";
import { apply, files, md, SHOP, ws } from "./helpers.js";

describe("formatWorkspace", () => {
  it("adds previews, and running it again changes nothing", () => {
    const first = ws(SHOP);
    const { changes } = formatWorkspace(first);
    expect(changes.map((c) => c.path).sort()).toEqual(["views/api-components.md", "views/landscape.md", "views/shop-containers.md", "views/shop-context.md"]);
    const second = apply(first, changes);
    expect(formatWorkspace(second).changes).toEqual([]);
    expect(checkWorkspace(second)).toEqual([]);
  });

  it("orders known keys, keeps unknown keys, comments and quoting", () => {
    const text = md(["# owned by checkout", "owner: team-checkout", "parent: shop", 'name: "API"', "uses:", "  - technology: SQL # via pgbouncer", "    to: db", "kind: container"], "\n# API\n\nNotes.\n");
    const workspace = ws({ ...SHOP, "model/shop/api.md": text });
    const out = formatWorkspace(workspace, ["model/shop/api.md"]).changes[0]!.content!;
    expect(out).toBe(
      md(["kind: container", 'name: "API"', "parent: shop", "uses:", "  - to: db", "    technology: SQL # via pgbouncer", "# owned by checkout", "owner: team-checkout"], "\n# API\n\nNotes.\n"),
    );
  });

  it("keeps Windows line endings", () => {
    const text = md(["name: Shop", "kind: system"]).replace(/\n/g, "\r\n");
    const out = formatWorkspace(ws({ "model/shop.md": text })).changes[0]!.content!;
    expect(out).toBe(md(["kind: system", "name: Shop"]).replace(/\n/g, "\r\n"));
  });

  it("inserts the preview before the layout comment and prunes stale positions", () => {
    const view = md(["kind: view", "title: L", "level: landscape"], '\n# L\n\nProse.\n<!-- open-arch:layout\n{"nodes": {"shop": {"x": 5, "y": 6, "w": 100}, "gone": {"x": 0, "y": 0}}, "viewport": {"zoom": 1}}\n-->\n');
    const workspace = ws({ "model/shop.md": md(["kind: system", "name: Shop"]), "views/l.md": view });
    const out = formatWorkspace(workspace).changes.find((c) => c.path === "views/l.md")!.content!;
    const body = out.slice(out.indexOf("# L"));
    expect(body.split("\n").slice(0, 4)).toEqual(["# L", "", "Prose.", ""]);
    expect(body).toMatch(/<!-- \/open-arch:preview -->\n\n<!-- open-arch:layout\n/);
    expect(body).toContain('"shop": {"x": 5, "y": 6, "w": 100}\n');
    expect(body).not.toContain("gone");
    expect(body).toContain('"viewport": {"zoom":1}');
  });

  it("removes previews when they're turned off", () => {
    const on = apply(ws(SHOP), formatWorkspace(ws(SHOP)).changes);
    const off = loadWorkspace(on.inputs, { ...DEFAULT_CONFIG, preview: "none" });
    const changed = formatWorkspace(off).changes;
    expect(changed).toHaveLength(4);
    expect(changed.every((c) => !c.content!.includes("open-arch:preview"))).toBe(true);
  });

  it("skips files it can't safely rewrite", () => {
    const workspace = loadWorkspace(files({ "model/x.md": "---\nkind: [\n---\n" }));
    expect(formatWorkspace(workspace)).toEqual({ changes: [], skipped: [{ path: "model/x.md", reason: "its frontmatter has errors; fix them first" }] });
  });
});
