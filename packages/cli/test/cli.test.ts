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
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: shop.openarch, 17 elements, 7 views, no problems.\n" });
    expect(cli(dir, "fmt", "--check").code).toBe(0);
    expect(cli(dir, "export", "--check")).toMatchObject({ code: 0 });
  });

  it("checks the tour example cleanly too", () => {
    const dir = fileURLToPath(new URL("../../../examples/food-delivery", import.meta.url));
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: food-delivery.openarch, 27 elements, 6 views, no problems.\n" });
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

    expect(cli(dir, "remove-element", "orders-api").out).toContain("removed orders-api and 7 elements inside it and views checkout-api-components, order-repository-classes");
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
      .replace('"openarch": 7', '"openarch": 1')
      .replace('"shape": "database"', '"tags": ["database"], "properties": { "owner": "orders" }');
    writeFileSync(join(dir, "shop.openarch"), v1);
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "fmt", "--check").code).toBe(1);
    expect(cli(dir, "fmt").code).toBe(0);
    expect(JSON.parse(read(dir))).toMatchObject({ openarch: 7, elements: { "orders-db": { shape: "database", tags: { owner: "orders" } } } });
  });

  it.each([2, 3, 4, 5, 6])("reads a version %i file, and writes it back as version 7", (version) => {
    const dir = example();
    writeFileSync(join(dir, "shop.openarch"), read(dir).replace('"openarch": 7', `"openarch": ${version}`));
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "fmt", "--check").code).toBe(1);
    expect(cli(dir, "update-workspace", "--name", "Shop 2").code).toBe(0);
    expect(read(dir)).toMatch(/^\{\n {2}"openarch": 7,\n/);
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
  it("creates a workspace with docs, installs the skill and AGENTS.md section, and can run again", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "AGENTS.md"), "# Project rules\n\nUse tabs.\n");

    const created = cli(project, "init", "--name", "Payments");
    expect(created.code).toBe(0);
    // The web app keeps its own copy, so it's the desktop app that edits the file.
    expect(created.out).toContain("open the file in the desktop app. The web app edits a copy: import the file, then export it back.");
    expect(JSON.parse(read(project, "architecture.openarch"))).toEqual({ openarch: 7, name: "Payments", export: { docs: "docs/architecture" }, elements: {}, views: {} });
    expect(read(project, "docs/architecture/README.md")).toContain("# Payments");
    for (const target of [".agents/skills/open-arch", ".claude/skills/open-arch"]) {
      const skill = read(project, `${target}/SKILL.md`);
      expect(skill).toContain("name: open-arch");
      expect(skill).toContain(`npx -y open-arch@${VERSION}`);
      expect(skill).not.toContain("{{version}}");
    }
    const agents = read(project, "AGENTS.md");
    expect(agents.startsWith("# Project rules\n\nUse tabs.\n\n<!-- open-arch:start -->")).toBe(true);
    expect(agents).toContain("Never edit `architecture.openarch` or `docs/architecture/` by hand");

    expect(cli(project, "init").out).toContain("kept architecture.openarch");
    expect(read(project, "AGENTS.md")).toBe(agents);

    expect(cli(project, "add-element", "payments", "--kind", "system").code).toBe(0);
    expect(cli(project, "add-view", "landscape", "--level", "landscape").code).toBe(0);
    expect(cli(project, "check")).toMatchObject({ code: 0, out: "OK: architecture.openarch, 1 element, 1 view, no problems.\n" });
  });
});
