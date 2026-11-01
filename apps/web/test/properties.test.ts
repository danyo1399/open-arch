import { buildWorkspace, computeView, type OpenArchDocument } from "@open-arch/core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { Properties } from "../src/panels/Properties.js";

const doc: OpenArchDocument = {
  openarch: 4,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things", notes: "Pays by **card**." }] },
    shop: { kind: "system", name: "Shop" },
  },
  views: { landscape: { title: "Landscape", description: "Everything.", level: "landscape", notes: "Drawn for **new starters**." } },
};

/** The details panel, with the landscape view open, showing what's selected. */
function render(selection: Selection): string {
  const ws = buildWorkspace(doc);
  const view = ws.views.get("landscape")!;
  return renderToString(
    createElement(Properties, {
      ws,
      view,
      computed: computeView(ws, view),
      selection,
      isNew: false,
      syncsDocs: false,
      docs: null,
      fileName: "shop.openarch",
      edit: async () => true,
      onSelect() {},
      onHide() {},
      onDelete() {},
      onFindUsages() {},
      onDeleteView() {},
    }),
  );
}

/** The text in the box with this label. */
function box(html: string, label: string): string | undefined {
  return new RegExp(`<textarea[^>]*aria-label="${label}"[^>]*>([^<]*)</textarea>`).exec(html)?.[1];
}

describe("Properties", () => {
  it("shows a view's description and notes, to edit", () => {
    const html = render(null);
    expect(box(html, "Description")).toBe("Everything.");
    expect(box(html, "Notes")).toBe("Drawn for **new starters**.");
  });

  it("shows an arrow's relationship notes, to edit", () => {
    expect(box(render({ kind: "arrow", from: "customer", to: "shop" }), "Notes")).toBe("Pays by **card**.");
  });
});
