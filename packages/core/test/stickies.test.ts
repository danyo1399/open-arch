import { describe, expect, it } from "vitest";
import { applyOperations, buildWorkspace, checkWorkspace, computeView, exportDocs, OpError, parseDocument, parseOperations, serializeDocument, stickyAnchor, type OpenArchDocument, type Operation } from "../src/index.js";
import { apply, shop } from "./helpers.js";

function fails(doc: OpenArchDocument, ...ops: Operation[]): string {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  return "applied";
}

/** The shop, with a note on each kind of thing on its container view. */
function noted(): OpenArchDocument {
  const doc = shop();
  doc.views["shop-containers"]!.stickies = {
    cache: { text: "Cached for a minute.", on: { element: "db" }, at: [10, 20] },
    orders: { text: "Sends the basket.", on: { from: "web-app", to: "controller" } },
    plain: { text: "Not on anything." },
  };
  return doc;
}

/** What the view draws each of its notes on: a box, the frame or an arrow, by its ends, or "-" when it draws none. */
function anchors(doc: OpenArchDocument, view: string): Record<string, string> {
  const ws = buildWorkspace(doc);
  const cv = computeView(ws, ws.views.get(view)!);
  return Object.fromEntries(
    cv.view.stickies.map((s) => {
      const a = s.on && stickyAnchor(ws, cv, s.on);
      return [s.id, !a ? "-" : a.kind === "arrow" ? `arrow ${a.edge.from}->${a.edge.to}` : `${a.kind} ${a.id}`];
    }),
  );
}

describe("sticky notes on elements and relationships", () => {
  it("are read and written in the file's canonical form, with an association's kind left out", () => {
    const doc = noted();
    doc.views["shop-containers"]!.stickies!.orders!.on = { from: "web-app", to: "controller", kind: "association" };
    const text = serializeDocument(doc);
    expect(text).toContain('"cache": { "text": "Cached for a minute.", "on": { "element": "db" }, "at": [10, 20] },');
    expect(text).toContain('"orders": { "text": "Sends the basket.", "on": { "from": "web-app", "to": "controller" } },');
    const read = parseDocument(text);
    expect(read.diagnostics).toEqual([]);
    expect(read.doc.views["shop-containers"]!.stickies!.orders!.on).toEqual({ from: "web-app", to: "controller" });
    // The model gives a relationship's kind every time.
    expect(buildWorkspace(read.doc).views.get("shop-containers")!.stickies.find((s) => s.id === "orders")!.on).toEqual({ from: "web-app", to: "controller", kind: "association" });
  });

  it("are new in version 12: a version 11 file is read as it is", () => {
    const parsed = parseDocument(JSON.stringify({ ...shop(), openarch: 11 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(shop());
  });

  it("report what's on nothing they can be on, and keep the note", () => {
    const doc = shop() as unknown as { views: Record<string, Record<string, unknown>> };
    doc.views.landscape!.stickies = {
      a: { text: "A", on: "db" },
      b: { text: "B", on: { element: "db", from: "web-app" } },
      c: { text: "C", on: { from: "web-app" } },
      d: { text: "D", on: { element: "" } },
      e: { text: "E", on: { from: "web-app", to: "controller", kind: "uses", via: "x" } },
      f: { text: "F", on: {} },
    };
    doc.views.order = { title: "Order", level: "sequence", steps: [], stickies: { g: { text: "G", on: { element: "db" } } } };
    const result = parseDocument(JSON.stringify(doc));
    expect(result.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-type views.landscape.stickies.a.on",
      "field-not-allowed views.landscape.stickies.b.on",
      "field-required views.landscape.stickies.c.on.to",
      "field-required views.landscape.stickies.d.on.element",
      "field-unknown views.landscape.stickies.e.on.via",
      "relationship-kind-invalid views.landscape.stickies.e.on.kind",
      "field-required views.landscape.stickies.f.on",
      "field-not-allowed views.order.stickies.g.on",
    ]);
    expect(result.diagnostics.at(-1)!.message).toBe(
      "A sticky note can be on an element or relationship on a landscape, context, container, component or class view, and on a block on a flowchart view. This is a sequence view.",
    );
    expect(Object.keys(result.doc.views.landscape!.stickies!)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(result.doc.views.landscape!.stickies!.a).toEqual({ text: "A" });
    // A bad kind is left out, as on a relationship.
    expect(result.doc.views.landscape!.stickies!.e!.on).toEqual({ from: "web-app", to: "controller" });
    expect(result.doc.views.order!.stickies!.g).toEqual({ text: "G" });
  });

  it("point at the box or frame that draws an element, and the arrow that draws a relationship", () => {
    const doc = noted();
    expect(anchors(doc, "shop-containers")).toEqual({ cache: "box db", orders: "arrow web-app->api", plain: "-" });
    // A component is drawn as its container, and the view's scope is the frame.
    doc.views["shop-containers"]!.stickies = { component: { text: "x", on: { element: "controller" } }, frame: { text: "y", on: { element: "shop" } } };
    expect(anchors(doc, "shop-containers")).toEqual({ component: "box api", frame: "frame shop" });
    // The landscape draws the shop as one box, so its containers' relationships to it are inside it.
    doc.views.landscape!.stickies = { box: { text: "x", on: { element: "db" } }, gone: { text: "y", on: { from: "web-app", to: "controller" } }, out: { text: "z", on: { from: "controller", to: "payments" } } };
    expect(anchors(doc, "landscape")).toEqual({ box: "box shop", gone: "-", out: "arrow shop->payments" });
  });

  it("are checked: what they're on is in the model, and the view draws it", () => {
    const doc = noted();
    expect(checkWorkspace(buildWorkspace(doc)).filter((d) => d.rule.startsWith("sticky"))).toEqual([]);
    doc.views["shop-containers"]!.stickies = {
      a: { text: "A", on: { element: "dbb" } },
      b: { text: "B", on: { from: "web-app", to: "db" } },
      c: { text: "C", on: { from: "nope", to: "db" } },
      d: { text: "D", on: { from: "web-app", to: "controller", kind: "inheritance" } },
      e: { text: "E", on: { element: "customer" } },
    };
    doc.views["shop-containers"]!.exclude = ["customer"];
    const found = checkWorkspace(buildWorkspace(doc)).filter((d) => d.rule.startsWith("sticky"));
    expect(found.map((d) => `${d.severity} ${d.rule} ${d.path}: ${d.message}`)).toEqual([
      'error sticky-unknown-target views.shop-containers.stickies.a.on.element: The note is on "dbb", which isn\'t an element.',
      'error sticky-unknown-target views.shop-containers.stickies.b.on: The note is on a relationship from "web-app" to "db", and "web-app" has none.',
      'error sticky-unknown-target views.shop-containers.stickies.c.on.from: The note is on a relationship from "nope" to "db", and "nope" isn\'t an element.',
      'error sticky-unknown-target views.shop-containers.stickies.d.on: The note is on a relationship from "web-app" to "controller" of the kind "inheritance", and "web-app" has none.',
      'warning sticky-target-not-drawn views.shop-containers.stickies.e.on: The note "e" is on "customer", which this view doesn\'t draw, so no line joins them.',
    ]);
    expect(found[0]!.fix).toBe('Did you mean "db"?');
    expect(found.at(-1)!.fix).toBe("Show it in this view, or take the note off it: `open-arch update-sticky shop-containers e --detach`.");
  });

  it("say to swap the ends of a relationship that goes both ways, named from its other end", () => {
    const doc = shop();
    doc.elements["web-app"]!.uses![0]!.bidirectional = true;
    doc.views["api-components"]!.stickies = { n: { text: "N", on: { from: "controller", to: "web-app" } } };
    const found = checkWorkspace(buildWorkspace(doc)).find((d) => d.rule === "sticky-unknown-target")!;
    expect(found.fix).toBe('That relationship goes both ways, and it\'s on "web-app": swap `from` and `to`.');
    expect(fails(shop(), { op: "update-relationship", from: "web-app", to: "controller", bidirectional: true }, { op: "add-sticky", view: "api-components", id: "n", text: "N", on: { from: "controller", to: "web-app" } })).toBe(
      'Operation 2 (add-sticky): "controller" has no relationship to "web-app". The one between them goes both ways, and it\'s on "web-app": put the note on web-app -> controller.',
    );
  });
});

describe("putting sticky notes on things", () => {
  it("adds a note on an element or a relationship, and says what it's on", () => {
    const result = applyOperations(shop(), [
      { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { element: "db" } },
      { op: "add-sticky", view: "shop-containers", id: "b", text: "B", on: { from: "controller", to: "db", kind: "association" } },
    ]);
    expect(result.summary).toEqual(["added sticky note a to view shop-containers, on db", "added sticky note b to view shop-containers, on controller -> db"]);
    expect(result.doc.views["shop-containers"]!.stickies).toEqual({ a: { text: "A", on: { element: "db" } }, b: { text: "B", on: { from: "controller", to: "db" } } });
    expect(result.warnings).toEqual([]);
  });

  it("moves a note onto something else, and takes it off", () => {
    let doc = apply(shop(), { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { element: "db" } });
    doc = apply(doc, { op: "update-sticky", view: "shop-containers", id: "a", on: { from: "customer", to: "web-app" } });
    expect(doc.views["shop-containers"]!.stickies!.a).toEqual({ text: "A", on: { from: "customer", to: "web-app" } });
    doc = apply(doc, { op: "update-sticky", view: "shop-containers", id: "a", on: null });
    expect(doc.views["shop-containers"]!.stickies!.a).toEqual({ text: "A" });
    expect(fails(doc, { op: "update-sticky", view: "shop-containers", id: "a" })).toBe("Say what to change: text, on, color, at, size or notes.");
  });

  it("refuses what isn't there, and views that don't draw boxes", () => {
    const doc = apply(shop(), { op: "add-view", id: "order", level: "sequence" });
    expect(fails(doc, { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { element: "dbb" } })).toBe('No element has the ID "dbb". Did you mean "db"?');
    expect(fails(doc, { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { from: "web-app", to: "db" } })).toBe('"web-app" has no relationship to "db".');
    expect(fails(doc, { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { from: "web-app", to: "controller", kind: "inheritance" } })).toBe('"web-app" has no inheritance relationship to "controller".');
    expect(fails(doc, { op: "add-sticky", view: "shop-containers", id: "a", text: "A", on: { from: "web-app", to: "controller", kind: "likes" as never } })).toMatch(/^Unknown kind of relationship "likes"/);
    expect(fails(doc, { op: "add-sticky", view: "order", id: "a", text: "A", on: { element: "db" } })).toBe(
      'View "order" is a sequence view. A sticky note can be on an element or relationship on a landscape, context, container, component or class view, and on a block on a flowchart view.',
    );
  });

  it("warns about a note on something the view doesn't draw", () => {
    const result = applyOperations(shop(), [{ op: "add-sticky", view: "landscape", id: "a", text: "A", on: { from: "web-app", to: "controller" } }]);
    expect(result.warnings.map((w) => w.rule)).toEqual(["sticky-target-not-drawn"]);
  });

  it("follows a rename, and comes off an element that's removed or a relationship to or from one", () => {
    let doc = noted();
    doc = apply(doc, { op: "rename", id: "web-app", to: "store" }, { op: "rename", id: "db", to: "orders-db" });
    expect(doc.views["shop-containers"]!.stickies!.cache!.on).toEqual({ element: "orders-db" });
    expect(doc.views["shop-containers"]!.stickies!.orders!.on).toEqual({ from: "store", to: "controller" });
    doc = apply(doc, { op: "remove-element", id: "orders-db" }, { op: "remove-element", id: "api" });
    expect(doc.views["shop-containers"]!.stickies).toEqual({
      cache: { text: "Cached for a minute.", at: [10, 20] },
      orders: { text: "Sends the basket." },
      plain: { text: "Not on anything." },
    });
  });

  it("comes off a relationship once the last of its kind between those ends is removed", () => {
    let doc = noted();
    doc.elements["web-app"]!.uses!.push({ to: "controller", description: "Checks stock" });
    doc = apply(doc, { op: "remove-relationship", from: "web-app", to: "controller", index: 0 });
    expect(doc.views["shop-containers"]!.stickies!.orders!.on).toEqual({ from: "web-app", to: "controller" });
    doc = apply(doc, { op: "remove-relationship", from: "web-app", to: "controller" });
    expect(doc.views["shop-containers"]!.stickies!.orders!.on).toBeUndefined();
  });

  it("follows a relationship to its new ends and kind, unless another like it is left", () => {
    let doc = noted();
    doc = apply(doc, { op: "update-relationship", from: "web-app", to: "controller", newTo: "db" });
    expect(doc.views["shop-containers"]!.stickies!.orders!.on).toEqual({ from: "web-app", to: "db" });
    doc = apply(doc, { op: "update-relationship", from: "web-app", to: "db", newFrom: "customer" });
    expect(doc.views["shop-containers"]!.stickies!.orders!.on).toEqual({ from: "customer", to: "db" });
    // The customer's other relationship, to the web app, is still there, so a note on it stays.
    doc = apply(doc, { op: "update-sticky", view: "shop-containers", id: "plain", on: { from: "customer", to: "web-app" } });
    doc.elements.customer!.uses!.push({ to: "web-app", description: "Browses" });
    doc = apply(doc, { op: "update-relationship", from: "customer", to: "web-app", index: 1, newTo: "api" });
    expect(doc.views["shop-containers"]!.stickies!.plain!.on).toEqual({ from: "customer", to: "web-app" });
  });

  it("follows a relationship between classes when its kind changes", () => {
    const doc = shop();
    doc.elements.order = { kind: "class", name: "Order", parent: "controller", uses: [{ to: "entity", kind: "inheritance" }] };
    doc.elements.entity = { kind: "class", name: "Entity", parent: "controller" };
    doc.views.classes = { title: "Classes", level: "class", scope: "controller", stickies: { n: { text: "N", on: { from: "order", to: "entity", kind: "inheritance" } } } };
    expect(anchors(doc, "classes")).toEqual({ n: "arrow order->entity" });
    const next = apply(doc, { op: "update-relationship", from: "order", to: "entity", kind: "realization" });
    expect(next.views.classes!.stickies!.n!.on).toEqual({ from: "order", to: "entity", kind: "realization" });
    expect(apply(next, { op: "update-relationship", from: "order", to: "entity", kind: null }).views.classes!.stickies!.n!.on).toEqual({ from: "order", to: "entity" });
  });

  it("checks what a note is on when it's sent as JSON", () => {
    const bad = (op: unknown) => {
      try {
        parseOperations(op);
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", on: { element: "db" } })).toBe("ok");
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", on: { from: "a", to: "b", kind: "inheritance" } })).toBe("ok");
    expect(bad({ op: "update-sticky", view: "v", id: "n", on: null })).toBe("ok");
    for (const on of ["db", { element: "db", to: "x" }, { from: "a" }, { from: "a", to: 2 }, { from: "a", to: "b", index: 0 }]) {
      expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", on })).toMatch(/^add-sticky: "on" must be an element, like \{ "element": "cache" \}, a relationship/);
    }
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", on: null })).toMatch(/^add-sticky: "on" must be/);
  });
});

describe("sticky notes in the docs", () => {
  it("start with what they're on", () => {
    const doc = noted();
    doc.views["shop-containers"]!.stickies!.orders!.text = "Sends the basket.\nThen waits.";
    const page = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/shop-containers.md")!.content;
    expect(page).toContain(
      [
        "## Sticky notes",
        "",
        "> On [DB](../elements/db.md): Cached for a minute.",
        "",
        "> On [Web App](../elements/web-app.md) → [Controller](../elements/controller.md): Sends the basket.",
        "> Then waits.",
        "",
        "> Not on anything.",
      ].join("\n"),
    );
  });

  it("have their notes after their text, in the same quote", () => {
    const doc = noted();
    doc.views["shop-containers"]!.stickies!.cache!.notes = "Kept for **a minute**.\n\n- Then read again";
    const page = exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === "views/shop-containers.md")!.content;
    expect(page).toContain(["> On [DB](../elements/db.md): Cached for a minute.", ">", "> Kept for **a minute**.", ">", "> - Then read again", "", "> On [Web App]"].join("\n"));
  });
});

describe("a sticky note's notes", () => {
  it("are read and written in the file's canonical form, after its other fields", () => {
    const doc = noted();
    doc.views["shop-containers"]!.stickies!.cache!.notes = "## Why\n\nIt's read often.";
    const text = serializeDocument(doc);
    expect(text).toContain('"cache": { "text": "Cached for a minute.", "on": { "element": "db" }, "at": [10, 20], "notes": "## Why\\n\\nIt\'s read often." },');
    const read = parseDocument(text);
    expect(read.diagnostics).toEqual([]);
    expect(read.doc.views["shop-containers"]!.stickies).toEqual(doc.views["shop-containers"]!.stickies);
    expect(buildWorkspace(read.doc).views.get("shop-containers")!.stickies.find((s) => s.id === "cache")!.notes).toBe("## Why\n\nIt's read often.");
  });

  it("are reported when they aren't text, and the note is kept", () => {
    const doc = shop() as unknown as { views: Record<string, Record<string, unknown>> };
    doc.views.landscape!.stickies = { a: { text: "A", notes: 5 } };
    const read = parseDocument(JSON.stringify(doc));
    expect(read.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["field-type views.landscape.stickies.a.notes"]);
    expect(read.doc.views.landscape!.stickies).toEqual({ a: { text: "A" } });
  });

  it("are new in version 19: a version 18 file is read as it is", () => {
    const parsed = parseDocument(JSON.stringify({ ...noted(), openarch: 18 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(noted());
  });

  it("are given when a note is added, and changed, trimmed and taken off when it's updated", () => {
    let doc = apply(shop(), { op: "add-sticky", view: "landscape", id: "a", text: "A", notes: "  Longer.\n" }, { op: "add-sticky", view: "landscape", id: "b", text: "B", notes: " " });
    expect(doc.views.landscape!.stickies).toEqual({ a: { text: "A", notes: "Longer." }, b: { text: "B" } });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", notes: "**More.**" });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A", notes: "**More.**" });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", text: "A2" });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A2", notes: "**More.**" });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", notes: "" });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A2" });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "b", notes: "B's." }, { op: "update-sticky", view: "landscape", id: "b", notes: null });
    expect(doc.views.landscape!.stickies!.b).toEqual({ text: "B" });
  });

  it("are checked in a batch: text, or null to take them off", () => {
    const bad = (op: unknown) => {
      try {
        parseOperations(op);
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", notes: "y" })).toBe("ok");
    expect(bad({ op: "update-sticky", view: "v", id: "n", notes: null })).toBe("ok");
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", notes: null })).toMatch(/^add-sticky: "notes" must be/);
    expect(bad({ op: "update-sticky", view: "v", id: "n", notes: 5 })).toMatch(/^update-sticky: "notes" must be/);
  });
});

describe("a sticky note's size", () => {
  it("is read and written in the file's canonical form, after where it is", () => {
    const doc = noted();
    doc.views["shop-containers"]!.stickies!.cache!.size = [260, 120];
    const text = serializeDocument(doc);
    expect(text).toContain('"cache": { "text": "Cached for a minute.", "on": { "element": "db" }, "at": [10, 20], "size": [260, 120] },');
    const read = parseDocument(text);
    expect(read.diagnostics).toEqual([]);
    expect(read.doc.views["shop-containers"]!.stickies).toEqual(doc.views["shop-containers"]!.stickies);
    expect(buildWorkspace(read.doc).views.get("shop-containers")!.stickies.find((s) => s.id === "cache")!.size).toEqual([260, 120]);
  });

  it("is reported when it isn't a width and a height above 0, and the note is kept", () => {
    const doc = shop() as unknown as { views: Record<string, Record<string, unknown>> };
    doc.views.landscape!.stickies = { a: { text: "A", size: [200] }, b: { text: "B", size: [0, 80] }, c: { text: "C", size: ["wide", 80] } };
    const read = parseDocument(JSON.stringify(doc));
    expect(read.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["field-type views.landscape.stickies.a.size", "field-type views.landscape.stickies.b.size", "field-type views.landscape.stickies.c.size"]);
    expect(read.doc.views.landscape!.stickies).toEqual({ a: { text: "A" }, b: { text: "B" }, c: { text: "C" } });
  });

  it("is new in version 22: a version 21 file is read as it is", () => {
    const parsed = parseDocument(JSON.stringify({ ...noted(), openarch: 21 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(noted());
  });

  it("is given when a note is added, rounded, and changed and taken off when it's updated", () => {
    let doc = apply(shop(), { op: "add-sticky", view: "landscape", id: "a", text: "A", size: [260.4, 119.6] });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A", size: [260, 120] });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", at: [5, 6], size: [300, 90] });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A", at: [5, 6], size: [300, 90] });
    // Putting it back where the designer places it keeps its size.
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", at: null });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A", size: [300, 90] });
    doc = apply(doc, { op: "update-sticky", view: "landscape", id: "a", size: null });
    expect(doc.views.landscape!.stickies!.a).toEqual({ text: "A" });
  });

  it("refuses a width or height that isn't above 0", () => {
    expect(fails(shop(), { op: "add-sticky", view: "landscape", id: "a", text: "A", size: [0, 80] })).toBe("A sticky note's width and height must be more than 0.");
    const doc = apply(shop(), { op: "add-sticky", view: "landscape", id: "a", text: "A" });
    expect(fails(doc, { op: "update-sticky", view: "landscape", id: "a", size: [200, -1] })).toBe("A sticky note's width and height must be more than 0.");
  });

  it("is checked in a batch: a width and a height, or null for the usual size", () => {
    const bad = (op: unknown) => {
      try {
        parseOperations(op);
        return "ok";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", size: [200, 80] })).toBe("ok");
    expect(bad({ op: "update-sticky", view: "v", id: "n", size: null })).toBe("ok");
    expect(bad({ op: "add-sticky", view: "v", id: "n", text: "x", size: null })).toMatch(/^add-sticky: "size" must be a width and a height/);
    expect(bad({ op: "update-sticky", view: "v", id: "n", size: [200] })).toMatch(/^update-sticky: "size" must be a width and a height/);
  });
});
