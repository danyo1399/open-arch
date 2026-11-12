// @vitest-environment happy-dom
import { buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Canvas } from "../src/canvas/Canvas.js";
import type { Edit } from "../src/state.js";
import { button, click, mount } from "./dom.js";

/**
 * An empty view shows a hint over the diagram, near the top, where the + Add menu opens. The menu
 * has to open over it, or the hint hides what's in it.
 */
describe("the hint on an empty view", () => {
  it("is under the + Add menu of a box diagram", async () => {
    const model: OpenArchDocument = { openarch: 11, name: "Empty", elements: {}, views: { landscape: { title: "System landscape", level: "landscape", include: ["*"] } } };
    const ws = buildWorkspace(model);
    const edits: Operation[][] = [];
    const host = mount(
      createElement(
        ReactFlowProvider,
        null,
        createElement(Canvas, {
          ws,
          view: ws.views.get("landscape")!,
          diagnostics: [],
          selection: null,
          onSelect() {},
          edit: async (e: Edit) => {
            edits.push(typeof e === "function" ? e(ws) : e);
            return true;
          },
          onElementMenu() {},
          onArrowMenu() {},
          onError() {},
          renames: [],
          exportItems: [],
        }),
      ),
    );
    await act(async () => {});
    await click(button(host, "+ Add"));
    // React Flow draws the diagram in a layer of its own, which the hint sits over. A menu inside
    // that layer can't be drawn over the hint, however high its z-index, so it opens on the page.
    expect(host.querySelector(".react-flow .context-menu, .react-flow .menu-items")).toBeNull();
    const items = [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(["Person", "Software system", "Sticky note"]);
    await click(items[0]!);
    expect(edits.flat().map((op) => op.op)).toContain("add-element");
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("is under a sequence view's toolbar, so the + Add step form opens over it", () => {
    // The hint and the toolbar are drawn in the same layer, so the higher z-index is on top.
    // Read from the stylesheet, as this page draws nothing.
    const css = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    const z = (selector: string) => Number(new RegExp(`\\n${selector.replace(/\./g, "\\.")} \\{[^}]*z-index: (\\d+)`).exec(css)?.[1]);
    expect(z(".empty-hint")).toBeLessThan(z(".sequence-toolbar"));
  });
});
