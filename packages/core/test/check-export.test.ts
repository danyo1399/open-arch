import { describe, expect, it } from "vitest";
import { buildWorkspace, checkWorkspace, exportDocs, GENERATED_MARKER } from "../src/index.js";
import { rules, shop } from "./helpers.js";

describe("checkWorkspace", () => {
  it("passes a valid model", () => {
    expect(rules(shop())).toEqual([]);
  });

  it("reports model errors at their place in the document, with suggestions", () => {
    const doc = shop();
    doc.elements.customer!.uses = [{ to: "web-ap", description: "Buys" }];
    doc.elements.orphan = { kind: "container", name: "Orphan" };
    doc.elements.wrong = { kind: "component", name: "Wrong", parent: "shop" };
    doc.elements.top = { kind: "system", name: "Top", parent: "shop" };
    doc.views.bad = { title: "Bad", level: "component", scope: "shop" };
    doc.views.shop = { title: "Clash", level: "landscape" };
    const found = checkWorkspace(buildWorkspace(doc)).map((d) => `${d.rule} ${d.path}${d.fix?.startsWith("Did") ? ` (${d.fix})` : ""}`);
    expect(found).toEqual([
      "id-duplicate views.shop",
      'relationship-unknown-target elements.customer.uses[0].to (Did you mean "web-app"?)',
      "parent-required elements.orphan.parent",
      "parent-kind elements.wrong.parent",
      "parent-not-allowed elements.top.parent",
      "view-scope-kind views.bad.scope",
    ]);
  });

  it("warns about a shape on a person, which is always drawn as a person", () => {
    const doc = shop();
    doc.elements.customer!.shape = "database";
    expect(rules(doc)).toEqual(["shape-ignored"]);
  });
});

describe("exportDocs", () => {
  const files = exportDocs(buildWorkspace(shop()), "shop.openarch");
  const page = (path: string) => files.find((f) => f.path === path)!.content;

  it("writes an index, one page per view and one per element, each marked as generated", () => {
    expect(files.map((f) => f.path)).toEqual([
      "README.md",
      "views/api-components.md",
      "views/landscape.md",
      "views/shop-containers.md",
      "views/shop-context.md",
      "elements/customer.md",
      "elements/shop.md",
      "elements/web-app.md",
      "elements/api.md",
      "elements/db.md",
      "elements/controller.md",
      "elements/payments.md",
    ]);
    for (const f of files) expect(f.content.startsWith(`${GENERATED_MARKER} from shop.openarch.`)).toBe(true);
  });

  it("puts the Mermaid diagram and linked tables in view pages", () => {
    const text = page("views/shop-containers.md");
    expect(text).toContain("Container view of [Shop](../elements/shop.md).");
    expect(text).toContain("```mermaid\nflowchart TB\n");
    expect(text).toContain("| [API](../elements/api.md) | [DB](../elements/db.md) | Stores orders | SQL |");
  });

  it("quotes a view's sticky notes under its diagram, in reading order", () => {
    const doc = shop();
    doc.views.landscape!.stickies = { later: { text: "Unplaced." }, second: { text: "Lower\n\nright.", at: [300, 100] }, first: { text: "Top.", at: [900, 0] } };
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/landscape.md")!.content;
    expect(text).toContain("```\n\n## Notes\n\n> Top.\n\n> Lower\n>\n> right.\n\n> Unplaced.\n\n## Elements");
    expect(page("views/landscape.md")).not.toContain("## Notes");
  });

  it("puts relationships, contents and views in element pages", () => {
    const text = page("elements/api.md");
    expect(text).toContain("**Container** · Node.js · inside [Shop](shop.md)");
    expect(text).toContain("## Contains\n\n- [Controller](controller.md) (component)");
    expect(text).toContain("- [API components](../views/api-components.md) (as the frame)");
    expect(page("README.md")).toContain("- [Shop](elements/shop.md) (system)\n  - [API](elements/api.md) (container, Node.js)");
  });

  it("lists an element's tags, by name", () => {
    const doc = shop();
    doc.elements.api!.tags = { team: "checkout", pii: "" };
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "elements/api.md")!.content;
    expect(text).toContain("## Tags\n\n| Tag | Value |\n|---|---|\n| pii |  |\n| team | checkout |\n");
    expect(page("elements/db.md")).not.toContain("## Tags");
  });
});
