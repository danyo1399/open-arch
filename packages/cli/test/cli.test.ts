import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/io.js";
import { run } from "../src/main.js";

const EXAMPLE = fileURLToPath(new URL("../../../examples/shop", import.meta.url));
const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-test-"));
  temps.push(dir);
  return dir;
}

/** A copy of the example workspace and its docs. */
function example(): string {
  const dir = join(tempDir(), "arch");
  cpSync(EXAMPLE, dir, { recursive: true });
  return dir;
}

function cli(cwd: string, ...args: string[]) {
  let out = "";
  let err = "";
  const code = run(args, { cwd, out: (t) => (out += t), err: (t) => (err += t) });
  return { code, out, err };
}

const read = (dir: string, path = "shop.openarch") => readFileSync(join(dir, path), "utf8");

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("reading", () => {
  it("checks the example cleanly; its file is formatted and its docs are current", () => {
    const dir = example();
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: shop.openarch, 17 elements, 14 views, no problems.\n" });
    expect(cli(dir, "fmt", "--check").code).toBe(0);
    expect(cli(dir, "export", "--check")).toMatchObject({ code: 0 });
  });

  it("checks the tour example cleanly too", () => {
    const dir = fileURLToPath(new URL("../../../examples/food-delivery", import.meta.url));
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: food-delivery.openarch, 27 elements, 8 views, no problems.\n" });
    expect(cli(dir, "fmt", "--check").code).toBe(0);
    expect(cli(dir, "export", "--check")).toMatchObject({ code: 0 });
  });

  it("finds the file from a parent or child folder", () => {
    const dir = example();
    expect(cli(join(dir, ".."), "check").code).toBe(0);
    expect(cli(join(dir, "docs", "elements"), "check").code).toBe(0);
    expect(cli(tempDir(), "check").err).toContain("No .openarch file found");
  });

  it("shows elements with their notes, and suggests IDs", () => {
    const dir = example();
    const shown = cli(dir, "show", "customer");
    expect(shown.out).toContain("Notes:\n  Customers use the shop from a browser on desktop or mobile.");
    expect(JSON.parse(cli(dir, "show", "customer", "--json").out)).toMatchObject({ id: "customer", notes: expect.any(String) });
    expect(cli(dir, "show", "custmer").err).toContain('Did you mean "customer"?');
  });

  it("reports problems as JSON when someone has edited the file by hand", () => {
    const dir = example();
    writeFileSync(join(dir, "shop.openarch"), read(dir).replace('"to": "orders-db"', '"to": "order-db"'));
    const { code, out } = cli(dir, "check", "--json");
    expect(code).toBe(1);
    expect(JSON.parse(out).diagnostics[0]).toMatchObject({
      rule: "relationship-unknown-target",
      path: "elements.order-repository.uses[0].to",
      fix: 'Did you mean "orders-db"?',
    });
  });
});

describe("changing", () => {
  it("adds an element and a relationship, saving the file and refreshing the docs", () => {
    const dir = example();
    const added = cli(dir, "add-element", "cache", "--kind", "container", "--parent", "shop", "--technology", "Redis", "--shape", "database", "--tag", "owner=checkout", "--tag", "pii", "--notes", "Holds carts.");
    expect(added).toMatchObject({ code: 0 });
    expect(added.out).toContain("added container cache\nSaved shop.openarch.\nDocs in docs: wrote");
    expect(JSON.parse(read(dir)).elements.cache).toEqual({ kind: "container", name: "Cache", parent: "shop", technology: "Redis", shape: "database", tags: { owner: "checkout", pii: "" }, notes: "Holds carts." });
    expect(read(dir, "docs/elements/cache.md")).toContain("Holds carts.");

    expect(cli(dir, "add-relationship", "checkout-controller", "cache", "--description", "Reads carts").code).toBe(0);
    expect(read(dir, "docs/views/shop-containers.md")).toContain("checkout_api -->|\"Reads carts\"| cache");
    expect(cli(dir, "check").code).toBe(0);
  });

  it("refuses an invalid change, saving nothing and suggesting a fix", () => {
    const dir = example();
    const before = read(dir);
    const result = cli(dir, "add-relationship", "web-app", "chekout-api", "--description", "Calls");
    expect(result).toMatchObject({ code: 1, err: 'open-arch: No element has the ID "chekout-api". Did you mean "checkout-api"?\n' });
    expect(read(dir)).toBe(before);
    expect(JSON.parse(cli(dir, "remove-element", "nope", "--json").out)).toMatchObject({ ok: false });
  });

  it("applies a batch all or nothing, from a file or standard input", () => {
    const dir = example();
    const before = read(dir);
    const ops = [
      { op: "add-element", id: "search", kind: "container", parent: "shop", technology: "OpenSearch" },
      { op: "add-relationship", from: "web-app", to: "search", description: "Searches products" },
    ];
    writeFileSync(join(dir, "bad.json"), JSON.stringify([...ops, { op: "add-relationship", from: "search", to: "shop" }]));
    expect(cli(dir, "apply", "bad.json").err).toContain("Operation 3 (add-relationship)");
    expect(read(dir)).toBe(before);

    writeFileSync(join(dir, "good.json"), JSON.stringify(ops));
    expect(cli(dir, "apply", "good.json", "--dry-run").out).toContain("would have added container search\nwould have added relationship web-app -> search\nNothing was saved");
    expect(read(dir)).toBe(before);
    expect(cli(dir, "apply", "good.json").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.search.name).toBe("Search");
  });

  it("explains malformed operations", () => {
    const dir = example();
    writeFileSync(join(dir, "typo.json"), JSON.stringify([{ op: "add-element", id: "x", kind: "system", desc: "y" }]));
    expect(cli(dir, "apply", "typo.json").err).toContain('add-element has no field "desc". Did you mean "description"?');
    writeFileSync(join(dir, "broken.json"), "[{");
    expect(cli(dir, "apply", "broken.json").err).toContain("aren't valid JSON");
  });

  it("renames and removes elements everywhere, cleaning up their docs", () => {
    const dir = example();
    expect(cli(dir, "rename", "checkout-api", "orders-api").code).toBe(0);
    const doc = JSON.parse(read(dir));
    expect(doc.elements["payment-client"].parent).toBe("orders-api");
    expect(doc.views["shop-containers"].layout["orders-api"]).toEqual([0, 320]);
    expect(existsSync(join(dir, "docs/elements/checkout-api.md"))).toBe(false);

    expect(cli(dir, "remove-element", "orders-api").out).toContain("removed orders-api and 7 elements inside it and views checking-out, checkout-api-components, order-repository-classes");
    expect(existsSync(join(dir, "docs/views/checkout-api-components.md"))).toBe(false);
    expect(cli(dir, "check").code).toBe(0);
  });

  it("moves a relationship to other elements, keeping what it says", () => {
    const dir = example();
    const moved = cli(dir, "update-relationship", "checkout-controller", "warehouse", "--new-from", "order-repository", "--new-to", "payment-provider");
    expect(moved).toMatchObject({ code: 0, out: expect.stringContaining("moved relationship checkout-controller -> warehouse to order-repository -> payment-provider\n") });
    const doc = JSON.parse(read(dir));
    expect(doc.elements["checkout-controller"].uses.map((u: { to: string }) => u.to)).toEqual(["order-repository", "payment-client", "logger"]);
    expect(doc.elements["order-repository"].uses[1]).toEqual({ to: "payment-provider", description: "Reserves stock", technology: "gRPC" });
    expect(read(dir, "docs/views/checkout-api-components.md")).toContain('order_repository -->|"Reserves stock<br/>[gRPC]"| payment_provider');
    expect(cli(dir, "update-relationship", "web-app", "checkout-controller", "--new-to", "web-app").err).toBe("open-arch: An element can't use itself.\n");
    expect(cli(dir, "update-relationship", "--help").out).toContain("--new-from and --new-to move it");
  });

  it("adds classes with members and a stereotype, relates them by kind, and shows them in a class view", () => {
    const dir = example();
    const added = cli(dir, "add-element", "money", "--kind", "class", "--parent", "order-repository", "--name", "Money", "--stereotype", "value", "--member", "+amount: number", "--member", "+currency(): string");
    expect(added).toMatchObject({ code: 0, out: expect.stringContaining("added class money\n") });
    expect(JSON.parse(read(dir)).elements.money).toEqual({ kind: "class", name: "Money", parent: "order-repository", stereotype: "value", members: ["+amount: number", "+currency(): string"] });
    expect(cli(dir, "add-relationship", "order", "money", "--kind", "composition", "--description", "Is priced in").code).toBe(0);
    expect(cli(dir, "show", "money").out).toContain("  stereotype:  value\n\nMembers:\n  +amount: number\n  +currency(): string\n");
    expect(cli(dir, "show", "order-repository-classes").out).toContain("  order -> money             (composition) Is priced in\n");
    expect(JSON.parse(cli(dir, "show", "order", "--json").out).uses).toContainEqual({ to: "money", kind: "composition", description: "Is priced in", tags: {}, known: true });
    expect(read(dir, "docs/views/order-repository-classes.md")).toContain("  order *-- money : Is priced in\n");

    expect(cli(dir, "update-element", "money", "--member", "+cents: int").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.money.members).toEqual(["+cents: int"]);
    expect(cli(dir, "update-element", "money", "--member", "", "--stereotype", "").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.money).toEqual({ kind: "class", name: "Money", parent: "order-repository" });
    expect(cli(dir, "update-relationship", "order", "money", "--kind", "aggregation").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.order.uses[1]).toEqual({ to: "money", kind: "aggregation", description: "Is priced in" });
    expect(cli(dir, "update-relationship", "order", "money", "--kind", "").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.order.uses[1]).toEqual({ to: "money", description: "Is priced in" });

    expect(cli(dir, "update-element", "web-app", "--member", "+x").err).toBe("open-arch: Only classes have members, and this is a container.\n");
    expect(cli(dir, "add-relationship", "order", "orders-db", "--kind", "inheritance").err).toContain('Only relationships between classes can be of the kind "inheritance"');
    expect(cli(dir, "add-view", "money-classes", "--level", "class", "--scope", "order-repository").code).toBe(0);
    expect(cli(dir, "add-view", "--help").out).toContain("a component or library for class views");
  });

  it("adds a library, builds containers with it, and shows it on both", () => {
    const dir = example();
    expect(cli(dir, "add-element", "metrics", "--kind", "library", "--name", "Metrics").code).toBe(0);
    expect(cli(dir, "update-element", "checkout-api", "--library", "metrics", "--library", "logging").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["checkout-api"].libraries).toEqual(["logging", "metrics"]);
    expect(cli(dir, "show", "checkout-api").out).toContain("Libraries:\n  logging  library  Logging [TypeScript]\n  metrics  library  Metrics\n");
    expect(cli(dir, "show", "metrics").out).toContain("Built into:\n  checkout-api  container  Checkout API [Node.js]\n");
    expect(JSON.parse(cli(dir, "show", "metrics", "--json").out).builtInto).toEqual(["checkout-api"]);
    expect(cli(dir, "update-element", "checkout-api", "--library", "").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["checkout-api"]).not.toHaveProperty("libraries");
    expect(cli(dir, "update-element", "orders-db", "--library", "nope").err).toContain('No element has the ID "nope".');
    expect(cli(dir, "add-element", "x", "--kind", "library", "--parent", "checkout-api").err).toContain("A library belongs to no one container");
    expect(cli(dir, "add-element", "formatter", "--kind", "component", "--parent", "logging").code).toBe(0);
    expect(cli(dir, "add-view", "logging-components", "--level", "component", "--scope", "logging").code).toBe(0);
    expect(cli(dir, "show", "logging-components").out).toContain("component view of logging (Logging)");
    expect(cli(dir, "add-element", "--help").out).toContain("components a container or library");
  });

  it("adds a state view, its states and transitions, and shows them and their Mermaid diagram", () => {
    const dir = example();
    expect(cli(dir, "add-view", "order-lifecycle", "--level", "state", "--scope", "order", "--title", "Order lifecycle").code).toBe(0);
    const added = cli(dir, "add-state", "order-lifecycle", "paid", "--description", "The card was charged.");
    expect(added.out).toContain("warning: views.order-lifecycle.initial: warning [state-initial-missing]");
    expect(cli(dir, "add-state", "order-lifecycle", "placed", "--initial").code).toBe(0);
    expect(cli(dir, "add-state", "order-lifecycle", "delivered", "--final", "--at", "0,300").code).toBe(0);
    expect(cli(dir, "add-transition", "order-lifecycle", "placed", "paid", "--event", "Payment taken", "--guard", "paid in full").code).toBe(0);
    expect(cli(dir, "add-transition", "order-lifecycle", "paid", "delivered").code).toBe(0);
    expect(cli(dir, "show", "order-lifecycle").out).toBe(`order-lifecycle: Order lifecycle
  level:        state view of order (Order)

States:
  placed     Placed     (starts here)
  paid       Paid       The card was charged.
  delivered  Delivered  (can end here)

Transitions:
  1.  placed -> paid     Payment taken [paid in full]
  2.  paid -> delivered  (no event)
`);
    expect(JSON.parse(cli(dir, "show", "order-lifecycle", "--json").out).transitions[0]).toEqual({ transition: 1, from: "placed", to: "paid", event: "Payment taken", guard: "paid in full" });
    expect(read(dir, "docs/views/order-lifecycle.md")).toContain("  placed --> paid : Payment taken [paid in full]\n");

    expect(cli(dir, "update-transition", "order-lifecycle", "2", "--event", "Delivered", "--move-to", "1").code).toBe(0);
    expect(JSON.parse(read(dir)).views["order-lifecycle"].transitions[0]).toEqual({ from: "paid", to: "delivered", event: "Delivered" });
    expect(cli(dir, "update-state", "order-lifecycle", "placed", "--new-id", "new", "--name", "New").code).toBe(0);
    expect(JSON.parse(read(dir)).views["order-lifecycle"].initial).toBe("new");
    expect(cli(dir, "remove-transition", "order-lifecycle", "1").code).toBe(0);
    expect(cli(dir, "remove-state", "order-lifecycle", "paid").out).toContain("removed state paid from view order-lifecycle and 1 transition to or from it");
    expect(cli(dir, "update-state", "order-lifecycle", "new", "--final", "--not-final").err).toContain("Pass --final or --not-final, not both.");
    expect(cli(dir, "remove-transition", "order-lifecycle", "x").err).toContain("<n> must be a transition's number");
    expect(cli(dir, "add-view", "--help").out).toContain("A state view shows the states something can be in");
  });

  it("adds a deployment view, its nodes and connections, and shows what runs where", () => {
    const dir = example();
    expect(cli(dir, "add-view", "staging", "--level", "deployment").code).toBe(0);
    expect(cli(dir, "add-node", "staging", "server", "--technology", "Ubuntu 24.04", "--run", "web-app", "--run", "checkout-api", "--instances", "2").code).toBe(0);
    expect(cli(dir, "add-node", "staging", "db-server", "--parent", "server", "--shape", "database", "--run", "orders-db").code).toBe(0);
    expect(cli(dir, "add-node", "staging", "lb", "--name", "Load balancer", "--infrastructure", "--technology", "nginx").out).toContain("added infrastructure node lb to view staging");
    expect(cli(dir, "add-connection", "staging", "lb", "web-app", "--description", "Forwards requests to", "--technology", "HTTPS").code).toBe(0);
    expect(cli(dir, "show", "staging").out).toBe(`staging: Staging
  level:        deployment view

Nodes:
  lb           Load balancer [nginx]  (infrastructure node)
  server       Server [Ubuntu 24.04]  ×2 runs web-app, checkout-api
    db-server  Db Server              (database) runs orders-db

Connections:
  1.  lb -> web-app  Forwards requests to [HTTPS]

Arrows:
  server/checkout-api -> db-server/orders-db  Reads and writes orders [SQL]
  server/web-app -> server/checkout-api       Places orders [HTTPS/JSON]
  lb -> server/web-app                        Forwards requests to [HTTPS]  (connection 1)
`);
    const json = JSON.parse(cli(dir, "show", "staging", "--json").out);
    expect(json.nodes[1]).toEqual({ id: "server", name: "Server", technology: "Ubuntu 24.04", instances: 2, runs: ["web-app", "checkout-api"] });
    expect(json.arrows[2]).toEqual({ from: "lb", to: "server/web-app", description: "Forwards requests to", technology: "HTTPS", connection: 1 });
    expect(cli(dir, "show", "orders-db").out).toContain("staging (runs in db-server)");
    expect(read(dir, "docs/views/staging.md")).toContain('  subgraph server["Server ×2 [Deployment node: Ubuntu 24.04]"]\n');

    expect(cli(dir, "update-node", "staging", "lb", "--new-id", "front", "--instances", "3").code).toBe(0);
    expect(JSON.parse(read(dir)).views.staging.connections).toEqual([{ from: "front", to: "web-app", description: "Forwards requests to", technology: "HTTPS" }]);
    expect(cli(dir, "update-node", "staging", "server", "--run", "checkout-api").out).toContain("removed 1 connection to what it no longer runs");
    expect(cli(dir, "update-node", "staging", "db-server", "--parent", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.staging.nodes["db-server"].parent).toBeUndefined();
    expect(cli(dir, "update-node", "staging", "front", "--infrastructure", "--deployment-node").err).toContain("Pass --infrastructure or --deployment-node, not both.");
    expect(cli(dir, "add-node", "staging", "x", "--instances", "two").err).toContain('--instances must be a whole number, 1 or more, not "two".');
    expect(cli(dir, "add-connection", "staging", "server", "front").code).toBe(0);
    expect(cli(dir, "update-connection", "staging", "1", "--description", "Calls").code).toBe(0);
    expect(cli(dir, "remove-node", "staging", "front").out).toContain("removed node front from view staging and 1 connection");
    expect(cli(dir, "remove-connection", "staging", "1").err).toContain('View "staging" has no connections yet.');
    expect(cli(dir, "add-view", "--help").out).toContain("A deployment view shows where containers and systems run");
  });

  it("adds an event view, its lanes and cards, and shows them in order with what each comes from", () => {
    const dir = example();
    expect(cli(dir, "add-view", "returns", "--level", "event", "--title", "Returning an order").code).toBe(0);
    expect(cli(dir, "add-lane", "returns", "shop").code).toBe(0);
    expect(cli(dir, "add-lane", "returns", "customer", "--description", "Whoever bought it.", "--position", "1").out).toContain("added lane customer to view returns, as lane 1");
    expect(cli(dir, "add-card", "returns", "ask-for-return", "--kind", "command", "--name", "Ask for a return", "--lane", "customer").out).toContain("added command ask-for-return to view returns");
    expect(cli(dir, "add-card", "returns", "return-asked-for", "--lane", "shop", "--from", "ask-for-return", "--description", "Within 30 days.").out).toContain("added event return-asked-for to view returns");
    expect(cli(dir, "add-card", "returns", "refund-policy", "--kind", "policy", "--name", "Whenever a return arrives, refund it", "--from", "return-asked-for").code).toBe(0);
    expect(cli(dir, "add-card", "returns", "who-pays", "--kind", "hotspot", "--name", "Who pays the postage?", "--position", "1").code).toBe(0);
    expect(cli(dir, "show", "returns").out).toBe(`returns: Returning an order
  level:        event view

Lanes:
  1.  customer  Customer  Whoever bought it.
  2.  shop      Shop

Cards:
  1.  who-pays          hotspot  Who pays the postage?                 (no lane)
  2.  ask-for-return    command  Ask for a return                      in customer
  3.  return-asked-for  event    Return Asked For                      in shop  <- ask-for-return  Within 30 days.
  4.  refund-policy     policy   Whenever a return arrives, refund it  (no lane)  <- return-asked-for
`);
    const json = JSON.parse(cli(dir, "show", "returns", "--json").out);
    expect(json.lanes[0]).toEqual({ id: "customer", position: 1, name: "Customer", description: "Whoever bought it." });
    expect(json.cards[2]).toEqual({ id: "return-asked-for", position: 3, kind: "event", name: "Return Asked For", description: "Within 30 days.", lane: "shop", from: ["ask-for-return"] });
    expect(cli(dir, "show").out).toContain("returns                   event view                      Returning an order");
    const page = read(dir, "docs/views/returns.md");
    expect(page).toContain('  subgraph lane__shop["Shop"]\n    direction LR\n    return_asked_for["Return Asked For<br/>[Event]"]\n  end\n');
    expect(page).toContain("| 3 | Return Asked For | Event | Shop | Ask for a return | Within 30 days. |");

    expect(cli(dir, "update-card", "returns", "refund-policy", "--lane", "shop", "--from", "return-asked-for", "--from", "ask-for-return", "--position", "3").out).toContain("updated card refund-policy in view returns, and moved it to card 3");
    expect(JSON.parse(read(dir)).views.returns.cards[2]).toEqual({ id: "refund-policy", kind: "policy", name: "Whenever a return arrives, refund it", lane: "shop", from: ["return-asked-for", "ask-for-return"] });
    expect(cli(dir, "update-card", "returns", "ask-for-return", "--new-id", "request-return", "--kind", "actor").code).toBe(0);
    expect(JSON.parse(read(dir)).views.returns.cards[2].from).toEqual(["return-asked-for", "request-return"]);
    expect(cli(dir, "update-card", "returns", "refund-policy", "--from", "", "--lane", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.returns.cards[2]).toEqual({ id: "refund-policy", kind: "policy", name: "Whenever a return arrives, refund it" });
    expect(cli(dir, "update-lane", "returns", "shop", "--new-id", "store", "--name", "Store", "--position", "1").out).toContain("renamed lane shop to store in view returns, and moved it to lane 1");
    expect(JSON.parse(read(dir)).views.returns.cards[3].lane).toBe("store");
    expect(cli(dir, "remove-lane", "returns", "store").out).toContain("removed lane store from view returns, leaving 1 card in no lane");
    expect(cli(dir, "remove-card", "returns", "request-return").out).toContain("removed card request-return from view returns and 1 arrow to or from it");
    expect(cli(dir, "add-card", "returns", "x", "--kind", "note").err).toContain('Unknown kind of card "note".');
    expect(cli(dir, "add-card", "returns", "x", "--position", "first").err).toContain("--position must be a card's number: 1 is the first.");
    expect(cli(dir, "add-lane", "returns", "x", "--position", "0").err).toContain("--position must be a lane's number: 1 is the first.");
    expect(cli(dir, "add-lane", "place-order", "x").err).toContain('View "place-order" is a sequence view. Only event and flowchart views have lanes.');
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "add-view", "--help").out).toContain("An event view shows what happens in a business process");
    expect(cli(dir, "add-card", "--help").out).toContain("--from <card>");
    expect(cli(dir, "--help").out).toContain("add-card <view> <id>");
  });

  it("applies a batch of lanes and cards from JSON, all or nothing", () => {
    const dir = example();
    const ops = [
      { op: "add-view", id: "returns", level: "event" },
      { op: "add-lane", view: "returns", id: "shop" },
      { op: "add-card", view: "returns", id: "return-arrived", lane: "shop" },
      { op: "add-card", view: "returns", id: "refund", kind: "command", from: ["return-arrived"] },
    ];
    writeFileSync(join(dir, "good.json"), JSON.stringify(ops));
    expect(cli(dir, "apply", "good.json").out).toContain("added event return-arrived to view returns\nadded command refund to view returns\n");
    writeFileSync(join(dir, "bad.json"), JSON.stringify([{ op: "add-card", view: "returns", id: "late", from: ["never"] }]));
    expect(cli(dir, "apply", "bad.json").err).toContain('View "returns" has no card "never".');
    expect(JSON.parse(read(dir)).views.returns.cards.map((c: { id: string }) => c.id)).toEqual(["return-arrived", "refund"]);
  });

  it("adds a wireframe view, its screens and widgets, and shows them in order with the screens they lead to", () => {
    const dir = example();
    expect(cli(dir, "add-view", "sign-in", "--level", "wireframe", "--scope", "web-app", "--title", "Signing in").out).toContain("added view sign-in");
    expect(cli(dir, "add-screen", "sign-in", "welcome").code).toBe(0);
    expect(cli(dir, "add-screen", "sign-in", "form", "--name", "Sign in", "--device", "phone", "--description", "Asks for an email.", "--position", "1").out).toContain("added screen form to view sign-in, as screen 1");
    expect(cli(dir, "add-widget", "sign-in", "title", "--kind", "heading", "--screen", "form", "--text", "Sign in").out).toContain("added heading title to screen form in view sign-in");
    expect(cli(dir, "add-widget", "sign-in", "fields", "--kind", "panel", "--screen", "form").code).toBe(0);
    expect(cli(dir, "add-widget", "sign-in", "email", "--kind", "input", "--in", "fields", "--text", "Email").out).toContain("added input email to panel fields in view sign-in");
    expect(cli(dir, "add-widget", "sign-in", "go", "--kind", "button", "--screen", "form", "--text", "Sign in", "--to", "welcome", "--description", "Checks the email first.").code).toBe(0);
    expect(cli(dir, "add-widget", "sign-in", "news", "--kind", "list", "--screen", "welcome", "--text", "New shoes\nSale ends Friday").code).toBe(0);
    expect(cli(dir, "show", "sign-in").out).toBe(`sign-in: Signing in
  level:        wireframe view of web-app (Web App)

Screens:
  1.  form  Sign in  (phone)  Asks for an email.
       1.     title   heading     "Sign in"
       2.     fields  panel
          1.  email   text field  "Email"
       3.     go      button      "Sign in"  -> welcome  Checks the email first.
  2.  welcome  Welcome
       1.  news  list  "New shoes / Sale ends Friday"
`);
    const json = JSON.parse(cli(dir, "show", "sign-in", "--json").out);
    expect(json.scope).toBe("web-app");
    expect(json.screens[0]).toMatchObject({ id: "form", position: 1, name: "Sign in", description: "Asks for an email.", device: "phone" });
    expect(json.screens[0].widgets[1]).toEqual({ id: "fields", position: 2, kind: "panel", widgets: [{ id: "email", position: 1, kind: "input", text: "Email" }] });
    expect(cli(dir, "show", "web-app").out).toContain("sign-in (its screens)");
    expect(read(dir, "docs/views/sign-in.md")).toContain("Wireframe view of [Web App](../elements/web-app.md).");

    expect(cli(dir, "update-widget", "sign-in", "go", "--in", "fields", "--position", "1").out).toContain("moved widget go to panel fields, as widget 1 there, in view sign-in");
    expect(cli(dir, "update-widget", "sign-in", "go", "--in", "", "--to", "", "--description", "").out).toContain("updated widget go in view sign-in, and moved it to screen form, as widget 3 there");
    expect(JSON.parse(read(dir)).views["sign-in"].screens[0].widgets[2]).toEqual({ id: "go", kind: "button", text: "Sign in" });
    expect(cli(dir, "update-widget", "sign-in", "go", "--screen", "welcome", "--new-id", "continue").out).toContain("renamed widget go to continue in view sign-in, and moved it to screen welcome, as widget 2 there");
    expect(cli(dir, "update-screen", "sign-in", "welcome", "--new-id", "home", "--device", "tablet", "--position", "1").out).toContain("renamed screen welcome to home in view sign-in, and moved it to screen 1");
    expect(cli(dir, "update-widget", "sign-in", "email", "--to", "home").code).toBe(0);
    expect(cli(dir, "update-screen", "sign-in", "home", "--device", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views["sign-in"].screens[0]).toEqual({ id: "home", name: "Welcome", widgets: [{ id: "news", kind: "list", text: "New shoes\nSale ends Friday" }, { id: "continue", kind: "button", text: "Sign in" }] });
    expect(cli(dir, "remove-screen", "sign-in", "home").out).toContain("removed screen home from view sign-in, with 2 widgets on it, and the arrow to it from 1 widget");
    expect(cli(dir, "remove-widget", "sign-in", "fields").out).toContain("removed widget fields from view sign-in, with 1 widget inside it");
    expect(cli(dir, "add-widget", "sign-in", "x", "--screen", "form").err).toContain("Pass --kind: heading, text, button,");
    expect(cli(dir, "add-widget", "sign-in", "x", "--kind", "slider", "--screen", "form").err).toContain('Unknown kind of widget "slider".');
    expect(cli(dir, "add-widget", "sign-in", "x", "--kind", "text").err).toContain("Say where the widget goes: the screen it's on, or the row or panel it's in.");
    expect(cli(dir, "add-widget", "sign-in", "x", "--kind", "text", "--screen", "form", "--position", "0").err).toContain("--position must be a widget's number: 1 is the first.");
    expect(cli(dir, "add-screen", "sign-in", "x", "--device", "watch").err).toContain('Unknown device "watch".');
    expect(cli(dir, "add-screen", "place-order", "x").err).toContain('View "place-order" is a sequence view. Only wireframe views have screens and widgets.');
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "add-view", "--help").out).toContain("A wireframe view sketches an app's screens");
    expect(cli(dir, "add-widget", "--help").out).toContain("--to <screen>");
    expect(cli(dir, "--help").out).toContain("add-widget <view> <id>");
    expect(cli(dir, "apply", "--help").out).toContain("add-screen, update-screen, remove-screen, add-widget, update-widget, remove-widget");
  });

  it("puts a whiteboard arrow's ends on a side of their shapes, and shows which", () => {
    const dir = example();
    cli(dir, "add-view", "flow", "--level", "whiteboard");
    cli(dir, "add-shape", "flow", "paid", "--kind", "diamond", "--text", "Paid?", "--at", "0,0");
    cli(dir, "add-shape", "flow", "ship", "--kind", "rectangle", "--text", "Ship it", "--at", "300,0");
    expect(cli(dir, "add-arrow", "flow", "yes", "--from", "paid", "--from-side", "right", "--to", "ship", "--to-side", "left", "--text", "yes").out).toContain("added arrow yes to view flow");
    expect(JSON.parse(read(dir)).views.flow.arrows[0]).toEqual({ id: "yes", from: { shape: "paid", side: "right" }, to: { shape: "ship", side: "left" }, text: "yes" });
    expect(cli(dir, "show", "flow").out).toContain(`  yes  paid (right) -> ship (left)  "yes"`);
    expect(JSON.parse(cli(dir, "show", "flow", "--json").out).arrows[0]).toMatchObject({ from: { shape: "paid", side: "right" }, to: { shape: "ship", side: "left" } });
    expect(cli(dir, "update-arrow", "flow", "yes", "--to-side", "", "--from-side", "bottom").code).toBe(0);
    expect(JSON.parse(read(dir)).views.flow.arrows[0]).toMatchObject({ from: { shape: "paid", side: "bottom" }, to: "ship" });
    expect(cli(dir, "add-arrow", "flow", "x", "--from", "5,5", "--from-side", "top", "--to", "paid").err).toContain("The arrow's start is at a point, which has no sides.");
    expect(cli(dir, "add-arrow", "flow", "x", "--from", "paid", "--from-side", "middle", "--to", "ship").err).toContain('Unknown side "middle". Use one of: top, right, bottom, left.');
    expect(cli(dir, "check").code).toBe(0);
  });

  it("adds a whiteboard view, its shapes and arrows, and shows them from the back to the front", () => {
    const dir = example();
    expect(cli(dir, "add-view", "ideas", "--level", "whiteboard").out).toContain("added view ideas");
    expect(cli(dir, "add-shape", "ideas", "cache", "--kind", "rectangle", "--text", "Cache\nthe menus", "--at", "0,0,180,90", "--fill", "yellow").out).toContain("added rectangle cache to view ideas");
    expect(cli(dir, "add-shape", "ideas", "db", "--kind", "ellipse", "--text", "Orders DB", "--color", "blue", "--dashed").code).toBe(0);
    expect(cli(dir, "add-shape", "ideas", "title", "--kind", "text", "--text", "Faster checkout", "--at", "0,-100", "--size", "large", "--position", "1").out).toContain(
      "added text title to view ideas, as shape 1 from the back",
    );
    expect(cli(dir, "add-shape", "ideas", "scribble", "--kind", "pen", "--points", "0,0 12,6  30,2", "--at", "300,200", "--color", "red").code).toBe(0);
    expect(cli(dir, "add-arrow", "ideas", "reads", "--from", "cache", "--to", "db", "--text", "reads").out).toContain("added arrow reads to view ideas");
    expect(cli(dir, "add-arrow", "ideas", "look", "--from", "500, 260", "--to", "scribble", "--heads", "none", "--dashed").out).toContain("added line look to view ideas");
    expect(JSON.parse(read(dir)).views.ideas.shapes[2]).toEqual({ id: "db", kind: "ellipse", text: "Orders DB", at: [0, 130], color: "blue", dashed: true });
    expect(cli(dir, "show", "ideas").out).toBe(`ideas: Ideas
  level:        whiteboard view

Shapes, from the back to the front:
  1.  title     text       at 0, -100         "Faster checkout"  (large text)
  2.  cache     rectangle  at 0, 0, 180 x 90  "Cache / the menus"  (yellow fill)
  3.  db        ellipse    at 0, 130          "Orders DB"  (blue, dashed)
  4.  scribble  pen        at 300, 200        3 points  (red)

Arrows:
  reads  cache -> db            "reads"
  look   500, 260 --- scribble  (dashed)
`);
    const json = JSON.parse(cli(dir, "show", "ideas", "--json").out);
    expect(json.shapes[3]).toEqual({ id: "scribble", position: 4, kind: "pen", at: [300, 200], points: [[0, 0], [12, 6], [30, 2]], color: "red" });
    expect(json.arrows[1]).toEqual({ id: "look", from: [500, 260], to: "scribble", heads: "none", color: "black", dashed: true });
    expect(read(dir, "docs/views/ideas.md")).toContain("| Rectangle | Cache / the menus |");

    expect(cli(dir, "update-shape", "ideas", "db", "--at", "300,0", "--solid", "--color", "", "--new-id", "orders").out).toContain("renamed shape db to orders in view ideas");
    expect(cli(dir, "update-shape", "ideas", "cache", "--fill", "", "--size", "huge", "--kind", "diamond", "--position", "4").out).toContain("updated shape cache in view ideas, and moved it to 4 from the back");
    expect(cli(dir, "update-shape", "ideas", "scribble", "--points", "0,0 5,5").code).toBe(0);
    expect(cli(dir, "update-arrow", "ideas", "look", "--from", "cache", "--heads", "", "--solid", "--text", "this").code).toBe(0);
    expect(cli(dir, "update-arrow", "ideas", "reads", "--text", "", "--heads", "both", "--color", "green", "--new-id", "talks").out).toContain("renamed arrow reads to talks in view ideas");
    const view = JSON.parse(read(dir)).views.ideas;
    expect(view.shapes.map((s: { id: string }) => s.id)).toEqual(["title", "orders", "scribble", "cache"]);
    expect(view.shapes[1]).toEqual({ id: "orders", kind: "ellipse", text: "Orders DB", at: [300, 0] });
    expect(view.shapes[3]).toEqual({ id: "cache", kind: "diamond", text: "Cache\nthe menus", at: [0, 0, 180, 90], size: "huge" });
    expect(view.arrows).toEqual([
      { id: "talks", from: "cache", to: "orders", heads: "both", color: "green" },
      { id: "look", from: "cache", to: "scribble", text: "this" },
    ]);
    expect(cli(dir, "remove-arrow", "ideas", "look").out).toContain("removed arrow look from view ideas");
    expect(cli(dir, "remove-shape", "ideas", "cache").out).toContain("removed shape cache from view ideas and 1 arrow to or from it");
    expect(cli(dir, "add-shape", "ideas", "x").err).toContain("Pass --kind: rectangle, ellipse, diamond, text or pen.");
    expect(cli(dir, "add-shape", "ideas", "x", "--kind", "rectangle", "--at", "1,2,3").err).toContain('--at needs x,y, or x,y,width,height, e.g. --at 400,120 or --at 400,120,160,80, not "1,2,3".');
    expect(cli(dir, "add-shape", "ideas", "x", "--kind", "pen", "--points", "0,0 1").err).toContain('--points needs points split by spaces, each x,y, e.g. --points "0,0 12,6 30,2", not "0,0 1".');
    expect(cli(dir, "add-shape", "ideas", "x", "--kind", "pen").err).toContain("A pen needs points");
    expect(cli(dir, "add-arrow", "ideas", "x", "--from", "title").err).toContain("Pass --from and --to: a shape's ID, or a point, x,y.");
    expect(cli(dir, "add-arrow", "ideas", "x", "--from", "title", "--to", "1,2,3").err).toContain('--to needs a shape\'s ID or a point, x,y, e.g. --to 400,120, not "1,2,3".');
    expect(cli(dir, "update-shape", "ideas", "title", "--dashed", "--solid").err).toContain("Pass --dashed or --solid, not both.");
    expect(cli(dir, "add-shape", "place-order", "x", "--kind", "text").err).toContain('View "place-order" is a sequence view. Only whiteboard views have shapes and arrows.');
    expect(cli(dir, "check").code).toBe(0);
  });

  it("adds a flowchart view, its blocks and flows, and shows them in order", () => {
    const dir = example();
    expect(cli(dir, "add-view", "returns", "--level", "flowchart", "--scope", "checkout-api", "--title", "Returns").out).toContain("added view returns");
    expect(cli(dir, "add-block", "returns", "asked", "--kind", "start", "--text", "Return asked for", "--at", "0,0").out).toContain("added start asked to view returns");
    expect(cli(dir, "add-block", "returns", "in-time", "--kind", "decision", "--text", "Within 30 days?").out).toContain('warning: views.returns.blocks[1].kind: warning [decision-ways] The decision "in-time" has no way out');
    expect(cli(dir, "add-block", "returns", "refund", "--text", "Refund\nthe card", "--description", "Within 3 days").code).toBe(0);
    expect(cli(dir, "add-block", "returns", "label", "--kind", "input-output", "--position", "3").out).toContain("added input or output label to view returns, as block 3");
    expect(cli(dir, "add-flow", "returns", "asked", "in-time").out).toContain("added flow 1 to view returns: asked -> in-time");
    expect(cli(dir, "add-flow", "returns", "in-time", "label", "--text", "Yes").code).toBe(0);
    expect(cli(dir, "add-flow", "returns", "in-time", "refund", "--text", "No").code).toBe(0);
    expect(cli(dir, "add-flow", "returns", "label", "refund", "--flow", "2").out).toContain("added flow 2 to view returns: label -> refund");
    expect(cli(dir, "show", "returns").out).toBe(`returns: Returns
  level:        flowchart view of checkout-api (Checkout API)

Blocks:
  1.  asked    start            "Return asked for"  (at 0, 0)
  2.  in-time  decision         "Within 30 days?"
  3.  label    input or output  "Label"
  4.  refund   process          "Refund / the card"  Within 3 days

Flows:
  1.  asked -> in-time
  2.  label -> refund
  3.  in-time -> label   "Yes"
  4.  in-time -> refund  "No"
`);
    const json = JSON.parse(cli(dir, "show", "returns", "--json").out);
    expect(json.blocks[0]).toEqual({ id: "asked", position: 1, kind: "start", text: "Return asked for", at: [0, 0] });
    expect(json.flows[2]).toEqual({ flow: 3, from: "in-time", to: "label", text: "Yes" });
    expect(read(dir, "docs/views/returns.md")).toContain('  in_time -->|"Yes"| label\n');
    expect(read(dir, "docs/elements/checkout-api.md")).toContain("- [Returns](../views/returns.md) (its process)");
    expect(cli(dir, "show", "checkout-api").out).toContain("returns (its process)");

    expect(cli(dir, "update-block", "returns", "label", "--kind", "", "--text", "Email a label", "--new-id", "email", "--at", "10,20", "--position", "4").out).toContain(
      "renamed block label to email in view returns, and moved it to block 4",
    );
    expect(cli(dir, "update-block", "returns", "refund", "--description", "", "--at", "").code).toBe(0);
    expect(cli(dir, "update-flow", "returns", "2", "--text", "Sent", "--move-to", "4").out).toContain("moved flow 2 to 4 in view returns");
    expect(cli(dir, "update-flow", "returns", "4", "--text", "").code).toBe(0);
    const view = JSON.parse(read(dir)).views.returns;
    expect(view.blocks.slice(2)).toEqual([
      { id: "refund", text: "Refund\nthe card" },
      { id: "email", text: "Email a label", at: [10, 20] },
    ]);
    expect(view.flows).toEqual([
      { from: "asked", to: "in-time" },
      { from: "in-time", to: "email", text: "Yes" },
      { from: "in-time", to: "refund", text: "No" },
      { from: "email", to: "refund" },
    ]);
    expect(cli(dir, "remove-flow", "returns", "4").out).toContain("removed flow 4 from view returns");
    expect(cli(dir, "remove-block", "returns", "in-time").out).toContain("removed block in-time from view returns and 3 flows to or from it");
    expect(cli(dir, "add-flow", "returns", "asked", "asked").err).toContain("A flow can't go from a block to itself.");
    expect(cli(dir, "add-flow", "returns", "asked").err).toContain("Missing <to>.");
    expect(cli(dir, "remove-flow", "returns", "x").err).toContain("<n> must be a flow's number");
    expect(cli(dir, "add-block", "returns", "x", "--at", "1").err).toContain('--at needs x,y, e.g. --at 400,120, not "1".');
    expect(cli(dir, "add-block", "place-order", "x").err).toContain('View "place-order" is a sequence view. Only flowchart views have blocks and flows.');
    expect(cli(dir, "add-view", "--help").out).toContain("A flowchart view shows the steps of a process");
    expect(cli(dir, "check").code).toBe(0);
  });

  it("links a view to another element, or to nothing, without losing what's on it", () => {
    const dir = example();
    const blocks = JSON.parse(read(dir)).views["checking-out"].blocks;
    expect(cli(dir, "update-view", "checking-out", "--scope", "web-app").out).toContain("updated view checking-out");
    expect(JSON.parse(read(dir)).views["checking-out"]).toMatchObject({ scope: "web-app", blocks });
    expect(cli(dir, "show", "checking-out").out).toContain("flowchart view of web-app (Web App)");
    expect(read(dir, "docs/elements/web-app.md")).toContain("(../views/checking-out.md) (its process)");
    // The Checkout API is no longer the process the view is of, but one of its lanes is still for it.
    expect(read(dir, "docs/elements/checkout-api.md")).not.toContain("(../views/checking-out.md) (its process)");
    expect(read(dir, "docs/elements/checkout-api.md")).toContain("(../views/checking-out.md) (its lane, Checkout API)");
    expect(cli(dir, "update-view", "checking-out", "--scope", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views["checking-out"].scope).toBeUndefined();
    expect(cli(dir, "update-view", "order-states", "--scope", "ordr").err).toContain('Scope "ordr" isn\'t an element. Did you mean "order"?');
    expect(cli(dir, "update-view", "shop-containers", "--scope", "warehouse").err).toContain("Its scope is what it draws, so it can't change: add a view of the other system instead.");
    expect(cli(dir, "update-view", "--help").out).toContain("--scope links a state, wireframe, flowchart or entity view to another element");
    expect(cli(dir, "check").code).toBe(0);
  });

  it("puts a flowchart's blocks in lanes, moves them out, and shows the lanes", () => {
    const dir = example();
    expect(cli(dir, "add-view", "returns", "--level", "flowchart").code).toBe(0);
    expect(cli(dir, "add-lane", "returns", "staff", "--name", "Shop staff").out).toContain("added lane staff to view returns");
    expect(cli(dir, "add-lane", "returns", "customer", "--position", "1", "--description", "Whoever bought it").out).toContain("added lane customer to view returns, as lane 1");
    expect(cli(dir, "add-block", "returns", "asked", "--kind", "start", "--lane", "customer").code).toBe(0);
    expect(cli(dir, "add-block", "returns", "refund", "--lane", "staff", "--at", "10,120").code).toBe(0);
    expect(cli(dir, "add-block", "returns", "done", "--kind", "end").code).toBe(0);
    expect(cli(dir, "show", "returns").out).toBe(`returns: Returns
  level:        flowchart view

Lanes, left to right:
  customer  Customer    Whoever bought it
  staff     Shop staff

Blocks:
  1.  asked   start    "Asked"  (in customer)
  2.  refund  process  "Refund"  (in staff)  (at 10, 120)
  3.  done    end      "Done"

Flows:
  (none)
`);
    expect(JSON.parse(cli(dir, "show", "returns", "--json").out).blocks[1]).toEqual({ id: "refund", position: 2, kind: "process", text: "Refund", lane: "staff", at: [10, 120] });
    expect(read(dir, "docs/views/returns.md")).toContain('  subgraph lane__staff["Shop staff"]');
    expect(cli(dir, "update-block", "returns", "refund", "--lane", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.returns.blocks[1]).toEqual({ id: "refund", text: "Refund", at: [10, 120] });
    expect(cli(dir, "remove-lane", "returns", "customer").out).toContain("removed lane customer from view returns, leaving 1 block in no lane, to be laid out again");
    expect(cli(dir, "add-block", "returns", "x", "--lane", "nope").err).toContain('View "returns" has no lane "nope". Its lanes: staff.');
    expect(cli(dir, "add-lane", "--help").out).toContain("to a flowchart, a column for its blocks");
    expect(cli(dir, "check").code).toBe(0);
  });

  it("makes a flowchart's lane for an element, shows it, and takes it off", () => {
    const dir = example();
    expect(cli(dir, "add-view", "returns", "--level", "flowchart").code).toBe(0);
    expect(cli(dir, "add-lane", "returns", "buyer", "--element", "customer").out).toContain("added lane buyer to view returns");
    expect(cli(dir, "add-lane", "returns", "staff", "--name", "Shop staff").code).toBe(0);
    expect(cli(dir, "update-lane", "returns", "staff", "--element", "orders-db").code).toBe(0);
    expect(JSON.parse(read(dir)).views.returns.lanes).toEqual([
      { id: "buyer", name: "Customer", element: "customer" },
      { id: "staff", name: "Shop staff", element: "orders-db" },
    ]);
    expect(cli(dir, "show", "returns").out).toContain(`Lanes, left to right:
  buyer  Customer  (for customer)
  staff  Shop staff  (for orders-db)
`);
    expect(JSON.parse(cli(dir, "show", "returns", "--json").out).lanes[0]).toEqual({ id: "buyer", name: "Customer", element: "customer" });
    expect(cli(dir, "show", "customer").out).toContain("returns (lane buyer)");
    expect(read(dir, "docs/elements/customer.md")).toContain("- [Returns](../views/returns.md) (its lane, Customer)");
    expect(cli(dir, "add-lane", "returns", "x", "--element", "nope").err).toContain('No element has the ID "nope".');
    expect(cli(dir, "update-lane", "returns", "staff", "--element", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.returns.lanes[1]).toEqual({ id: "staff", name: "Shop staff" });
    expect(cli(dir, "update-lane", "--help").out).toContain('--element "" takes it off');
    expect(cli(dir, "check").code).toBe(0);
  });

  it("adds an entity view, its entities, attributes and links, and shows them with how many of each end there can be", () => {
    const dir = example();
    expect(cli(dir, "add-view", "people", "--level", "entity", "--scope", "orders-db").out).toContain("added view people");
    expect(JSON.parse(read(dir)).views.people.title).toBe("Orders DB entities");
    expect(cli(dir, "add-entity", "people", "person", "--description", "Someone we know", "--at", "0,0").out).toContain("added entity person to view people");
    expect(cli(dir, "add-entity", "people", "team", "--name", "Team").code).toBe(0);
    expect(cli(dir, "add-entity", "people", "badge", "--position", "1").out).toContain("added entity badge to view people, as entity 1");
    expect(cli(dir, "add-attribute", "people", "person", "id", "--type", "uuid", "--key", "pk").out).toContain("added attribute id to entity person in view people");
    expect(cli(dir, "add-attribute", "people", "person", "team_id", "--type", "uuid", "--key", "fk").code).toBe(0);
    expect(cli(dir, "add-attribute", "people", "person", "email", "--type", "text", "--key", "uk,pk", "--description", "Work email", "--position", "2").out).toContain(
      "added attribute email to entity person in view people, as attribute 2",
    );
    expect(cli(dir, "add-link", "people", "team", "person", "--text", "has").out).toContain("added link 1 to view people: team -> person");
    expect(cli(dir, "add-link", "people", "person", "badge", "--cardinality", "one,zero-or-one").code).toBe(0);
    expect(cli(dir, "add-link", "people", "person", "person", "--cardinality", "zero-or-one,zero-or-more", "--text", "manages", "--link", "1").out).toContain("added link 1 to view people: person -> person");
    expect(cli(dir, "show", "people").out).toBe(`people: Orders DB entities
  level:        entity view of orders-db (Orders DB)

Entities:
  1. badge "Badge"
       (no attributes)
  2. person "Person"  Someone we know  (at 0, 0)
       id       uuid  pk
       email    text  pk,uk  Work email
       team_id  uuid  fk
  3. team "Team"
       (no attributes)

Links (how many of from, then of to):
  1.  person -> person  zero-or-one to zero-or-more  "manages"
  2.  team -> person    one to zero-or-more          "has"
  3.  person -> badge   one to zero-or-one
`);
    const json = JSON.parse(cli(dir, "show", "people", "--json").out);
    expect(json.entities[1].attributes[1]).toEqual({ name: "email", position: 2, type: "text", keys: ["pk", "uk"], description: "Work email" });
    expect(json.links[0]).toEqual({ link: 1, from: "person", to: "person", cardinality: ["zero-or-one", "zero-or-more"], text: "manages" });
    expect(read(dir, "docs/views/people.md")).toContain('  person |o--o{ person : "manages"\n');
    expect(read(dir, "docs/elements/orders-db.md")).toContain("- [Orders DB entities](../views/people.md) (its data)");
    expect(cli(dir, "show", "orders-db").out).toContain("people (its data)");

    expect(cli(dir, "update-entity", "people", "team", "--name", "Squad", "--new-id", "squad", "--description", "Who works together", "--at", "10,20", "--position", "1").out).toContain(
      "renamed entity team to squad in view people, and moved it to entity 1",
    );
    expect(cli(dir, "update-entity", "people", "person", "--description", "", "--at", "").code).toBe(0);
    expect(cli(dir, "update-attribute", "people", "person", "email", "--new-name", "mail", "--type", "", "--key", "uk", "--position", "3").out).toContain(
      "renamed attribute email to mail of entity person in view people, and moved it to attribute 3",
    );
    expect(cli(dir, "update-attribute", "people", "person", "id", "--key", "", "--description", "Ours").code).toBe(0);
    expect(cli(dir, "update-link", "people", "2", "--cardinality", "one,one-or-more", "--text", "", "--move-to", "3").out).toContain("moved link 2 to 3 in view people");
    expect(cli(dir, "update-link", "people", "1", "--cardinality", "").code).toBe(0);
    const view = JSON.parse(read(dir)).views.people;
    expect(view.entities[0]).toEqual({ id: "squad", name: "Squad", description: "Who works together", attributes: [], at: [10, 20] });
    expect(view.entities[2]).toEqual({
      id: "person",
      name: "Person",
      attributes: [
        { name: "id", type: "uuid", description: "Ours" },
        { name: "team_id", type: "uuid", keys: ["fk"] },
        { name: "mail", keys: ["uk"], description: "Work email" },
      ],
    });
    expect(view.links).toEqual([
      { from: "person", to: "person", text: "manages" },
      { from: "person", to: "badge", cardinality: ["one", "zero-or-one"] },
      { from: "squad", to: "person", cardinality: ["one", "one-or-more"] },
    ]);
    expect(cli(dir, "remove-link", "people", "1").out).toContain("removed link 1 from view people");
    expect(cli(dir, "remove-attribute", "people", "person", "mail").out).toContain("removed attribute mail from entity person in view people");
    expect(cli(dir, "remove-entity", "people", "person").out).toContain("removed entity person from view people and 2 links to or from it");
    expect(cli(dir, "add-link", "people", "squad", "nobody").err).toContain('View "people" has no entity "nobody". Its entities: squad, badge.');
    expect(cli(dir, "add-link", "people", "squad", "badge", "--cardinality", "one").err).toContain('--cardinality needs how many of each end there can be, from\'s then to\'s, e.g. --cardinality one,zero-or-more, not "one".');
    expect(cli(dir, "add-link", "people", "squad", "badge", "--cardinality", "one,lots").err).toContain('Unknown cardinality "lots".');
    expect(cli(dir, "add-attribute", "people", "squad", "x", "--key", "primary").err).toContain('Unknown key "primary".');
    expect(cli(dir, "add-attribute", "people", "squad").err).toContain("Missing <name>.");
    expect(cli(dir, "add-entity", "people", "x", "--position", "x").err).toContain("--position must be an entity's number: 1 is the first.");
    expect(cli(dir, "remove-link", "people", "x").err).toContain("<n> must be a link's number");
    expect(cli(dir, "add-entity", "place-order", "x").err).toContain('View "place-order" is a sequence view. Only entity views have entities, attributes and links.');
    expect(cli(dir, "add-view", "--help").out).toContain("An entity view shows the data something keeps, as an entity-relationship diagram (ERD)");
    expect(cli(dir, "add-link", "--help").out).toContain("Drawn in crow's foot notation");
    expect(cli(dir, "--help").out).toContain("add-link <view> <from> <to>");
    expect(cli(dir, "check").code).toBe(0);
  });

  it("applies a batch of screens and widgets from JSON, all or nothing", () => {
    const dir = example();
    const ops = [
      { op: "add-view", id: "sign-in", level: "wireframe" },
      { op: "add-screen", view: "sign-in", id: "form" },
      { op: "add-widget", view: "sign-in", id: "buttons", kind: "row", screen: "form" },
      { op: "add-widget", view: "sign-in", id: "go", kind: "button", in: "buttons", text: "Go" },
    ];
    writeFileSync(join(dir, "good.json"), JSON.stringify(ops));
    expect(cli(dir, "apply", "good.json").out).toContain("added row buttons to screen form in view sign-in\nadded button go to row buttons in view sign-in\n");
    writeFileSync(join(dir, "bad.json"), JSON.stringify([{ op: "add-widget", view: "sign-in", id: "late", kind: "link", screen: "form", to: "never" }]));
    expect(cli(dir, "apply", "bad.json").err).toContain('View "sign-in" has no screen "never".');
    expect(JSON.parse(read(dir)).views["sign-in"].screens[0].widgets.map((w: { id: string }) => w.id)).toEqual(["buttons"]);
  });

  it("removes fields with empty values and hides elements from views", () => {
    const dir = example();
    expect(cli(dir, "update-element", "web-app", "--technology", "", "--tag", "frontend").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["web-app"]).not.toHaveProperty("technology");
    expect(cli(dir, "hide-in-view", "shop-containers", "customer", "warehouse").code).toBe(0);
    expect(JSON.parse(read(dir)).views["shop-containers"].exclude).toEqual(["customer", "warehouse"]);
  });

  it("adds, moves and removes sticky notes, and shows them with the view and in its docs", () => {
    const dir = example();
    expect(cli(dir, "add-sticky", "landscape", "start-here", "--text", "Start here.", "--color", "green", "--at", "400,-80").code).toBe(0);
    expect(JSON.parse(read(dir)).views.landscape.stickies).toEqual({ "start-here": { text: "Start here.", color: "green", at: [400, -80] } });
    expect(cli(dir, "show", "landscape").out).toContain("Sticky notes:\n  start-here (green at 400, -80):\n    Start here.\n");
    expect(read(dir, "docs/views/landscape.md")).toContain("## Sticky notes\n\n> Start here.\n");
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--at", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.landscape.stickies["start-here"]).not.toHaveProperty("at");
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--at", "4").err).toContain("--at needs x,y");
    expect(cli(dir, "add-sticky", "landscape", "x").err).toContain("Pass --text");
    expect(cli(dir, "remove-sticky", "landscape", "start-here").code).toBe(0);
    expect(JSON.parse(read(dir)).views.landscape).not.toHaveProperty("stickies");
  });

  it("gives sticky notes notes, shows them, puts them in the docs, and takes them off", () => {
    const dir = example();
    expect(cli(dir, "add-sticky", "landscape", "start-here", "--text", "Start here.", "--notes", "Then **zoom in**.").code).toBe(0);
    writeFileSync(join(dir, "notes.md"), "What each step sends.\n\n- In order.\n");
    expect(cli(dir, "add-sticky", "place-order", "steps", "--text", "The steps.", "--notes-file", "notes.md").code).toBe(0);
    const stickies = (view: string) => JSON.parse(read(dir)).views[view].stickies;
    expect(stickies("landscape")).toEqual({ "start-here": { text: "Start here.", notes: "Then **zoom in**." } });
    expect(stickies("place-order").steps).toEqual({ text: "The steps.", notes: "What each step sends.\n\n- In order." });
    expect(cli(dir, "show", "landscape").out).toContain("Sticky notes:\n  start-here (yellow):\n    Start here.\n    Notes:\n      Then **zoom in**.\n");
    expect(cli(dir, "show", "place-order").out).toContain("  steps (yellow):\n    The steps.\n    Notes:\n      What each step sends.\n\n      - In order.\n");
    expect(JSON.parse(cli(dir, "show", "landscape", "--json").out).stickies).toEqual([{ id: "start-here", text: "Start here.", color: "yellow", notes: "Then **zoom in**." }]);
    expect(JSON.parse(cli(dir, "show", "place-order", "--json").out).stickies).toContainEqual({ id: "steps", text: "The steps.", color: "yellow", notes: "What each step sends.\n\n- In order." });
    expect(read(dir, "docs/views/landscape.md")).toContain("## Sticky notes\n\n> Start here.\n>\n> Then **zoom in**.\n");
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--notes", "Then pick a system.").code).toBe(0);
    expect(stickies("landscape")["start-here"]).toEqual({ text: "Start here.", notes: "Then pick a system." });
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--notes", "").code).toBe(0);
    expect(stickies("landscape")["start-here"]).toEqual({ text: "Start here." });
  });

  it("puts sticky notes on elements and relationships, moves them, takes them off, and shows what they're on", () => {
    const dir = example();
    const notes = () => JSON.parse(read(dir)).views["shop-containers"].stickies;
    expect(cli(dir, "add-sticky", "shop-containers", "db", "--text", "Backed up nightly.", "--element", "orders-db").out).toContain("added sticky note db to view shop-containers, on orders-db\n");
    expect(cli(dir, "add-sticky", "shop-containers", "orders", "--text", "Retried twice.", "--from", "web-app", "--to", "checkout-controller").code).toBe(0);
    expect(notes()).toEqual({ db: { text: "Backed up nightly.", on: { element: "orders-db" } }, orders: { text: "Retried twice.", on: { from: "web-app", to: "checkout-controller" } } });
    const shown = cli(dir, "show", "shop-containers").out;
    expect(shown).toContain("Sticky notes:\n  db (yellow), on orders-db:\n    Backed up nightly.\n  orders (yellow), on web-app -> checkout-controller:\n    Retried twice.\n");
    expect(JSON.parse(cli(dir, "show", "shop-containers", "--json").out).stickies).toEqual([
      { id: "db", text: "Backed up nightly.", on: { element: "orders-db" }, drawn: true, color: "yellow" },
      // As the file writes it, with an association's kind left out.
      { id: "orders", text: "Retried twice.", on: { from: "web-app", to: "checkout-controller" }, drawn: true, color: "yellow" },
    ]);
    expect(read(dir, "docs/views/shop-containers.md")).toContain("> On [Orders DB](../elements/orders-db.md): Backed up nightly.\n");

    // Hidden, the box has no line to its note, and show and check say so.
    const hidden = cli(dir, "hide-in-view", "shop-containers", "orders-db").out;
    expect(hidden).toContain('warning: views.shop-containers.stickies.db.on: warning [sticky-target-not-drawn] The note "db" is on "orders-db", which this view doesn\'t draw');
    expect(cli(dir, "show", "shop-containers").out).toContain("  db (yellow), on orders-db, which this view doesn't draw:\n");

    expect(cli(dir, "update-sticky", "shop-containers", "db", "--from", "customer", "--to", "web-app", "--at", "10,20").code).toBe(0);
    expect(notes().db).toEqual({ text: "Backed up nightly.", on: { from: "customer", to: "web-app" }, at: [10, 20] });
    expect(cli(dir, "update-sticky", "shop-containers", "db", "--detach").code).toBe(0);
    expect(notes().db).toEqual({ text: "Backed up nightly.", at: [10, 20] });

    expect(cli(dir, "add-sticky", "shop-containers", "x", "--text", "X", "--from", "web-app").err).toContain("Pass --from and --to together");
    expect(cli(dir, "add-sticky", "shop-containers", "x", "--text", "X", "--element", "web-app", "--to", "checkout-api").err).toContain("Pass --element, --block, or --from and --to, not more than one of them.");
    expect(cli(dir, "update-sticky", "shop-containers", "db", "--element", "web-app", "--detach").err).toContain("Pass --element, --block, --from and --to, or --detach, not more than one of them.");
    expect(cli(dir, "add-sticky", "place-order", "x", "--text", "X", "--element", "web-app").err).toContain('View "place-order" is a sequence view.');
    expect(cli(dir, "add-sticky", "shop-containers", "x", "--text", "X", "--from", "web-app", "--to", "orders-db").err).toContain('"web-app" has no relationship to "orders-db".');
  });

  it("puts a sticky note on a flowchart's block, moves it, takes it off, and shows what it's on", () => {
    const dir = example();
    const note = () => JSON.parse(read(dir)).views["checking-out"].stickies.retry;
    const added = cli(dir, "add-sticky", "checking-out", "retry", "--text", "As often as they like.", "--block", "declined");
    expect(added.out).toContain("added sticky note retry to view checking-out, on block declined\n");
    expect(note()).toEqual({ text: "As often as they like.", on: { block: "declined" } });
    expect(cli(dir, "show", "checking-out").out).toContain("  retry (yellow), on block declined:\n    As often as they like.\n");
    expect(JSON.parse(cli(dir, "show", "checking-out", "--json").out).stickies).toContainEqual({ id: "retry", text: "As often as they like.", on: { block: "declined" }, drawn: true, color: "yellow" });
    expect(read(dir, "docs/views/checking-out.md")).toContain('> On "Say the card was declined": As often as they like.\n');

    expect(cli(dir, "update-sticky", "checking-out", "retry", "--block", "card-details", "--at", "10,20").code).toBe(0);
    expect(note()).toEqual({ text: "As often as they like.", on: { block: "card-details" }, at: [10, 20] });
    // It follows its block to a new ID, and comes off one that's removed.
    expect(cli(dir, "update-block", "checking-out", "card-details", "--new-id", "read-card").code).toBe(0);
    expect(note().on).toEqual({ block: "read-card" });
    expect(cli(dir, "remove-block", "checking-out", "read-card").code).toBe(0);
    expect(note()).toEqual({ text: "As often as they like.", at: [10, 20] });
    expect(cli(dir, "update-sticky", "checking-out", "retry", "--block", "paid").code).toBe(0);
    expect(cli(dir, "update-sticky", "checking-out", "retry", "--detach").code).toBe(0);
    expect(note()).toEqual({ text: "As often as they like.", at: [10, 20] });

    expect(cli(dir, "add-sticky", "checking-out", "x", "--text", "X", "--block", "declind").err).toContain('View "checking-out" has no block "declind". Did you mean "declined"?');
    expect(cli(dir, "add-sticky", "checking-out", "x", "--text", "X", "--element", "checkout-api").err).toContain('View "checking-out" is a flowchart view, which draws its blocks, not elements or relationships');
    expect(cli(dir, "add-sticky", "shop-containers", "x", "--text", "X", "--block", "paid").err).toContain('View "shop-containers" is a container view. Only a sticky note on a flowchart view can be on a block.');
    expect(cli(dir, "add-sticky", "checking-out", "x", "--text", "X", "--block", "paid", "--element", "web-app").err).toContain("Pass --element, --block, or --from and --to, not more than one of them.");
    expect(cli(dir, "update-sticky", "checking-out", "retry", "--block", "paid", "--detach").err).toContain("Pass --element, --block, --from and --to, or --detach, not more than one of them.");
    expect(cli(dir, "add-sticky", "--help").out).toContain("--block <id>           The block it's on, on a flowchart view");
    expect(cli(dir, "update-block", "--help").out).toContain("--new-id changes its ID, and the flows to and from it, and the sticky notes on it, follow it.");
    expect(cli(dir, "remove-block", "--help").out).toContain("Removes a block, and the flows to and from it. A sticky note on it stays on the view, on nothing.");
  });

  it("adds, changes, moves and removes a sequence view's steps, and shows them", () => {
    const dir = example();
    expect(cli(dir, "add-view", "refund", "--level", "sequence", "--description", "Giving money back.").code).toBe(0);
    expect(JSON.parse(read(dir)).views.refund).toEqual({ title: "Refund", description: "Giving money back.", level: "sequence", steps: [] });
    expect(cli(dir, "add-step", "refund", "customer", "web-app", "--description", "Asks for a refund").code).toBe(0);
    expect(cli(dir, "add-step", "refund", "payment-client", "payment-provider").code).toBe(0);
    expect(cli(dir, "add-step", "refund", "web-app", "checkout-api", "--step", "2").code).toBe(0);
    expect(cli(dir, "add-step", "refund", "payment-provider", "checkout-api", "--reply", "--description", "Refunded").code).toBe(0);
    const shown = cli(dir, "show", "refund").out;
    expect(shown).toContain("Participants:\n  customer          person             Customer\n  web-app           container          Web App [React]\n");
    expect(shown).toContain(
      [
        "Steps:",
        "  1.  customer -> web-app                 Asks for a refund [HTTPS]",
        "  2.  web-app -> checkout-api             Places orders [HTTPS/JSON]  (via web-app -> checkout-controller)",
        "  3.  payment-client -> payment-provider  Charges cards [HTTPS]",
        "  4.  payment-provider --> checkout-api   Refunded  (reply)  (via payment-client -> payment-provider)",
      ].join("\n"),
    );
    expect(JSON.parse(cli(dir, "show", "refund", "--json").out).steps[3]).toMatchObject({ step: 4, from: "payment-provider", to: "checkout-api", reply: true, label: "Refunded" });
    expect(read(dir, "docs/views/refund.md")).toContain("  payment_provider-->>checkout_api: Refunded\n");

    expect(cli(dir, "update-step", "refund", "4", "--move-to", "1", "--description", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.refund.steps[0]).toEqual({ from: "payment-provider", to: "checkout-api", reply: true });
    expect(cli(dir, "update-step", "refund", "1", "--call").err).toContain('no relationship from "payment-provider" to "checkout-api"');
    expect(cli(dir, "update-step", "refund", "1", "--reply", "--call")).toMatchObject({ code: 2, err: expect.stringContaining("not both") });
    expect(cli(dir, "remove-step", "refund", "0")).toMatchObject({ code: 2, err: expect.stringContaining("<n> must be a step's number") });
    expect(cli(dir, "remove-step", "refund", "1").code).toBe(0);
    expect(JSON.parse(read(dir)).views.refund.steps).toHaveLength(3);
    expect(cli(dir, "add-step", "refund", "orders-db", "customer").err).toContain('The model has no relationship from "orders-db" to "customer"');
    expect(cli(dir, "show-in-view", "refund", "orders-db").err).toContain("Add a step with add-step");
    expect(cli(dir, "add-step", "landscape", "customer", "shop").err).toContain("Only sequence views have steps");
  });

  it("keeps elements added later out of a view, or lets them in", () => {
    const dir = example();
    expect(cli(dir, "update-view", "shop-containers", "--new-elements", "hide").code).toBe(0);
    expect(JSON.parse(read(dir)).views["shop-containers"].include).not.toContain("*");
    expect(cli(dir, "add-element", "cache", "--kind", "container", "--parent", "shop").code).toBe(0);
    expect(cli(dir, "show", "shop-containers").out).toContain("  new elements: hidden until shown with show-in-view\n");
    expect(cli(dir, "show", "shop-containers").out).not.toContain("cache");
    expect(JSON.parse(cli(dir, "show", "shop-containers", "--json").out).newElements).toBe("hide");
    expect(cli(dir, "update-view", "shop-containers", "--new-elements", "show").code).toBe(0);
    expect(JSON.parse(read(dir)).views["shop-containers"]).toMatchObject({ include: ["*"], exclude: ["cache"] });
    expect(cli(dir, "update-view", "shop-containers", "--new-elements", "some").err).toContain('Unknown new-elements setting "some". Use show or hide.');
  });

  it("makes a relationship go both ways, shows it, and lets steps go along it either way", () => {
    const dir = example();
    expect(cli(dir, "add-relationship", "warehouse", "checkout-controller").code).toBe(0);
    expect(cli(dir, "remove-relationship", "warehouse", "checkout-controller").code).toBe(0);
    expect(cli(dir, "add-step", "place-order", "warehouse", "checkout-controller").err).toContain('or make the one from "checkout-controller" to "warehouse" go both ways');
    expect(cli(dir, "update-relationship", "checkout-controller", "warehouse", "--bidirectional").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["checkout-controller"].uses[2]).toEqual({ to: "warehouse", bidirectional: true, description: "Reserves stock", technology: "gRPC" });
    expect(cli(dir, "show", "checkout-controller").out).toContain("  <-> warehouse        Reserves stock [gRPC] (both ways)");
    expect(cli(dir, "show", "warehouse").out).toContain("  <-> checkout-controller  Reserves stock [gRPC] (both ways)");
    expect(cli(dir, "show", "shop-context").out).toContain("  shop <-> warehouse");
    expect(read(dir, "docs/views/shop-context.md")).toContain("  shop <-->|");
    expect(cli(dir, "show", "shop-containers").out).toContain("(via checkout-controller <-> warehouse)");
    expect(cli(dir, "show", "checkout-api").out).toContain("Its contents use:\n  checkout-controller <-> warehouse   Reserves stock [gRPC] (both ways)\n");
    expect(JSON.parse(cli(dir, "show", "checkout-api", "--json").out).contentsUse[0]).toMatchObject({ from: "checkout-controller", to: "warehouse", bidirectional: true });
    expect(cli(dir, "update-relationship", "web-app", "checkout-controller", "--bidirectional").code).toBe(0);
    expect(cli(dir, "show", "checkout-api").out).toContain("Its contents are used by:\n  web-app <-> checkout-controller  Places orders [HTTPS/JSON] (both ways)\n");
    expect(JSON.parse(cli(dir, "show", "checkout-api", "--json").out).contentsUsedBy[0]).toMatchObject({ from: "web-app", to: "checkout-controller", bidirectional: true });
    expect(cli(dir, "add-view", "ordering", "--level", "sequence").code).toBe(0);
    expect(cli(dir, "add-step", "ordering", "web-app", "checkout-api").code).toBe(0);
    expect(cli(dir, "show", "ordering").out).toContain("(via web-app <-> checkout-controller)");
    expect(cli(dir, "add-step", "place-order", "warehouse", "checkout-controller", "--description", "Stock reserved").code).toBe(0);
    // A step back along a relationship that goes both ways is direct: it needs no "via".
    expect(cli(dir, "show", "place-order").out).toMatch(/warehouse -> checkout-controller +Stock reserved \[gRPC\]\n/);
    expect(cli(dir, "update-relationship", "checkout-controller", "warehouse", "--bidirectional", "--one-way")).toMatchObject({ code: 2, err: expect.stringContaining("not both") });
    expect(cli(dir, "update-relationship", "checkout-controller", "warehouse", "--one-way").code).toBe(0);
    expect(cli(dir, "check").out).toContain("step-relationship-missing");
    expect(cli(dir, "add-relationship", "customer", "shop", "--bidirectional", "--description", "Chats with").code).toBe(0);
    expect(JSON.parse(read(dir)).elements.customer.uses[1]).toEqual({ to: "shop", bidirectional: true, description: "Chats with" });
  });

  it("gives views and relationships notes, shows them, and puts them in the docs", () => {
    const dir = example();
    expect(cli(dir, "update-view", "shop-containers", "--notes", "Drawn for **new starters**.").code).toBe(0);
    writeFileSync(join(dir, "notes.md"), "Over a pooled connection.\n\n- Retries twice.\n");
    expect(cli(dir, "update-relationship", "order-repository", "orders-db", "--notes-file", "notes.md").code).toBe(0);
    expect(cli(dir, "add-relationship", "customer", "warehouse", "--description", "Tracks parcels", "--notes", "On the courier's site.").code).toBe(0);
    expect(cli(dir, "add-view", "parcels", "--level", "landscape", "--notes", "Where parcels go.").code).toBe(0);
    const doc = JSON.parse(read(dir));
    expect(doc.views["shop-containers"].notes).toBe("Drawn for **new starters**.");
    expect(doc.views.parcels.notes).toBe("Where parcels go.");
    expect(doc.elements["order-repository"].uses[0]).toEqual({ to: "orders-db", description: "Reads and writes orders", technology: "SQL", notes: "Over a pooled connection.\n\n- Retries twice." });
    expect(doc.elements.customer.uses[1]).toEqual({ to: "warehouse", description: "Tracks parcels", notes: "On the courier's site." });

    expect(cli(dir, "show", "shop-containers").out).toContain("  description:  What runs inside the shop.\n  new elements: shown here on their own\n\nNotes:\n  Drawn for **new starters**.\n\nBoxes:");
    expect(JSON.parse(cli(dir, "show", "shop-containers", "--json").out)).toMatchObject({ description: "What runs inside the shop.", notes: "Drawn for **new starters**." });
    expect(cli(dir, "show", "orders-db").out).toContain("<- order-repository  Reads and writes orders [SQL]\n      Over a pooled connection.\n\n      - Retries twice.\n");
    expect(JSON.parse(cli(dir, "show", "order-repository", "--json").out).uses[0]).toMatchObject({ notes: "Over a pooled connection.\n\n- Retries twice." });
    expect(read(dir, "docs/views/shop-containers.md")).toContain("What runs inside the shop.\n\nDrawn for **new starters**.\n");
    expect(read(dir, "docs/elements/orders-db.md")).toContain("### Order Repository → Orders DB: Reads and writes orders\n\nOver a pooled connection.\n");

    expect(cli(dir, "update-view", "shop-containers", "--notes", "").code).toBe(0);
    expect(cli(dir, "update-relationship", "order-repository", "orders-db", "--notes", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views["shop-containers"]).not.toHaveProperty("notes");
    expect(JSON.parse(read(dir)).elements["order-repository"].uses[0]).not.toHaveProperty("notes");
  });

  it("sets shapes and tags, removes them, and shows them", () => {
    const dir = example();
    expect(cli(dir, "update-element", "web-app", "--shape", "web-browser", "--tag", "owner=storefront", "--tag", "team=web=ui", "--tag", "pii").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["web-app"]).toMatchObject({ shape: "web-browser", tags: { owner: "storefront", pii: "", team: "web=ui" } });
    const shown = cli(dir, "show", "web-app");
    expect(shown.out).toContain("  shape:       web-browser\n\nTags:\n  owner  storefront\n  pii\n  team   web=ui\n");
    expect(JSON.parse(cli(dir, "show", "web-app", "--json").out)).toMatchObject({ shape: "web-browser", tags: { owner: "storefront", pii: "" } });
    expect(read(dir, "docs/elements/web-app.md")).toContain("| owner | storefront |");

    expect(cli(dir, "update-element", "web-app", "--shape", "", "--remove-tag", "pii", "--remove-tag", "team").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["web-app"]).not.toHaveProperty("shape");
    expect(JSON.parse(read(dir)).elements["web-app"].tags).toEqual({ owner: "storefront" });

    expect(cli(dir, "update-relationship", "web-app", "checkout-controller", "--tag", "protocol=https").code).toBe(0);
    expect(JSON.parse(cli(dir, "show", "web-app", "--json").out).uses[0]).toMatchObject({ to: "checkout-controller", tags: { protocol: "https" } });
    expect(cli(dir, "show", "web-app").out).toContain("-> checkout-controller  Places orders [HTTPS/JSON] (tags: protocol=https)");
    expect(cli(dir, "update-element", "web-app", "--tag", "owner=").code).toBe(0);
    expect(JSON.parse(read(dir)).elements["web-app"].tags).toEqual({ owner: "" });

    expect(cli(dir, "update-element", "web-app", "--tag", "=x")).toMatchObject({ code: 2, err: expect.stringContaining("--tag needs a name") });
    expect(cli(dir, "update-element", "customer", "--shape", "database").err).toContain("People are always drawn as a person");
    expect(cli(dir, "update-element", "web-app", "--shape", "mobile").err).toContain('Unknown shape "mobile". Did you mean "mobile-app"?');
  });

  it("upgrades a version 1 file the next time it's saved", () => {
    const dir = example();
    const v1 = read(dir)
      .replace('"openarch": 21', '"openarch": 1')
      .replace('"shape": "database"', '"tags": ["database"], "properties": { "owner": "orders" }');
    writeFileSync(join(dir, "shop.openarch"), v1);
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "fmt", "--check").code).toBe(1);
    expect(cli(dir, "fmt").code).toBe(0);
    expect(JSON.parse(read(dir))).toMatchObject({ openarch: 21, elements: { "orders-db": { shape: "database", tags: { owner: "orders" } } } });
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])("reads a version %i file, and writes it back as version 21", (version) => {
    const dir = example();
    writeFileSync(join(dir, "shop.openarch"), read(dir).replace('"openarch": 21', `"openarch": ${version}`));
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "fmt", "--check").code).toBe(1);
    expect(cli(dir, "update-workspace", "--name", "Shop 2").code).toBe(0);
    expect(read(dir)).toMatch(/^\{\n {2}"openarch": 21,\n/);
  });

  it("refuses to change a file that doesn't parse", () => {
    const dir = example();
    writeFileSync(join(dir, "shop.openarch"), read(dir).replace('"kind": "person"', '"kind": "human"'));
    const result = cli(dir, "update-workspace", "--name", "X");
    expect(result.code).toBe(1);
    expect(result.err).toContain("has errors that stop it being changed safely");
  });
});

describe("usage", () => {
  it("explains mistakes with exit code 2", () => {
    const dir = example();
    expect(cli(dir, "frobnicate").code).toBe(2);
    expect(cli(dir, "check", "--nope").code).toBe(2);
    expect(cli(dir, "add-element", "x").err).toContain("Pass --kind");
    expect(cli(dir, "add-relationship", "a").err).toContain("Missing <to>");
    expect(cli(dir, "export", "--file", join(tempDir(), "missing.openarch")).code).toBe(1);
  });
});

describe("init", () => {
  it("leaves an AGENTS.md alone that isn't UTF-8 text, and keeps a byte-order mark", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
    writeFileSync(join(project, "AGENTS.md"), latin1);
    const result = cli(project, "init");
    expect(result.code).toBe(1);
    expect(result.err).toContain("AGENTS.md isn't UTF-8 text, so it was left alone.");
    expect(readFileSync(join(project, "AGENTS.md"))).toEqual(latin1);

    writeFileSync(join(project, "AGENTS.md"), "\uFEFF# Rules\n");
    expect(cli(project, "init").code).toBe(0);
    const bytes = readFileSync(join(project, "AGENTS.md"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString("utf8")).toContain("# Rules\n\n<!-- open-arch:start -->");
  });

  it("refuses to name a path with a line break in AGENTS.md, and says to rename it", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    const result = cli(project, "init", "a\u2028b.openarch");
    expect(result.code).toBe(1);
    expect(result.err).toContain('can\'t name "a\\u2028b.openarch": the workspace\'s path has a line break in it.');
    expect(result.err).toContain("rename the file, or the folder in its path with the break, so its path has none, then run `open-arch init <new path>` with the file's new path from here.");

    // A break in a folder's name, for a file in a subfolder: the steps say the folder and the path.
    const nested = tempDir();
    mkdirSync(join(nested, ".git"));
    const inFolder = cli(nested, "init", "ar\nch/a.openarch");
    expect(inFolder.code).toBe(1);
    expect(inFolder.err).toContain('can\'t name "ar\\nch/a.openarch": the workspace\'s path has a line break in it.');
    expect(inFolder.err).toContain("or the folder in its path with the break");
    expect(inFolder.err).toContain("`open-arch init <new path>` with the file's new path from here");
    expect(existsSync(join(nested, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(project, "AGENTS.md"))).toBe(false);

    // A docs folder's is fixed in the workspace, not by renaming the folder. The steps name the
    // file, as init without one would make a new architecture.openarch.
    const docs = tempDir();
    mkdirSync(join(docs, ".git"));
    const refused = cli(docs, "init", "shop.openarch", "--docs", "do\ncs");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('can\'t name "do\\ncs": the docs folder\'s path has a line break in it.');
    expect(refused.err).toContain("choose a docs folder without one, with `open-arch update-workspace --file shop.openarch --docs <folder>`, then run `open-arch init shop.openarch` again.");
    expect(cli(docs, "update-workspace", "--file", "shop.openarch", "--docs", "docs").code).toBe(0);
    expect(cli(docs, "init", "shop.openarch").code).toBe(0);
    expect(existsSync(join(docs, "architecture.openarch"))).toBe(false);
    expect(read(docs, "AGENTS.md")).toContain("in `shop.openarch`. Readable docs generated from it are in `docs/`.");
  });

  it("writes the section with AGENTS.md's own Windows line endings", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "AGENTS.md"), "# Rules\r\n\r\nUse tabs.\r\n");
    expect(cli(project, "init").code).toBe(0);
    const agents = read(project, "AGENTS.md");
    expect(agents).toContain("\r\n<!-- open-arch:start -->\r\n## Architecture\r\n");
    expect(agents.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("export leaves the docs of another workspace in the same folder alone", () => {
    const project = tempDir();
    for (const [name, title] of [["a.openarch", "A"], ["b.openarch", "B"]]) {
      writeFileSync(join(project, name), JSON.stringify({ openarch: 21, name: title, export: { docs: "." }, elements: {}, views: {} }));
    }
    expect(cli(project, "export", "--file", "a.openarch").code).toBe(0);
    const result = cli(project, "export", "--file", "b.openarch");
    expect(result.code).toBe(0);
    expect(result.out).toContain("wrote them for another workspace beside this one: README.md.");
    expect(read(project, "README.md")).toContain("from a.openarch.");
  });

  it("names the pages of docs at the top of the project in AGENTS.md", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    expect(cli(project, "init", "architecture.openarch", "--docs", ".").code).toBe(0);
    expect(read(project, "AGENTS.md")).toContain("Readable docs generated from it are beside it, at the top of the project: the pages in `elements/` and `views/`, and `README.md` unless the folder has its own.");
    expect(read(project, "AGENTS.md")).toContain("Never edit `architecture.openarch` or a page generated from it (one that starts with `<!-- Generated by open-arch`) by hand.");
    expect(read(project, "README.md")).toContain("<!-- Generated by open-arch");
  });

  it("puts the docs of a file named in a folder with other things in it in docs/architecture, apart from its README.md", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    const service = join(project, "services", "payments");
    mkdirSync(service, { recursive: true });
    writeFileSync(join(service, "README.md"), "# Payments\n");
    expect(cli(service, "init", "payments.openarch").code).toBe(0);
    expect(JSON.parse(read(service, "payments.openarch")).export).toEqual({ docs: "docs/architecture" });
    expect(read(service, "docs/architecture/README.md")).toContain("<!-- Generated by open-arch");
    expect(read(service, "README.md")).toBe("# Payments\n");
    expect(read(project, "AGENTS.md")).toContain("Readable docs generated from it are in `services/payments/docs/architecture/`.");
    expect(read(project, "AGENTS.md")).not.toContain("`services/payments/`");

    // Without a file named, it gets a folder of its own there, with its docs beside it.
    const other = join(project, "services", "orders");
    mkdirSync(other);
    writeFileSync(join(other, "README.md"), "# Orders\n");
    expect(cli(other, "init").out).toContain("created architecture/architecture.openarch");
    expect(JSON.parse(read(other, "architecture/architecture.openarch")).export).toEqual({ docs: "." });
    expect(read(other, "architecture/README.md")).toContain("<!-- Generated by open-arch");
    expect(read(other, "README.md")).toBe("# Orders\n");
  });

  it("says plainly when a file named architecture is where its folder would go", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "architecture"), "notes\n");
    const result = cli(project, "init");
    expect(result.code).toBe(2);
    expect(result.err).toContain("There's a file named architecture here, so init can't make a folder of that name for the workspace. Name the file to make: `open-arch init <folder>/architecture.openarch`.");
    expect(read(project, "architecture")).toBe("notes\n");
  });

  it("makes the workspace in an empty folder, and keeps one made at a repository's top before", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    const folder = join(project, "design");
    mkdirSync(folder);
    expect(cli(folder, "init").code).toBe(0);
    expect(JSON.parse(read(folder, "architecture.openarch")).export).toEqual({ docs: "." });
    expect(read(folder, "README.md")).toContain("<!-- Generated by open-arch");
    // The skill and AGENTS.md still go at the repository's top.
    expect(read(project, "AGENTS.md")).toContain("in `design/architecture.openarch`. Readable docs generated from it are beside it: the pages in `design/elements/` and `design/views/`, and `design/README.md` unless the folder has its own.");

    const older = tempDir();
    mkdirSync(join(older, ".git"));
    writeFileSync(join(older, "architecture.openarch"), JSON.stringify({ openarch: 21, name: "Old", elements: {}, views: {} }));
    expect(cli(older, "init").out).toContain("kept architecture.openarch");
    expect(existsSync(join(older, "architecture"))).toBe(false);
  });

  it("says why when AGENTS.md can't be read at all", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    mkdirSync(join(project, "AGENTS.md"));
    const result = cli(project, "init");
    expect(result.code).toBe(1);
    expect(result.err).toContain("Couldn't read AGENTS.md: EISDIR");
    expect(result.err).not.toContain("isn't UTF-8");
  });

  it("leaves an AGENTS.md alone that has one of the section's markers without the other", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    const broken = "# Rules\n<!-- open-arch:start -->\nMy own notes.\n";
    writeFileSync(join(project, "AGENTS.md"), broken);
    const result = cli(project, "init");
    expect(result.code).toBe(1);
    expect(result.err).toContain("AGENTS.md has <!-- open-arch:start --> without <!-- open-arch:end --> after it, so it was left alone.");
    expect(result.err).toContain("The workspace, its docs and the skill are in place: run `open-arch init architecture/architecture.openarch` again once AGENTS.md is fixed.");
    // Without the skill, it doesn't say the skill is in place.
    const noSkills = cli(project, "init", "--no-skills");
    expect(noSkills.code).toBe(1);
    expect(noSkills.err).toContain("The workspace and its docs are in place: run `open-arch init architecture/architecture.openarch` again once AGENTS.md is fixed.");
    expect(read(project, "AGENTS.md")).toBe(broken);
  });

  it("creates a workspace in a folder of its own with docs, installs the skill and AGENTS.md section, and can run again", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "AGENTS.md"), "# Project rules\n\nUse tabs.\n");
    writeFileSync(join(project, "README.md"), "# My project\n");

    const created = cli(project, "init", "--name", "Payments");
    expect(created.code).toBe(0);
    // The desktop app and, in Chrome or Edge, the web app edit the file; other browsers keep a copy.
    expect(created.out).toContain("open the file in the desktop app. In Chrome or Edge, the web app's Open folder… edits it too; other browsers edit a copy: import the file, then export it back.");
    expect(created.out).toContain("created architecture/architecture.openarch");
    expect(JSON.parse(read(project, "architecture/architecture.openarch"))).toEqual({ openarch: 21, name: "Payments", export: { docs: "." }, elements: {}, views: {} });
    // At the repository's top, the workspace gets a folder of its own, with its docs beside it, apart from the repository's README.md.
    expect(read(project, "architecture/README.md")).toContain("# Payments");
    expect(read(project, "README.md")).toBe("# My project\n");
    for (const target of [".agents/skills/open-arch", ".claude/skills/open-arch"]) {
      const skill = read(project, `${target}/SKILL.md`);
      expect(skill).toContain("name: open-arch");
      expect(skill).toContain(`npx -y open-arch@${VERSION}`);
      expect(skill).not.toContain("{{version}}");
    }
    const agents = read(project, "AGENTS.md");
    expect(agents.startsWith("# Project rules\n\nUse tabs.\n\n<!-- open-arch:start -->")).toBe(true);
    expect(agents).toContain("in `architecture/architecture.openarch`. Readable docs generated from it are beside it: the pages in `architecture/elements/` and `architecture/views/`, and `architecture/README.md` unless the folder has its own.");
    expect(agents).toContain("Never edit `architecture/architecture.openarch` or a page generated from it (one that starts with `<!-- Generated by open-arch`) by hand");

    expect(cli(project, "init").out).toContain("kept architecture/architecture.openarch");
    expect(read(project, "AGENTS.md")).toBe(agents);

    expect(cli(project, "add-element", "payments", "--kind", "system").code).toBe(0);
    expect(cli(project, "add-view", "landscape", "--level", "landscape").code).toBe(0);
    expect(cli(project, "check")).toMatchObject({ code: 0, out: "OK: architecture/architecture.openarch, 1 element, 1 view, no problems.\n" });
  });
});
