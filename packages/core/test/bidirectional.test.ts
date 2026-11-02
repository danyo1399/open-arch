import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, computeView, exportDocs, parseDocument, parseOperations, renderMermaid, serializeDocument, stepRelationships, type OpenArchDocument } from "../src/index.js";
import { apply, rules } from "./helpers.js";

/** We publish content to a CMS, and it calls us back. The API has a component that does the calling. */
function site(): OpenArchDocument {
  return {
    openarch: 5,
    name: "Site",
    elements: {
      site: { kind: "system", name: "Site" },
      api: { kind: "container", name: "API", parent: "site" },
      publisher: { kind: "component", name: "Publisher", parent: "api", uses: [{ to: "cms", bidirectional: true, description: "Syncs pages with", technology: "HTTPS" }] },
      cms: { kind: "system", name: "CMS", external: true, uses: [{ to: "api", description: "Sends webhooks to" }] },
      editor: { kind: "person", name: "Editor", uses: [{ to: "cms", description: "Writes pages in" }] },
    },
    views: {
      context: { title: "Context", level: "context", scope: "site" },
      containers: { title: "Containers", level: "container", scope: "site" },
    },
  };
}

const view = (doc: OpenArchDocument, id: string) => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

describe("relationships that go both ways", () => {
  it("are read and written, after the target", () => {
    const text = serializeDocument(site());
    expect(text).toContain('{ "to": "cms", "bidirectional": true, "description": "Syncs pages with", "technology": "HTTPS" }');
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.elements).toEqual(site().elements);
    const bad = parseDocument(JSON.stringify({ ...site(), elements: { a: { kind: "system", name: "A", uses: [{ to: "b", bidirectional: "yes" }] }, b: { kind: "system", name: "B" } } }));
    expect(bad.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["field-type elements.a.uses[0].bidirectional"]);
    expect(rules(site())).toEqual([]);
  });

  it("are drawn as one arrow with a head at each end, standing for every relationship between the two boxes", () => {
    const cv = view(site(), "context");
    expect(cv.edges).toEqual([
      {
        from: "site",
        to: "cms",
        description: "Syncs pages with; Sends webhooks to",
        technology: "HTTPS",
        implied: true,
        bidirectional: true,
        sources: [
          { element: "publisher", index: 0 },
          { element: "cms", index: 0 },
        ],
      },
    ]);
    // In the container view the webhook goes straight to the API, so its arrow isn't implied.
    expect(view(site(), "containers").edges.find((e) => e.to === "cms")).toMatchObject({ from: "api", bidirectional: true, implied: false });
  });

  it("keep arrows one-way when no relationship between the boxes goes both ways", () => {
    const doc = apply(site(), { op: "update-relationship", from: "publisher", to: "cms", bidirectional: false });
    expect(doc.elements.publisher!.uses![0]).not.toHaveProperty("bidirectional");
    expect(view(doc, "context").edges.map((e) => `${e.from}>${e.to} ${e.bidirectional}`)).toEqual(["cms>site false", "site>cms false"]);
  });

  it("are set and cleared by operations, and checked as JSON", () => {
    let doc = apply(site(), { op: "add-relationship", from: "editor", to: "site", bidirectional: true, description: "Reviews pages with" });
    expect(doc.elements.editor!.uses![1]).toEqual({ to: "site", bidirectional: true, description: "Reviews pages with" });
    doc = apply(doc, { op: "update-relationship", from: "editor", to: "site", bidirectional: false });
    expect(doc.elements.editor!.uses![1]).toEqual({ to: "site", description: "Reviews pages with" });
    expect(() => parseOperations({ op: "add-relationship", from: "a", to: "b", bidirectional: "yes" })).toThrow('add-relationship: "bidirectional" must be true or false.');
  });

  it("back steps either way, as calls or replies", () => {
    const ws = buildWorkspace(site());
    expect(stepRelationships(ws, "cms", "publisher")).toEqual([{ element: "publisher", index: 0 }]);
    expect(stepRelationships(ws, "api", "cms")).toEqual([{ element: "publisher", index: 0 }]);
    expect(stepRelationships(ws, "cms", "api").sort((a, b) => a.element.localeCompare(b.element))).toEqual([
      { element: "cms", index: 0 },
      { element: "publisher", index: 0 },
    ]);
    // The webhook goes one way only.
    expect(stepRelationships(ws, "editor", "cms", true)).toEqual([]);
    const doc = apply(
      site(),
      { op: "add-view", id: "publish", level: "sequence" },
      { op: "add-step", view: "publish", from: "cms", to: "publisher" },
      { op: "add-step", view: "publish", from: "publisher", to: "cms", reply: true },
    );
    expect(view(doc, "publish").steps.map((s) => [s.label, s.sources])).toEqual([
      ["Syncs pages with", [{ element: "publisher", index: 0 }]],
      [undefined, [{ element: "publisher", index: 0 }]],
    ]);
  });

  it("show both heads in Mermaid, and say they go both ways in the docs", () => {
    expect(renderMermaid(view(site(), "context"))).toContain('  site <-->|"Syncs pages with; Sends webhooks to<br/>[HTTPS]"| cms');
    const files = exportDocs(buildWorkspace(site()), "site.openarch");
    const page = (path: string) => files.find((f) => f.path === path)!.content;
    expect(page("views/context.md")).toContain("| [Site](../elements/site.md) | [CMS](../elements/cms.md) | Syncs pages with; Sends webhooks to (both ways) | HTTPS |");
    expect(page("elements/publisher.md")).toContain("| [CMS](cms.md) | Syncs pages with (both ways) | HTTPS |");
    expect(page("elements/cms.md")).toContain("| [Publisher](publisher.md) | Syncs pages with (both ways) | HTTPS |");
    const noted = site();
    noted.elements.publisher!.uses![0]!.notes = "Every five minutes.";
    expect(exportDocs(buildWorkspace(noted), "site.openarch").find((f) => f.path === "elements/publisher.md")!.content).toContain("### Publisher ↔ CMS: Syncs pages with");
  });

  it("are upgraded from version 4 files, which mean the same", () => {
    const result = parseDocument(JSON.stringify({ ...site(), openarch: 4 }));
    expect(result.diagnostics).toEqual([]);
    expect(applyOperations(result.doc, [{ op: "update-workspace", name: "Site 2" }]).doc.openarch).toBe(5);
  });
});
