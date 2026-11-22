import { applyOperations, buildWorkspace, OPERATION_NAMES, OpError, serializeDocument, loadWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { OPERATION_FIELDS, operationsGuide, recipesGuide, RULES } from "../src/ai/guide.js";
import { ANSWER_LIMIT, runTool, searchModel, toolSpecs, type ToolHost } from "../src/ai/tools.js";
import type { Change } from "../src/state.js";
import { FakeFolder } from "./fakeFolder.js";

const shop = (): OpenArchDocument => ({
  openarch: 19,
  name: "Shop",
  description: "Everything the shop runs.",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web-app", description: "Buys things with", tags: { journey: "checkout" } }] },
    shop: { kind: "system", name: "Shop", notes: "Owned by the **commerce** team.\n\nPayments go through Stripe, which settles every night at midnight and reports what it settled the morning after, in a file the finance team reconciles against the orders by hand each week." },
    "web-app": { kind: "container", name: "Web App", parent: "shop", technology: "React", tags: { owner: "storefront" } },
    "orders-db": { kind: "container", name: "Orders DB", parent: "shop", shape: "database" },
  },
  views: {
    containers: { title: "Shop containers", level: "container", scope: "shop", stickies: { "why-react": { text: "React, for the checkout team." } }, layout: { "web-app": [10, 20] } },
    "order-states": { title: "Order states", level: "state", states: { placed: { name: "Placed" }, "paid-in-full": { name: "Paid" } }, initial: "placed", transitions: [{ from: "placed", to: "paid-in-full", event: "Payment taken" }] },
  },
});

/** A workspace the tools read and change, as the designer's does: operations apply all or none. */
function host(doc: OpenArchDocument = shop(), folder?: FakeFolder): ToolHost & { text: string; changes: Operation[][] } {
  const state = {
    fileName: "shop.openarch",
    text: serializeDocument(doc),
    changes: [] as Operation[][],
    folder,
    workspace: async () => loadWorkspace(state.text),
    change: async (ops: Operation[]): Promise<Change> => {
      state.changes.push(ops);
      try {
        const result = applyOperations(loadWorkspace(state.text).doc, ops);
        state.text = serializeDocument(result.doc);
        return { ok: true, summary: result.summary, warnings: result.warnings };
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
        return { ok: false, error: error.message };
      }
    },
  };
  return state;
}

const call = (on: ToolHost, name: string, args: unknown = {}) => runTool(on, name, typeof args === "string" ? args : JSON.stringify(args));

describe("the tools Ask AI's model can call", () => {
  it("are the model's tools, with the file tools only when there's a folder it may read", () => {
    const names = (specs: ReturnType<typeof toolSpecs>) => specs.map((s) => s.function.name);
    expect(names(toolSpecs({}))).toEqual(["show_model", "search_model", "check_model", "change_model", "read_guide"]);
    expect(names(toolSpecs({ folder: new FakeFolder("shop") }))).toEqual(["show_model", "search_model", "check_model", "change_model", "read_guide", "find_files", "read_file", "search_files"]);
    for (const spec of toolSpecs({ folder: new FakeFolder("shop") })) {
      expect(spec.type).toBe("function");
      expect(spec.function.name).toMatch(/^[a-z_]{1,64}$/);
      expect(spec.function.description.length).toBeGreaterThan(20);
      expect(spec.function.parameters).toMatchObject({ type: "object", properties: {} });
    }
  });

  it("show the model as a tree with its views, as the CLI's show does, and say how to see one", async () => {
    const shown = await call(host(), "show_model");
    expect(shown.did).toBe("Looked at the model");
    expect(shown.answer.split("\n")[0]).toBe("Shop: shop.openarch (4 elements, 2 views)");
    expect(shown.answer).toMatch(/\n  shop +system +Shop\n    orders-db +container +Orders DB\n/);
    expect(shown.answer).toMatch(/\n  containers +container view of shop +Shop containers\n/);
    expect(shown.answer.endsWith("\nCall show_model with an ID for details of one element or view.")).toBe(true);
    // No arguments at all, as some models send for a tool that needs none.
    expect((await call(host(), "show_model", "")).answer).toBe(shown.answer);
    expect((await call(host(), "show_model", { id: "" })).answer).toBe(shown.answer);
  });

  it("show one element or one view by its ID, and suggest one for an ID that isn't there", async () => {
    const element = await call(host(), "show_model", { id: "web-app" });
    expect(element.did).toBe("Looked at `web-app`");
    expect(element.answer).toContain("web-app: Web App\n  kind:        container\n  parent:      shop (Shop)\n  technology:  React\n");
    expect(element.answer).toMatch(/Used by:\n  <- customer +Buys things with \(tags: journey=checkout\)/);
    const view = await call(host(), "show_model", { id: "order-states" });
    expect(view.answer).toMatch(/Transitions:\n  1\. +placed -> paid-in-full +Payment taken/);
    const missing = await call(host(), "show_model", { id: "web-ap" });
    expect(missing.answer).toBe('No element or view has the ID "web-ap". Did you mean "web-app"? Call show_model without an ID to list them.');
    expect(missing.did).toBe(`Couldn't show model: ${missing.answer}`);
    expect((await call(host(), "show_model", { id: 7 })).answer).toBe('"id" must be text.');
  });

  it("say why a view can't be shown when its scope is wrong", async () => {
    const doc = shop();
    doc.views.containers!.scope = "customer";
    const shown = await call(host(doc), "show_model", { id: "containers" });
    expect(shown.answer).toMatch(/^The view "containers" can't be shown: .+ Call check_model for the problems\.$/);
  });

  it("search every part of the workspace, saying where each match is", async () => {
    const found = (text: string) => searchModel(buildWorkspace(shop()), text);
    // In a name, a description, a technology, a tag's value and name, and notes, capitals aside.
    expect(found("REACT")).toBe(
      ["Element web-app (container, Web App):", "  technology: React", "View containers (container view, Shop containers):", "  stickies.why-react", "  stickies.why-react.text: React, for the checkout team.", "", "Call show_model with an element's or a view's ID for all of it."].join("\n"),
    );
    expect(found("everything")).toContain("Workspace:\n  description: Everything the shop runs.");
    expect(found("buys")).toContain("Element customer (person, Customer):\n  uses[0].description: Buys things with");
    expect(found("storefront")).toContain("  tags.owner: storefront");
    expect(found("journey")).toContain("Element customer (person, Customer):\n  uses[0].tags.journey: checkout");
    // In an ID: an element's, a view's, and those of what a view holds.
    expect(found("orders-db")).toContain("Element orders-db (container, Orders DB):\n  its ID");
    expect(found("order-st")).toContain("View order-states (state view, Order states):\n  its ID");
    expect(found("paid-in")).toContain("  states.paid-in-full\n  transitions[0].to: paid-in-full");
    // In what a view holds, and in a list of text, such as a class's members.
    expect(found("payment taken")).toContain("  transitions[0].event: Payment taken");
    const withClass = shop();
    withClass.elements.order = { kind: "class", name: "Order", parent: "web-app", members: ["+id: OrderId", "+total(): Money"] };
    expect(searchModel(buildWorkspace(withClass), "money")).toContain("Element order (class, Order):\n  members[1]: +total(): Money");
    // Long text is cut down to the part round the match, on one line.
    expect(found("midnight")).toMatch(/\n  notes: …[^\n]*Stripe, which settles every night at midnight and reports[^\n]*…\n/);
    // Where a box was dragged to isn't a match for its element.
    expect(found("web-app")).not.toContain("layout");
    expect(found("kubernetes")).toBe('Nothing in the workspace has "kubernetes" in it.');
  });

  it("search for at most so many matches, and say there are more", async () => {
    const doc = shop();
    for (let i = 0; i < 120; i++) doc.elements[`service-${i}`] = { kind: "system", name: `Billing ${i}` };
    // In the file's order, as the designer has it.
    const found = searchModel(loadWorkspace(serializeDocument(doc)), "billing");
    expect(found.match(/name: Billing/g)).toHaveLength(100);
    expect(found).toContain("(There are more: these are the first 100. Search for something longer.)");
    const called = await call(host(doc), "search_model", { text: "billing" });
    expect(called.did).toBe("Searched the model for “billing”");
    expect((await call(host(doc), "search_model", { text: `billing ${"x".repeat(200)}` })).did).toBe(`Searched the model for “billing ${"x".repeat(72)}…”`);
    expect(called.answer).toBe(found);
    expect((await call(host(), "search_model", {})).answer).toBe('Give "text".');
  });

  it("list the workspace's problems, with how to fix each", async () => {
    expect(await call(host(), "check_model")).toEqual({ answer: "No problems.", did: "Checked the model for problems" });
    const doc = shop();
    doc.elements.customer!.uses!.push({ to: "nowhere" });
    doc.elements["web-app"]!.uses = [{ to: "orders-db" }];
    const checked = (await call(host(doc), "check_model")).answer;
    expect(checked).toBe(
      [
        'elements.customer.uses[1].to: error [relationship-unknown-target] "nowhere" isn\'t an element.',
        'elements.web-app.uses[0]: warning [relationship-description] The relationship from "web-app" to "orders-db" has no description.',
        '  fix: Add a short verb phrase, e.g. "Reads and writes orders".',
        "",
        "1 error, 1 warning.",
      ].join("\n"),
    );
  });

  it("change the workspace through operations, all or none, and say what changed and what to fix", async () => {
    const on = host();
    const changed = await call(on, "change_model", {
      operations: [
        { op: "add-element", id: "cache", kind: "container", parent: "shop", name: "Cache", technology: "Redis" },
        { op: "add-relationship", from: "web-app", to: "cache" },
      ],
    });
    expect(changed.did).toBe("Changed the model: added container cache; added relationship web-app -> cache");
    expect(changed.answer).toMatch(/^Changed:\n- added container cache\n- added relationship web-app -> cache\n\nWarnings from this change:\nelements\.web-app\.uses\[0\]: warning \[relationship-description\] /);
    expect(loadWorkspace(on.text).elements.get("cache")?.technology).toBe("Redis");

    // One wrong operation in a list refuses all of it.
    const before = on.text;
    const refused = await call(on, "change_model", { operations: [{ op: "add-element", id: "queue", kind: "container", parent: "shop" }, { op: "add-relationship", from: "queue", to: "nowhere" }] });
    expect(refused.answer).toMatch(/^Refused, so nothing changed: Operation 2 \(add-relationship\): /);
    expect(refused.did).toMatch(/^Tried a change that was refused: Operation 2 /);
    expect(on.text).toBe(before);
  });

  it("refuse operations that aren't shaped right before they reach the workspace, saying how they should be", async () => {
    const on = host();
    const wrong = async (operations: unknown) => (await call(on, "change_model", { operations })).answer;
    expect(await wrong([{ op: "add-elemnt", id: "cache" }])).toMatch(/^unknown "op" "add-elemnt"\. Did you mean "add-element"\? Operations: .+ Nothing changed\. Call read_guide with "operations" for every operation's fields\.$/);
    // The model is told all of it, every operation's name included; the person reads the start.
    const unknown = await call(on, "change_model", { operations: [{ op: "add-elemnt", id: "cache" }] });
    expect(unknown.answer.length).toBeGreaterThan(900);
    expect(unknown.did).toBe(`Couldn't change model: ${unknown.answer.slice(0, 240)}…`);
    expect(await wrong([{ op: "add-element", id: "cache", kind: "container", parrent: "shop" }])).toMatch(/^add-element has no field "parrent"\. Did you mean "parent"\? /);
    expect(await wrong([{ op: "add-element", id: "cache" }])).toMatch(/^add-element needs "kind"\. /);
    expect(await wrong([])).toMatch(/^There are no operations to apply\. /);
    expect(await wrong("add a cache")).toMatch(/^each operation must be an object like /);
    expect(await wrong(undefined)).toMatch(/^each operation must be an object like /);
    expect(on.changes).toEqual([]);
  });

  it("hand out the guides: every operation's fields, and the recipes with the model's rules", async () => {
    const operations = await call(host(), "read_guide", { topic: "operations" });
    expect(operations).toEqual({ answer: operationsGuide(), did: "Read the guide to operations" });
    expect(operations.answer).toContain("- add-element: **id**, **kind**, parent, name, ");
    expect(operations.answer).toContain('{ "op": "add-element", "id": "notifications", "kind": "container", "parent": "shop"');
    const recipes = await call(host(), "read_guide", { topic: "recipes" });
    expect(recipes).toEqual({ answer: recipesGuide(), did: "Read the guide to recipes" });
    expect(recipes.answer).toMatch(/^These recipes are written for agents with a command line, as `open-arch` commands\. Here there's none: make each command an operation for change_model\./);
    expect(recipes.answer).toContain("- **Add an element:**");
    expect(recipes.answer).toContain("- **Show what happens in order** (a sequence diagram)");
    expect(recipes.answer).toContain(`Rules:\n${RULES}`);
    expect(recipes.answer.length).toBeLessThan(ANSWER_LIMIT);
    expect((await call(host(), "read_guide", { topic: "format" })).answer).toBe('"topic" must be "operations" or "recipes".');
    expect((await call(host(), "read_guide")).answer).toBe('Give "topic".');
  });

  it("know every operation there is, from the skill's own page", () => {
    // The guide is read out of the skill's pages: an operation the skill doesn't list, or a page laid out another way, shows here.
    expect([...OPERATION_FIELDS.keys()].sort()).toEqual([...OPERATION_NAMES].sort());
    for (const [name, fields] of OPERATION_FIELDS) expect(fields.length, name).toBeGreaterThan(0);
    expect(RULES).toContain("- IDs are lowercase kebab-case");
    expect(RULES.split("\n").every((line) => line.startsWith("- "))).toBe(true);
  });

  it("find, read and search the folder's files when there's one to read, and say so when there isn't", async () => {
    const folder = new FakeFolder("shop");
    folder.put("src/checkout.ts", "export const pay = () => stripe.charge();\n");
    folder.put(".env", "STRIPE_KEY=sk_live_secret\n");
    const on = host(shop(), folder);
    expect(await call(on, "find_files", { pattern: "*.ts" })).toEqual({ answer: "src/checkout.ts", did: "Looked for files matching “*.ts”" });
    expect(await call(on, "find_files")).toEqual({ answer: "src/checkout.ts", did: "Listed the files" });
    expect(await call(on, "read_file", { path: "src/checkout.ts" })).toEqual({ answer: "src/checkout.ts (1 line):\n1: export const pay = () => stripe.charge();", did: "Read `src/checkout.ts`" });
    expect(await call(on, "search_files", { text: "STRIPE" })).toEqual({ answer: "src/checkout.ts:1: export const pay = () => stripe.charge();", did: "Searched the files for “STRIPE”" });
    // What it's not shown, it can't read by asking for it by name either.
    const hidden = await call(on, "read_file", { path: ".env" });
    expect(hidden.answer).toBe('".env" is in .env, which isn\'t read: hidden files and folders, and node_modules, are left out.');
    expect(hidden.did).toBe(`Couldn't read file: ${hidden.answer}`);
    expect((await call(on, "read_file", { path: "src/checkout.ts", from: 0 })).answer).toBe('"from" must be a whole number, 1 or more.');
    expect((await call(on, "read_file", {})).answer).toBe('Give "path".');
    for (const name of ["find_files", "read_file", "search_files"]) {
      expect((await call(host(), name, { path: "src/checkout.ts", text: "stripe" })).answer, name).toBe("There are no files to read: the workspace wasn't opened from a folder, or the person hasn't let its files be read.");
    }
  });

  it("answer the model, not throw, when a call is one it can put right", async () => {
    const on = host();
    expect((await call(on, "delete_everything")).answer).toBe('There\'s no tool called "delete_everything". The tools are: show_model, search_model, check_model, change_model, read_guide.');
    expect((await call(on, "show_model", '{"id": "shop"')).answer).toMatch(/^The arguments weren't JSON that could be read \(.+\)\. Call it again with a JSON object\.$/);
    for (const args of ["[]", '"shop"', "null", "7"]) expect((await call(on, "show_model", args)).answer, args).toBe('The arguments must be a JSON object, like { "id": "shop" }.');
    // A folder the browser stopped allowing: the model is told, and carries on.
    const folder = new FakeFolder("shop");
    folder.put("a.txt", "a");
    folder.getDirectoryHandle = () => Promise.reject(Object.assign(new Error("The request is not allowed."), { name: "NotAllowedError" }));
    expect((await call(host(shop(), folder), "read_file", { path: "src/a.txt" })).answer).toBe("The request is not allowed.");
    expect((await call({ ...on, workspace: async () => null }, "show_model")).answer).toBe("No workspace is open.");
  });

  it("stop when the request is stopped, rather than answer", async () => {
    const folder = new FakeFolder("shop");
    folder.put("a.txt", "a");
    const stop = new AbortController();
    stop.abort();
    await expect(runTool(host(shop(), folder), "find_files", "{}", stop.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
