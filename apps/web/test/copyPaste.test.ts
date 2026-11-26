import { applyOperations, buildWorkspace, loadWorkspace, OpError, serializeDocument, type OpenArchDocument, type Operation, type Workspace } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { copiedMiddle, copiedText, copyOf, copySource, deleteOps, pasteOps, readCopied } from "../src/copyPaste.js";
import { deletePlan } from "../src/model.js";

const BOX = { width: 200, height: 100 };

/** The shop: a web app and an API in it, the API with a component inside, and a logging library the API is built with. */
const shop: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {
    customer: { kind: "person", name: "Customer", uses: [{ to: "web", description: "Buys things" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", technology: "React", tags: { team: "web" }, uses: [{ to: "api", description: "Calls", technology: "HTTPS" }] },
    api: { kind: "container", name: "API", parent: "shop", shape: "server", libraries: ["logging"], notes: "The **API**." },
    orders: { kind: "component", name: "Orders", parent: "api" },
    db: { kind: "container", name: "DB", parent: "shop", shape: "database" },
    logging: { kind: "library", name: "Logging" },
    other: { kind: "system", name: "Other" },
  },
  views: {
    containers: {
      title: "Containers",
      level: "container",
      scope: "shop",
      layout: { customer: [0, 0], web: [0, 300], api: [400, 300], db: [800, 300] },
      stickies: {
        why: { text: "Server-rendered", on: { element: "web" }, at: [-300, 300] },
        call: { text: "Over HTTPS", on: { from: "web", to: "api" }, at: [200, 450] },
        loose: { text: "Read me", color: "blue", at: [1200, 0] },
      },
    },
    "other-containers": { title: "Other containers", level: "container", scope: "other", include: [] },
    landscape: { title: "Landscape", level: "landscape" },
  },
};

const ws = buildWorkspace(structuredClone(shop));
const view = ws.views.get("containers")!;
const places = { boxes: { customer: [0, 0], web: [0, 300], api: [400, 300], db: [800, 300] } as Record<string, [number, number]>, notes: { why: [-300, 300], call: [200, 450], loose: [1200, 0] } as Record<string, [number, number]> };
const after = (w: Workspace, ops: Operation[]) => loadWorkspace(serializeDocument(applyOperations(w.doc, ops).doc));

describe("copySource", () => {
  it("is the element, the note or the several selected", () => {
    expect(copySource({ kind: "element", id: "web" })).toEqual({ elements: ["web"], stickies: [] });
    expect(copySource({ kind: "sticky", id: "why" })).toEqual({ elements: [], stickies: ["why"] });
    expect(copySource({ kind: "several", elements: ["web", "api"], stickies: ["why"] })).toEqual({ elements: ["web", "api"], stickies: ["why"] });
    expect(copySource({ kind: "arrow", from: "web", to: "api" })).toEqual({ elements: [], stickies: [] });
    expect(copySource(null)).toEqual({ elements: [], stickies: [] });
  });
});

describe("copyOf", () => {
  it("copies the boxes with what's inside them, the relationships between them, and the notes, with where each is", () => {
    const copied = copyOf(ws, view, { elements: ["web", "api"], stickies: ["why", "call", "loose"] }, places)!;
    expect(copied.view).toBe("containers");
    expect(copiedMiddle(copied, BOX)).toEqual({ x: 550, y: 275 });
    expect(copied.elements.map((e) => [e.id, e.picked ?? false, e.at])).toEqual([
      ["web", true, [0, 300]],
      ["api", true, [400, 300]],
      ["orders", false, undefined],
    ]);
    expect(copied.elements[0]).toMatchObject({ kind: "container", name: "Web", parent: "shop", technology: "React", tags: { team: "web" } });
    expect(copied.elements[1]).toMatchObject({ shape: "server", libraries: ["logging"], notes: "The **API**." });
    // Only the one between two of them: the customer's to the web app isn't copied.
    expect(copied.relationships).toEqual([{ from: "web", to: "api", description: "Calls", technology: "HTTPS" }]);
    // In the view's reading order, top to bottom.
    expect(copied.stickies).toEqual([
      { text: "Read me", color: "blue", at: [1200, 0] },
      { text: "Server-rendered", on: { element: "web" }, at: [-300, 300] },
      { text: "Over HTTPS", on: { from: "web", to: "api", kind: "association" }, at: [200, 450] },
    ]);
  });

  it("leaves a note off what isn't copied with it, and copies nothing when nothing's selected", () => {
    const copied = copyOf(ws, view, { elements: ["api"], stickies: ["why", "call"] }, places)!;
    expect(copied.stickies.map((s) => s.on)).toEqual([undefined, undefined]);
    expect(copyOf(ws, view, { elements: [], stickies: [] }, places)).toBeNull();
    expect(copyOf(ws, view, { elements: ["gone"], stickies: [] }, places)).toBeNull();
  });
});

describe("readCopied", () => {
  it("reads what Copy put on the clipboard, and nothing else", () => {
    const copied = copyOf(ws, view, { elements: ["web"], stickies: [] }, places)!;
    expect(readCopied(copiedText(copied))).toEqual(copied);
    expect(readCopied("Web calls the API")).toBeNull();
    expect(readCopied('{"elements": []}')).toBeNull();
    expect(readCopied(JSON.stringify({ ...copied, elements: [{ id: "web" }] }))).toBeNull();
    expect(readCopied(JSON.stringify({ ...copied, elements: [{ ...copied.elements[0], at: ["x", 1] }] }))).toBeNull();
  });

  it("checks every field, as clipboard text can come from anywhere", () => {
    const copied = copyOf(ws, view, { elements: ["web", "api"], stickies: ["why"] }, places)!;
    const element = copied.elements[0]!;
    for (const bad of [
      { ...copied, elements: [{ ...element, libraries: "logging" }] },
      { ...copied, elements: [{ ...element, tags: { team: 1 } }] },
      { ...copied, elements: [{ ...element, external: "yes" }] },
      { ...copied, relationships: [{ from: "web", to: "api", description: 2 }] },
      { ...copied, stickies: [{ text: "Hi", on: "web" }] },
      { ...copied, stickies: [{ text: "Hi", on: { from: "web" } }] },
      { ...copied, view: 3 },
      { ...copied, elements: {} },
    ]) {
      expect(readCopied(JSON.stringify(bad))).toBeNull();
    }
  });
});

describe("pasteOps", () => {
  const copied = copyOf(ws, view, { elements: ["web", "api"], stickies: ["why", "call", "loose"] }, places)!;

  it("adds copies with new IDs and the same names, in what the view is of, with their relationships and notes, centred where it's pasted", () => {
    const pasted = pasteOps(ws, "containers", copied, places.boxes, { x: 2000, y: 1000 }, BOX);
    const now = after(ws, pasted.ops);
    expect(pasted.elements).toEqual(["web-2", "api-2"]);
    expect(now.elements.get("web-2")).toMatchObject({ name: "Web", parent: "shop", technology: "React", tags: { team: "web" } });
    expect(now.elements.get("api-2")).toMatchObject({ name: "API", parent: "shop", shape: "server", libraries: ["logging"], notes: "The **API**." });
    expect(now.elements.get("orders-2")).toMatchObject({ name: "Orders", parent: "api-2" });
    expect(now.elements.get("web-2")!.uses).toMatchObject([{ to: "api-2", description: "Calls", technology: "HTTPS" }]);
    // The originals are as they were.
    expect(now.elements.get("web")!.uses.map((r) => r.to)).toEqual(["api"]);

    // From -300 to 1400 across and 0 to 550 down, so the middle, (550, 275), goes to the point, and each keeps its place relative to the rest.
    const v = now.views.get("containers")!;
    expect(v.layout["web-2"]).toEqual([1450, 1025]);
    expect(v.layout["api-2"]).toEqual([1850, 1025]);
    expect(v.layout.customer).toEqual([0, 0]);
    expect(pasted.stickies).toEqual(["note", "note-2", "note-3"]);
    const notes = pasted.stickies.map((id) => v.stickies.find((s) => s.id === id)!);
    expect(notes.map((s) => [s.text, s.on, s.at, s.color])).toEqual([
      ["Read me", undefined, [2650, 725], "blue"],
      ["Server-rendered", { element: "web-2" }, [1150, 1025], "yellow"],
      ["Over HTTPS", { from: "web-2", to: "api-2", kind: "association" }, [1650, 1175], "yellow"],
    ]);
  });

  it("numbers a copy of a copy on from it", () => {
    const once = after(ws, pasteOps(ws, "containers", copied, places.boxes, { x: 0, y: 0 }, BOX).ops);
    const again = copyOf(once, once.views.get("containers")!, { elements: ["web-2"], stickies: [] }, { boxes: {}, notes: {} })!;
    expect(pasteOps(once, "containers", again, {}, { x: 0, y: 0 }, BOX).elements).toEqual(["web-3"]);
  });

  it("goes in what another view is of, and shows on it when it shows only what's added there", () => {
    const pasted = pasteOps(ws, "other-containers", copied, {}, { x: 0, y: 0 }, BOX);
    const now = after(ws, pasted.ops);
    expect(now.elements.get("web-2")!.parent).toBe("other");
    expect(now.views.get("other-containers")!.include).toEqual(["web-2", "api-2"]);
    expect(Object.keys(now.views.get("other-containers")!.layout).sort()).toEqual(["api-2", "web-2"]);
  });

  it("keeps the IDs in another workspace that has none of them, and its library when it has one", () => {
    const empty = buildWorkspace({ openarch: 21, name: "New", elements: { shop: { kind: "system", name: "Shop" } }, views: { containers: { title: "Containers", level: "container", scope: "shop" } } });
    const pasted = pasteOps(empty, "containers", copied, {}, { x: 0, y: 0 }, BOX);
    const now = after(empty, pasted.ops);
    expect(pasted.elements).toEqual(["web", "api"]);
    // There's no logging library here, so the API isn't built with one.
    expect(now.elements.get("api")!.libraries).toEqual([]);
  });

  it("copies a library a container is built with when it's copied too", () => {
    const both = copyOf(ws, view, { elements: ["api", "logging"], stickies: [] }, places)!;
    const now = after(ws, pasteOps(ws, "containers", both, places.boxes, { x: 0, y: 0 }, BOX).ops);
    expect(now.elements.get("api-2")!.libraries).toEqual(["logging-2"]);
  });

  it("says why a container can't be pasted where there's no system for it", () => {
    const empty = buildWorkspace({ openarch: 21, name: "New", elements: {}, views: { landscape: { title: "Landscape", level: "landscape" } } });
    expect(() => pasteOps(empty, "landscape", copied, {}, { x: 0, y: 0 }, BOX)).toThrow(`There's no system here for the container "Web" to go in. Paste it on a view of one.`);
  });

  it("pastes only what it knows of each relationship, so text on the clipboard can't make it another operation", () => {
    const text = JSON.stringify({ ...copied, relationships: [{ from: "web", to: "api", op: "remove-element", id: "shop" }] });
    const sneaky = readCopied(text)!;
    const pasted = pasteOps(ws, "containers", sneaky, places.boxes, { x: 0, y: 0 }, BOX);
    expect(pasted.ops.map((op) => op.op)).not.toContain("remove-element");
    expect(pasted.ops.find((op) => op.op === "add-relationship")).toEqual({ op: "add-relationship", from: "web-2", to: "api-2" });
    expect(after(ws, pasted.ops).elements.has("shop")).toBe(true);
  });

  it("says why an element of no kind it knows can't be pasted", () => {
    const odd = readCopied(JSON.stringify({ ...copied, elements: [{ id: "x", kind: "constructor", name: "X", picked: true }], relationships: [], stickies: [] }))!;
    expect(() => pasteOps(ws, "containers", odd, {}, { x: 0, y: 0 }, BOX)).toThrow(OpError);
  });

  it("pastes nothing on a view that can't draw what was copied, and says so", () => {
    // In the same workspace there's a shop for the web app to go in, but a landscape doesn't draw containers.
    expect(() => pasteOps(ws, "landscape", copied, {}, { x: 0, y: 0 }, BOX)).toThrow(`This view can't draw the container "Web", so nothing was pasted. Paste it on a view that shows containers.`);
  });

  it("pastes a person on a landscape, where it's drawn", () => {
    const person = copyOf(ws, view, { elements: ["customer"], stickies: [] }, places)!;
    const pasted = pasteOps(ws, "landscape", person, {}, { x: 100, y: 100 }, BOX);
    const now = after(ws, pasted.ops);
    expect(now.views.get("landscape")!.layout["customer-2"]).toEqual([0, 50]);
  });
});

describe("deleteOps and deletePlan for several elements", () => {
  it("deletes them and the notes selected with them as one edit, skipping one inside another", () => {
    const ops = deleteOps(ws, "containers", ["api", "orders", "web"], ["loose"]);
    expect(ops).toEqual([
      { op: "remove-sticky", view: "containers", id: "loose" },
      { op: "remove-element", id: "api" },
      { op: "remove-element", id: "web" },
    ]);
    const now = after(ws, ops);
    expect([...now.elements.keys()].sort()).toEqual(["customer", "db", "logging", "other", "shop"]);
    expect(now.views.get("containers")!.stickies.map((s) => s.id)).toEqual(["why", "call"]);
  });

  it("says what else goes with them", () => {
    const plan = deletePlan(ws, ["api", "web", "logging"]);
    expect(plan.inside.map((e) => e.id)).toEqual(["orders"]);
    expect(plan.affected.map((e) => e.id)).toEqual(["customer"]);
    // The API is built with the library, but it's going too.
    expect(plan.builtWith).toEqual([]);
    expect(deletePlan(ws, ["logging"]).builtWith.map((e) => e.id)).toEqual(["api"]);
  });
});
