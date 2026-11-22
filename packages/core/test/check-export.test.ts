import { describe, expect, it } from "vitest";
import { buildWorkspace, checkWorkspace, computeView, exportDocs, formatDiagnostic, GENERATED_MARKER, renderMermaid, viewMarkdown, type OpenArchDocument } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

describe("checkWorkspace", () => {
  it("passes a valid model", () => {
    expect(rules(shop())).toEqual([]);
  });

  it("reports model errors at their place in the document, with suggestions", () => {
    const doc = shop();
    doc.elements.customer!.uses = [{ to: "web-ap", description: "Buys" }];
    doc.elements.orphan = { kind: "container", name: "Orphan" };
    doc.elements.wrong = { kind: "component", name: "Wrong", parent: "shop" };
    doc.elements.top = { kind: "system", name: "Top", parent: "shop" };
    doc.views.bad = { title: "Bad", level: "component", scope: "shop" };
    doc.views.shop = { title: "Clash", level: "landscape" };
    const found = checkWorkspace(buildWorkspace(doc)).map((d) => `${d.rule} ${d.path}${d.fix?.startsWith("Did") ? ` (${d.fix})` : ""}`);
    expect(found).toEqual([
      "id-duplicate views.shop",
      'relationship-unknown-target elements.customer.uses[0].to (Did you mean "web-app"?)',
      "parent-required elements.orphan.parent",
      "parent-kind elements.wrong.parent",
      "parent-not-allowed elements.top.parent",
      "view-scope-kind views.bad.scope",
    ]);
  });

  it("prints a problem with where it is, what's wrong and how to fix it", () => {
    const doc = shop();
    doc.elements.customer!.uses = [{ to: "web-ap", description: "Buys" }];
    const [problem] = checkWorkspace(buildWorkspace(doc));
    expect(formatDiagnostic(problem!)).toBe('elements.customer.uses[0].to: error [relationship-unknown-target] "web-ap" isn\'t an element.\n  fix: Did you mean "web-app"?');
    // One with no place in the file, and no fix to suggest.
    expect(formatDiagnostic({ severity: "warning", rule: "some-rule", message: "Something's off.", path: "" })).toBe("(file): warning [some-rule] Something's off.");
  });

  it("warns about a shape on a person, which is always drawn as a person", () => {
    const doc = shop();
    doc.elements.customer!.shape = "database";
    expect(rules(doc)).toEqual(["shape-ignored"]);
    expect(buildWorkspace(doc).elements.get("customer")!.shape).toBe("box");
  });
});

describe("implied relationships", () => {
  const implied = (doc: OpenArchDocument) =>
    checkWorkspace(buildWorkspace(doc))
      .filter((d) => d.rule === "relationship-implied")
      .map((d) => `${d.path}: ${d.message}`);

  it("warns about a relationship that one between elements nested in its ends already implies", () => {
    const doc = shop();
    // The controller, in the API in the shop, charges cards; the customer uses the shop's web app;
    // the controller stores orders in the DB.
    doc.elements.shop!.uses = [{ to: "payments", description: "Takes payments" }];
    doc.elements.customer!.uses!.push({ to: "shop", description: "Shops at" });
    doc.elements.api!.uses = [{ to: "db", description: "Stores data" }];
    expect(implied(doc)).toEqual([
      'elements.customer.uses[1]: "customer" uses "shop", and the relationship from "customer" to "web-app" already implies that: views that show both draw them as one arrow, with the label of the one on "customer".',
      'elements.shop.uses[0]: "shop" uses "payments", and the relationship from "controller" to "payments" already implies that: views that show both draw them as one arrow, with the label of the one on "shop".',
      'elements.api.uses[0]: "api" uses "db", and the relationship from "controller" to "db" already implies that: views that show both draw them as one arrow, with the label of the one on "api".',
    ]);
    expect(checkWorkspace(buildWorkspace(doc)).find((d) => d.rule === "relationship-implied")!.fix).toBe(
      'Remove the one on "customer", and those views label the arrow with the more detailed one. If it says something else, put it on the most detailed elements it\'s true for instead.',
    );

    // As the warning says: one arrow, labelled with the coarser relationship.
    const context = (d: OpenArchDocument) => computeView(buildWorkspace(d), buildWorkspace(d).views.get("shop-context")!).edges.find((e) => e.to === "payments")!;
    expect(context(doc)).toMatchObject({ from: "shop", description: "Takes payments", implied: false, sources: [{ element: "shop" }, { element: "controller" }] });
    // Without it, the arrow is labelled with the one that implied it.
    const removed = apply(doc, { op: "remove-relationship", from: "shop", to: "payments" });
    expect(context(removed)).toMatchObject({ from: "shop", description: "Charges cards", implied: true });
    expect(implied(removed).map((d) => d.split(":")[0])).toEqual(["elements.customer.uses[1]", "elements.api.uses[0]"]);
  });

  it("names a relationship that goes both ways when it implies one the other way", () => {
    const doc = shop();
    doc.elements.controller!.uses![1] = { to: "payments", description: "Syncs charges with", bidirectional: true };
    doc.elements.payments!.uses = [{ to: "shop", description: "Sends webhooks" }];
    expect(implied(doc)).toEqual([
      'elements.payments.uses[0]: "payments" uses "shop", and the relationship from "controller" to "payments", which goes both ways, already implies that: views that show both draw them as one arrow, with the label of the one on "payments".',
    ]);
  });

  it("warns about a relationship that goes both ways only when both ways are implied", () => {
    const doc = shop();
    doc.elements.shop!.uses = [{ to: "payments", description: "Syncs payments with", bidirectional: true }];
    // Only the controller charges cards: nothing says the payments system uses the shop.
    expect(implied(doc)).toEqual([]);
    doc.elements.payments!.uses = [{ to: "api", description: "Sends webhooks" }];
    expect(implied(doc)).toEqual([
      'elements.shop.uses[0]: "shop" and "payments" use each other, and the relationships from "controller" to "payments" and from "payments" to "api" already imply that: views that show both draw them as one arrow, with the label of the one on "shop".',
    ]);
    expect(checkWorkspace(buildWorkspace(doc)).find((d) => d.rule === "relationship-implied")!.fix).toBe(
      'Remove the one on "shop", and those views label the arrow with the more detailed ones. If it says something else, put it on the most detailed elements it\'s true for instead.',
    );
  });

  it("doesn't warn about relationships between the same elements, the other way, or to or from classes or library code", () => {
    const doc = shop();
    // Another relationship between the same two elements, and one the other way.
    doc.elements.controller!.uses!.push({ to: "payments", description: "Refunds cards" });
    doc.elements.payments!.uses = [{ to: "shop", description: "Sends webhooks" }];
    // A class view draws a class as itself, so a class's relationship isn't always drawn on its component.
    doc.elements.charge = { kind: "class", name: "Charge", parent: "controller", uses: [{ to: "db", description: "Saves charges" }] };
    // A library's code isn't inside the containers built with it.
    doc.elements.logs = { kind: "system", name: "Logs", external: true };
    doc.elements.logging = { kind: "library", name: "Logging" };
    doc.elements["log-client"] = { kind: "component", name: "Log client", parent: "logging", uses: [{ to: "logs", description: "Sends logs" }] };
    doc.elements.db!.libraries = ["logging"];
    doc.elements.db!.uses = [{ to: "logs", description: "Sends logs" }];
    expect(rules(doc)).toEqual([]);
  });
});

describe("exportDocs", () => {
  const files = exportDocs(buildWorkspace(shop()), "shop.openarch");
  const page = (path: string) => files.find((f) => f.path === path)!.content;

  it("writes an index, one page per view and one per element, each marked as generated", () => {
    expect(files.map((f) => f.path)).toEqual([
      "README.md",
      "views/api-components.md",
      "views/landscape.md",
      "views/shop-containers.md",
      "views/shop-context.md",
      "elements/customer.md",
      "elements/shop.md",
      "elements/web-app.md",
      "elements/api.md",
      "elements/db.md",
      "elements/controller.md",
      "elements/payments.md",
    ]);
    for (const f of files) expect(f.content.startsWith(`${GENERATED_MARKER} from shop.openarch.`)).toBe(true);
  });

  it("puts the Mermaid diagram and linked tables in view pages", () => {
    const text = page("views/shop-containers.md");
    expect(text).toContain("Container view of [Shop](../elements/shop.md).");
    expect(text).toContain("```mermaid\nflowchart TB\n");
    expect(text).toContain("| [API](../elements/api.md) | [DB](../elements/db.md) | Stores orders | SQL |");
  });

  it("quotes a view's sticky notes under its diagram, in reading order", () => {
    const doc = shop();
    doc.views.landscape!.stickies = { later: { text: "Unplaced." }, second: { text: "Lower\n\nright.", at: [300, 100] }, first: { text: "Top.", at: [900, 0] } };
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/landscape.md")!.content;
    expect(text).toContain("```\n\n## Sticky notes\n\n> Top.\n\n> Lower\n>\n> right.\n\n> Unplaced.\n\n## Elements");
    expect(page("views/landscape.md")).not.toContain("## Sticky notes");
  });

  it("puts a view's notes, as markdown, after its description", () => {
    const doc = shop();
    doc.views.landscape!.description = "Everything.";
    doc.views.landscape!.notes = "Drawn for **new starters**.\n\n- Start at the customer.";
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/landscape.md")!.content;
    expect(text).toContain("Landscape view.\n\nEverything.\n\nDrawn for **new starters**.\n\n- Start at the customer.\n\n```mermaid\n");
  });

  it("puts a relationship's notes, as markdown, under each table that lists it", () => {
    const doc = shop();
    doc.elements.controller!.uses![0]!.notes = "Over a **pooled** connection.\n\n- Retries twice.";
    doc.elements.controller!.uses![1]!.description = undefined;
    doc.elements.controller!.uses![1]!.notes = "Only for card payments.";
    const docs = exportDocs(buildWorkspace(doc), "shop.openarch");
    const at = (path: string) => docs.find((f) => f.path === path)!.content;
    const stores = "### Controller → DB: Stores orders\n\nOver a **pooled** connection.\n\n- Retries twice.";
    expect(at("elements/controller.md")).toContain(`| [Payments](payments.md) |  |  |\n\n${stores}\n\n### Controller → Payments\n\nOnly for card payments.\n\n## Used by`);
    expect(at("elements/db.md")).toContain(`| [Controller](controller.md) | Stores orders | SQL |\n\n${stores}\n\n## Shown in`);
    expect(at("elements/web-app.md")).not.toContain("###");
    // The container view draws the controller's relationships as arrows from the API, and names them as they are.
    expect(at("views/shop-containers.md")).toContain(`| [API](../elements/api.md) | [DB](../elements/db.md) | Stores orders | SQL |\n`);
    expect(at("views/shop-containers.md")).toContain(`\n\n${stores}\n\n### Controller → Payments\n\nOnly for card payments.\n\n[All views and elements]`);
    expect(page("views/shop-containers.md")).not.toContain("###");
  });

  it("puts relationships, contents and views in element pages", () => {
    const text = page("elements/api.md");
    expect(text).toContain("**Container** · Node.js · inside [Shop](shop.md)");
    expect(text).toContain("## Contains\n\n- [Controller](controller.md) (component)");
    expect(text).toContain("- [API components](../views/api-components.md) (as the frame)");
    expect(page("README.md")).toContain("- [Shop](elements/shop.md) (system)\n  - [API](elements/api.md) (container, Node.js)");
  });

  it("lists an element's tags, by name, and says how it's drawn", () => {
    const doc = shop();
    doc.elements.api!.tags = { team: "checkout", pii: "" };
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "elements/api.md")!.content;
    expect(text).toContain("## Tags\n\n| Tag | Value |\n|---|---|\n| pii |  |\n| team | checkout |\n");
    expect(page("elements/db.md")).not.toContain("## Tags");
    expect(page("elements/db.md")).toContain("**Container** · drawn as a database · inside [Shop](shop.md)");
  });

  it("names each shape in words, with a or an", () => {
    const doc = shop();
    doc.elements.api!.shape = "email";
    doc.elements.db!.shape = "scheduled-job";
    const files = exportDocs(buildWorkspace(doc), "shop.openarch");
    const text = (path: string) => files.find((f) => f.path === path)!.content;
    expect(text("elements/api.md")).toContain("**Container** · Node.js · drawn as an email · inside [Shop](shop.md)");
    expect(text("elements/db.md")).toContain("**Container** · drawn as a scheduled job · inside [Shop](shop.md)");
  });

  it("adds a Tags column to relationship tables when a relationship has tags", () => {
    const doc = shop();
    doc.elements.controller!.uses![0]!.tags = { protocol: "postgres", sync: "" };
    const text = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "elements/db.md")!.content;
    expect(text).toContain("| Element | Description | Technology | Tags |\n|---|---|---|---|\n| [Controller](controller.md) | Stores orders | SQL | protocol=postgres, sync |");
    expect(page("elements/db.md")).toContain("| Element | Description | Technology |\n|---|---|---|\n");
  });
});

describe("viewMarkdown", () => {
  it("writes one view's title, description and diagram, with no links to other pages", () => {
    const doc = shop();
    doc.views["shop-containers"]!.description = "What the shop is made of.";
    const ws = buildWorkspace(doc);
    const cv = computeView(ws, ws.views.get("shop-containers")!);
    expect(viewMarkdown(cv)).toBe(["# Shop containers", "", "What the shop is made of.", "", "```mermaid", renderMermaid(cv), "```", ""].join("\n"));
    expect(viewMarkdown(cv)).not.toContain("](");
  });

  it("leaves out a missing description", () => {
    const ws = buildWorkspace(shop());
    const cv = computeView(ws, ws.views.get("landscape")!);
    expect(viewMarkdown(cv).startsWith("# Landscape\n\n```mermaid\nflowchart TB\n")).toBe(true);
  });
});
