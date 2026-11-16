import { describe, expect, it } from "vitest";
import {
  applyOperations,
  arrowName,
  buildWorkspace,
  checkWorkspace,
  computeView,
  exportDocs,
  OpError,
  parseDocument,
  parseOperations,
  renderMermaid,
  serializeDocument,
  shapeName,
  type OpenArchDocument,
  type Operation,
} from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with a whiteboard of an idea: a title, two boxes, a question, a scribble, and arrows between them. */
function ideas(): OpenArchDocument {
  const doc = shop();
  doc.views.ideas = {
    title: "Ideas",
    level: "whiteboard",
    shapes: [
      { id: "title", kind: "text", text: "Faster checkout", at: [0, -100], size: "large" },
      { id: "cache", kind: "rectangle", text: "Cache the menus", at: [0, 0, 180, 90], fill: "yellow" },
      { id: "db", kind: "ellipse", text: "Orders DB", at: [300, 0], color: "blue", dashed: true },
      { id: "which", kind: "diamond", text: "Redis\nor memory?", at: [0, 200] },
      { id: "scribble", kind: "pen", at: [300, 200], points: [[0, 0], [12, 6], [30, 2]], color: "red" },
    ],
    arrows: [
      { id: "reads", from: "cache", to: "db", text: "reads" },
      { id: "choose", from: "cache", to: "which", heads: "none", dashed: true },
      { id: "look", from: [500, 260], to: "scribble", color: "red" },
    ],
  };
  return doc;
}

function fails(doc: OpenArchDocument, ...ops: Operation[]): string {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("expected the operations to be refused");
}

/** The shop with an empty whiteboard, "ideas". */
const base = () => apply(shop(), { op: "add-view", id: "ideas", level: "whiteboard" });

describe("whiteboard views", () => {
  it("are read and written, with a shape or an arrow on each line, from the back to the front", () => {
    const text = serializeDocument(ideas());
    expect(text).toContain(`    "ideas": {
      "title": "Ideas",
      "level": "whiteboard",
      "shapes": [
        { "id": "title", "kind": "text", "text": "Faster checkout", "at": [0, -100], "size": "large" },
        { "id": "cache", "kind": "rectangle", "text": "Cache the menus", "at": [0, 0, 180, 90], "fill": "yellow" },
        { "id": "db", "kind": "ellipse", "text": "Orders DB", "at": [300, 0], "color": "blue", "dashed": true },
        { "id": "which", "kind": "diamond", "text": "Redis\\nor memory?", "at": [0, 200] },
        { "id": "scribble", "kind": "pen", "at": [300, 200], "points": [[0, 0], [12, 6], [30, 2]], "color": "red" }
      ],
      "arrows": [
        { "id": "reads", "from": "cache", "to": "db", "text": "reads" },
        { "id": "choose", "from": "cache", "to": "which", "heads": "none", "dashed": true },
        { "id": "look", "from": [500, 260], "to": "scribble", "color": "red" }
      ]
    },`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.ideas).toEqual(ideas().views.ideas);
    expect(rules(ideas())).toEqual([]);
  });

  it("are written with empty lists when they have nothing on them yet, and leave out the defaults", () => {
    expect(serializeDocument(base())).toContain(`      "level": "whiteboard",\n      "shapes": [],\n      "arrows": []\n    }`);
    const doc = apply(
      base(),
      { op: "add-shape", view: "ideas", id: "a", kind: "rectangle", at: [1.4, 2.6], size: "medium", color: "black", dashed: false },
      { op: "add-shape", view: "ideas", id: "b", kind: "ellipse", at: [300, 0] },
      { op: "add-arrow", view: "ideas", id: "ab", from: "a", to: "b", heads: "end", color: "black" },
    );
    expect(doc.views.ideas).toEqual({
      title: "Ideas",
      level: "whiteboard",
      shapes: [
        { id: "a", kind: "rectangle", at: [1, 3] },
        { id: "b", kind: "ellipse", at: [300, 0] },
      ],
      arrows: [{ id: "ab", from: "a", to: "b" }],
    });
    // Reading drops them too.
    const parsed = parseDocument(JSON.stringify({ ...shop(), views: { w: { title: "W", level: "whiteboard", shapes: [{ id: "a", kind: "text", at: [0, 0], size: "medium", color: "black" }], arrows: [{ id: "x", from: [0, 0], to: "a", heads: "end", dashed: false }] } } }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.w).toEqual({ title: "W", level: "whiteboard", shapes: [{ id: "a", kind: "text", at: [0, 0] }], arrows: [{ id: "x", from: [0, 0], to: "a" }] });
  });

  it("are new in version 14: a version 13 file is read as it is", () => {
    const old = shop();
    const parsed = parseDocument(JSON.stringify({ ...old, openarch: 13 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual(old);
  });

  it("refuse fields of other views, and report malformed shapes and arrows", () => {
    const doc = {
      ...shop(),
      views: {
        w: {
          title: "W",
          level: "whiteboard",
          scope: "shop",
          include: ["*"],
          layout: {},
          screens: [],
          shapes: [
            { id: "ok", kind: "rectangle", at: [0, 0] },
            { id: "ok", kind: "ellipse", at: [0, 0] },
            { id: "Bad", kind: "rectangle", at: [0, 0] },
            { kind: "rectangle", at: [0, 0] },
            { id: "star", kind: "star", at: [0, 0] },
            { id: "nowhere", kind: "rectangle" },
            { id: "flat", kind: "rectangle", at: [0, 0, 10, 0] },
            { id: "line", kind: "pen", at: [0, 0, 10, 10], points: [[0, 0], [1, 1]] },
            { id: "dot", kind: "pen", at: [0, 0], points: [[0, 0]] },
            { id: "words", kind: "pen", at: [0, 0], points: [[0, 0], [1, 1]], text: "Hi", fill: "red" },
            { id: "box", kind: "rectangle", at: [0, 0], points: [[0, 0], [1, 1]], size: "tiny", color: "pink", fill: "black", dashed: "yes", shadow: true },
            { id: "label", kind: "text", at: [0, 0], dashed: true },
            "nope",
          ],
          arrows: [
            { id: "a", from: "ok", to: [1, 2] },
            { id: "a", from: "ok", to: [1, 2] },
            { id: "b", from: "ok" },
            { id: "c", from: 5, to: "ok", heads: "start" },
          ],
        },
        other: { title: "Other", level: "landscape", shapes: [], arrows: [] },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.w.scope",
      "field-not-allowed views.w.include",
      "field-not-allowed views.w.layout",
      "field-not-allowed views.w.screens",
      "id-duplicate views.w.shapes[1].id",
      "id-format views.w.shapes[2].id",
      "field-required views.w.shapes[3].id",
      "shape-kind-invalid views.w.shapes[4].kind",
      "field-required views.w.shapes[5].at",
      "field-type views.w.shapes[6].at",
      "field-type views.w.shapes[7].at",
      "field-type views.w.shapes[8].points",
      "field-not-allowed views.w.shapes[9].text",
      "field-not-allowed views.w.shapes[9].fill",
      "field-unknown views.w.shapes[10].shadow",
      "field-not-allowed views.w.shapes[10].points",
      "size-invalid views.w.shapes[10].size",
      "fill-invalid views.w.shapes[10].fill",
      "color-invalid views.w.shapes[10].color",
      "field-type views.w.shapes[10].dashed",
      "field-not-allowed views.w.shapes[11].dashed",
      "field-type views.w.shapes[12]",
      "id-duplicate views.w.arrows[1].id",
      "field-required views.w.arrows[2].to",
      "field-type views.w.arrows[3].from",
      "field-not-allowed views.other.shapes",
      "field-not-allowed views.other.arrows",
    ]);
    expect(parsed.diagnostics.find((d) => d.path === "views.w.shapes[7].at")!.message).toBe("Must be a position, [x, y]: how big a pen's line is comes from its points.");
    expect(parsed.doc.views.w!.shapes!.map((s) => s.id)).toEqual(["ok", "words", "box", "label"]);
    expect(parsed.doc.views.w!.arrows).toEqual([{ id: "a", from: "ok", to: [1, 2] }]);
    expect(parsed.valid).toBe(false);
  });

  it("are checked: an arrow's end is a shape of the view, or a point, and not the shape at its other end", () => {
    const doc = ideas();
    doc.views.ideas!.arrows!.push({ id: "lost", from: "cahce", to: [0, 0] }, { id: "loop", from: "db", to: "db" });
    const found = checkWorkspace(buildWorkspace(doc)).map((d) => [d.severity, d.rule, d.path, d.message, d.fix]);
    expect(found).toEqual([
      ["error", "arrow-end-unknown", "views.ideas.arrows[3].from", 'Arrow "lost" starts at "cahce", which isn\'t a shape of this view.', 'Did you mean "cache"?'],
      ["warning", "arrow-to-itself", "views.ideas.arrows[4].to", 'Arrow "loop" goes from shape "db" to itself, so it isn\'t drawn.', "Point `to` at another shape, or at a point."],
    ]);
  });

  it("warn about text with nothing to say, which draws nothing, and still move and restyle it", () => {
    const doc = ideas();
    doc.views.ideas!.shapes!.push({ id: "blank", kind: "text", at: [0, 0] }, { id: "spaces", kind: "text", text: "  ", at: [0, 0] });
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => [d.severity, d.rule, d.path, d.message])).toEqual([
      ["warning", "shape-text-empty", "views.ideas.shapes[5].text", 'Text "blank" has nothing to say, so it draws nothing on the board.'],
      ["warning", "shape-text-empty", "views.ideas.shapes[6].text", 'Text "spaces" has nothing to say, so it draws nothing on the board.'],
    ]);
    // Only a change to its text or kind has to give it some: moving it, with others too, restyling, renaming or reordering it doesn't.
    const moved = apply(
      doc,
      { op: "update-shape", view: "ideas", id: "blank", at: [10, 20], color: "red", fill: "yellow", size: "large", position: 1, newId: "empty" },
      { op: "update-shape", view: "ideas", id: "cache", at: [5, 5] },
    );
    expect(moved.views.ideas!.shapes![0]).toEqual({ id: "empty", kind: "text", at: [10, 20], size: "large", color: "red", fill: "yellow" });
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "blank", text: " " })).toMatch(/^Text needs something to say/);
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "blank", kind: "text" })).toMatch(/^Text needs something to say/);
    expect(apply(doc, { op: "update-shape", view: "ideas", id: "blank", text: "Now it says something" }).views.ideas!.shapes![5]!.text).toBe("Now it says something");
  });

  it("know each shape's place from the back, and fill in the defaults", () => {
    const view = buildWorkspace(ideas()).views.get("ideas")!;
    expect(view.shapes.map((s) => [s.id, s.number, s.size, s.color, s.fill, s.dashed, s.points.length])).toEqual([
      ["title", 1, "large", "black", undefined, false, 0],
      ["cache", 2, "medium", "black", "yellow", false, 0],
      ["db", 3, "medium", "blue", undefined, true, 0],
      ["which", 4, "medium", "black", undefined, false, 0],
      ["scribble", 5, "medium", "red", undefined, false, 3],
    ]);
    expect(view.arrows.map((a) => [a.id, a.heads, a.color, a.dashed])).toEqual([
      ["reads", "end", "black", false],
      ["choose", "none", "black", true],
      ["look", "end", "red", false],
    ]);
    expect(computeView(buildWorkspace(ideas()), view)).toMatchObject({ nodes: [], edges: [], diagnostics: [] });
  });

  it("show in Mermaid as a flowchart of their shapes, in their colours, with the arrows between them", () => {
    expect(renderMermaid(computeView(buildWorkspace(ideas()), buildWorkspace(ideas()).views.get("ideas")!))).toBe(
      [
        "flowchart TB",
        '  title["<b>Faster checkout</b>"]',
        '  cache["Cache the menus"]',
        '  db(["Orders DB"])',
        '  which{"Redis<br/>or memory?"}',
        '  cache -->|"reads"| db',
        "  cache -.- which",
        "  style title fill:none,stroke:none,color:#1e1e1e",
        "  style cache fill:#fff3bf,stroke:#1e1e1e,color:#1e1e1e",
        "  style db fill:none,stroke:#1971c2,color:#1971c2,stroke-dasharray:5 5",
        "  style which fill:none,stroke:#1e1e1e,color:#1e1e1e",
      ].join("\n"),
    );
    const doc = ideas();
    doc.views.ideas!.arrows = [
      { id: "both", from: "db", to: "cache", heads: "both", color: "green", text: 'Says "hi"' },
      { id: "maybe", from: "which", to: "db", dashed: true },
      { id: "line", from: "title", to: "db", heads: "none" },
      { id: "both-dashed", from: "title", to: "which", heads: "both", dashed: true },
    ];
    const ws = buildWorkspace(doc);
    const text = renderMermaid(computeView(ws, ws.views.get("ideas")!));
    expect(text).toContain('  db <-->|"Says #quot;hi#quot;"| cache\n  which -.-> db\n  title --- db\n  title <-.-> which\n');
    expect(text).toContain("  linkStyle 0 stroke:#2f9e44");
    expect(text.match(/linkStyle/g)).toHaveLength(1);
  });

  it("say so in Mermaid when there's nothing it can draw, and draw a shape with no text", () => {
    const ws = buildWorkspace(base());
    expect(renderMermaid(computeView(ws, ws.views.get("ideas")!))).toBe("flowchart TB\n  %% This view has no shapes Mermaid can draw yet.");
    const pens = buildWorkspace(apply(base(), { op: "add-shape", view: "ideas", id: "line", kind: "pen", points: [[0, 0], [5, 5]] }));
    expect(renderMermaid(computeView(pens, pens.views.get("ideas")!))).toBe("flowchart TB\n  %% This view has no shapes Mermaid can draw yet.");
    const empty = buildWorkspace(apply(base(), { op: "add-shape", view: "ideas", id: "box", kind: "rectangle", text: "\n" }));
    expect(renderMermaid(computeView(empty, empty.views.get("ideas")!))).toContain('  box[" "]');
  });

  it("are documented with a table of their shapes in reading order and one of their arrows, and say what Mermaid leaves out", () => {
    const page = exportDocs(buildWorkspace(ideas()), "shop.openarch").find((f) => f.path === "views/ideas.md")!.content;
    expect(page).toContain("# Ideas\n\nWhiteboard view.\n\n```mermaid\nflowchart TB\n");
    expect(page).toContain(
      [
        "## Shapes",
        "",
        "| Shape | Text |",
        "|---|---|",
        "| Text | Faster checkout |",
        "| Rectangle | Cache the menus |",
        "| Ellipse | Orders DB |",
        "| Diamond | Redis / or memory? |",
        "| Pen line |  |",
        "",
        "## Arrows",
        "",
        "| Arrow | From | To | Text |",
        "|---|---|---|---|",
        "| Arrow | Cache the menus | Orders DB | reads |",
        "| Line | Cache the menus | Redis |  |",
        "| Arrow | the point (500, 260) | Pen scribble |  |",
        "",
        "The diagram above leaves out the line drawn with the pen, and the arrow with an end at a point or on a pen's line, as Mermaid can't draw them. Open the view in the designer to see the whole whiteboard.",
      ].join("\n"),
    );
    // An arrow from a shape to itself isn't drawn either, but that's a problem check reports, not something Mermaid can't draw.
    const looped = ideas();
    looped.views.ideas!.arrows!.push({ id: "loop", from: "db", to: "db" });
    expect(exportDocs(buildWorkspace(looped), "shop.openarch").find((f) => f.path === "views/ideas.md")!.content).toContain("the line drawn with the pen, and the arrow with an end at a point");
    const noPen = ideas();
    noPen.views.ideas!.shapes = noPen.views.ideas!.shapes!.filter((s) => s.kind !== "pen");
    noPen.views.ideas!.arrows = [{ id: "reads", from: "cache", to: "db" }, { id: "loop", from: "db", to: "db" }];
    expect(exportDocs(buildWorkspace(noPen), "shop.openarch").find((f) => f.path === "views/ideas.md")!.content).not.toContain("leaves out");
    const plain = exportDocs(buildWorkspace(base()), "shop.openarch").find((f) => f.path === "views/ideas.md")!.content;
    expect(plain).toContain("## Shapes\n\nNone yet.\n\n[All views and elements](../README.md)");
  });

  it("name a shape or an arrow by its text's first line, or else its kind and its ID, unless all the ID says is its kind", () => {
    expect(shapeName({ id: "x", kind: "rectangle", text: "\n  Cache it \nnow" })).toBe("Cache it");
    expect(shapeName({ id: "ellipse", kind: "ellipse" })).toBe("Ellipse");
    expect(shapeName({ id: "ellipse-2", kind: "ellipse" })).toBe("Ellipse 2");
    expect(shapeName({ id: "scribble", kind: "pen" })).toBe("Pen scribble");
    expect(shapeName({ id: "pen-ink", kind: "pen" })).toBe("Pen pen-ink");
    expect(arrowName({ id: "arrow", heads: "end" })).toBe("Arrow");
    expect(arrowName({ id: "line-3", heads: "none" })).toBe("Line 3");
    expect(arrowName({ id: "reads", heads: "both", text: "reads" })).toBe("reads");
  });

  it("add shapes under the ones there are, or where they're put, in front of the rest or at a place from the back", () => {
    let doc = apply(base(), { op: "add-shape", view: "ideas", id: "first", kind: "rectangle", text: "First" });
    expect(doc.views.ideas!.shapes![0]!.at).toEqual([0, 0]);
    doc = apply(
      doc,
      { op: "add-shape", view: "ideas", id: "wide", kind: "ellipse", at: [-50, 10, 200, 150] },
      { op: "add-shape", view: "ideas", id: "under", kind: "text", text: "Under" },
      { op: "add-shape", view: "ideas", id: "two", kind: "text", text: "Two\nlines", size: "huge", at: [400, 400] },
      { op: "add-shape", view: "ideas", id: "below-text", kind: "diamond" },
      { op: "add-shape", view: "ideas", id: "scrawl", kind: "pen", points: [[0, 0], [10, 90]], at: [0, 600] },
      { op: "add-shape", view: "ideas", id: "below-pen", kind: "rectangle" },
    );
    const at = Object.fromEntries(doc.views.ideas!.shapes!.map((s) => [s.id, s.at]));
    expect(at).toEqual({ first: [0, 0], wide: [-50, 10, 200, 150], under: [-50, 200], two: [400, 400], "below-text": [-50, 560], scrawl: [0, 600], "below-pen": [-50, 730] });
    const result = applyOperations(doc, [{ op: "add-shape", view: "ideas", id: "back", kind: "rectangle", position: 1 }]);
    expect(result.summary).toEqual(["added rectangle back to view ideas, as shape 1 from the back"]);
    expect(result.doc.views.ideas!.shapes![0]!.id).toBe("back");
    expect(applyOperations(doc, [{ op: "add-shape", view: "ideas", id: "x", kind: "text", text: "X" }]).summary).toEqual(["added text x to view ideas"]);
  });

  it("change, move, resize, reorder, rename and remove shapes, and the arrows to them follow or go", () => {
    let result = applyOperations(ideas(), [{ op: "update-shape", view: "ideas", id: "cache", kind: "diamond", text: "Cache it", at: [10, 20], color: "green", fill: null, size: "small", dashed: true }]);
    expect(result.summary).toEqual(["updated shape cache in view ideas"]);
    // A position on its own keeps the size.
    expect(result.doc.views.ideas!.shapes![1]).toEqual({ id: "cache", kind: "diamond", text: "Cache it", at: [10, 20, 180, 90], size: "small", color: "green", dashed: true });
    result = applyOperations(result.doc, [{ op: "update-shape", view: "ideas", id: "cache", at: [5, 6, 70, 80], text: "Cached", size: null, color: null, dashed: false, kind: "text" }]);
    expect(result.doc.views.ideas!.shapes![1]).toEqual({ id: "cache", kind: "text", text: "Cached", at: [5, 6, 70, 80] });
    // Shapes with an outline draw something without text; text doesn't.
    expect(apply(ideas(), { op: "update-shape", view: "ideas", id: "cache", text: null }).views.ideas!.shapes![1]).toEqual({ id: "cache", kind: "rectangle", at: [0, 0, 180, 90], fill: "yellow" });
    // Text has no outline, so a shape that becomes text loses its dashes.
    expect(apply(ideas(), { op: "update-shape", view: "ideas", id: "db", kind: "text" }).views.ideas!.shapes![2]).toEqual({ id: "db", kind: "text", text: "Orders DB", at: [300, 0], color: "blue" });
    expect(apply(ideas(), { op: "update-shape", view: "ideas", id: "scribble", points: [[0, 0], [4.4, 5.6]], at: [1, 2], dashed: true }).views.ideas!.shapes![4]).toEqual({
      id: "scribble",
      kind: "pen",
      at: [1, 2],
      points: [[0, 0], [4, 6]],
      color: "red",
      dashed: true,
    });

    result = applyOperations(ideas(), [{ op: "update-shape", view: "ideas", id: "title", position: 5 }]);
    expect(result.summary).toEqual(["moved shape title to 5 from the back in view ideas"]);
    expect(result.doc.views.ideas!.shapes!.map((s) => s.id)).toEqual(["cache", "db", "which", "scribble", "title"]);
    expect(applyOperations(ideas(), [{ op: "update-shape", view: "ideas", id: "title", position: 1 }]).summary).toEqual(["shape title is already shape 1 from the back in view ideas"]);

    result = applyOperations(ideas(), [{ op: "update-shape", view: "ideas", id: "cache", newId: "menus", position: 1 }]);
    expect(result.summary).toEqual(["renamed shape cache to menus in view ideas, and moved it to 1 from the back"]);
    expect(result.doc.views.ideas!.arrows!.map((a) => [a.from, a.to])).toEqual([
      ["menus", "db"],
      ["menus", "which"],
      [[500, 260], "scribble"],
    ]);

    result = applyOperations(ideas(), [{ op: "remove-shape", view: "ideas", id: "cache" }]);
    expect(result.summary).toEqual(["removed shape cache from view ideas and 2 arrows to or from it"]);
    expect(result.doc.views.ideas!.arrows!.map((a) => a.id)).toEqual(["look"]);
    expect(applyOperations(ideas(), [{ op: "remove-shape", view: "ideas", id: "title" }]).summary).toEqual(["removed shape title from view ideas"]);
  });

  it("add, change, rename and remove arrows, from a shape or a point to a shape or a point", () => {
    let result = applyOperations(base(), [
      { op: "add-shape", view: "ideas", id: "a", kind: "rectangle" },
      { op: "add-shape", view: "ideas", id: "b", kind: "rectangle", at: [300, 0] },
      { op: "add-arrow", view: "ideas", id: "ab", from: "a", to: "b", text: "then", heads: "both", color: "purple", dashed: true },
      { op: "add-arrow", view: "ideas", id: "line", from: [0.4, 9.6], to: [100, 100], heads: "none" },
    ]);
    expect(result.summary.slice(2)).toEqual(["added arrow ab to view ideas", "added line line to view ideas"]);
    expect(result.doc.views.ideas!.arrows).toEqual([
      { id: "ab", from: "a", to: "b", text: "then", heads: "both", color: "purple", dashed: true },
      { id: "line", from: [0, 10], to: [100, 100], heads: "none" },
    ]);
    result = applyOperations(result.doc, [
      { op: "update-arrow", view: "ideas", id: "ab", from: [5, 5], text: null, heads: null, color: null, dashed: false },
      { op: "update-arrow", view: "ideas", id: "line", newId: "link", to: "b", text: "goes" },
    ]);
    expect(result.summary).toEqual(["updated arrow ab in view ideas", "renamed arrow line to link in view ideas"]);
    expect(result.doc.views.ideas!.arrows).toEqual([
      { id: "ab", from: [5, 5], to: "b" },
      { id: "link", from: [0, 10], to: "b", text: "goes", heads: "none" },
    ]);
    result = applyOperations(result.doc, [{ op: "remove-arrow", view: "ideas", id: "ab" }]);
    expect(result.summary).toEqual(["removed arrow ab from view ideas"]);
    expect(result.doc.views.ideas!.arrows!.map((a) => a.id)).toEqual(["link"]);
  });

  it("refuse what doesn't fit", () => {
    const doc = ideas();
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "cache", kind: "rectangle" })).toBe('View "ideas" already has a shape "cache".');
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "Bad", kind: "rectangle" })).toBe('"Bad" isn\'t a valid ID. IDs are lowercase kebab-case, like "big-idea".');
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangel" as never })).toBe('Unknown kind of shape "rectangel". Did you mean "rectangle"? Use one of: rectangle, ellipse, diamond, text, pen.');
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "pen" })).toBe("A pen needs points: the points its line goes through, from its corner.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "pen", points: [[0, 0]] })).toBe("A pen's line needs two points or more.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "pen", points: [[0, 0], [1, 1]], at: [0, 0, 5, 5] })).toBe("A pen's at is [x, y]: how big its line is comes from its points.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "pen", points: [[0, 0], [1, 1]], text: "Hi" })).toBe("A pen draws only a line, so it takes no text.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "pen", points: [[0, 0], [1, 1]], fill: "red" })).toBe("A pen draws only a line, so it takes no fill.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", points: [[0, 0], [1, 1]] })).toBe("Only pens have points.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "text", text: "Hi", dashed: true })).toBe("Text has no outline, so it can't be dashed.");
    // Text with nothing to say draws nothing, however it's made.
    const empty = "Text needs something to say: give it text. Without any, it draws nothing on the board.";
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "text" })).toBe(empty);
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "text", text: " \n " })).toBe(empty);
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "title", text: null })).toBe(`${empty} To take it off the board, remove it with remove-shape.`);
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "title", text: "  " })).toBe(`${empty} To take it off the board, remove it with remove-shape.`);
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "which", kind: "text", text: null })).toBe(`${empty} To take it off the board, remove it with remove-shape.`);
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", at: [0, 0, 0, 10] })).toBe("A shape's width and height must be more than 0.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", size: "tiny" as never })).toBe("Unknown text size \"tiny\". Use one of: small, medium, large, huge.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", color: "yellow" as never })).toBe("Unknown color \"yellow\". Use one of: black, grey, red, orange, green, blue, purple.");
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", fill: "pink" as never })).toMatch(/^Unknown fill "pink"\. .*Use one of: white, grey, red, orange, yellow, green, blue, purple\.$/);
    expect(fails(doc, { op: "add-shape", view: "ideas", id: "x", kind: "rectangle", position: 7 })).toBe('View "ideas" has 5 shapes, so a new one\'s position can be 1 to 6.');
    expect(fails(doc, { op: "add-shape", view: "landscape", id: "x", kind: "rectangle" })).toBe('View "landscape" is a landscape view. Only whiteboard views have shapes and arrows.');
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "cache" })).toBe('Say what to change on shape "cache": newId, kind, text, at, points, size, color, fill, dashed, position.');
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "cache", kind: "pen" })).toBe("A shape can't become a pen's line. Remove it, and draw the line with the pen.");
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "scribble", kind: "text" })).toBe("A pen's line can't become another kind of shape. Remove it, and add the shape you want.");
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "scribble", text: "Hi" })).toBe("A pen draws only a line, so it takes no text.");
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "title", dashed: true })).toBe("Text has no outline, so it can't be dashed.");
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "cache", points: [[0, 0], [1, 1]] })).toBe("Only pens have points.");
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "cache", position: 6 })).toBe('View "ideas" has 5 shapes, so "position" must be 1 to 5.');
    expect(fails(doc, { op: "update-shape", view: "ideas", id: "cache", newId: "db" })).toBe('View "ideas" already has a shape "db".');
    expect(fails(doc, { op: "remove-shape", view: "ideas", id: "cahce" })).toBe('View "ideas" has no shape "cahce". Did you mean "cache"?');
    expect(fails(base(), { op: "remove-shape", view: "ideas", id: "x" })).toBe('View "ideas" has no shape "x". Add one with add-shape.');
    expect(fails(doc, { op: "add-arrow", view: "ideas", id: "reads", from: "cache", to: "db" })).toBe('View "ideas" already has an arrow "reads".');
    expect(fails(doc, { op: "add-arrow", view: "ideas", id: "x", from: "cache", to: "cache" })).toBe("An arrow can't go from a shape to itself.");
    expect(fails(doc, { op: "add-arrow", view: "ideas", id: "x", from: "cahce", to: "db" })).toBe('View "ideas" has no shape "cahce". Did you mean "cache"?');
    expect(fails(doc, { op: "add-arrow", view: "ideas", id: "x", from: "cache", to: "db", heads: "start" as never })).toBe('Unknown heads "start". Use one of: end, both, none.');
    expect(fails(doc, { op: "update-arrow", view: "ideas", id: "reads" })).toBe('Say what to change on arrow "reads": newId, from, to, text, heads, color, dashed.');
    expect(fails(doc, { op: "update-arrow", view: "ideas", id: "reads", to: "cache" })).toBe("An arrow can't go from a shape to itself.");
    expect(fails(doc, { op: "update-arrow", view: "ideas", id: "reads", newId: "look" })).toBe('View "ideas" already has an arrow "look".');
    expect(fails(doc, { op: "remove-arrow", view: "ideas", id: "raeds" })).toBe('View "ideas" has no arrow "raeds". Did you mean "reads"?');
    expect(fails(doc, { op: "show-in-view", view: "ideas", id: "shop" })).toMatch(/^A whiteboard view draws its shapes and arrows, not elements/);
    expect(fails(doc, { op: "hide-in-view", view: "ideas", id: "shop" })).toMatch(/^A whiteboard view draws its shapes and arrows, not elements/);
    expect(fails(doc, { op: "update-view", id: "ideas", include: ["*"] })).toMatch(/^A whiteboard view draws its shapes and arrows, not elements/);
    expect(fails(doc, { op: "add-view", id: "x", level: "whiteboard", include: ["shop"] })).toMatch(/^A whiteboard view draws its shapes and arrows, not elements/);
    expect(fails(doc, { op: "add-view", id: "x", level: "whiteboard", scope: "shop" })).toBe("Whiteboard views show their shapes and arrows, not the model, so they don't take a `scope`. Remove `scope`.");
    expect(fails(doc, { op: "set-layout", view: "ideas", positions: {} })).toBe("A whiteboard view has no boxes. Move a shape with update-shape --at.");
  });

  it("are checked when sent as JSON", () => {
    expect(parseOperations({ op: "add-arrow", view: "v", id: "a", from: [1, 2], to: "b" })).toEqual([{ op: "add-arrow", view: "v", id: "a", from: [1, 2], to: "b" }]);
    expect(parseOperations({ op: "update-shape", view: "v", id: "a", text: null, fill: null, at: [1, 2, 3, 4] })).toHaveLength(1);
    expect(() => parseOperations({ op: "add-shape", view: "v", id: "a" })).toThrow('add-shape needs "kind".');
    expect(() => parseOperations({ op: "add-shape", view: "v", id: "a", kind: "rectangle", at: [1, 2, 3] })).toThrow('add-shape: "at" must be a position, [x, y], or a position and a size, [x, y, width, height].');
    expect(() => parseOperations({ op: "add-shape", view: "v", id: "a", kind: "pen", points: [1, 2] })).toThrow('add-shape: "points" must be a list of points, [[x, y], ...].');
    expect(() => parseOperations({ op: "add-arrow", view: "v", id: "a", from: 1, to: "b" })).toThrow('add-arrow: "from" must be the ID of a shape, or a point, [x, y].');
    expect(() => parseOperations({ op: "add-arrow", view: "v", id: "a", from: "b" })).toThrow('add-arrow needs "to".');
  });

  it("start out titled from their ID, and keep their shapes when elements are renamed or removed, and the view's own ID changes", () => {
    expect(base().views.ideas).toEqual({ title: "Ideas", level: "whiteboard", shapes: [], arrows: [] });
    const doc = apply(ideas(), { op: "add-sticky", view: "ideas", id: "note", text: "Rough!" });
    expect(apply(doc, { op: "rename", id: "api", to: "backend" }).views.ideas).toEqual(doc.views.ideas);
    expect(apply(doc, { op: "remove-element", id: "api" }).views.ideas).toEqual(doc.views.ideas);
    expect(apply(doc, { op: "rename", id: "ideas", to: "sketch" }).views.sketch).toEqual(doc.views.ideas);
  });
});
