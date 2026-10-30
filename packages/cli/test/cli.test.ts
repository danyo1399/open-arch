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
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: shop.openarch, 10 elements, 4 views, no problems.\n" });
    expect(cli(dir, "fmt", "--check").code).toBe(0);
    expect(cli(dir, "export", "--check")).toMatchObject({ code: 0 });
  });

  it("checks the tour example cleanly too", () => {
    const dir = fileURLToPath(new URL("../../../examples/food-delivery", import.meta.url));
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: food-delivery.openarch, 21 elements, 5 views, no problems.\n" });
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

    expect(cli(dir, "remove-element", "orders-api").out).toContain("removed orders-api and 3 elements inside it and view checkout-api-components");
    expect(existsSync(join(dir, "docs/views/checkout-api-components.md"))).toBe(false);
    expect(cli(dir, "check").code).toBe(0);
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
    expect(read(dir, "docs/views/landscape.md")).toContain("## Notes\n\n> Start here.\n");
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--at", "").code).toBe(0);
    expect(JSON.parse(read(dir)).views.landscape.stickies["start-here"]).not.toHaveProperty("at");
    expect(cli(dir, "update-sticky", "landscape", "start-here", "--at", "4").err).toContain("--at needs x,y");
    expect(cli(dir, "add-sticky", "landscape", "x").err).toContain("Pass --text");
    expect(cli(dir, "remove-sticky", "landscape", "start-here").code).toBe(0);
    expect(JSON.parse(read(dir)).views.landscape).not.toHaveProperty("stickies");
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
      .replace('"openarch": 2', '"openarch": 1')
      .replace('"shape": "database"', '"tags": ["database"], "properties": { "owner": "orders" }');
    writeFileSync(join(dir, "shop.openarch"), v1);
    expect(cli(dir, "check").code).toBe(0);
    expect(cli(dir, "fmt", "--check").code).toBe(1);
    expect(cli(dir, "fmt").code).toBe(0);
    expect(JSON.parse(read(dir))).toMatchObject({ openarch: 2, elements: { "orders-db": { shape: "database", tags: { owner: "orders" } } } });
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

    expect(cli(project, "init", "--name", "Payments").code).toBe(0);
    expect(JSON.parse(read(project, "architecture.openarch"))).toEqual({ openarch: 2, name: "Payments", export: { docs: "docs/architecture" }, elements: {}, views: {} });
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
