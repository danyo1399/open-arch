// @vitest-environment happy-dom
import { applyOperations, buildWorkspace, loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { connectionEnds, deploymentAfter, deploymentOffers, type DeploymentOffer } from "../src/model.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/**
 * A region with a load balancer, a server running the web app and the API, and a database
 * server, and an empty node outside it. Three connections, and the model's own arrows between
 * the containers. A note beside them.
 */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: {
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }] },
    api: { kind: "container", name: "API", parent: "shop", uses: [{ to: "db" }] },
    db: { kind: "container", name: "DB", parent: "shop" },
    cache: { kind: "container", name: "Cache", parent: "shop" },
  },
  views: {
    production: {
      title: "Production",
      level: "deployment",
      nodes: {
        region: { name: "Region" },
        lb: { name: "Load balancer", parent: "region", infrastructure: true },
        server: { name: "Server", parent: "region", runs: ["web", "api"] },
        data: { name: "Database server", parent: "region", runs: ["db"] },
        edge: { name: "Edge" },
      },
      connections: [
        { from: "lb", to: "web", description: "Forwards" },
        { from: "lb", to: "server", description: "Checks" },
        { from: "edge", to: "lb", description: "Routes" },
      ],
      stickies: { note: { text: "Read me", at: [3000, 0] } },
    },
  },
};

type Open = Awaited<ReturnType<typeof open>>;
/** Waits for the diagram to be laid out again, which it is a moment after what it draws changes. */
const laidOut = async (d: Open) => {
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
  await d.settle();
};
/** The whole designer, open on the deployment view, laid out. */
const designer = async (model: OpenArchDocument = doc, file?: MemoryHost) => {
  const d = await open(model, "production", file);
  await laidOut(d);
  return d;
};
const slow = async (): Promise<[Open, SlowHost]> => {
  const file = new SlowHost("shop.openarch", serializeDocument(doc));
  return [await designer(doc, file), file];
};
const node = async (d: Open, id: string, view = "production") => (await d.saved(view)).nodes.find((n) => n.id === id);
const connections = async (d: Open, view = "production") => (await d.saved(view)).connections.map((c) => `${c.from} -> ${c.to}`);

describe("what a deployment view's menus can offer", () => {
  const ws = buildWorkspace(doc);
  const view = ws.views.get("production")!;
  const connects = (from: string, to: string) => deploymentOffers(ws, view, { op: "add-connection", view: "production", from, to });
  /** Whether core makes an edit, tried on a copy. */
  const made = (model: OpenArchDocument, op: DeploymentOffer) => {
    try {
      applyOperations(model, [op]);
      return true;
    } catch {
      return false;
    }
  };

  it("is a connection between two of its nodes, or a node and something one runs", () => {
    expect(connects("lb", "server")).toBe(true);
    expect(connects("lb", "web")).toBe(true);
    expect(connects("web", "lb")).toBe(true);
    expect(connects("lb", "lb")).toBe(false);
    // An arrow between two containers comes from the model's relationships.
    expect(connects("web", "db")).toBe(false);
    // A node can't connect to what's inside it: a node, or what runs in one.
    expect(connects("region", "lb")).toBe(false);
    expect(connects("server", "web")).toBe(false);
    expect(connects("web", "region")).toBe(false);
  });

  it("isn't a move that would leave another connection joining a node and something inside it", () => {
    const move: DeploymentOffer = { op: "update-node", view: "production", id: "region", parent: "edge" };
    // Routes joins the edge node and the load balancer, which would then be inside it.
    expect(deploymentOffers(ws, view, move)).toBe(false);
    const free = structuredClone(doc);
    free.views.production!.connections!.pop();
    const without = buildWorkspace(free);
    expect(deploymentOffers(without, without.views.get("production")!, move)).toBe(true);
  });

  it("is the view as the edit would leave it that's checked, with nothing changed", () => {
    const before = JSON.stringify(view);
    const after = (op: DeploymentOffer) => deploymentAfter(ws, view, op);
    const joins = (v: typeof view) => v.connections.map((c) => `${c.number}: ${c.from} -> ${c.to}`);
    expect(after({ op: "add-connection", view: "production", from: "edge", to: "db" }).connections.at(-1)).toMatchObject({ number: 4, from: "edge", to: "db" });
    expect(joins(after({ op: "update-connection", view: "production", connection: 2, to: "db" }))).toEqual(["1: lb -> web", "2: lb -> db", "3: edge -> lb"]);
    const node = (op: DeploymentOffer) => after(op).nodes.find((n) => n.id === "server")!;
    expect(node({ op: "update-node", view: "production", id: "server", parent: "edge" }).parent).toBe("edge");
    expect("parent" in node({ op: "update-node", view: "production", id: "server", parent: null })).toBe(false);
    expect(node({ op: "update-node", view: "production", id: "server", runs: ["web", "api", "db"] })).toMatchObject({ parent: "region", runs: ["web", "api", "db"], infrastructure: false });
    expect(node({ op: "update-node", view: "production", id: "server", infrastructure: true }).infrastructure).toBe(true);
    // A node that stops running the web app takes the connection to it, and the ones after move up.
    expect(joins(after({ op: "update-node", view: "production", id: "server", runs: ["api"] }))).toEqual(["1: lb -> server", "2: edge -> lb"]);
    expect(joins(after({ op: "update-node", view: "production", id: "server", runs: null }))).toEqual(["1: lb -> server", "2: edge -> lb"]);
    expect(joins(after({ op: "update-node", view: "production", id: "server", shape: "queue" }))).toEqual(["1: lb -> web", "2: lb -> server", "3: edge -> lb"]);
    expect(JSON.stringify(view)).toBe(before);
  });

  /** Every edit a menu might offer on a view, and more that it never would: each node moved, made the other kind, given a shape, and told to run one more thing or one less; each connection there could be, and each end moved. */
  function everyOffer(workspace: ReturnType<typeof buildWorkspace>): DeploymentOffer[] {
    const production = workspace.views.get("production")!;
    const ends = [...connectionEnds(workspace, production).map((end) => end.id), "no-such-end"];
    return [
      ...production.nodes.flatMap((n) => [
        ...production.nodes.filter((p) => p.id !== n.parent).map((p): DeploymentOffer => ({ op: "update-node", view: "production", id: n.id, parent: p.id })),
        { op: "update-node", view: "production", id: n.id, parent: null } as const,
        { op: "update-node", view: "production", id: n.id, infrastructure: !n.infrastructure } as const,
        { op: "update-node", view: "production", id: n.id, shape: n.shape === "queue" ? null : "queue" } as const,
        ...[...workspace.elements.keys()].filter((e) => !n.runs.includes(e)).map((e): DeploymentOffer => ({ op: "update-node", view: "production", id: n.id, runs: [...n.runs, e] })),
        ...n.runs.map((e): DeploymentOffer => ({ op: "update-node", view: "production", id: n.id, runs: n.runs.filter((r) => r !== e) })),
      ]),
      ...ends.flatMap((from) => ends.map((to): DeploymentOffer => ({ op: "add-connection", view: "production", from, to }))),
      ...production.connections.flatMap((c) => ends.flatMap((end): DeploymentOffer[] => [
        { op: "update-connection", view: "production", connection: c.number, from: end },
        { op: "update-connection", view: "production", connection: c.number, to: end },
      ])),
    ];
  }

  /** The model with something wrong in its deployment view already, as a file written by hand can have. */
  const broken = (change: (view: NonNullable<OpenArchDocument["views"][string]>, model: OpenArchDocument) => void) => {
    const model = structuredClone(doc);
    // Things no node can run: a person, and a component of a container.
    model.elements.buyer = { kind: "person", name: "Buyer" };
    model.elements.orders = { kind: "component", name: "Orders", parent: "api" };
    change(model.views.production!, model);
    return model;
  };

  it.each([
    ["nothing wrong", doc],
    ["a connection that joins a node and one inside it", broken((v) => v.connections!.push({ from: "region", to: "lb" }))],
    ["a node that runs something that's no element, and a person", broken((v) => (v.nodes!.server!.runs = ["web", "ghost", "buyer"]))],
    ["infrastructure that runs something", broken((v) => (v.nodes!.lb!.runs = ["cache"]))],
    ["infrastructure that holds a node", broken((v) => (v.nodes!.edge!.parent = "lb"))],
    ["nodes inside one another", broken((v) => (v.nodes!.region!.parent = "data"))],
    ["a node inside one the view doesn't have", broken((v) => (v.nodes!.edge!.parent = "nowhere"))],
    // Telling a node what it runs drops the first, which renumbers the second, and core takes the error under its new number for a new one.
    ["a connection to what nothing runs, then one between a node and one inside it", broken((v) => v.connections!.push({ from: "lb", to: "cache" }, { from: "region", to: "lb" }))],
    ["a connection from something to itself, and one between two elements", broken((v) => v.connections!.push({ from: "lb", to: "lb" }, { from: "web", to: "db" }))],
    // Moving it out is the edit that puts it right: it holds nothing once it isn't inside itself.
    ["infrastructure inside itself", broken((v) => (v.nodes!.lb!.parent = "lb"))],
    ["a node inside itself", broken((v) => (v.nodes!.edge!.parent = "edge"))],
    ["infrastructure and a node inside one another", broken((v) => ((v.nodes!.region!.parent = "lb"), (v.nodes!.lb!.parent = "region")))],
    ["a node with an element's ID", broken((v) => ((v.nodes!.web = { name: "Web node" }), v.connections!.push({ from: "edge", to: "web" })))],
    ["a connection to something the view doesn't have", broken((v) => v.connections!.unshift({ from: "lb", to: "nothing" }))],
    ["what a node runs said twice, and with spaces round it", broken((v) => (v.nodes!.server!.runs = ["web", " api ", "web"]))],
    // Valid, but more to tell apart: the web app runs in two nodes, one of them inside the region.
    ["a container that runs in two nodes", broken((v) => ((v.nodes!.edge!.runs = ["web"]), v.connections!.push({ from: "region", to: "web" })))],
  ] as const)("is what core makes when asked, for every edit a menu might offer: with %s", (_, model) => {
    const workspace = buildWorkspace(model);
    const production = workspace.views.get("production")!;
    const offers = everyOffer(workspace);
    expect(offers.length).toBeGreaterThan(150);
    const [offered, refused] = [offers.filter((op) => made(model, op)), offers.filter((op) => !made(model, op))];
    // Some of each, so both answers are compared.
    expect(Math.min(offered.length, refused.length)).toBeGreaterThan(10);
    // Every one that differs is named, not only the first.
    const differ = offers.filter((op) => deploymentOffers(workspace, production, op) !== made(model, op));
    expect(differ.map((op) => `${made(model, op) ? "made" : "refused"}: ${JSON.stringify(op)}`)).toEqual([]);
  });

  it("have for a connection's ends the view's nodes, then what they run, by name", () => {
    expect(connectionEnds(ws, view).map((end) => end.label)).toEqual([
      "Edge [Deployment node]",
      "Region [Deployment node]",
      "Database server [Deployment node]",
      "Load balancer [Infrastructure node]",
      "Server [Deployment node]",
      "API [Container]",
      "DB [Container]",
      "Web [Container]",
    ]);
  });
});

describe("a node's right-click menu", () => {
  it("selects the node, from its frame, its name or its box, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("server")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Deployment node");
    expect(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!.value).toBe("Server");
    // It runs something, so it can't be infrastructure.
    expect(d.labels()).toEqual(["Add inside", "Run here", "Add connection to", "Shape", "Move inside", "Delete node"]);
    await d.rightClick(d.node("label:server")!);
    expect(d.labels()).toEqual(["Add inside", "Run here", "Add connection to", "Shape", "Move inside", "Delete node"]);
    // Infrastructure holds no nodes and runs nothing.
    await d.rightClick(d.node("lb")!);
    expect(d.details()).toBe("Infrastructure node");
    expect(d.labels()).toEqual(["Add connection to", "Shape", "Move inside", "Make it a deployment node", "Delete node"]);
    await d.rightClick(d.node("edge")!);
    expect(d.labels()).toEqual(["Add inside", "Run here", "Add connection to", "Shape", "Move inside", "Make it infrastructure", "Delete node"]);
    // The region can't go inside the edge node: Routes would then join that and a node inside it.
    await d.rightClick(d.node("region")!);
    expect(d.labels()).toEqual(["Add inside", "Run here", "Add connection to", "Shape", "Delete node and what's inside"]);
  });

  it("doesn't offer what update-node would refuse for what's already wrong with the node, in a file written by hand", async () => {
    const wrong = structuredClone(doc);
    wrong.elements.buyer = { kind: "person", name: "Buyer" };
    // The server is told to run a person, and the load balancer, which is infrastructure, runs the cache.
    wrong.views.production!.nodes!.server!.runs = ["web", "api", "buyer"];
    wrong.views.production!.nodes!.lb!.runs = ["cache"];
    const d = await designer(wrong);
    // Whatever more it's told to run, it's refused for the person: there's nothing to offer under Run here.
    await d.rightClick(d.node("server")!);
    expect(d.labels()).toEqual(["Add inside", "Add connection to", "Shape", "Move inside", "Delete node"]);
    // Nor can what it runs be stopped, as what's left would still name the person.
    await d.rightClick(d.node("server/web")!);
    expect(d.labels()).toEqual(["Add connection to", "Find usages", "New view", "Delete from model…"]);
    // Infrastructure that runs something can't be changed until it's made a deployment node: not its shape, nor where it is.
    await d.rightClick(d.node("lb")!);
    expect(d.labels()).toEqual(["Add connection to", "Make it a deployment node", "Delete node"]);
    await d.pick("Make it a deployment node");
    expect(await node(d, "lb")).toMatchObject({ infrastructure: false, runs: ["cache"] });
  });

  it("adds a node inside it, and selects it to give it a name", async () => {
    const d = await designer();
    await d.rightClick(d.node("server")!);
    await d.pick("Add inside");
    expect(d.labels()).toEqual(["Deployment node", "Infrastructure node"]);
    await d.pick("Infrastructure node");
    expect(await node(d, "new-infrastructure")).toMatchObject({ name: "New infrastructure", parent: "server", infrastructure: true });
    expect(d.details()).toBe("Infrastructure node");
    expect(document.activeElement).toBe(d.host.querySelector('input[aria-label="Name"]'));
    // Another node is selected, and the new one goes in the one whose menu it is.
    await laidOut(d);
    await d.rightClick(d.node("edge")!);
    await d.pick("Add inside", "Deployment node");
    expect(await node(d, "new-node")).toMatchObject({ parent: "edge", infrastructure: false });
  });

  it("runs a container or system in it, of those it doesn't run yet", async () => {
    const d = await designer();
    await d.rightClick(d.node("server")!);
    await d.pick("Run here");
    expect(d.labels()).toEqual(["Cache [Container]", "DB [Container]", "Shop [System]"]);
    await d.pick("Cache [Container]");
    expect((await node(d, "server"))!.runs).toEqual(["web", "api", "cache"]);
  });

  it("adds a connection from it to another node, or to something a node runs, and selects it", async () => {
    const d = await designer();
    await d.rightClick(d.node("server")!);
    await d.pick("Add connection to");
    // Not to the region it's inside, or to what runs in it.
    expect(d.labels()).toEqual(["Edge [Deployment node]", "Database server [Deployment node]", "Load balancer [Infrastructure node]", "DB [Container]"]);
    await d.pick("DB [Container]");
    expect(await connections(d)).toEqual(["lb -> web", "lb -> server", "edge -> lb", "server -> db"]);
    expect(d.details()).toBe("Connection 4of 4");
  });

  it("gives it a shape, and moves it inside another node or out to the top", async () => {
    const d = await designer();
    await d.rightClick(d.node("edge")!);
    await d.pick("Shape", "Database");
    expect((await node(d, "edge"))!.shape).toBe("database");
    await laidOut(d);
    await d.rightClick(d.node("edge")!);
    await d.pick("Shape");
    expect(d.labels()).toContain("Box");
    expect(d.labels()).not.toContain("Database");
    await d.pick("Box");
    expect((await node(d, "edge"))!.shape).toBe("box");

    await laidOut(d);
    await d.rightClick(d.node("server")!);
    await d.pick("Move inside");
    // Not the region it's in, infrastructure, or itself.
    expect(d.labels()).toEqual(["Edge", "Database server", "Nothing: at the top"]);
    await d.pick("Nothing: at the top");
    expect((await node(d, "server"))!.parent).toBeUndefined();
    // Once nothing joins the edge node and the load balancer, the region can go inside the edge node.
    await laidOut(d);
    await d.rightClick(d.node("region")!);
    expect(d.labels()).not.toContain("Move inside");
    await d.rightClick(d.edge("connection:3")!);
    await d.pick("Delete connection");
    await laidOut(d);
    await d.rightClick(d.node("region")!);
    await d.pick("Move inside");
    // At the top, there's nothing to move it out of. Not into the nodes inside it, or the server, which its load balancer checks.
    expect(d.labels()).toEqual(["Edge"]);
    await d.pick("Edge");
    expect((await node(d, "region"))!.parent).toBe("edge");
  });

  it("makes it infrastructure, or a deployment node again, and deletes it, with what's inside", async () => {
    const d = await designer();
    await d.rightClick(d.node("edge")!);
    await d.pick("Make it infrastructure");
    expect((await node(d, "edge"))!.infrastructure).toBe(true);
    await laidOut(d);
    await d.rightClick(d.node("edge")!);
    await d.pick("Make it a deployment node");
    expect((await node(d, "edge"))!.infrastructure).toBe(false);

    await laidOut(d);
    await d.rightClick(d.node("region")!);
    await d.pick("Delete node and what's inside");
    const view = await d.saved();
    expect(view.nodes.map((n) => n.id)).toEqual(["edge"]);
    expect(view.connections).toEqual([]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menu of a container running in a node", () => {
  it("selects it where it runs, and has what's done with it there, then the element's own menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("server/web")!);
    expect(d.details()).toBe("Container");
    expect(d.host.querySelector(".instance-of")!.textContent).toContain("Runs in Server");
    expect(d.labels()).toEqual(["Stop running it here", "Add connection to", "Find usages", "New view", "Delete from model…"]);
    await d.pick("New view");
    expect(d.labels()).toContain("Component view");
    await key(document.activeElement!, "Escape");
    await d.pick("Find usages");
    expect(d.host.querySelector(".usages")).not.toBeNull();
  });

  it("stops it running there, which takes the connections to it, and selects the node", async () => {
    const d = await designer();
    await d.rightClick(d.node("server/web")!);
    await d.pick("Stop running it here");
    expect((await node(d, "server"))!.runs).toEqual(["api"]);
    expect(await connections(d)).toEqual(["lb -> server", "edge -> lb"]);
    expect(d.details()).toBe("Deployment node");
    // The model still has it.
    expect(loadWorkspace(await d.file.load()).elements.has("web")).toBe(true);
  });

  it("adds a connection from it to a node it isn't inside, as one from a container can only go to a node", async () => {
    const d = await designer();
    await d.rightClick(d.node("data/db")!);
    await d.pick("Add connection to");
    expect(d.labels()).toEqual(["Edge [Deployment node]", "Load balancer [Infrastructure node]", "Server [Deployment node]"]);
    await d.pick("Edge [Deployment node]");
    expect((await connections(d)).at(-1)).toBe("db -> edge");
    expect(d.details()).toBe("Connection 4of 4");
  });
});

describe("a connection's right-click menu", () => {
  it("selects the connection, from its line or its text, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("connection:2")!);
    expect(d.details()).toBe("Connection 2of 3");
    expect(d.labels()).toEqual(["Change from", "Change to", "Move up, to connection 1", "Move down, to connection 3", "Delete connection"]);
    await key(document.activeElement!, "Escape");
    const label = [...d.host.querySelectorAll(".arrow-label")].find((l) => l.textContent === "Forwards")!;
    await d.rightClick(label);
    expect(d.details()).toBe("Connection 1of 3");
    expect(d.labels()).toEqual(["Change from", "Change to", "Move down, to connection 2", "Delete connection"]);
  });

  it("moves either end, only to where a connection can go", async () => {
    const d = await designer();
    // To a container, it can only come from a node, and not one the container is inside.
    await d.rightClick(d.edge("connection:1")!);
    await d.pick("Change from");
    expect(d.labels()).toEqual(["Edge [Deployment node]", "Database server [Deployment node]"]);
    await key(document.activeElement!, "Escape");
    // From a node, it can go to another node, or to a container, but not to the region the node is inside.
    await d.pick("Change to");
    expect(d.labels()).toEqual(["Edge [Deployment node]", "Database server [Deployment node]", "Server [Deployment node]", "API [Container]", "DB [Container]"]);
    await d.pick("DB [Container]");
    expect(await connections(d)).toEqual(["lb -> db", "lb -> server", "edge -> lb"]);
    await laidOut(d);
    await d.rightClick(d.edge("connection:3")!);
    await d.pick("Change from", "Server [Deployment node]");
    expect(await connections(d)).toEqual(["lb -> db", "lb -> server", "server -> lb"]);
  });

  it("moves it up or down the list, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(d.edge("connection:2")!);
    await d.pick("Move up, to connection 1");
    expect(await connections(d)).toEqual(["lb -> server", "lb -> web", "edge -> lb"]);
    expect(d.details()).toBe("Connection 1of 3");
    await laidOut(d);
    await d.rightClick(d.edge("connection:1")!);
    await d.pick("Delete connection");
    expect(await connections(d)).toEqual(["lb -> web", "edge -> lb"]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menus of a deployment view's other arrows, notes and background", () => {
  it("has the menu an arrow has on any view for an arrow between two containers, which is the model's", async () => {
    const d = await designer();
    const event = await d.rightClick(d.edge("server/web->server/api")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Relationship");
    expect(d.labels()).toEqual(["Select Web", "Select API", "Remove relationship"]);
    await d.pick("Remove relationship");
    expect(loadWorkspace(await d.file.load()).elements.get("web")!.uses).toEqual([]);
  });

  it("has a sticky note's menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
    await key(box, "Escape");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Move beside the diagram");
    expect((await d.saved()).stickies[0]!.at).toBeUndefined();
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and has what the toolbar has, with nothing to lay out", async () => {
    const d = await designer();
    await click(d.node("server")!);
    await d.rightClick(d.pane());
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Deployment node", "Infrastructure node", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("adds a node at the top from the background, whatever was selected, and a sticky note where it was clicked", async () => {
    const d = await designer();
    await click(d.node("server")!);
    await d.rightClick(d.pane());
    await d.pick("Add", "Deployment node");
    expect(await node(d, "new-node")).toMatchObject({ name: "New node", infrastructure: false });
    expect((await node(d, "new-node"))!.parent).toBeUndefined();
    expect(d.details()).toBe("Deployment node");

    await laidOut(d);
    await d.rightClick(d.pane(), { x: 5000, y: 3000 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [5000 - STICKY.width / 2, 2950] });
    expect(document.activeElement).toBe(d.node("sticky:note-2")!.querySelector("textarea"));
  });
});

describe("a deployment view's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("lb")!, 300, 420);
    await d.menuKey(d.node("lb")!);
    expect(d.details()).toBe("Infrastructure node");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the node under the new ID its name gave it, and on what runs in it", async () => {
    for (const [target, pick] of [
      ["server", "Delete node"],
      ["server/api", "Stop running it here"],
    ] as const) {
      const [d, file] = await slow();
      await click(d.node("server")!);
      file.hold = true;
      // Its ID follows its name, and the save that renames it hasn't landed when it's right-clicked.
      await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "App server");
      await d.rightClick(d.node(target)!);
      expect(d.menuOpen()).toBe(false);
      file.release();
      await laidOut(d);
      expect(d.node("app-server"), target).not.toBeNull();
      await d.pick(pick);
      expect((await node(d, "app-server"))?.runs, target).toEqual(pick === "Delete node" ? undefined : ["web"]);
    }
  });

  it("opens on a connection under the number it has once a container stops running in its node, unless it went with that", async () => {
    const [d, file] = await slow();
    await click(d.node("server/web")!);
    file.hold = true;
    await click(button(d.host, "Stop running it here"));
    // Forwards, connection 1, goes to the web app, which nothing runs any more. Routes, connection 3, doesn't.
    await d.rightClick(d.edge("connection:3")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await laidOut(d);
    expect(d.details()).toBe("Connection 2of 2");
    await d.pick("Delete connection");
    expect(await connections(d)).toEqual(["lb -> server"]);

    const [gone, again] = await slow();
    await click(gone.node("server/web")!);
    again.hold = true;
    await click(button(gone.host, "Stop running it here"));
    await gone.rightClick(gone.edge("connection:1")!);
    again.release();
    await laidOut(gone);
    expect(gone.menuOpen()).toBe(false);
    expect(await connections(gone)).toEqual(["lb -> server", "edge -> lb"]);
  });

  it("doesn't open on what ran in a node deleted just before, or on a node inside it, and does on one outside", async () => {
    for (const [target, opens] of [
      ["server/api", false],
      ["data", false],
      ["edge", true],
    ] as const) {
      const [d, file] = await slow();
      await click(d.node("region")!);
      file.hold = true;
      await click(button(d.host, "Delete node and what's inside"));
      await d.rightClick(d.node(target)!);
      file.release();
      await laidOut(d);
      expect(d.menuOpen(), target).toBe(opens);
      expect((await d.saved()).nodes.map((n) => n.id)).toEqual(["edge"]);
    }
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const [d, file] = await slow();
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Live");
    await d.rightClick(d.edge("connection:2")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await laidOut(d);
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Connection 2of 3");
    await d.pick("Delete connection");
    expect(await connections(d, "live")).toEqual(["lb -> web", "edge -> lb"]);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const [d, file] = await slow();
    await d.rightClick(d.node("edge")!);
    await d.pick("Make it infrastructure");
    await laidOut(d);
    await d.rightClick(d.node("edge")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await laidOut(d);
    expect(d.menuOpen()).toBe(false);
    // And with a Redo on its way.
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("edge")!);
    file.release();
    await laidOut(d);
    expect(d.menuOpen()).toBe(false);
  });
});
