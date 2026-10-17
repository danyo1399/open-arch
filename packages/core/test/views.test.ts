import { describe, expect, it } from "vitest";
import { computeView, describeElement, renderMermaid } from "../src/index.js";
import { md, SHOP, ws } from "./helpers.js";

const view = (workspace: ReturnType<typeof ws>, id: string) => computeView(workspace, workspace.views.get(id)!);
const arrows = (cv: ReturnType<typeof computeView>) => cv.edges.map((e) => `${e.from}->${e.to}`);

describe("computeView", () => {
  it("landscape shows every person and system, with relationships lifted to them", () => {
    const cv = view(ws(SHOP), "landscape");
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "payments", "shop"]);
    expect(arrows(cv)).toEqual(["customer->shop", "shop->payments"]);
    expect(cv.boundary).toBeUndefined();
  });

  it("context view shows the scope and what it connects to", () => {
    const cv = view(ws(SHOP), "shop-context");
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "payments", "shop"]);
  });

  it("container view frames the scope's containers and lifts components to their container", () => {
    const cv = view(ws(SHOP), "shop-containers");
    expect(cv.boundary?.id).toBe("shop");
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "payments", "api", "db", "web-app"]);
    expect(arrows(cv)).toEqual(["api->db", "api->payments", "customer->web-app", "web-app->api"]);
    const implied = cv.edges.find((e) => e.from === "api" && e.to === "db")!;
    expect(implied).toMatchObject({ implied: true, description: "Stores orders", technology: "SQL" });
    expect(cv.edges.find((e) => e.from === "customer")!.implied).toBe(false);
  });

  it("component view shows sibling containers as containers and other systems as systems", () => {
    const cv = view(ws(SHOP), "api-components");
    expect(cv.boundary?.id).toBe("api");
    expect(cv.nodes.map((n) => n.id)).toEqual(["payments", "db", "web-app", "controller"]);
    expect(arrows(cv)).toEqual(["controller->db", "controller->payments", "web-app->controller"]);
  });

  it("applies include and exclude, and warns about entries that don't fit", () => {
    const workspace = ws({
      ...SHOP,
      "views/shop-containers.md": md(["kind: view", "title: T", "level: container", "scope: shop", "include: [web-app, controller, nope]", "exclude: [db, customer]"]),
    });
    const cv = view(workspace, "shop-containers");
    expect(cv.nodes.map((n) => n.id)).toEqual(["api", "web-app"]);
    expect(cv.diagnostics.map((d) => d.rule)).toEqual(["view-include-lifted", "view-include-unknown", "view-exclude-unused", "view-exclude-unused"]);
  });

  it("merges several relationships between the same two boxes into one arrow", () => {
    const workspace = ws({
      ...SHOP,
      "model/shop/api/other.md": md(["kind: component", "name: Other", "parent: api", "uses:", "  - to: db", "    description: Reads reports"]),
    });
    const edge = view(workspace, "shop-containers").edges.find((e) => e.from === "api" && e.to === "db")!;
    expect(edge.description).toBe("Stores orders; Reads reports");
    expect(edge.sources).toHaveLength(2);
  });
});

describe("renderMermaid", () => {
  it("draws a frame, C4 classes and safe node IDs", () => {
    const text = renderMermaid(view(ws(SHOP), "shop-containers"));
    expect(text).toContain('subgraph shop_boundary["Shop [System]"]');
    expect(text).toContain('    web_app["Web App<br/>[Container: React]"]');
    expect(text).toContain('db[("DB<br/>[Container]")]');
    expect(text).toContain('customer(["Customer<br/>[Person]"])');
    expect(text).toContain('api -->|"Stores orders<br/>[SQL]"| db');
    expect(text).toContain("class payments external");
  });

  it("escapes characters Mermaid would misread", () => {
    const workspace = ws({ "model/a.md": md(['kind: system', 'name: \'Say "hi" | <b>\'']), "views/l.md": md(["kind: view", "title: L", "level: landscape"]) });
    expect(renderMermaid(view(workspace, "l"))).toContain('a["Say #quot;hi#quot; #124; #lt;b#gt;<br/>[System]"]');
  });
});

describe("describeElement", () => {
  it("lists direct relationships, those of its contents, and the views showing it", () => {
    const d = describeElement(ws(SHOP), "api")!;
    expect(d.parent?.id).toBe("shop");
    expect(d.children.map((c) => c.id)).toEqual(["controller"]);
    expect(d.uses).toEqual([]);
    expect(d.contentsUse.map((u) => `${u.from.id}->${u.rel.to}`)).toEqual(["controller->db", "controller->payments"]);
    expect(d.contentsUsedBy.map((u) => `${u.from.id}->${u.rel.to}`)).toEqual(["web-app->controller"]);
    expect(d.views).toEqual([
      { view: expect.objectContaining({ id: "api-components" }), as: "frame" },
      { view: expect.objectContaining({ id: "shop-containers" }), as: "box" },
    ]);
  });
});
