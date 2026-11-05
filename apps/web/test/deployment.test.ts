// @vitest-environment happy-dom
import { buildWorkspace, computeView, type OpenArchDocument, type Operation } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import type { Selection } from "../src/canvas/Canvas.js";
import { arrowSelected, boxEnd, deploymentConnectOps, DeploymentDiagram } from "../src/canvas/DeploymentDiagram.js";
import { boxHeight, elkDeployment, holdsAnything, layOutDeployment, placeDeploymentLabels, rowsDeployment } from "../src/canvas/deploymentLayout.js";
import { findUsages, followRenames, renamedSelection, shownInProperties, uniqueNodeId, viewAction } from "../src/model.js";
import { NewViewDialog } from "../src/panels/dialogs.js";
import { Properties } from "../src/panels/Properties.js";
import type { Edit } from "../src/state.js";
import { button, checkbox, choose, click, mount, select, type } from "./dom.js";

/** A web app and an API in a cluster in a cloud region, a database beside it, behind a load balancer. */
const doc: OpenArchDocument = {
  openarch: 10,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop", uses: [{ to: "db", description: "Stores orders", technology: "SQL" }] },
    db: { kind: "container", name: "DB", parent: "shop", shape: "database" },
    customer: { kind: "person", name: "Customer" },
  },
  views: {
    production: {
      title: "Production",
      level: "deployment",
      nodes: {
        cloud: { name: "Cloud", technology: "AWS" },
        cluster: { name: "Cluster", parent: "cloud", instances: 3, runs: ["web", "api"] },
        database: { name: "Database server", parent: "cloud", runs: ["db"] },
        lb: { name: "Load balancer", parent: "cloud", infrastructure: true, shape: "server" },
      },
      connections: [{ from: "lb", to: "web", description: "Forwards requests to" }],
    },
  },
};
const ws = buildWorkspace(doc);
const view = ws.views.get("production")!;
const computed = computeView(ws, view);
const d = computed.deployment!;

/** The details panel for the deployment view, showing what's selected, keeping the edits it sends and what it selects. */
function panel(selection: Selection) {
  const edits: Operation[][] = [];
  const selected: Selection[] = [];
  const element = createElement(Properties, {
    ws,
    view,
    computed,
    selection,
    isNew: false,
    syncsDocs: false,
    docs: null,
    fileName: "shop.openarch",
    edit: async (e: Edit) => {
      edits.push(typeof e === "function" ? e(ws) : e);
      return true;
    },
    onSelect: (s: Selection) => void selected.push(s),
    onHide() {},
    onDelete() {},
    onFindUsages() {},
    onDeleteView() {},
  });
  return { host: mount(element), edits, selected };
}

describe("a deployment view in the designer", () => {
  it("shows a selected node, connection or running container in the details, while it's there", () => {
    expect(shownInProperties(ws, view, { kind: "node", id: "cluster" })).toMatchObject({ kind: "node", node: { id: "cluster", instances: 3 } });
    expect(shownInProperties(ws, view, { kind: "connection", number: 1 })).toMatchObject({ kind: "connection", connection: { from: "lb", to: "web" } });
    expect(shownInProperties(ws, view, { kind: "instance", node: "cluster", element: "api" })).toMatchObject({ kind: "instance", node: { id: "cluster" }, element: { id: "api" } });
    expect(shownInProperties(ws, view, { kind: "instance", node: "cluster", element: "db" })).toMatchObject({ kind: "view" });
    expect(shownInProperties(ws, view, { kind: "node", id: "gone" })).toMatchObject({ kind: "view" });
  });

  it("has no boxes to show or hide", () => {
    expect(viewAction(ws, view, computed, "customer")).toBeNull();
    expect(viewAction(ws, view, computed, "api")).toBeNull();
  });

  it("finds the nodes a container runs in, for Find usages", () => {
    expect(findUsages(ws, "api")!.views.map((v) => [v.view.id, v.as, v.runsIn?.map((n) => n.id)])).toEqual([["production", "deployed", ["cluster"]]]);
  });

  it("makes new node IDs that the view doesn't have yet", () => {
    expect(uniqueNodeId(ws, view, "cluster")).toBe("cluster-2");
    expect(uniqueNodeId(ws, view, "cluster", "cluster")).toBe("cluster");
    expect(uniqueNodeId(ws, view, "new-node")).toBe("new-node");
    // Nor an element's: a node named after the database it runs can't take the database's ID.
    expect(uniqueNodeId(ws, view, "db")).toBe("db-2");
    expect(uniqueNodeId(ws, view, "customer")).toBe("customer-2");
  });

  it("follows renamed elements in what nodes run and in connections, and a running container's selection", () => {
    const renames = [{ op: "rename" as const, id: "web", to: "website" }];
    expect(followRenames([{ op: "update-node", view: "production", id: "cluster", runs: ["web", "api"] }], renames)).toEqual([{ op: "update-node", view: "production", id: "cluster", runs: ["website", "api"] }]);
    expect(followRenames([{ op: "add-connection", view: "production", from: "lb", to: "web" }], renames)).toEqual([{ op: "add-connection", view: "production", from: "lb", to: "website" }]);
    expect(renamedSelection({ kind: "instance", node: "cluster", element: "web" }, (id) => (id === "web" ? "website" : id))).toEqual({ kind: "instance", node: "cluster", element: "website" });
  });

  it("adds a relationship for an arrow dragged between two containers, and a connection for one to or from a node", () => {
    expect(boxEnd("cluster/api")).toEqual({ node: "cluster", element: "api" });
    expect(boxEnd("lb")).toEqual({ node: "lb" });
    expect(deploymentConnectOps("production", "cluster/web", "database/db")).toEqual([{ op: "add-relationship", from: "web", to: "db" }]);
    expect(deploymentConnectOps("production", "lb", "cluster")).toEqual([{ op: "add-connection", view: "production", from: "lb", to: "cluster" }]);
    expect(deploymentConnectOps("production", "cluster/api", "lb")).toEqual([{ op: "add-connection", view: "production", from: "api", to: "lb" }]);
    expect(deploymentConnectOps("production", "cluster/api", "other/api")).toEqual([]);
  });

  it("highlights every copy of a selected arrow, and a selected connection", () => {
    const calls = d.arrows.find((a) => a.edge?.from === "web")!;
    expect(arrowSelected(calls, { kind: "arrow", from: "web", to: "api" })).toBe(true);
    expect(arrowSelected(calls, { kind: "connection", number: 1 })).toBe(false);
    expect(arrowSelected(d.arrows.find((a) => a.connection)!, { kind: "connection", number: 1 })).toBe(true);
  });
});

describe("laying out a deployment view", () => {
  const inside = (box: { x: number; y: number; w: number; h: number }, frame: { x: number; y: number; w: number; h: number }) =>
    box.x >= frame.x && box.y >= frame.y && box.x + box.w <= frame.x + frame.w && box.y + box.h <= frame.y + frame.h;

  it("nests every box inside its node, and routes every arrow, with ELK", async () => {
    const layout = await elkDeployment(d, new Map());
    expect([...layout.boxes.keys()].sort()).toEqual(["cloud", "cluster", "cluster/api", "cluster/web", "database", "database/db", "lb"]);
    expect(inside(layout.boxes.get("cluster/api")!, layout.boxes.get("cluster")!)).toBe(true);
    expect(inside(layout.boxes.get("cluster")!, layout.boxes.get("cloud")!)).toBe(true);
    expect(inside(layout.boxes.get("lb")!, layout.boxes.get("cloud")!)).toBe(true);
    for (const a of d.arrows) expect(layout.arrows.get(a.id)!.length).toBeGreaterThanOrEqual(2);
    expect(layout.boxes.get("lb")!.h).toBe(boxHeight(undefined));
  });

  it("still draws everything nested, in rows, when ELK can't be loaded", async () => {
    const { layout, failed } = await layOutDeployment(d, new Map(), () => Promise.reject(new Error("no ELK")));
    expect(failed).toBe(true);
    expect(layout).toEqual(rowsDeployment(d));
    expect(inside(layout.boxes.get("database/db")!, layout.boxes.get("database")!)).toBe(true);
    expect(inside(layout.boxes.get("database")!, layout.boxes.get("cloud")!)).toBe(true);
    expect(layout.arrows.size).toBe(d.arrows.length);
  });

  it("places each label on its arrow, clear of the boxes", async () => {
    const layout = await elkDeployment(d, new Map());
    const sizes = new Map(d.arrows.map((a) => [a.id, { w: 100, h: 30 }]));
    const labels = placeDeploymentLabels(d, layout, sizes);
    expect([...labels.keys()].sort()).toEqual(d.arrows.map((a) => a.id).sort());
    const boxes = [...layout.boxes].filter(([id]) => id.includes("/") || !holdsAnything(d, d.nodes.find((n) => n.id === id)!)).map(([, b]) => b);
    for (const at of labels.values()) expect(boxes.some((b) => at.x > b.x && at.x < b.x + b.w && at.y > b.y && at.y < b.y + b.h)).toBe(false);
  });
});

describe("the deployment diagram", () => {
  it("draws its nodes as frames, the containers in them, infrastructure as a box in its shape, and how many copies run", async () => {
    const host = mount(
      createElement(
        ReactFlowProvider,
        null,
        createElement(DeploymentDiagram, { ws, computed, selection: null, onSelect() {}, edit: async () => true, onError() {}, exportItems: [] }),
      ),
    );
    // ELK lays it out a moment later.
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect([...host.querySelectorAll(".deployment-frame-label .c4-name")].map((n) => n.textContent)).toEqual(["Cloud", "Cluster ×3", "Database server"]);
    expect([...host.querySelectorAll(".c4-container .c4-name")].map((n) => n.textContent)).toEqual(["Web", "API", "DB"]);
    expect(host.querySelector(".c4-node.c4-shape-server .c4-name")?.textContent).toBe("Load balancer");
    expect(host.querySelector(".deployment-frame.copies")).not.toBeNull();
    expect(host.textContent).toContain("deployment view");
  });
});

describe("a deployment node's details", () => {
  it("rename it after what it runs, with an ID that isn't that element's", async () => {
    const { host, edits, selected } = panel({ kind: "node", id: "cluster" });
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await type(name, "API");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toEqual([[{ op: "update-node", view: "production", id: "cluster", name: "API", newId: "api-2" }]]);
    expect(selected).toEqual([{ kind: "node", id: "api-2" }]);
  });

  it("rename it, with its ID following the name, and select it under its new ID", async () => {
    const { host, edits, selected } = panel({ kind: "node", id: "cluster" });
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    await type(name, "Servers");
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve));
    expect(edits).toEqual([[{ op: "update-node", view: "production", id: "cluster", name: "Servers", newId: "servers" }]]);
    expect(selected).toEqual([{ kind: "node", id: "servers" }]);
  });

  it("run another container in it, stop running one, and add a connection from it", async () => {
    const { host, edits, selected } = panel({ kind: "node", id: "cluster" });
    expect([...select(host, "Run here").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Choose a container or system…", "DB [Container]", "Shop [System]"]);
    await choose(select(host, "Run here"), "db");
    await click(button(host, "Stop running it here"));
    await choose(select(host, "Add a connection to"), "database");
    expect(edits).toEqual([
      [{ op: "update-node", view: "production", id: "cluster", runs: ["web", "api", "db"] }],
      [{ op: "update-node", view: "production", id: "cluster", runs: ["api"] }],
      [{ op: "add-connection", view: "production", from: "cluster", to: "database" }],
    ]);
    expect(selected).toEqual([{ kind: "connection", number: 2 }]);
    // It runs containers, so it can't be infrastructure until they're out of it.
    expect(checkbox(host, "Infrastructure, like a load balancer, DNS or a firewall").disabled).toBe(true);
  });

  it("can't go inside itself or what's inside it, or inside infrastructure", () => {
    const { host } = panel({ kind: "node", id: "cloud" });
    expect([...select(host, "Inside").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["(nothing: at the top)"]);
  });

  it("refuse a number of copies that isn't a whole number", async () => {
    const { host, edits } = panel({ kind: "node", id: "lb" });
    const copies = host.querySelector<HTMLInputElement>('input[aria-label="Copies"]')!;
    const enter = () => copies.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await type(copies, "two");
    enter();
    expect(copies.value).toBe("1");
    await type(copies, "2");
    enter();
    expect(edits).toEqual([[{ op: "update-node", view: "production", id: "lb", instances: 2 }]]);
  });

  it("delete it", async () => {
    const { host, edits } = panel({ kind: "node", id: "cloud" });
    await click(button(host, "Delete node and what's inside"));
    expect(edits).toEqual([[{ op: "remove-node", view: "production", id: "cloud" }]]);
  });
});

describe("a connection's details", () => {
  it("change its ends to nodes or what they run, and delete it", async () => {
    const { host, edits } = panel({ kind: "connection", number: 1 });
    expect([...select(host, "To").querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Cloud [Deployment node]",
      "Cluster [Deployment node]",
      "Database server [Deployment node]",
      "Load balancer [Infrastructure node]",
      "API [Container]",
      "DB [Container]",
      "Web [Container]",
    ]);
    await choose(select(host, "To"), "cluster");
    await click(button(host, "Delete connection"));
    expect(edits).toEqual([[{ op: "update-connection", view: "production", connection: 1, to: "cluster" }], [{ op: "remove-connection", view: "production", connection: 1 }]]);
  });
});

describe("a running container's details", () => {
  it("say where it runs, and stop it running there, above the container's own details", async () => {
    const { host, edits, selected } = panel({ kind: "instance", node: "cluster", element: "api" });
    expect(host.querySelector(".instance-of")?.textContent).toContain("Runs in Cluster, 3 copies.");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("API");
    await click(button(host, "Stop running it here"));
    expect(edits).toEqual([[{ op: "update-node", view: "production", id: "cluster", runs: ["web"] }]]);
    expect(selected).toEqual([{ kind: "node", id: "cluster" }]);
  });
});

describe("the New view dialog", () => {
  it("makes a deployment view, which needs a title", async () => {
    const created: Operation[] = [];
    const host = mount(createElement(NewViewDialog, { ws, onCreate: (op: Operation) => void created.push(op), onClose() {} }));
    await choose(host.querySelector("select")!, "deployment");
    expect(button(host, "Create view").disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>('input[placeholder="e.g. Production"]')!, "Staging");
    await click(button(host, "Create view"));
    expect(created).toEqual([{ op: "add-view", id: "staging", level: "deployment", title: "Staging" }]);
  });
});
