// @vitest-environment happy-dom
import { buildWorkspace, computeView, type ArchElement, type OpenArchDocument, type Operation } from "@open-arch/core";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { addableKinds, withFrame, type Selection } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, FrameFlowNode } from "../src/canvas/nodes.js";
import { deletePlan, followRenames, renamesBetween, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { checkbox, choose, click, mount } from "./dom.js";

/** A shop whose API is built with a logging library, and whose web app isn't. */
const shop: OpenArchDocument = {
  openarch: 7,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    api: { kind: "container", name: "API", parent: "shop", libraries: ["logging"] },
    web: { kind: "container", name: "Web app", parent: "shop" },
    orders: { kind: "component", name: "Orders", parent: "api" },
    logging: { kind: "library", name: "Logging" },
    logger: { kind: "class", name: "Logger", parent: "logging" },
  },
  views: {
    components: { title: "Components", level: "component", scope: "api" },
    "web-components": { title: "Web components", level: "component", scope: "web" },
    containers: { title: "Containers", level: "container", scope: "shop" },
  },
};
const ws = buildWorkspace(shop);

describe("a library on the diagram", () => {
  it("is drawn inside the frame of a container built with it", () => {
    const element = (id: string): ElementFlowNode => ({ id, type: "element", position: { x: 0, y: 0 }, data: { element: ws.elements.get(id)!, problems: 0 } });
    const nodes = withFrame([element("orders"), { ...element("logging"), position: { x: 0, y: 400 } }], ws.elements.get("api"));
    const frame = nodes.find((n): n is FrameFlowNode => n.type === "frame")!;
    expect(frame.data.height).toBeGreaterThan(400);
  });

  it("can be added to a component view, built into its container", () => {
    expect(addableKinds(ws, ws.views.get("components")!)).toContainEqual({ kind: "library", builtInto: "api", label: "Library built into API" });
  });

  it("is shown and hidden only where a view could draw it", () => {
    const action = (view: string, id: string) => viewAction(ws, ws.views.get(view)!, computeView(ws, ws.views.get(view)!), id);
    expect(action("components", "logging")).toBe("hide");
    expect(action("web-components", "logging")).toBeNull();
    expect(action("containers", "logging")).toBeNull();
    expect(action("components", "logger")).toBeNull();
  });
});

describe("a library in the model", () => {
  it("follows renames into the containers built with it", () => {
    const renames = [{ op: "rename" as const, id: "logging", to: "logs" }];
    expect(followRenames([{ op: "update-element", id: "web", libraries: ["logging"] }], renames)).toEqual([{ op: "update-element", id: "web", libraries: ["logs"] }]);
    const renamed = buildWorkspace({ ...shop, elements: { ...shop.elements, api: { ...shop.elements.api!, libraries: ["logs"] }, logs: shop.elements.logging!, logger: { ...shop.elements.logger!, parent: "logs" } } });
    delete renamed.doc.elements.logging;
    expect(renamesBetween(ws, buildWorkspace(renamed.doc))).toEqual(renames);
  });

  it("says which containers deleting it takes it out of", () => {
    expect(deletePlan(ws, "logging").builtWith.map((e: ArchElement) => e.id)).toEqual(["api"]);
    expect(deletePlan(ws, "api").builtWith).toEqual([]);
  });
});

/** The details panel showing an element, keeping the edits it sends. */
function panel(id: string) {
  const edits: Operation[][] = [];
  const view = ws.views.get("components")!;
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection: { kind: "element", id } as Selection,
    isNew: false,
    syncsDocs: false,
    docs: null,
    fileName: "shop.openarch",
    edit: async (e: Edit) => {
      edits.push(typeof e === "function" ? e(ws) : e);
      return true;
    },
    onSelect() {},
    onHide() {},
    onDelete() {},
    onFindUsages() {},
    onDeleteView() {},
  });
  return { host: mount(element), edits };
}

describe("a library's details", () => {
  it("builds containers with it, or takes it out of them", async () => {
    const { host, edits } = panel("logging");
    expect(checkbox(host, "API").checked).toBe(true);
    await click(checkbox(host, "Web app"));
    await click(checkbox(host, "API"));
    expect(edits).toEqual([[{ op: "update-element", id: "web", libraries: ["logging"] }], [{ op: "update-element", id: "api", libraries: [] }]]);
    expect(() => checkbox(host, "Outside our organisation (external)")).toThrow();
  });

  it("are on a container's too, as its libraries", async () => {
    const { host, edits } = panel("web");
    await click(checkbox(host, "Logging"));
    expect(edits).toEqual([[{ op: "update-element", id: "web", libraries: ["logging"] }]]);
  });

  it("offer a library as a class's parent", () => {
    const { host } = panel("logger");
    const inside = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Inside")!;
    expect([...inside.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Logging", "Orders"]);
  });
});

describe("the New view dialog", () => {
  it("makes a class view of a library", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "class");
    expect(host.textContent).toContain("Of which component or library");
    const scope = host.querySelectorAll("select")[1]!;
    expect([...scope.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Logging", "Orders"]);
    await choose(scope, "logging");
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Create view")!);
    expect(created).toEqual([{ op: "add-view", id: "logging-classes", level: "class", scope: "logging", title: "Logging classes" }]);
  });
});
