// @vitest-environment happy-dom
import { buildWorkspace, computeView, loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { sequenceLayout, stepEnds } from "../src/canvas/sequenceLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/**
 * A buyer orders from the web app, which calls the API. The API and the cache use each other, so
 * a step between them can be a call or a reply. A note beside the steps.
 */
const doc: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: {
    buyer: { kind: "person", name: "Buyer", uses: [{ to: "web" }] },
    shop: { kind: "system", name: "Shop" },
    web: { kind: "container", name: "Web", parent: "shop", uses: [{ to: "api", description: "Calls" }, { to: "cache" }] },
    api: { kind: "container", name: "API", parent: "shop", uses: [{ to: "db" }, { to: "cache", bidirectional: true }] },
    db: { kind: "container", name: "DB", parent: "shop" },
    cache: { kind: "container", name: "Cache", parent: "shop" },
  },
  views: {
    ordering: {
      title: "Ordering",
      level: "sequence",
      steps: [
        { from: "buyer", to: "web", description: "Orders" },
        { from: "web", to: "api", description: "Submits" },
        { from: "api", to: "cache", description: "Remembers" },
        { from: "api", to: "web", reply: true, description: "Says it's saved" },
      ],
      stickies: { note: { text: "Read me" } },
    },
  },
};

/** The whole designer, open on the sequence view. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "ordering", file);
type Open = Awaited<ReturnType<typeof designer>>;
const slow = async (): Promise<[Open, SlowHost]> => {
  const file = new SlowHost("shop.openarch", serializeDocument(doc));
  return [await designer(doc, file), file];
};
/** A step's label, by its number: 1 is the first. */
const label = (d: Open, number: number) => d.host.querySelectorAll(".step-label")[number - 1]!;
const steps = async (d: Open, view = "ordering") => (await d.saved(view)).steps.map((s) => `${s.from} ${s.reply ? "replies to" : "->"} ${s.to}`);

describe("where either end of a step can move to", () => {
  const ws = buildWorkspace(doc);
  const [orders, submits, remembers, saved] = ws.views.get("ordering")!.steps;
  const names = (step: (typeof orders)&{}, end: "from" | "to") => stepEnds(ws, step, end).map((e) => e.name);

  it("is an element the model has a relationship for the step to go along, by name", () => {
    // The cache uses the API too, as theirs goes both ways.
    expect(names(submits!, "from")).toEqual(["Cache"]);
    expect(names(submits!, "to")).toEqual(["Cache"]);
    expect(names(remembers!, "from")).toEqual(["Web"]);
    expect(names(remembers!, "to")).toEqual(["DB"]);
    // What the buyer uses is in the shop, so a step can go to the shop instead. Nothing else uses the web app.
    expect(names(orders!, "to")).toEqual(["Shop"]);
    expect(names(orders!, "from")).toEqual([]);
  });

  it("is, for a reply, an element the relationship comes back from", () => {
    // The API answers what uses it, and the web app is answered by what it uses.
    expect(names(saved!, "to")).toEqual(["Cache"]);
    expect(names(saved!, "from")).toEqual(["Cache"]);
  });
});

describe("a step's right-click menu", () => {
  it("selects the step, from its text or its arrow, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(label(d, 2));
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Step 2of 4");
    expect(d.labels()).toEqual(["Change from", "Change what it calls", "Move up, to step 1", "Move down, to step 3", "Delete step"]);
    await key(document.activeElement!, "Escape");
    expect(d.menuOpen()).toBe(false);

    await d.rightClick(d.host.querySelectorAll(".step-arrow")[2]!);
    expect(d.details()).toBe("Step 3of 4");
    // The API and the cache use each other, so its call to the cache can be a reply to it.
    expect(d.labels()).toEqual(["Change from", "Change what it calls", "Make it a reply", "Move up, to step 2", "Move down, to step 4", "Delete step"]);
    // A reply says who it replies to. The web app doesn't answer to the API, so this one can't be a call.
    await d.rightClick(label(d, 4));
    expect(d.labels()).toEqual(["Change from", "Change who it replies to", "Move up, to step 3", "Delete step"]);
    // Nothing but the buyer uses the web app, so the first step can't come from anything else.
    await d.rightClick(label(d, 1));
    expect(d.labels()).toEqual(["Change what it calls", "Move down, to step 2", "Delete step"]);
    // Only one menu is open: the step's, not the background's as well.
    expect(document.querySelectorAll(".context-menu").length).toBe(1);
  });

  it("moves either end to an element the model has a relationship for", async () => {
    const d = await designer();
    await d.rightClick(label(d, 3));
    await d.pick("Change what it calls");
    expect(d.labels()).toEqual(["DB [Container]"]);
    await d.pick("DB [Container]");
    expect((await steps(d))[2]).toBe("api -> db");
    await d.rightClick(label(d, 2));
    await d.pick("Change from", "Cache [Container]");
    expect((await steps(d))[1]).toBe("cache -> api");
    await d.rightClick(label(d, 4));
    await d.pick("Change who it replies to", "Cache [Container]");
    expect((await steps(d))[3]).toBe("api replies to cache");
  });

  it("makes a call a reply, and a reply a call", async () => {
    const d = await designer();
    await d.rightClick(label(d, 3));
    await d.pick("Make it a reply");
    expect((await steps(d))[2]).toBe("api replies to cache");
    expect(d.details()).toBe("Step 3of 4");
    await d.rightClick(label(d, 3));
    expect(d.labels()).toContain("Change who it replies to");
    await d.pick("Make it a call");
    expect((await steps(d))[2]).toBe("api -> cache");
  });

  it("moves it up or down the steps, staying on it, and deletes it", async () => {
    const d = await designer();
    await d.rightClick(label(d, 2));
    await d.pick("Move up, to step 1");
    expect(await steps(d)).toEqual(["web -> api", "buyer -> web", "api -> cache", "api replies to web"]);
    expect(d.details()).toBe("Step 1of 4");
    await d.rightClick(label(d, 1));
    await d.pick("Move down, to step 2");
    expect((await steps(d))[1]).toBe("web -> api");
    await d.rightClick(label(d, 2));
    await d.pick("Delete step");
    expect(await steps(d)).toEqual(["buyer -> web", "api -> cache", "api replies to web"]);
    expect(d.details()).toBe("View");
  });
});

describe("the right-click menus of a sequence view's notes, background and elements", () => {
  it("has a sticky note's menu, without what a note placed on a diagram has", async () => {
    const d = await designer();
    const note = () => d.host.querySelector(".sequence-notes .sticky")!;
    await d.rightClick(note());
    expect(d.details()).toBe("Sticky note");
    // The notes are listed beside the steps, so there's no text to edit in place, and nowhere to move one back to.
    expect(d.labels()).toEqual(["Colour", "Edit notes…", "Delete note"]);
    await d.pick("Colour", "Pink");
    expect((await d.saved()).stickies[0]!.color).toBe("pink");
    await d.rightClick(note());
    await d.pick("Edit notes…");
    await click(button(d.host.querySelector("dialog.notes-editor") as HTMLElement, "Cancel"));
    await d.rightClick(note());
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and has what the toolbar has", async () => {
    const d = await designer();
    await click(label(d, 2));
    await d.rightClick(d.host.querySelector(".sequence-surface")!);
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual(["Step…", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
    // A lifeline, and the room round the steps, are the background too.
    await d.rightClick(d.host.querySelector(".lifeline-grip")!);
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.rightClick(d.host.querySelector(".sequence-scroll")!);
    expect(d.labels()).toEqual(["Add", "Export"]);
  });

  it("opens the form that adds a step, and adds a sticky note, from the background", async () => {
    const d = await designer();
    await d.rightClick(d.host.querySelector(".sequence-surface")!);
    await d.pick("Add", "Step…");
    const form = d.host.querySelector<HTMLElement>('[role="dialog"][aria-label="Add a step"]')!;
    await click(button(form, "Add step"));
    await d.settle();
    expect((await steps(d)).length).toBe(5);
    expect(d.details()).toBe("Step 5of 5");

    await d.rightClick(d.host.querySelector(".sequence-surface")!);
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.map((s) => s.text)).toEqual(["Read me", "New note"]);
    expect(d.details()).toBe("Sticky note");
  });

  it("leaves the menu of ways to add a step drawn between two elements alone: a right-click on it isn't one on the background", async () => {
    const d = await designer();
    await click(label(d, 2));
    // The cache is dragged to the buyer, which the model has no relationship for, so there are ways to choose from.
    const ws = buildWorkspace(doc);
    const lifeline = sequenceLayout(computeView(ws, ws.views.get("ordering")!)).x;
    const grip = [...d.host.querySelectorAll<HTMLElement>(".lifeline-grip")].find((g) => g.title.endsWith("from Cache"))!;
    grip.setPointerCapture = () => {};
    const at = (id: string) => ({ bubbles: true, button: 0, pointerId: 1, clientX: lifeline.get(id)!, clientY: 150 });
    await act(async () => {
      grip.dispatchEvent(new PointerEvent("pointerdown", at("cache")));
    });
    await act(async () => {
      grip.dispatchEvent(new PointerEvent("pointermove", at("buyer")));
    });
    await act(async () => {
      grip.dispatchEvent(new PointerEvent("pointerup", at("buyer")));
    });
    expect(d.labels()).toEqual(["Call Buyer, adding a relationship from Cache to Buyer", "Call Buyer, adding a relationship both ways"]);
    const choices = document.querySelector(".context-menu")!;
    const event = await d.rightClick(choices.querySelector('[role="menuitem"]')!);
    expect(event.defaultPrevented).toBe(true);
    // It's still the one menu, and the step selected before still is.
    expect(document.querySelector(".context-menu")).toBe(choices);
    expect(document.querySelectorAll(".context-menu").length).toBe(1);
    expect(d.labels()).toEqual(["Call Buyer, adding a relationship from Cache to Buyer", "Call Buyer, adding a relationship both ways"]);
    expect(d.details()).toBe("Step 2of 4");
  });

  it("has the menu an element has on any view on an element's heading, and no other with it", async () => {
    const d = await designer();
    const head = [...d.host.querySelectorAll(".sequence-head")].find((h) => h.textContent!.includes("API"))!;
    const event = await d.rightClick(head);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Container");
    expect(d.labels()).toEqual(["Find usages", "New view", "Delete from model…"]);
    expect(document.querySelectorAll(".context-menu").length).toBe(1);
  });
});

describe("a sequence view's right-click menu, opened with the keyboard or after an edit", () => {
  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(label(d, 2), 300, 420);
    await d.menuKey(label(d, 2));
    expect(d.details()).toBe("Step 2of 4");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on a step under the number it has once one before it is deleted", async () => {
    const [d, file] = await slow();
    await click(label(d, 1));
    file.hold = true;
    await click(button(d.host, "Delete step"));
    await d.rightClick(label(d, 3));
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    // Remembers was step 3, and is step 2 now.
    expect(d.details()).toBe("Step 2of 3");
    await d.pick("Delete step");
    expect(await steps(d)).toEqual(["web -> api", "api replies to web"]);
  });

  it("opens on a step under the number it has once an element is deleted from the model, unless the step went with it", async () => {
    for (const [clicked, opens] of [
      [4, true],
      [3, false],
    ] as const) {
      const [d, file] = await slow();
      const head = [...d.host.querySelectorAll(".sequence-head")].find((h) => h.textContent!.includes("Cache"))!;
      await d.rightClick(head);
      await d.pick("Delete from model…");
      file.hold = true;
      await click([...d.host.querySelectorAll("button")].find((b) => b.textContent!.trim() === "Delete from model")!);
      // Remembers, step 3, is the API's call to the cache, and goes with it. The reply after it, step 4, doesn't.
      await d.rightClick(label(d, clicked));
      expect(d.menuOpen()).toBe(false);
      file.release();
      await d.settle();
      expect(loadWorkspace(await d.file.load()).elements.has("cache")).toBe(false);
      expect(await steps(d)).toEqual(["buyer -> web", "web -> api", "api replies to web"]);
      expect(d.menuOpen(), `step ${clicked}`).toBe(opens);
      if (!opens) continue;
      expect(d.details()).toBe("Step 3of 3");
      await d.pick("Delete step");
      expect(await steps(d)).toEqual(["buyer -> web", "web -> api"]);
    }
  });

  it("doesn't open on the step that was being deleted", async () => {
    const [d, file] = await slow();
    await click(label(d, 3));
    file.hold = true;
    await click(button(d.host, "Delete step"));
    await d.rightClick(label(d, 3));
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    expect(await steps(d)).toEqual(["buyer -> web", "web -> api", "api replies to web"]);
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const [d, file] = await slow();
    const surface = d.host.querySelector(".sequence-surface");
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Buying");
    await d.rightClick(label(d, 2));
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.host.querySelector(".sequence-surface")).toBe(surface);
    expect(d.details()).toBe("Step 2of 4");
    await d.pick("Delete step");
    expect(await steps(d, "buying")).toEqual(["buyer -> web", "api -> cache", "api replies to web"]);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const [d, file] = await slow();
    await d.rightClick(label(d, 3));
    await d.pick("Make it a reply");
    await d.rightClick(label(d, 3));
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    // And with a Redo on its way.
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(label(d, 3));
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
