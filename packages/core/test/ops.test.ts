import { describe, expect, it } from "vitest";
import { checkWorkspace, formatWorkspace, newElement, newView, OpError, renameId } from "../src/index.js";
import { apply, md, SHOP, ws } from "./helpers.js";

function cleanShop(extra: Record<string, string> = {}) {
  const first = ws({ ...SHOP, ...extra });
  return apply(first, formatWorkspace(first).changes);
}

describe("newElement", () => {
  it("puts the file in the parent's folder and refreshes the views that now show it", () => {
    const workspace = cleanShop();
    const changes = newElement(workspace, { id: "cache", kind: "container", parent: "shop", technology: "Redis", description: "Caches carts." });
    expect(changes[0]).toEqual({
      path: "model/shop/cache.md",
      content: md(["kind: container", "name: Cache", "parent: shop", "description: Caches carts.", "technology: Redis"], "\n# Cache\n"),
    });
    expect(changes.slice(1).map((c) => c.path)).toEqual(["views/shop-containers.md"]);
    expect(checkWorkspace(apply(workspace, changes))).toEqual([]);
  });

  it("refuses invalid elements", () => {
    const workspace = cleanShop();
    expect(() => newElement(workspace, { id: "Cache", kind: "container", parent: "shop" })).toThrow(OpError);
    expect(() => newElement(workspace, { id: "api", kind: "container", parent: "shop" })).toThrow(/already used/);
    expect(() => newElement(workspace, { id: "x", kind: "container" })).toThrow(/needs a parent system/);
    expect(() => newElement(workspace, { id: "x", kind: "component", parent: "shop" })).toThrow(/must be a container/);
    expect(() => newElement(workspace, { id: "x", kind: "system", parent: "shop" })).toThrow(/top-level/);
    expect(() => newElement(workspace, { id: "x", kind: "box" })).toThrow(/Unknown kind/);
  });
});

describe("newView", () => {
  it("creates a view with a generated preview and a default title", () => {
    const workspace = cleanShop();
    const changes = newView(workspace, { id: "web-components", level: "component", scope: "web-app" });
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe("views/web-components.md");
    expect(changes[0]!.content).toContain("title: Web App components\n");
    expect(changes[0]!.content).toContain("<!-- open-arch:preview hash=");
    expect(checkWorkspace(apply(workspace, changes))).toEqual([]);
  });

  it("refuses a scope of the wrong kind", () => {
    expect(() => newView(cleanShop(), { id: "v", level: "container", scope: "api" })).toThrow(/must be a system/);
  });
});

describe("renameId", () => {
  it("updates every reference, moves the children's folder and keeps saved positions", () => {
    const base = cleanShop({
      "views/shop-containers.md": md(["kind: view", "title: Shop containers", "level: container", "scope: shop", "include: ['*', api]"], '\n# Shop\n\nThe api container.\n<!-- open-arch:layout\n{"nodes": {"api": {"x": 1, "y": 2}}}\n-->\n'),
      "views/api-components.md": md(["kind: view", "title: API components", "level: component", "scope: api", "exclude: [api]"]),
    });
    const result = renameId(base, "api", "orders-api");
    const after = apply(base, result.changes);

    expect(after.elements.get("orders-api")?.path).toBe("model/shop/orders-api.md");
    expect(after.elements.get("controller")?.path).toBe("model/shop/orders-api/controller.md");
    expect(after.elements.get("controller")?.parent).toBe("orders-api");
    expect(after.views.get("api-components")?.scope).toBe("orders-api");
    expect(after.views.get("shop-containers")?.include).toEqual(["*", "orders-api"]);
    const containers = after.inputs.find((f) => f.path === "views/shop-containers.md")!.text;
    expect(containers).toContain(`"orders-api": {"x": 1, "y": 2}`);
    expect(containers).toContain("include: ['*', orders-api]");
    expect(result.mentions).toEqual(["views/shop-containers.md"]);
    expect(checkWorkspace(after).filter((d) => d.severity === "error")).toEqual([]);
  });

  it("updates uses entries, including the shorthand form", () => {
    const base = cleanShop({ "model/customer.md": md(["kind: person", "name: Customer", "uses:", "  - web-app"]) });
    const after = apply(base, renameId(base, "web-app", "storefront").changes);
    expect(after.elements.get("customer")!.uses[0]!.to).toBe("storefront");
    expect(checkWorkspace(after).filter((d) => d.severity === "error")).toEqual([]);
  });

  it("renames a view file only", () => {
    const base = cleanShop();
    const { changes } = renameId(base, "landscape", "overview");
    expect(changes).toEqual([{ path: "views/overview.md", content: base.inputs.find((f) => f.path === "views/landscape.md")!.text, from: "views/landscape.md" }]);
  });

  it("refuses bad renames", () => {
    const base = cleanShop();
    expect(() => renameId(base, "nope", "x")).toThrow(/No element or view/);
    expect(() => renameId(base, "api", "db")).toThrow(/already used/);
    expect(() => renameId(base, "api", "API")).toThrow(/valid ID/);
  });
});
