// @vitest-environment happy-dom
import { applyOperations, buildWorkspace, computeView, type ArchElement, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { addableKinds, addElementOps, withFrame, type Selection } from "../src/canvas/Canvas.js";
import type { ElementFlowNode, FrameFlowNode } from "../src/canvas/nodes.js";
import { buildOps, deletePlan, followRenames, renamesBetween, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, mount } from "./dom.js";

/** A shop whose API is built with a logging library, and whose web app isn't. */
const shop: OpenArchDocument = {
  openarch: 21,
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

  it("can be added to a container view, built into nothing yet", () => {
    expect(addableKinds(ws, ws.views.get("containers")!)).toEqual([
      { kind: "container", parent: "shop", label: "Container in Shop" },
      { kind: "library", label: "Shared library" },
      { kind: "person", label: "Person" },
      { kind: "system", label: "Software system" },
    ]);
  });

  it("is added to a component view as a box, and its container is built with it", () => {
    const layout = { orders: [0, 0] as [number, number] };
    expect(addElementOps(ws, ws.views.get("components")!, "new-library", { kind: "library", builtInto: "api" }, layout, { x: 40, y: 200 })).toEqual([
      { op: "add-element", id: "new-library", kind: "library", parent: undefined, name: "New library" },
      { op: "update-element", id: "api", libraries: ["logging", "new-library"] },
      { op: "show-in-view", view: "components", id: "new-library" },
      { op: "set-layout", view: "components", positions: { orders: [0, 0], "new-library": [40, 200] } },
    ]);
  });

  it("is added from a container view to the model only, as that view draws no libraries", () => {
    const ops = addElementOps(ws, ws.views.get("containers")!, "new-library", { kind: "library" }, { api: [0, 0] }, { x: 40, y: 200 });
    expect(ops).toEqual([{ op: "add-element", id: "new-library", kind: "library", parent: undefined, name: "New library" }]);
    expect(applyOperations(shop, ops).doc.elements["new-library"]).toEqual({ kind: "library", name: "New library" });
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

  it("is built into a container, or taken out, from the container's libraries when the edit runs", () => {
    // The web app got a library of its own after the details that sent the tick were drawn.
    const now = buildWorkspace({ ...shop, elements: { ...shop.elements, web: { ...shop.elements.web!, libraries: ["metrics"] }, metrics: { kind: "library", name: "Metrics" } } });
    expect(buildOps(now, "web", "logging", true)).toEqual([{ op: "update-element", id: "web", libraries: ["metrics", "logging"] }]);
    expect(buildOps(now, "web", "metrics", false)).toEqual([{ op: "update-element", id: "web", libraries: [] }]);
    // Already so, or no such container by then: nothing to do.
    expect(buildOps(now, "web", "metrics", true)).toEqual([]);
    expect(buildOps(now, "api", "metrics", false)).toEqual([]);
    expect(buildOps(now, "gone", "metrics", true)).toEqual([]);
    expect(buildOps(now, "logging", "metrics", true)).toEqual([]);
  });

  it("says which containers deleting it takes it out of", () => {
    expect(deletePlan(ws, "logging").builtWith.map((e: ArchElement) => e.id)).toEqual(["api"]);
    expect(deletePlan(ws, "api").builtWith).toEqual([]);
  });
});

/**
 * The details panel showing an element of `ws`, keeping the edits it sends, the containers it
 * asks for a new library in, and the ticks it asks for. A library is added once `added` resolves.
 */
function panel(id: string, ws = buildWorkspace(shop), added: Promise<void> = Promise.resolve()) {
  const edits: Operation[][] = [];
  const newLibraries: string[] = [];
  const built: [container: string, library: string, built: boolean][] = [];
  const view = ws.views.get("components")!;
  const element = createElement(Properties, {
    ws,
    view,
    computed: computeView(ws, view),
    selection: { kind: "element", id } as Selection,
    isNew: false,
    syncsDocs: false,
    syncsSkill: false,
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
    onNewView() {},
    onNewLibrary: (container: string) => {
      newLibraries.push(container);
      return added;
    },
    onBuild: (container: string, library: string, with_: boolean) => void built.push([container, library, with_]),
    onAddSticky() {},
    onDeleteView() {},
    onEditNotes() {},
  });
  return { host: mount(element), edits, newLibraries, built };
}

describe("a library's details", () => {
  it("builds containers with it, or takes it out of them", async () => {
    const { host, built } = panel("logging");
    expect(checkbox(host, "API").checked).toBe(true);
    await click(checkbox(host, "Web app"));
    await click(checkbox(host, "API"));
    expect(built).toEqual([
      ["web", "logging", true],
      ["api", "logging", false],
    ]);
    expect(() => checkbox(host, "Outside our organisation (external)")).toThrow();
  });

  it("are on a container's too, as its libraries", async () => {
    const { host, built } = panel("web");
    await click(checkbox(host, "Logging"));
    expect(built).toEqual([["web", "logging", true]]);
  });

  it("ask for a new library in a container, once for a double-click", async () => {
    let done = () => {};
    const { host, newLibraries } = panel("web", ws, new Promise<void>((resolve) => (done = resolve)));
    await click(button(host, "+ New library"));
    expect(button(host, "+ New library").disabled).toBe(true);
    await click(button(host, "+ New library"));
    expect(newLibraries).toEqual(["web"]);
    await act(async () => done());
    expect(button(host, "+ New library").disabled).toBe(false);
  });

  it("offer a container's first library, in a workspace with none", () => {
    const { logging: _logging, logger: _logger, ...elements } = shop.elements;
    const none = buildWorkspace({ ...shop, elements: { ...elements, api: { kind: "container", name: "API", parent: "shop" } } });
    const { host } = panel("api", none);
    expect(host.textContent).toContain("Libraries");
    expect(button(host, "+ New library").disabled).toBe(false);
  });

  it("offer a library as a class's parent", () => {
    const { host } = panel("logger");
    const inside = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Inside")!;
    expect([...inside.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Logging", "Orders"]);
  });

  it("offer a library as a component's parent", () => {
    const { host } = panel("orders");
    const inside = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === "Inside")!;
    expect([...inside.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["API", "Logging", "Web app"]);
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

describe("a library with components", () => {
  const sdk = buildWorkspace({
    ...shop,
    elements: { ...shop.elements, sdk: { kind: "library", name: "SDK" }, http: { kind: "component", name: "HTTP", parent: "sdk" }, fetcher: { kind: "class", name: "Fetcher", parent: "http" } },
    views: { ...shop.views, "sdk-components": { title: "SDK components", level: "component", scope: "sdk" }, "http-classes": { title: "HTTP classes", level: "class", scope: "http" } },
  });

  it("adds components and classes on its component view, and components on its components' class views", () => {
    expect(addableKinds(sdk, sdk.views.get("sdk-components")!).slice(0, 2)).toEqual([
      { kind: "component", parent: "sdk", label: "Component in SDK" },
      { kind: "class", parent: "sdk", label: "Class in SDK" },
    ]);
    expect(addableKinds(sdk, sdk.views.get("http-classes")!).slice(0, 2)).toEqual([
      { kind: "class", parent: "http", label: "Class in HTTP" },
      { kind: "component", parent: "sdk", label: "Component in SDK" },
    ]);
  });

  it("hides its components on its component view, and shows what's outside as itself", () => {
    const view = sdk.views.get("sdk-components")!;
    const action = (id: string) => viewAction(sdk, view, computeView(sdk, view), id);
    expect(action("http")).toBe("hide");
    expect(["orders", "api"].map(action)).toEqual(["show", "show"]);
    expect(["sdk", "fetcher"].map(action)).toEqual([null, null]);
  });
});
