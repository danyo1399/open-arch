// @vitest-environment happy-dom
import { buildWorkspace, loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { accepts, connectionEnds } from "../src/model.js";
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

describe("the connections a deployment view can have", () => {
  const ws = buildWorkspace(doc);
  const view = ws.views.get("production")!;

  const connects = (from: string, to: string) => accepts(ws, [{ op: "add-connection", view: "production", from, to }]);

  it("go between two of its nodes, or a node and something one runs, as core says when asked", () => {
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

  it("are asked of core without changing anything, and of each workspace once", () => {
    const before = serializeDocument(ws.doc);
    const move: Parameters<typeof accepts>[1] = [{ op: "update-node", view: "production", id: "region", parent: "edge" }];
    // Routes joins the edge node and the load balancer, which would then be inside it.
    expect(accepts(ws, move)).toBe(false);
    expect(accepts(ws, move)).toBe(false);
    expect(serializeDocument(ws.doc)).toBe(before);
    // Another workspace is asked for itself.
    const free = structuredClone(doc);
    free.views.production!.connections!.pop();
    expect(accepts(buildWorkspace(free), move)).toBe(true);
    // More than one operation is one edit: the second here needs the first.
    expect(accepts(ws, [{ op: "remove-connection", view: "production", connection: 3 }, ...move])).toBe(true);
  });

  it("have for ends the view's nodes, then what they run, by name", () => {
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
