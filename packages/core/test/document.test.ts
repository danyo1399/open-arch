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
    expect(ws.elements.size).toBe(10);
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
        openarch: 2,
        name: "X",
        colour: "red",
        elements: {
          Good_ID: { kind: "system", name: "Bad id" },
          ok: { kind: "system", name: "OK", tags: "database", owner: "me", uses: [{ to: "x", desc: "typo" }, "y"] },
          what: { kind: "box", name: "What" },
        },
        views: { v: { title: "V", level: "landscape", layout: { ok: [1, "2"] } } },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-unknown colour",
      "version-unsupported openarch",
      "id-format elements.Good_ID",
      "field-unknown elements.ok.owner",
      "field-type elements.ok.tags",
      "field-unknown elements.ok.uses[0].desc",
      "field-type elements.ok.uses[1]",
      "kind-invalid elements.what.kind",
      "field-type views.v.layout.ok",
    ]);
    expect(Object.keys(result.doc.elements)).toEqual(["ok"]);
    expect(result.doc.elements.ok!.uses).toEqual([{ to: "x" }]);
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
    doc.elements.shop!.tags = [];
    const text = serializeDocument(doc);
    expect(text).toContain('        { "to": "db", "description": "Stores orders", "technology": "SQL" },\n');
    expect(text).toContain('      "layout": {\n        "customer": [0, 0],\n        "shop": [10, 21]\n      }');
    expect(text).toContain('    "shop": {\n      "kind": "system",\n      "name": "Shop"\n    },');
    expect(text).toContain('"include": ["*"]');
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("keeps notes as one JSON string", () => {
    const doc = shop();
    doc.elements.api!.notes = 'Line one.\n\nSays "hi".';
    expect(serializeDocument(doc)).toContain('"notes": "Line one.\\n\\nSays \\"hi\\"."');
  });
});
