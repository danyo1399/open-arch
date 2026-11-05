import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, computeView, describeElement, exportDocs, OpError, parseDocument, parseOperations, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/**
 * The shop, deployed to two regions of a cloud, each with its own copy of the web app, the API
 * and the database, behind one load balancer, with the payment provider in its own cloud.
 */
function production(): OpenArchDocument {
  const doc = shop();
  doc.views.production = {
    title: "Production",
    level: "deployment",
    nodes: {
      "us-db": { name: "Database server", parent: "us", runs: ["db"] },
      aws: { name: "AWS", technology: "Amazon Web Services" },
      eu: { name: "eu-west-1", parent: "aws" },
      us: { name: "us-east-1", parent: "aws" },
      "eu-ecs": { name: "ECS cluster", parent: "eu", technology: "Fargate", instances: 3, runs: ["web-app", "api"] },
      "us-ecs": { name: "ECS cluster", parent: "us", technology: "Fargate", runs: ["web-app", "api"] },
      "eu-db": { name: "Database server", parent: "eu", shape: "database", runs: ["db"] },
      lb: { name: "Load balancer", parent: "aws", technology: "ALB", infrastructure: true },
      stripe: { name: "Stripe", runs: ["payments"] },
    },
    connections: [{ from: "lb", to: "web-app", description: "Forwards requests to", technology: "HTTPS" }],
  };
  return doc;
}

const view = (doc: OpenArchDocument, id = "production") => {
  const ws = buildWorkspace(doc);
  return computeView(ws, ws.views.get(id)!);
};

const fails = (doc: OpenArchDocument, ...ops: Operation[]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("The operations were applied.");
};

describe("deployment views", () => {
  it("are read and written, with their nodes in reading order and their connections in order", () => {
    const text = serializeDocument(production());
    expect(text).toContain(`      "level": "deployment",
      "nodes": {
        "aws": { "name": "AWS", "technology": "Amazon Web Services" },
        "eu": { "name": "eu-west-1", "parent": "aws" },
        "eu-db": { "name": "Database server", "parent": "eu", "shape": "database", "runs": ["db"] },
        "eu-ecs": { "name": "ECS cluster", "parent": "eu", "technology": "Fargate", "instances": 3, "runs": ["web-app", "api"] },
        "lb": { "name": "Load balancer", "parent": "aws", "technology": "ALB", "infrastructure": true },
        "us": { "name": "us-east-1", "parent": "aws" },
        "us-db": { "name": "Database server", "parent": "us", "runs": ["db"] },
        "us-ecs": { "name": "ECS cluster", "parent": "us", "technology": "Fargate", "runs": ["web-app", "api"] },
        "stripe": { "name": "Stripe", "runs": ["payments"] }
      },
      "connections": [
        { "from": "lb", "to": "web-app", "description": "Forwards requests to", "technology": "HTTPS" }
      ]`);
    expect(text).not.toMatch(/"production": \{[^}]*"include"/);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(serializeDocument(parsed.doc)).toBe(text);
    expect(rules(production())).toEqual([]);
  });

  it("refuse fields of other views, and other views refuse theirs", () => {
    const doc = production();
    const raw = JSON.parse(serializeDocument(doc));
    raw.views.production.include = ["*"];
    raw.views.production.scope = "shop";
    raw.views.production.layout = {};
    raw.views.landscape.nodes = {};
    raw.views.production.nodes.aws.instances = 0;
    raw.views.production.nodes.aws.color = "red";
    raw.views.production.connections.push({ to: "lb" });
    const result = parseDocument(JSON.stringify(raw));
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.landscape.nodes",
      "field-not-allowed views.production.include",
      "field-not-allowed views.production.scope",
      "field-not-allowed views.production.layout",
      "field-unknown views.production.nodes.aws.color",
      "field-type views.production.nodes.aws.instances",
      "field-required views.production.connections[1].from",
    ]);
  });

  it("run each copy of a container in its node, and join it to the nearest copies of what it uses", () => {
    const cv = view(production());
    const d = cv.deployment!;
    expect(d.nodes.map((n) => n.id)).toEqual(["aws", "eu", "eu-db", "eu-ecs", "lb", "us", "us-db", "us-ecs", "stripe"]);
    expect(d.instances.map((i) => i.id)).toEqual(["eu-db/db", "eu-ecs/web-app", "eu-ecs/api", "us-db/db", "us-ecs/web-app", "us-ecs/api", "stripe/payments"]);
    // The view's boxes are the elements it runs, and its edges the arrows between them, as on another view.
    expect(cv.nodes.map((n) => n.id)).toEqual(["payments", "api", "db", "web-app"]);
    expect(cv.edges.map((e) => `${e.from}>${e.to}`)).toEqual(["api>db", "api>payments", "web-app>api"]);
    // Each region's API uses its own database; both use the one payment provider; the load balancer reaches both web apps.
    expect(d.arrows.map((a) => `${a.from} -> ${a.to}${a.description ? `: ${a.description}` : ""}`)).toEqual([
      "eu-ecs/api -> eu-db/db: Stores orders",
      "us-ecs/api -> us-db/db: Stores orders",
      "eu-ecs/api -> stripe/payments: Charges cards",
      "us-ecs/api -> stripe/payments: Charges cards",
      "eu-ecs/web-app -> eu-ecs/api: Places orders",
      "us-ecs/web-app -> us-ecs/api: Places orders",
      "lb -> eu-ecs/web-app: Forwards requests to",
      "lb -> us-ecs/web-app: Forwards requests to",
    ]);
    expect(d.arrows.find((a) => a.from === "lb")!.connection!.number).toBe(1);
    expect(d.arrows[0]!.edge!.sources).toEqual([{ element: "controller", index: 0 }]);
  });

  it("draw a relationship to a system's container as the system, when the view runs the system", () => {
    const doc = production();
    doc.views.production!.nodes!["eu-ecs"]!.runs = ["shop"];
    doc.views.production!.nodes!["us-ecs"]!.runs = ["shop"];
    const d = view(doc).deployment!;
    expect(d.arrows.map((a) => `${a.from} -> ${a.to}`)).toEqual(["eu-ecs/shop -> eu-db/db", "us-ecs/shop -> us-db/db", "eu-ecs/shop -> stripe/payments", "us-ecs/shop -> stripe/payments"]);
  });

  it("report what can't be drawn", () => {
    const doc = production();
    const nodes = doc.views.production!.nodes!;
    nodes.lost = { name: "Lost", parent: "nowhere" };
    nodes.inside = { name: "Inside", parent: "lb" };
    nodes.a = { name: "A", parent: "b" };
    nodes.b = { name: "B", parent: "a" };
    nodes.lb!.runs = ["api"];
    nodes.stripe!.runs = ["payments", "controller", "ghost"];
    nodes.api = { name: "API host" };
    doc.views.production!.connections!.push(
      { from: "web-app", to: "db", description: "Calls" },
      { from: "lb", to: "lb" },
      { from: "lb", to: "nobody" },
      { from: "eu", to: "eu-db" },
      { from: "customer", to: "lb" },
    );
    expect(view(doc).diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "node-parent-infrastructure views.production.nodes.inside.parent",
      "node-parent-unknown views.production.nodes.lost.parent",
      "node-parent-cycle views.production.nodes.a.parent",
      "node-parent-cycle views.production.nodes.b.parent",
      "node-infrastructure-runs views.production.nodes.lb.runs",
      "node-runs-kind views.production.nodes.stripe.runs[1]",
      "node-runs-unknown views.production.nodes.stripe.runs[2]",
      "node-id-taken views.production.nodes.api",
      "connection-between-elements views.production.connections[1]",
      "connection-self views.production.connections[2]",
      "connection-unknown-end views.production.connections[3].to",
      "connection-parent-child views.production.connections[4]",
      "connection-unknown-end views.production.connections[5].from",
    ]);
    // Nodes that can't be where they say are drawn at the top.
    expect(view(doc).deployment!.nodes.filter((n) => !n.parent).map((n) => n.id)).toEqual(["api", "aws", "inside", "lost", "stripe", "a", "b"]);
  });

  it("are a Mermaid flowchart of nested subgraphs", () => {
    expect(renderMermaid(view(production()))).toBe(
      [
        "flowchart TB",
        '  subgraph aws["AWS [Deployment node: Amazon Web Services]"]',
        '    subgraph eu["eu-west-1 [Deployment node]"]',
        '      subgraph eu_db["Database server [Deployment node]"]',
        '        eu_db__db[("DB<br/>[Container]")]',
        "      end",
        '      subgraph eu_ecs["ECS cluster ×3 [Deployment node: Fargate]"]',
        '        eu_ecs__web_app["Web App<br/>[Container: React]"]',
        '        eu_ecs__api["API<br/>[Container: Node.js]"]',
        "      end",
        "    end",
        '    lb["Load balancer<br/>[Infrastructure node: ALB]"]',
        '    subgraph us["us-east-1 [Deployment node]"]',
        '      subgraph us_db["Database server [Deployment node]"]',
        '        us_db__db[("DB<br/>[Container]")]',
        "      end",
        '      subgraph us_ecs["ECS cluster [Deployment node: Fargate]"]',
        '        us_ecs__web_app["Web App<br/>[Container: React]"]',
        '        us_ecs__api["API<br/>[Container: Node.js]"]',
        "      end",
        "    end",
        "  end",
        '  subgraph stripe["Stripe [Deployment node]"]',
        '    stripe__payments["Payments<br/>[External System]"]',
        "  end",
        '  eu_ecs__api -->|"Stores orders<br/>[SQL]"| eu_db__db',
        '  us_ecs__api -->|"Stores orders<br/>[SQL]"| us_db__db',
        '  eu_ecs__api -->|"Charges cards"| stripe__payments',
        '  us_ecs__api -->|"Charges cards"| stripe__payments',
        '  eu_ecs__web_app -->|"Places orders"| eu_ecs__api',
        '  us_ecs__web_app -->|"Places orders"| us_ecs__api',
        '  lb -->|"Forwards requests to<br/>[HTTPS]"| eu_ecs__web_app',
        '  lb -->|"Forwards requests to<br/>[HTTPS]"| us_ecs__web_app',
        "  classDef system fill:#1168bd,stroke:#0b4884,color:#ffffff",
        "  classDef container fill:#438dd5,stroke:#2e6295,color:#ffffff",
        "  classDef external fill:#999999,stroke:#6b6b6b,color:#ffffff",
        "  class eu_db__db,eu_ecs__web_app,eu_ecs__api,us_db__db,us_ecs__web_app,us_ecs__api container",
        "  class stripe__payments external",
        "  classDef deploymentNode fill:#ffffff,stroke:#8a94a6,color:#000000",
        "  class lb deploymentNode",
        "  style aws fill:none,stroke:#444444",
        "  style eu fill:none,stroke:#444444",
        "  style eu_db fill:none,stroke:#444444",
        "  style eu_ecs fill:none,stroke:#444444",
        "  style us fill:none,stroke:#444444",
        "  style us_db fill:none,stroke:#444444",
        "  style us_ecs fill:none,stroke:#444444",
        "  style stripe fill:none,stroke:#444444",
      ].join("\n"),
    );
    const empty = apply(shop(), { op: "add-view", id: "staging", level: "deployment" });
    expect(renderMermaid(view(empty, "staging"))).toBe("flowchart TB\n  %% This view has no nodes yet.");
  });

  it("have a docs page listing their nodes and connections, and each element's page says where it runs", () => {
    const files = exportDocs(buildWorkspace(production()), "shop.openarch");
    const page = files.find((f) => f.path === "views/production.md")!.content;
    expect(page).toContain("Deployment view.");
    expect(page).toContain("| ECS cluster | Deployment node | eu-west-1 | Fargate | 3 | [Web App](../elements/web-app.md), [API](../elements/api.md) |  |");
    expect(page).toContain("| Load balancer | Infrastructure node | AWS | ALB | 1 |  |  |");
    expect(page).toContain("| [API](../elements/api.md) | [DB](../elements/db.md) | Stores orders | SQL |");
    expect(page).toContain("## Connections\n\n| # | From | To | Description | Technology |\n|---|---|---|---|---|\n| 1 | Load balancer | [Web App](../elements/web-app.md) | Forwards requests to | HTTPS |");
    const api = files.find((f) => f.path === "elements/api.md")!.content;
    expect(api).toContain("- [Production](../views/production.md) (runs in ECS cluster, ECS cluster)");
    expect(describeElement(buildWorkspace(production()), "db")!.views.find((v) => v.view.id === "production")).toMatchObject({ as: "deployed", runsIn: [{ id: "eu-db" }, { id: "us-db" }] });
  });
});

describe("deployment operations", () => {
  it("add a view with nodes, nested, and connections", () => {
    const doc = apply(
      shop(),
      { op: "add-view", id: "staging", level: "deployment" },
      { op: "add-node", view: "staging", id: "server", technology: "Ubuntu", instances: 2, runs: ["web-app", "api"] },
      { op: "add-node", view: "staging", id: "db-server", parent: "server", shape: "database", runs: ["db"] },
      { op: "add-node", view: "staging", id: "firewall", infrastructure: true },
      { op: "add-connection", view: "staging", from: "firewall", to: "server", description: "Lets in" },
    );
    expect(doc.views.staging).toEqual({
      title: "Staging",
      level: "deployment",
      nodes: {
        server: { name: "Server", technology: "Ubuntu", instances: 2, runs: ["web-app", "api"] },
        "db-server": { name: "Db Server", parent: "server", shape: "database", runs: ["db"] },
        firewall: { name: "Firewall", infrastructure: true },
      },
      connections: [{ from: "firewall", to: "server", description: "Lets in" }],
    });
    expect(fails(shop(), { op: "add-view", id: "staging", level: "deployment", scope: "shop" })).toMatch(/don't take a `scope`/);
    expect(fails(shop(), { op: "add-view", id: "staging", level: "deployment", include: ["api"] })).toMatch(/takes no include or exclude/);
  });

  it("refuse nodes that can't be where they're put, or run what they're given", () => {
    const doc = production();
    expect(fails(doc, { op: "add-node", view: "production", id: "aws" })).toBe('View "production" already has a node "aws".');
    expect(fails(doc, { op: "add-node", view: "production", id: "x", parent: "lb" })).toBe('"lb" is infrastructure, which holds no nodes.');
    expect(fails(doc, { op: "add-node", view: "production", id: "x", parent: "nope" })).toMatch(/has no node "nope"/);
    expect(fails(doc, { op: "add-node", view: "production", id: "x", runs: ["controller"] })).toBe('"controller" is a component. Nodes run containers and systems: run the container it\'s in instead.');
    expect(fails(doc, { op: "add-node", view: "production", id: "x", infrastructure: true, runs: ["api"] })).toMatch(/^Infrastructure runs no containers/);
    expect(fails(doc, { op: "update-node", view: "production", id: "aws", parent: "eu" })).toBe('"eu" is inside "aws", so "aws" can\'t be inside it.');
    expect(fails(doc, { op: "update-node", view: "production", id: "eu", infrastructure: true })).toBe('Node "eu" holds other nodes, and infrastructure holds none. Move them out of it first.');
    expect(fails(doc, { op: "add-node", view: "landscape", id: "x" })).toBe('View "landscape" is a landscape view. Only deployment views have nodes and connections.');
    expect(fails(doc, { op: "add-node", view: "production", id: "api" })).toMatch(/has the ID of an element this view runs/);
  });

  it("update a node, and rename it, which the nodes inside it and its connections follow", () => {
    const doc = apply(
      production(),
      { op: "update-node", view: "production", id: "lb", newId: "front", name: "Front door", instances: 2, technology: null },
      { op: "update-node", view: "production", id: "eu", newId: "europe" },
    );
    const nodes = doc.views.production!.nodes!;
    expect(nodes.front).toEqual({ name: "Front door", parent: "aws", infrastructure: true, instances: 2 });
    expect(nodes["eu-ecs"]!.parent).toBe("europe");
    expect(doc.views.production!.connections).toEqual([{ from: "front", to: "web-app", description: "Forwards requests to", technology: "HTTPS" }]);
    expect(apply(doc, { op: "update-node", view: "production", id: "front", instances: null }).views.production!.nodes!.front!.instances).toBeUndefined();
    expect(apply(doc, { op: "update-node", view: "production", id: "eu-ecs", parent: null }).views.production!.nodes!["eu-ecs"]!.parent).toBeUndefined();
  });

  it("remove a node with the nodes inside it, and the connections to them or to what only they ran", () => {
    const result = applyOperations(production(), [{ op: "remove-node", view: "production", id: "eu" }]);
    expect(result.summary).toEqual(["removed node eu from view production and 2 nodes inside it"]);
    expect(Object.keys(result.doc.views.production!.nodes!)).toEqual(["us-db", "aws", "us", "us-ecs", "lb", "stripe"]);
    expect(result.doc.views.production!.connections).toHaveLength(1);
    const both = applyOperations(production(), [{ op: "remove-node", view: "production", id: "aws" }]);
    expect(both.summary).toEqual(["removed node aws from view production and 7 nodes inside it and 1 connection"]);
    expect(both.doc.views.production!.connections).toEqual([]);
    // Running something else instead takes the connections to it away too.
    const moved = applyOperations(production(), [
      { op: "update-node", view: "production", id: "eu-ecs", runs: ["api"] },
      { op: "update-node", view: "production", id: "us-ecs", runs: ["api"] },
    ]);
    expect(moved.summary[1]).toBe("updated node us-ecs in view production and removed 1 connection to what it no longer runs");
    expect(moved.doc.views.production!.connections).toEqual([]);
  });

  it("add, change, move and remove connections, refusing ones that join two elements", () => {
    let doc = apply(production(), { op: "add-connection", view: "production", from: "stripe", to: "lb", description: "Calls back", connection: 1 });
    expect(doc.views.production!.connections!.map((c) => `${c.from}>${c.to}`)).toEqual(["stripe>lb", "lb>web-app"]);
    doc = apply(doc, { op: "update-connection", view: "production", connection: 1, to: "api", description: null, technology: "HTTPS", newConnection: 2 });
    expect(doc.views.production!.connections).toEqual([
      { from: "lb", to: "web-app", description: "Forwards requests to", technology: "HTTPS" },
      { from: "stripe", to: "api", technology: "HTTPS" },
    ]);
    doc = apply(doc, { op: "remove-connection", view: "production", connection: 1 });
    expect(doc.views.production!.connections).toEqual([{ from: "stripe", to: "api", technology: "HTTPS" }]);
    expect(fails(doc, { op: "add-connection", view: "production", from: "web-app", to: "api" })).toBe(
      '"web-app" and "api" are both elements. Arrows between them come from the model\'s relationships: add one with add-relationship web-app api.',
    );
    expect(fails(doc, { op: "add-connection", view: "production", from: "lb", to: "customer" })).toBe('No node of view "production" runs "customer". Run it in one first: list it in the node\'s runs with update-node.');
    expect(fails(doc, { op: "add-connection", view: "production", from: "lb", to: "lb" })).toBe("A connection can't go from something to itself.");
    expect(fails(doc, { op: "add-connection", view: "production", from: "eu", to: "eu-db" })).toMatch(/one is inside the other/);
    expect(fails(doc, { op: "update-connection", view: "production", connection: 3 })).toBe('View "production" has 1 connection: "connection" must be 1 to 1.');
  });

  it("follow elements renamed or removed in the model", () => {
    const renamed = apply(production(), { op: "rename", id: "web-app", to: "website" });
    expect(renamed.views.production!.nodes!["eu-ecs"]!.runs).toEqual(["website", "api"]);
    expect(renamed.views.production!.connections![0]!.to).toBe("website");
    const removed = apply(production(), { op: "remove-element", id: "web-app" });
    expect(removed.views.production!.nodes!["eu-ecs"]!.runs).toEqual(["api"]);
    expect(removed.views.production!.connections).toEqual([]);
    const gone = apply(production(), { op: "remove-element", id: "shop" });
    expect(gone.views.production!.nodes!["eu-db"]!.runs).toBeUndefined();
  });

  it("refuse what other views do with their boxes", () => {
    const doc = production();
    expect(fails(doc, { op: "show-in-view", view: "production", id: "api" })).toMatch(/^A deployment view shows its nodes/);
    expect(fails(doc, { op: "update-view", id: "production", newElements: "hide" })).toMatch(/^A deployment view shows its nodes/);
    expect(fails(doc, { op: "set-layout", view: "production", positions: {} })).toBe("A deployment view is laid out from its nodes, so it has no box positions.");
  });

  it("are checked as JSON", () => {
    expect(parseOperations({ op: "add-node", view: "v", id: "n", instances: 3, runs: ["api"] })).toHaveLength(1);
    expect(() => parseOperations({ op: "add-node", view: "v", id: "n", instances: 0 })).toThrow('add-node: "instances" must be a whole number, 1 or more.');
    expect(() => parseOperations({ op: "update-node", view: "v", id: "n", instances: null, parent: null, runs: null })).not.toThrow();
  });
});
