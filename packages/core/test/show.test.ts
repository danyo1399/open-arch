import { describe, expect, it } from "vitest";
import { computeView, showElement, showView, showWorkspace } from "../src/index.js";
import { shop, ws } from "./helpers.js";

describe("what show says", () => {
  it("of a workspace: the model as a tree and the views, calling the file what it's given", () => {
    const shown = showWorkspace(ws(), "docs/shop.openarch");
    expect(shown.text.split("\n")[0]).toBe("Shop: docs/shop.openarch (7 elements, 4 views)");
    // A container is under its system, and a component under its container.
    expect(shown.text).toMatch(/\n  shop +system +Shop\n    api +container +API \[Node\.js\]\n      controller +component +Controller\n/);
    expect(shown.text).toMatch(/\n  shop-containers +container view of shop +Shop containers\n/);
    // Which command or tool shows one of them is for whoever prints this to say.
    expect(shown.text.endsWith("Shop context\n")).toBe(true);
    expect(shown.json).toEqual({
      elements: expect.arrayContaining([{ id: "db", kind: "container", name: "DB", technology: undefined, external: undefined, parent: "shop" }]),
      views: expect.arrayContaining([{ id: "landscape", title: "Landscape", level: "landscape", scope: undefined }]),
    });
  });

  it("of an element: its fields, what it uses and what uses it, and the views showing it", () => {
    const model = ws();
    const shown = showElement(model, model.elements.get("controller")!);
    expect(shown.text).toContain("controller: Controller\n  kind:        component\n  parent:      api (API)\n");
    expect(shown.text).toMatch(/Uses:\n  -> db +Stores orders \[SQL\]\n  -> payments +Charges cards\n/);
    expect(shown.text).toMatch(/Used by:\n  <- web-app +Places orders\n/);
    expect(shown.text).toContain("Shown in views:\n  api-components\n");
    expect(shown.json).toMatchObject({ id: "controller", kind: "component", uses: [{ to: "db", technology: "SQL", known: true }, { to: "payments" }], usedBy: [{ from: "web-app" }] });
  });

  it("of a view: its boxes and arrows, and for another level what that level holds", () => {
    const model = ws();
    const containers = showView(model, computeView(model, model.views.get("shop-containers")!));
    expect(containers.text).toContain("shop-containers: Shop containers\n  level:        container view of shop (Shop)\n");
    expect(containers.text).toMatch(/\n  customer -> web-app +Buys things \[HTTPS\]\n/);
    // An arrow that stands for a relationship of something inside a box says which.
    expect(containers.text).toMatch(/web-app -> api +Places orders +\(via web-app -> controller\)/);
    expect(containers.json).toMatchObject({ id: "shop-containers", level: "container", frame: "shop", boxes: expect.arrayContaining([expect.objectContaining({ id: "api" })]) });

    const doc = shop();
    doc.views.ordering = { title: "Ordering", level: "sequence", steps: [{ from: "customer", to: "web-app", description: "Asks for the basket" }] };
    const steps = ws(doc);
    const sequence = showView(steps, computeView(steps, steps.views.get("ordering")!));
    expect(sequence.text).toMatch(/Steps:\n  1\. +customer -> web-app +Asks for the basket \[HTTPS\]\n/);
    expect(sequence.json).toMatchObject({ level: "sequence", steps: [{ step: 1, from: "customer", to: "web-app" }] });
  });
});
