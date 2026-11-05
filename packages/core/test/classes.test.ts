import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, computeView, exportDocs, OpError, parseDocument, parseOperations, renderMermaid, serializeDocument, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with the code inside its API's controller and a second component that stores orders. */
function code(): OpenArchDocument {
  const doc = shop();
  doc.elements.store = { kind: "component", name: "Store", parent: "api" };
  doc.elements.order = {
    kind: "class",
    name: "Order",
    parent: "controller",
    stereotype: "entity",
    members: ["+id: OrderId", "+total(): Money"],
    uses: [
      { to: "order-line", kind: "composition", description: "Holds" },
      { to: "payments", description: "Charges" },
    ],
  };
  doc.elements["order-line"] = { kind: "class", name: "Order line", parent: "controller", members: ["+quantity: int"] };
  doc.elements.repository = { kind: "class", name: "Order repository", parent: "controller", stereotype: "interface", members: ["+save(order: Order): void"], uses: [{ to: "order", kind: "dependency", description: "Saves" }] };
  doc.elements["sql-repository"] = { kind: "class", name: "SQL order repository", parent: "store", uses: [{ to: "repository", kind: "realization" }, { to: "db", description: "Writes orders", technology: "SQL" }] };
  doc.views["controller-classes"] = { title: "Controller classes", level: "class", scope: "controller" };
  return doc;
}

const view = (doc: OpenArchDocument, id: string) => {
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

describe("classes", () => {
  it("are read and written, with their stereotype and members, and relationships with their kind", () => {
    const text = serializeDocument(code());
    expect(text).toContain(`    "order": {
      "kind": "class",
      "name": "Order",
      "parent": "controller",
      "stereotype": "entity",
      "members": [
        "+id: OrderId",
        "+total(): Money"
      ],
      "uses": [
        { "to": "order-line", "kind": "composition", "description": "Holds" },`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.elements).toEqual(code().elements);
    expect(rules(code())).toEqual([]);
  });

  it("report a relationship's unknown kind, and leave an association's out of the file", () => {
    const doc = { ...code(), elements: { a: { kind: "system", name: "A", uses: [{ to: "b", kind: "association" }, { to: "b", kind: "extends", description: "Other" }] }, b: { kind: "system", name: "B" } } };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["relationship-kind-invalid elements.a.uses[1].kind"]);
    expect(parsed.doc.elements.a!.uses).toEqual([{ to: "b" }, { to: "b", description: "Other" }]);
    const members = parseDocument(JSON.stringify({ ...code(), elements: { c: { kind: "class", name: "C", members: "+id" } } }));
    expect(members.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["field-type elements.c.members"]);
  });

  it("are checked: inside a component, members and stereotypes only on classes, and only classes have kinds of relationship", () => {
    const doc = code();
    doc.elements.misplaced = { kind: "class", name: "Misplaced", parent: "api", shape: "database" };
    doc.elements.api!.members = ["+x"];
    doc.elements.api!.stereotype = "service";
    doc.elements.order!.uses!.push({ to: "store", kind: "inheritance" }, { to: "order-line", kind: "aggregation", bidirectional: true });
    expect(rules(doc)).toEqual(["members-ignored", "stereotype-ignored", "relationship-kind-classes", "relationship-kind-bidirectional", "parent-kind", "shape-ignored"]);
  });

  it("need no description on a relationship of a kind other than association", () => {
    const doc = code();
    doc.elements["order-line"]!.uses = [{ to: "order" }, { to: "repository", kind: "dependency" }];
    expect(rules(doc)).toEqual(["relationship-description"]);
  });

  it("are added and changed by operations, which keep their fields to classes", () => {
    let doc = apply(code(), { op: "add-element", id: "money", kind: "class", parent: "controller", stereotype: " value ", members: [" +amount: number ", "", "+currency: string"] });
    expect(doc.elements.money).toEqual({ kind: "class", name: "Money", parent: "controller", stereotype: "value", members: ["+amount: number", "+currency: string"] });
    doc = apply(doc, { op: "update-element", id: "money", members: ["+cents: int"], stereotype: null });
    expect(doc.elements.money).toEqual({ kind: "class", name: "Money", parent: "controller", members: ["+cents: int"] });
    doc = apply(doc, { op: "update-element", id: "money", members: null });
    expect(doc.elements.money).not.toHaveProperty("members");
    expect(fails(doc, { op: "add-element", id: "x", kind: "container", parent: "shop", members: ["+a"] })).toBe("Only classes have members, and this is a container.");
    expect(fails(doc, { op: "update-element", id: "api", stereotype: "service" })).toBe("Only classes have a stereotype, and this is a container.");
    expect(fails(doc, { op: "update-element", id: "money", shape: "database" })).toBe("Classes are always drawn as a class, so they don't take a shape.");
    expect(fails(doc, { op: "add-element", id: "y", kind: "class", parent: "api" })).toBe('A class\'s parent must be a component or library, but "api" is a container.');
    expect(fails(doc, { op: "add-element", id: "y", kind: "class" })).toBe('A class needs a parent component or library: set "parent".');
  });

  it("take members as JSON, as a list or null", () => {
    expect(parseOperations({ op: "update-element", id: "a", members: null })).toEqual([{ op: "update-element", id: "a", members: null }]);
    expect(() => parseOperations({ op: "update-element", id: "a", members: "+x" })).toThrow('update-element: "members" must be a list of strings, or null to remove it.');
  });

  it("are related by kind: two of different kinds between the same classes are both kept", () => {
    let doc = apply(code(), { op: "add-relationship", from: "order-line", to: "order", kind: "association" }, { op: "add-relationship", from: "order-line", to: "order", kind: "dependency" });
    expect(doc.elements["order-line"]!.uses).toEqual([{ to: "order" }, { to: "order", kind: "dependency" }]);
    doc = apply(doc, { op: "update-relationship", from: "order-line", to: "order", index: 1, kind: "inheritance" });
    expect(doc.elements["order-line"]!.uses![1]).toEqual({ to: "order", kind: "inheritance" });
    doc = apply(doc, { op: "update-relationship", from: "order-line", to: "order", index: 1, kind: null });
    expect(doc.elements["order-line"]!.uses![1]).toEqual({ to: "order" });
    expect(fails(code(), { op: "add-relationship", from: "order", to: "order-line", kind: "composition", description: "Holds" })).toBe('"order" already has this relationship to "order-line". Use update-relationship to change it.');
    expect(fails(code(), { op: "add-relationship", from: "order", to: "store", kind: "inheritance" })).toMatch(/Only relationships between classes can be of the kind "inheritance", and "store" is a component\./);
    expect(fails(code(), { op: "add-relationship", from: "order", to: "repository", kind: "extends" as never })).toBe('Unknown kind of relationship "extends". Use one of: association, dependency, inheritance, realization, composition, aggregation.');
    expect(fails(code(), { op: "update-relationship", from: "repository", to: "order", bidirectional: true })).toMatch(/Only associations go both ways, and this relationship is a dependency\./);
  });

  it("are shown in a class view of their component, with the classes and boxes they're related to", () => {
    const cv = view(code(), "controller-classes");
    expect(cv.boundary?.id).toBe("controller");
    expect(cv.nodes.map((n) => n.id)).toEqual(["payments", "order", "order-line", "repository", "sql-repository"]);
    expect(cv.edges.map((e) => [e.from, e.to, e.kind, e.implied])).toEqual([
      ["order", "order-line", "composition", false],
      ["order", "payments", "association", false],
      ["repository", "order", "dependency", false],
      ["sql-repository", "repository", "realization", false],
    ]);
  });

  it("draw other components and containers as a component view of their container would", () => {
    const doc = code();
    doc.elements["order-line"]!.uses = [{ to: "db", description: "Reads" }, { to: "web-app", description: "Tells" }];
    doc.elements.store!.uses = [{ to: "order", description: "Loads" }];
    const cv = view(doc, "controller-classes");
    expect(cv.nodes.map((n) => n.id)).toEqual(["payments", "db", "web-app", "store", "order", "order-line", "repository", "sql-repository"]);
    expect(cv.edges.find((e) => e.from === "store")).toMatchObject({ to: "order", implied: false });
  });

  it("keep different kinds between the same two classes as different arrows, and associations both ways as one", () => {
    const doc = apply(
      code(),
      { op: "add-relationship", from: "order-line", to: "order", kind: "inheritance" },
      { op: "add-relationship", from: "order-line", to: "order", description: "Belongs to", bidirectional: true },
      { op: "add-relationship", from: "order", to: "order-line", description: "Counts" },
    );
    const cv = view(doc, "controller-classes");
    expect(cv.edges.filter((e) => [e.from, e.to].includes("order-line")).map((e) => [e.from, e.to, e.kind, e.bidirectional, e.description])).toEqual([
      ["order", "order-line", "composition", false, "Holds"],
      ["order-line", "order", "association", true, "Counts; Belongs to"],
      ["order-line", "order", "inheritance", false, undefined],
    ]);
  });

  it("are drawn as their component elsewhere, where every arrow is an association", () => {
    const cv = view(code(), "api-components");
    expect(cv.nodes.map((n) => n.id)).not.toContain("order");
    expect(cv.edges.find((e) => e.from === "store" && e.to === "controller")).toMatchObject({ kind: "association", implied: true });
  });

  it("need a component as a class view's scope", () => {
    expect(fails(code(), { op: "add-view", id: "v", level: "class", scope: "api" })).toBe('A class view\'s scope must be a component or library, but "api" is a container.');
    expect(apply(code(), { op: "add-view", id: "v", level: "class", scope: "store" }).views.v).toEqual({ title: "Store classes", level: "class", scope: "store", include: ["*"] });
  });

  it("show in Mermaid as a class diagram", () => {
    expect(renderMermaid(view(code(), "controller-classes"))).toBe(
      [
        "classDiagram",
        '  class payments["Payments"] {',
        "    <<External System>>",
        "  }",
        '  class order["Order"] {',
        "    <<entity>>",
        "    +id: OrderId",
        "    +total() Money",
        "  }",
        '  class order_line["Order line"] {',
        "    +quantity: int",
        "  }",
        '  class repository["Order repository"] {',
        "    <<interface>>",
        "    +save(order: Order) void",
        "  }",
        '  class sql_repository["SQL order repository"]',
        "  order *-- order_line : Holds",
        "  order --> payments : Charges",
        "  repository ..> order : Saves",
        "  sql_repository ..|> repository",
      ].join("\n"),
    );
  });

  it("escape what Mermaid reads as markup, and keywords used as IDs", () => {
    const doc = code();
    doc.elements.note = { kind: "class", name: 'A "quoted" <T>', parent: "controller", members: ["+__init__(): None", "#map: Map<K, List<V>>", "+opts: { a: 1 }; ~x*$"] };
    doc.elements.note.uses = [{ to: "order", kind: "inheritance", description: "Is a <kind>" }];
    const text = renderMermaid(view(doc, "controller-classes"));
    expect(text).toContain(
      [
        '  class note_["A #quot;quoted#quot; #lt;T#gt;"] {',
        "    +#95;#95;init#95;#95;() None",
        "    #35;map: Map#lt;K, List#lt;V#gt;#gt;",
        "    +opts: #123; a: 1 #125;#59; #126;x#42;#36;",
        "  }",
      ].join("\n"),
    );
    expect(text).toContain("  note_ --|> order : Is a #lt;kind#gt;");
  });

  it("are documented with their members and stereotype, and relationships with their kind", () => {
    const files = exportDocs(buildWorkspace(code()), "shop.openarch");
    const page = (path: string) => files.find((f) => f.path === path)!.content;
    expect(page("elements/order.md")).toContain("**Class** · «entity» · inside [Controller](controller.md)");
    expect(page("elements/order.md")).toContain("## Members\n\n```text\n+id: OrderId\n+total(): Money\n```");
    expect(page("elements/order.md")).toContain("| [Order line](order-line.md) | (composition) Holds |  |");
    expect(page("views/controller-classes.md")).toContain("Class view of [Controller](../elements/controller.md).");
    expect(page("views/controller-classes.md")).toContain("| [SQL order repository](../elements/sql-repository.md) | [Order repository](../elements/repository.md) | (realization) |  |");
    expect(page("views/controller-classes.md")).toContain("```mermaid\nclassDiagram\n");
  });

  it("go when their component is removed, with relationships to them and class views of it", () => {
    const doc = apply(code(), { op: "remove-element", id: "controller" });
    expect(Object.keys(doc.elements)).not.toContain("order");
    expect(doc.elements["sql-repository"]!.uses).toEqual([{ to: "db", description: "Writes orders", technology: "SQL" }]);
    expect(doc.views).not.toHaveProperty("controller-classes");
  });
});
