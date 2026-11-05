import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkWorkspace, loadWorkspace, parseDocument, serializeDocument } from "../src/index.js";
import { shop } from "./helpers.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/shop/shop.openarch", import.meta.url));

describe("parseDocument", () => {
  it("reads the example cleanly", () => {
    const ws = loadWorkspace(readFileSync(EXAMPLE, "utf8"));
    expect(ws.valid).toBe(true);
    expect(ws.elements.size).toBe(17);
    expect(checkWorkspace(ws)).toEqual([]);
  });

  it("reports invalid JSON", () => {
    const result = parseDocument("{ nope");
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]!.rule).toBe("json-invalid");
  });

  it("reports every shape problem and leaves the bad parts out", () => {
    const result = parseDocument(
      JSON.stringify({
        openarch: 8,
        name: "X",
        colour: "red",
        elements: {
          Good_ID: { kind: "system", name: "Bad id" },
          ok: { kind: "system", name: "OK", shape: "cylinder", tags: ["database"], owner: "me", uses: [{ to: "x", desc: "typo" }, "y"] },
          what: { kind: "box", name: "What" },
        },
        views: {
          v: {
            title: "V",
            level: "landscape",
            stickies: { fine: { text: "Fine", color: "blue" }, empty: { text: " " }, odd: { text: "Odd", color: "red", at: [1], size: 2 } },
            layout: { ok: [1, "2"] },
          },
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-unknown colour",
      "version-unsupported openarch",
      "id-format elements.Good_ID",
      "field-unknown elements.ok.owner",
      "shape-invalid elements.ok.shape",
      "field-type elements.ok.tags",
      "field-unknown elements.ok.uses[0].desc",
      "field-type elements.ok.uses[1]",
      "kind-invalid elements.what.kind",
      "field-required views.v.stickies.empty.text",
      "field-unknown views.v.stickies.odd.size",
      "color-invalid views.v.stickies.odd.color",
      "field-type views.v.stickies.odd.at",
      "field-type views.v.layout.ok",
    ]);
    expect(result.doc.views.v!.stickies).toEqual({ fine: { text: "Fine", color: "blue" }, odd: { text: "Odd" } });
    expect(Object.keys(result.doc.elements)).toEqual(["ok"]);
    expect(result.doc.elements.ok!.uses).toEqual([{ to: "x" }]);
    expect(result.diagnostics.find((d) => d.path === "elements.ok.tags")!.fix).toMatch(/"shape": "database"/);
    // Relationships have no shape, so their hint doesn't suggest one.
    const rel = parseDocument(JSON.stringify({ openarch: 7, name: "X", elements: { a: { kind: "system", name: "A", uses: [{ to: "a", tags: ["sync"] }] } }, views: {} }));
    expect(rel.diagnostics.map((d) => [d.path, d.fix])).toEqual([["elements.a.uses[0].tags", 'Give a tag without a value "" as its value.']]);
  });

  it("upgrades version 1: the database tag becomes a shape, and properties become tags", () => {
    const result = parseDocument(
      JSON.stringify({
        openarch: 1,
        name: "Old",
        elements: {
          customer: { kind: "person", name: "Customer", tags: ["database"], uses: [{ to: "db", description: "Reads", tags: ["async"] }] },
          shop: { kind: "system", name: "Shop", tags: ["core"], properties: { owner: "payments", core: "yes" } },
          db: { kind: "container", name: "DB", parent: "shop", tags: ["database"] },
        },
        views: {},
      }),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.doc.openarch).toBe(7);
    expect(result.doc.elements).toEqual({
      customer: { kind: "person", name: "Customer", tags: { database: "" }, uses: [{ to: "db", description: "Reads", tags: { async: "" } }] },
      shop: { kind: "system", name: "Shop", tags: { core: "yes", owner: "payments" } },
      db: { kind: "container", name: "DB", parent: "shop", shape: "database" },
    });
    expect(serializeDocument(result.doc)).toContain('"openarch": 7,');
  });

  it.each([2, 3, 4, 5, 6])("reads version %i as it is, and writes it back as version 7", (version) => {
    const old = { openarch: version, name: "Old", elements: { a: { kind: "system", name: "A", uses: [{ to: "b", description: "Uses" }] }, b: { kind: "system", name: "B" } }, views: {} };
    const result = parseDocument(JSON.stringify(old));
    expect(result.diagnostics).toEqual([]);
    expect(result.doc).toEqual({ ...old, openarch: 7 });
    expect(serializeDocument(result.doc)).toContain('"openarch": 7,');
  });

  it("reads notes on views and relationships, and reports ones that aren't text", () => {
    const result = parseDocument(
      JSON.stringify({
        openarch: 7,
        name: "X",
        elements: { a: { kind: "system", name: "A", uses: [{ to: "b", notes: "Over **HTTPS**." }, { to: "b", description: "Other", notes: 5 }] }, b: { kind: "system", name: "B" } },
        views: { v: { title: "V", level: "landscape", notes: "## Why\n\nTo show it." }, w: { title: "W", level: "landscape", notes: ["x"] } },
      }),
    );
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["field-type elements.a.uses[1].notes", "field-type views.w.notes"]);
    expect(result.doc.elements.a!.uses).toEqual([{ to: "b", notes: "Over **HTTPS**." }, { to: "b", description: "Other" }]);
    expect(result.doc.views.v!.notes).toBe("## Why\n\nTo show it.");
    expect(result.doc.views.w).not.toHaveProperty("notes");
  });

  it("reports what it can't upgrade in version 1's terms, and keeps the rest", () => {
    const result = parseDocument(
      JSON.stringify({
        openarch: 1,
        name: "Old",
        elements: {
          a: { kind: "system", name: "A", tags: "x", properties: ["y"] },
          b: { kind: "system", name: "B", tags: { x: "" }, properties: { owner: "me" }, uses: [{ to: "a", description: "Uses", tags: "z" }] },
          c: { kind: "system", name: "C", tags: ["core"], properties: { owner: 5 } },
        },
        views: {},
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => `${d.path}: ${d.message}`)).toEqual([
      "elements.a.tags: Must be a list of strings.",
      "elements.a.properties: Must be an object of string values.",
      "elements.b.tags: Must be a list of strings.",
      "elements.b.uses[0].tags: Must be a list of strings.",
      "elements.c.properties: Must be an object of string values.",
    ]);
    expect(result.doc.elements.b).toEqual({ kind: "system", name: "B", tags: { owner: "me" }, uses: [{ to: "a", description: "Uses" }] });
    expect(result.doc.elements.c!.tags).toEqual({ core: "" });
  });

  it("trims names as it upgrades, so every tag can be removed later", () => {
    const result = parseDocument(JSON.stringify({ openarch: 1, name: "Old", elements: { a: { kind: "system", name: "A", tags: [" core ", " "], properties: { "owner ": "x" } } }, views: {} }));
    expect(result.doc.elements.a!.tags).toEqual({ core: "", owner: "x" });
  });
});

describe("serializeDocument", () => {
  it("writes the same text every time, in reading order", () => {
    const text = serializeDocument(shop());
    expect(serializeDocument(parseDocument(text).doc)).toBe(text);
    const order = [...text.matchAll(/^ {4}"([a-z-]+)": \{$/gm)].map((m) => m[1]);
    expect(order).toEqual(["customer", "payments", "shop", "api", "controller", "db", "web-app", "api-components", "landscape", "shop-containers", "shop-context"]);
  });

  it("keeps one relationship and one position per line, and drops empty fields", () => {
    const doc = shop();
    doc.views.landscape!.layout = { shop: [10.4, 20.6], customer: [0, 0] };
    doc.elements.shop!.description = "";
    doc.elements.shop!.tags = {};
    doc.elements.api!.shape = "box";
    const text = serializeDocument(doc);
    expect(text).toContain('        { "to": "db", "description": "Stores orders", "technology": "SQL" },\n');
    doc.elements.controller!.uses![0]!.notes = "Line one.\nLine two.";
    doc.elements.controller!.uses![0]!.tags = { sync: "" };
    doc.views.landscape!.notes = "Why it's drawn.";
    doc.views.landscape!.exclude = ["payments"];
    doc.views.landscape!.stickies = { hi: { text: "Hi" } };
    const noted = serializeDocument(doc);
    expect(noted).toContain('        { "to": "db", "description": "Stores orders", "technology": "SQL", "tags": { "sync": "" }, "notes": "Line one.\\nLine two." },\n');
    expect(noted).toContain('      "exclude": ["payments"],\n      "notes": "Why it\'s drawn.",\n      "stickies": {');
    expect(serializeDocument(parseDocument(noted).doc)).toBe(noted);
    expect(text).toContain('      "layout": {\n        "customer": [0, 0],\n        "shop": [10, 21]\n      }');
    expect(text).toContain('    "shop": {\n      "kind": "system",\n      "name": "Shop"\n    },');
    expect(text).toContain('    "api": {\n      "kind": "container",\n      "name": "API",\n      "parent": "shop",\n      "technology": "Node.js"\n    },');
    expect(text).toContain('"include": ["*"]');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("keeps one sticky note per line, by ID, before the layout", () => {
    const doc = shop();
    doc.views.landscape!.layout = { shop: [0, 0] };
    doc.views.landscape!.stickies = { tip: { text: "Two\nlines", color: "yellow", at: [1.6, 2] }, about: { text: "About", color: "green" } };
    expect(serializeDocument(doc)).toContain(
      '      "stickies": {\n        "about": { "text": "About", "color": "green" },\n        "tip": { "text": "Two\\nlines", "at": [2, 2] }\n      },\n      "layout": {',
    );
  });

  it("writes the shape, element tags one per line and relationship tags inline, by name", () => {
    const doc = shop();
    doc.elements.api!.tags = { team: "checkout", pii: "" };
    doc.elements.customer!.uses![0]!.tags = { sync: "", protocol: "https" };
    const text = serializeDocument(doc);
    expect(text).toContain('      "parent": "shop",\n      "shape": "database"\n    },');
    expect(text).toContain('      "technology": "Node.js",\n      "tags": {\n        "pii": "",\n        "team": "checkout"\n      }\n    },');
    expect(text).toContain('{ "to": "web-app", "description": "Buys things", "technology": "HTTPS", "tags": { "protocol": "https", "sync": "" } }');
  });

  it("keeps notes as one JSON string", () => {
    const doc = shop();
    doc.elements.api!.notes = 'Line one.\n\nSays "hi".';
    expect(serializeDocument(doc)).toContain('"notes": "Line one.\\n\\nSays \\"hi\\"."');
  });
});
