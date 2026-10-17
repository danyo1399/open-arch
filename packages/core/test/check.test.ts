import { describe, expect, it } from "vitest";
import { checkWorkspace, formatWorkspace, parseConfig } from "../src/index.js";
import { apply, md, SHOP, ws } from "./helpers.js";

/** The SHOP fixture with previews generated, so it starts clean. */
function cleanShop(extra: Record<string, string> = {}) {
  const first = ws({ ...SHOP, ...extra });
  return apply(first, formatWorkspace(first).changes);
}

const rules = (workspace: ReturnType<typeof ws>) => checkWorkspace(workspace).map((d) => d.rule);

describe("checkWorkspace", () => {
  it("passes a valid workspace once previews are generated", () => {
    expect(rules(ws(SHOP)).every((r) => r === "preview-missing")).toBe(true);
    expect(checkWorkspace(cleanShop())).toEqual([]);
  });

  it("reports an unknown relationship target at its line, with the closest ID", () => {
    const workspace = cleanShop({ "model/customer.md": md(["kind: person", "name: Customer", "uses:", "  - to: web-ap", "    description: Buys"]) });
    const d = checkWorkspace(workspace).find((x) => x.rule === "relationship-unknown-target")!;
    expect(d).toMatchObject({ severity: "error", path: "model/customer.md", line: 5, fix: 'Did you mean "web-app"?' });
  });

  it("enforces C4 nesting", () => {
    const workspace = cleanShop({
      "model/orphan.md": md(["kind: container", "name: Orphan"]),
      "model/wrong.md": md(["kind: component", "name: Wrong", "parent: shop"]),
      "model/top.md": md(["kind: system", "name: Top", "parent: shop"]),
      "model/lost.md": md(["kind: container", "name: Lost", "parent: shpo"]),
      "model/ext.md": md(["kind: container", "name: Ext", "parent: shop", "external: true"]),
    });
    expect(rules(workspace)).toEqual(expect.arrayContaining(["parent-required", "parent-kind", "parent-not-allowed", "parent-unknown", "external-ignored"]));
  });

  it("rejects relationships that can't be drawn", () => {
    const workspace = cleanShop({
      "model/shop/api.md": md(["kind: container", "name: API", "parent: shop", "uses:", "  - to: controller", "    description: x", "  - to: api", "    description: y"]),
    });
    expect(rules(workspace)).toEqual(expect.arrayContaining(["relationship-parent-child", "relationship-self"]));
  });

  it("warns about missing descriptions and duplicates", () => {
    const workspace = cleanShop({ "model/customer.md": md(["kind: person", "name: Customer", "uses:", "  - web-app", "  - web-app"]) });
    const found = checkWorkspace(workspace).filter((d) => d.path === "model/customer.md");
    expect(found.map((d) => [d.rule, d.severity])).toEqual([
      ["relationship-description", "warning"],
      ["relationship-description", "warning"],
      ["relationship-duplicate", "warning"],
    ]);
  });

  it("reports file-level problems", () => {
    const workspace = ws({
      "model/Bad_Name.md": md(["kind: system", "name: Bad"]),
      "model/a/dup.md": md(["kind: system", "name: A"]),
      "model/b/dup.md": md(["kind: system", "name: B"]),
      "model/no-frontmatter.md": "# Just text\n",
      "model/broken.md": md(["kind: [system"]),
      "model/a-view.md": md(["kind: view", "title: X", "level: landscape"]),
      "model/tags.md": md(["kind: system", "name: T", "tags: database"]),
      "views/an-element.md": md(["kind: system", "name: S"]),
      "model/README.md": "# ignored\n",
      "model/_drafts/ignored.md": "nothing here",
    });
    expect(rules(workspace).sort()).toEqual(
      ["field-type", "frontmatter-invalid", "frontmatter-missing", "id-duplicate", "id-format", "wrong-folder", "wrong-folder"].sort(),
    );
  });

  it("checks view scopes", () => {
    const workspace = ws({
      "model/shop.md": md(["kind: system", "name: Shop"]),
      "views/a.md": md(["kind: view", "title: A", "level: container"]),
      "views/b.md": md(["kind: view", "title: B", "level: component", "scope: shop"]),
      "views/c.md": md(["kind: view", "title: C", "level: landscape", "scope: shop"]),
      "views/d.md": md(["kind: view", "title: D", "level: context", "scope: shp"]),
      "views/e.md": md(["kind: view", "title: E", "level: zoomed"]),
    });
    expect(rules(workspace)).toEqual(["view-scope-required", "view-scope-kind", "view-scope-not-allowed", "view-scope-unknown", "level-invalid"]);
  });

  it("tells a stale preview from a hand-edited one", () => {
    const clean = cleanShop();
    const stale = apply(clean, [{ path: "model/shop/api.md", content: md(["kind: container", "name: Orders API", "parent: shop"]) }]);
    expect(rules(stale)).toEqual(["preview-stale", "preview-stale"]);

    const view = clean.inputs.find((f) => f.path === "views/landscape.md")!;
    const edited = apply(clean, [{ path: view.path, content: view.text.replace("Customer<br/>", "Shopper<br/>") }]);
    expect(rules(edited)).toEqual(["preview-edited"]);
  });

  it("checks the layout comment", () => {
    const base = cleanShop();
    const view = base.inputs.find((f) => f.path === "views/shop-containers.md")!;
    const withLayout = (json: string) => apply(base, [{ path: view.path, content: `${view.text}\n<!-- open-arch:layout\n${json}\n-->\n` }]);
    expect(rules(withLayout('{"nodes": {"api": {"x": 1, "y": 2}}}'))).toEqual([]);
    expect(rules(withLayout('{"nodes": {"gone": {"x": 1, "y": 2}}}'))).toEqual(["layout-stale"]);
    expect(rules(withLayout('{"nodes": {"api": {"x": "1"}}}'))).toEqual(["layout-invalid"]);
    expect(rules(withLayout("{nope"))).toEqual(["layout-invalid"]);
  });

  it("ignores marker-like text inside fenced code", () => {
    const workspace = cleanShop({
      "model/shop.md": md(["kind: system", "name: Shop"], "\n```markdown\n<!-- open-arch:layout\n{bad\n-->\n```\n"),
    });
    expect(checkWorkspace(workspace)).toEqual([]);
  });
});

describe("parseConfig", () => {
  it("reads settings and rejects bad ones", () => {
    expect(parseConfig("version: 1\nmodel: arch/model\nviews: arch/views\npreview: none\n")).toEqual({
      config: { version: 1, model: "arch/model", views: "arch/views", preview: "none" },
      diagnostics: [],
    });
    const bad = parseConfig("version: 2\nmodel: ../out\npreview: svg\n");
    expect(bad.diagnostics.map((d) => d.line)).toEqual([1, 2, 3]);
  });
});
