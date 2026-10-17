import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/main.js";
import { VERSION } from "../src/io.js";

const EXAMPLE = new URL("../../../examples/shop", import.meta.url).pathname;
const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-test-"));
  temps.push(dir);
  return dir;
}

/** A copy of the example workspace. */
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

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("open-arch CLI", () => {
  it("checks the example workspace cleanly, and it's already formatted", () => {
    const dir = example();
    expect(cli(dir, "check")).toMatchObject({ code: 0, out: "OK: 10 elements, 4 views, no problems.\n" });
    expect(cli(dir, "fmt", "--check").code).toBe(0);
  });

  it("finds the workspace from a parent folder", () => {
    const dir = example();
    expect(cli(join(dir, ".."), "check").code).toBe(0);
    expect(cli(join(dir, "model", "shop"), "check").code).toBe(0);
  });

  it("reports errors as JSON with fixes, and exits 1", () => {
    const dir = example();
    const file = join(dir, "model/shop/checkout-api/order-repository.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("to: orders-db", "to: order-db"));
    const { code, out } = cli(dir, "check", "--json");
    expect(code).toBe(1);
    const report = JSON.parse(out);
    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]).toMatchObject({
      severity: "error",
      rule: "relationship-unknown-target",
      path: join("model", "shop", "checkout-api", "order-repository.md"),
      line: 8,
      fix: 'Did you mean "orders-db"?',
    });
  });

  it("creates an element, shows it, and keeps the workspace valid", () => {
    const dir = example();
    const created = cli(dir, "new", "element", "cache", "--kind", "container", "--parent", "shop", "--technology", "Redis", "--name", "Cart Cache");
    expect(created.code).toBe(0);
    expect(created.out).toContain(`created ${join("model", "shop", "cache.md")}`);
    expect(created.out).toContain(`updated preview in ${join("views", "shop-containers.md")}`);
    expect(cli(dir, "check").code).toBe(0);
    const shown = cli(dir, "show", "cache", "--json");
    expect(JSON.parse(shown.out)).toMatchObject({ id: "cache", kind: "container", name: "Cart Cache", views: [{ id: "shop-containers", as: "box" }] });
  });

  it("renames an element and everything that refers to it", () => {
    const dir = example();
    const { code, out } = cli(dir, "rename", "checkout-api", "orders-api");
    expect(code).toBe(0);
    expect(out).toContain(`move ${join("model", "shop", "checkout-api.md")} -> ${join("model", "shop", "orders-api.md")}`);
    expect(existsSync(join(dir, "model/shop/checkout-api"))).toBe(false);
    expect(readFileSync(join(dir, "model/shop/orders-api/payment-client.md"), "utf8")).toContain("parent: orders-api");
    expect(readFileSync(join(dir, "views/shop-containers.md"), "utf8")).toContain('"orders-api": {"x": 0, "y": 320}');
    expect(cli(dir, "check").code).toBe(0);
  });

  it("explains usage mistakes with exit code 2", () => {
    const dir = example();
    expect(cli(dir, "frobnicate")).toMatchObject({ code: 2 });
    expect(cli(dir, "check", "--nope").code).toBe(2);
    expect(cli(dir, "new", "element", "x").err).toContain("Pass --kind");
    expect(cli(dir, "new", "element", "x", "--kind", "container").err).toContain("needs a parent system");
    expect(cli(tempDir(), "check").err).toContain("No open-arch workspace found");
  });

  it("init creates a workspace, installs the skill and an AGENTS.md section, and can run again", () => {
    const project = tempDir();
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, "AGENTS.md"), "# Project rules\n\nUse tabs.\n");

    const first = cli(project, "init", "architecture");
    expect(first.code).toBe(0);
    expect(existsSync(join(project, "architecture/open-arch.yaml"))).toBe(true);
    for (const target of [".agents/skills/open-arch", ".claude/skills/open-arch"]) {
      const skill = readFileSync(join(project, target, "SKILL.md"), "utf8");
      expect(skill).toContain("name: open-arch");
      expect(skill).toContain(`npx -y open-arch@${VERSION}`);
      expect(skill).not.toContain("{{version}}");
      expect(existsSync(join(project, target, "references/format.md"))).toBe(true);
    }
    const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
    expect(agents.startsWith("# Project rules\n\nUse tabs.\n\n<!-- open-arch:start -->")).toBe(true);
    expect(agents).toContain("`architecture/model/`");

    expect(cli(project, "init", "architecture").code).toBe(0);
    expect(readFileSync(join(project, "AGENTS.md"), "utf8")).toBe(agents);

    expect(cli(project, "new", "element", "shop", "--kind", "system").code).toBe(0);
    expect(cli(project, "new", "view", "landscape", "--level", "landscape").code).toBe(0);
    expect(cli(project, "check")).toMatchObject({ code: 0, out: "OK: 1 element, 1 view, no problems.\n" });
  });
});
