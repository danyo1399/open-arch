import { describe, expect, it } from "vitest";
import { computeView, describeElement, renderMermaid, type Workspace } from "../src/index.js";
import { shop, ws } from "./helpers.js";

const view = (workspace: Workspace, id: string) => computeView(workspace, workspace.views.get(id)!);
const arrows = (cv: ReturnType<typeof computeView>) => cv.edges.map((e) => `${e.from}->${e.to}`);

describe("computeView", () => {
  it("landscape shows every person and system, with relationships lifted to them", () => {
    const cv = view(ws(), "landscape");
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "payments", "shop"]);
    expect(arrows(cv)).toEqual(["customer->shop", "shop->payments"]);
  });

  it("context view shows the scope and what it connects to", () => {
    expect(view(ws(), "shop-context").nodes.map((n) => n.id)).toEqual(["customer", "payments", "shop"]);
  });

  it("container view frames the scope's containers and lifts components to their container", () => {
    const cv = view(ws(), "shop-containers");
    expect(cv.boundary?.id).toBe("shop");
    expect(cv.nodes.map((n) => n.id)).toEqual(["customer", "payments", "api", "db", "web-app"]);
    expect(arrows(cv)).toEqual(["api->db", "api->payments", "customer->web-app", "web-app->api"]);
    expect(cv.edges.find((e) => e.from === "api" && e.to === "db")).toMatchObject({ implied: true, description: "Stores orders", technology: "SQL" });
  });

  it("component view shows sibling containers as containers and other systems as systems", () => {
    const cv = view(ws(), "api-components");
    expect(cv.nodes.map((n) => n.id)).toEqual(["payments", "db", "web-app", "controller"]);
    expect(arrows(cv)).toEqual(["controller->db", "controller->payments", "web-app->controller"]);
  });

  it("applies include and exclude, and warns about entries that don't fit", () => {
    const doc = shop();
    doc.views["shop-containers"] = { title: "T", level: "container", scope: "shop", include: ["web-app", "controller", "nope"], exclude: ["db", "customer"] };
    const cv = view(ws(doc), "shop-containers");
    expect(cv.nodes.map((n) => n.id)).toEqual(["api", "web-app"]);
    expect(cv.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "view-include-lifted views.shop-containers.include[1]",
      "view-include-unknown views.shop-containers.include[2]",
      "view-exclude-unused views.shop-containers.exclude[0]",
      "view-exclude-unused views.shop-containers.exclude[1]",
    ]);
  });

  it("merges several relationships between the same two boxes into one arrow", () => {
    const doc = shop();
    doc.elements.other = { kind: "component", name: "Other", parent: "api", uses: [{ to: "db", description: "Reads reports" }] };
    const edge = view(ws(doc), "shop-containers").edges.find((e) => e.from === "api" && e.to === "db")!;
    expect(edge.description).toBe("Stores orders; Reads reports");
    expect(edge.sources).toHaveLength(2);
  });
});

describe("renderMermaid", () => {
  it("draws a frame, C4 classes and safe node IDs", () => {
    const text = renderMermaid(view(ws(), "shop-containers"));
    expect(text).toContain('subgraph shop_boundary["Shop [System]"]');
    expect(text).toContain('    web_app["Web App<br/>[Container: React]"]');
    expect(text).toContain('db[("DB<br/>[Container]")]');
    expect(text).toContain('api -->|"Stores orders<br/>[SQL]"| db');
    expect(text).toContain("class payments external");
  });

  it("draws each shape as the nearest Mermaid shape, and people as people", () => {
    const doc = shop();
    doc.elements.api!.shape = "queue";
    doc.elements["web-app"]!.shape = "mobile-app";
    doc.elements.customer!.shape = "database";
    const text = renderMermaid(view(ws(doc), "shop-containers"));
    expect(text).toContain('api[["API<br/>[Container: Node.js]"]]');
    expect(text).toContain('web_app("Web App<br/>[Container: React]")');
    expect(text).toContain('customer(["Customer<br/>[Person]"])');
  });
});

describe("describeElement", () => {
  it("lists direct relationships, those of its contents, and the views showing it", () => {
    const d = describeElement(ws(), "api")!;
    expect(d.children.map((c) => c.id)).toEqual(["controller"]);
    expect(d.contentsUse.map((u) => `${u.from.id}->${u.rel.to}`)).toEqual(["controller->db", "controller->payments"]);
    expect(d.contentsUsedBy.map((u) => `${u.from.id}->${u.rel.to}`)).toEqual(["web-app->controller"]);
    expect(d.views.map((v) => `${v.view.id}:${v.as}`)).toEqual(["api-components:frame", "shop-containers:box"]);
  });
});
