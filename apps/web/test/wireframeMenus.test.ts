// @vitest-environment happy-dom
import { allWidgets, buildWorkspace, serializeDocument, type OpenArchDocument, type ViewDef } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { STICKY } from "../src/canvas/autoLayout.js";
import { addScreenOp, afterWidget, newWidgetOps } from "../src/canvas/WireframeDiagram.js";
import { screenPlace, screenSpot, wireframeLayout } from "../src/canvas/wireframeLayout.js";
import type { MemoryHost } from "../src/hosts.js";
import { button, click, key } from "./dom.js";
import { designer as open, put, SlowHost, write } from "./menuDesigner.js";

/** Three screens: a phone's cart, with a row of two, a payment screen with a panel, and an empty one. A note beside them. */
const doc: OpenArchDocument = {
  openarch: 20,
  name: "Shop",
  elements: {},
  views: {
    checkout: {
      title: "Checkout",
      level: "wireframe",
      screens: [
        {
          id: "cart",
          name: "Cart",
          device: "phone",
          widgets: [
            { id: "title", kind: "heading", text: "Your cart" },
            {
              id: "actions",
              kind: "row",
              widgets: [
                { id: "pay", kind: "button", text: "Pay", to: "payment" },
                { id: "back", kind: "link", text: "Back" },
              ],
            },
          ],
        },
        { id: "payment", name: "Payment", widgets: [{ id: "card", kind: "panel", text: "Card" }, { id: "blank", kind: "text" }] },
        { id: "done", name: "Done" },
      ],
      stickies: { note: { text: "Read me", at: [3000, 0] } },
    },
  },
};

/** The whole designer, open on the wireframe view, with its screens and widgets measured. */
const designer = (model: OpenArchDocument = doc, file?: MemoryHost) => open(model, "checkout", file);
type Open = Awaited<ReturnType<typeof designer>>;

const view = (model: OpenArchDocument = doc) => buildWorkspace(model).views.get("checkout")!;
/** Each screen's widgets, in order, with what's inside one in brackets after it. */
const on = (v: ViewDef) => Object.fromEntries(v.screens.map((s) => [s.id, s.widgets.map((w) => (w.widgets.length ? `${w.id}(${w.widgets.map((i) => i.id).join(" ")})` : w.id))]));
const widget = (v: ViewDef, id: string) => allWidgets(v).find((w) => w.id === id)!;
const kinds = ["Heading", "Text", "Button", "Link", "Text field", "Checkbox", "Drop-down", "Image", "List", "Table", "Tabs", "Divider", "Panel", "Row"];
/** The middle of a screen or a widget, as the layout draws it. */
const middle = (v: ViewDef, what: "screens" | "widgets", id: string) => {
  const box = wireframeLayout(v)[what].get(id)!;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
};

describe("where a widget or a screen added from a right-click goes", () => {
  const v = view();
  const layout = wireframeLayout(v);

  it("is a widget's place among its screen's own, by how far down the click was", () => {
    const cart = v.screens[0]!;
    const [title, actions] = [middle(v, "widgets", "title"), middle(v, "widgets", "actions")];
    expect(screenSpot(layout, cart, { x: title.x, y: title.y - 1 })).toBe(1);
    expect(screenSpot(layout, cart, { x: title.x, y: (title.y + actions.y) / 2 })).toBe(2);
    expect(screenSpot(layout, cart, { x: title.x, y: actions.y + 1 })).toBe(3);
    // A screen with nothing on it has one place.
    expect(screenSpot(layout, v.screens[2]!, { x: 0, y: 9000 })).toBe(1);
  });

  it("is a screen's place among the screens, by how far along the click was", () => {
    const [cart, payment, done] = ["cart", "payment", "done"].map((id) => middle(v, "screens", id));
    expect(screenPlace(v, layout, { x: cart!.x - 1, y: 0 })).toBe(1);
    expect(screenPlace(v, layout, { x: (cart!.x + payment!.x) / 2, y: 0 })).toBe(2);
    expect(screenPlace(v, layout, { x: done!.x + 1, y: 0 })).toBe(4);
  });

  it("adds a screen at a place, for the device of the one before it, and at the end with no place said", () => {
    // After the phone's screen, it's a phone's. Before the first, it's like the first.
    expect(addScreenOp(v, null, 2)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen", device: "phone", position: 2 });
    expect(addScreenOp(v, null, 1)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen", device: "phone", position: 1 });
    expect(addScreenOp(v, null, 3)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen", position: 3 });
    expect(addScreenOp(v, null, 4)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen" });
    const none = view({ ...doc, views: { checkout: { title: "Checkout", level: "wireframe" } } });
    expect(addScreenOp(none, null, 1)).toEqual({ op: "add-screen", view: "checkout", id: "new-screen", name: "New screen" });
  });

  it("adds a widget at a place, under an ID no widget of the view has", () => {
    expect(newWidgetOps(v, "button", { screen: "cart", position: 1 })).toEqual({ ops: [{ op: "add-widget", view: "checkout", id: "button", kind: "button", screen: "cart", position: 1 }], id: "button" });
    // A widget on another screen has the ID a new link would get, so the new one gets the next.
    expect(newWidgetOps({ ...v, screens: v.screens.map((s) => ({ ...s, widgets: s.widgets.map((w) => (w.id === "card" ? { ...w, id: "link" } : w)) })) }, "link", { in: "actions" }).id).toBe("link-2");
    expect(afterWidget(widget(v, "title"))).toEqual({ screen: "cart", position: 2 });
    expect(afterWidget(widget(v, "pay"))).toEqual({ in: "actions", position: 2 });
  });
});

describe("a screen's right-click menu", () => {
  it("selects the screen, and lists what can be done with it", async () => {
    const d = await designer();
    const event = await d.rightClick(d.node("screen:payment")!);
    expect(event.defaultPrevented).toBe(true);
    expect(d.details()).toBe("Screen 2of 3");
    expect(d.labels()).toEqual(["Add", "Device", "Move left", "Move right", "Delete screen"]);
    await d.rightClick(d.node("screen:cart")!);
    expect(d.labels()).toEqual(["Add", "Device", "Move right", "Delete screen"]);
    await d.rightClick(d.node("screen:done")!);
    expect(d.labels()).toEqual(["Add", "Device", "Move left", "Delete screen"]);
    await d.pick("Add");
    expect(d.labels()).toEqual([...kinds, "Screen", "Sticky note"]);
  });

  it("adds a widget to the screen, at the place where it was clicked, and selects it", async () => {
    const d = await designer();
    const title = middle(view(), "widgets", "title");
    await d.rightClick(d.node("screen:cart")!, { x: title.x, y: title.y - 1 });
    await d.pick("Add", "Button");
    expect(on(await d.saved()).cart).toEqual(["button", "title", "actions(pay back)"]);
    expect(d.details()).toBe("Button1 of 3 on Cart");
    // Below them all, it goes at the end.
    await d.rightClick(d.node("screen:cart")!, { x: title.x, y: 9000 });
    await d.pick("Add", "Image");
    expect(on(await d.saved()).cart).toEqual(["button", "title", "actions(pay back)", "image"]);
  });

  it("adds a screen after it, for the same device, and a sticky note where it was clicked", async () => {
    const d = await designer();
    await d.rightClick(d.node("screen:cart")!);
    await d.pick("Add", "Screen");
    const saved = await d.saved();
    expect(saved.screens.map((s) => [s.id, s.device])).toEqual([["cart", "phone"], ["new-screen", "phone"], ["payment", "desktop"], ["done", "desktop"]]);
    expect(d.details()).toBe("Screen 2of 4");

    await d.rightClick(d.node("screen:done")!, { x: 5000, y: 2000 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [5000 - STICKY.width / 2, 1950] });
    expect(document.activeElement).toBe(d.node("sticky:note-2")!.querySelector("textarea"));
  });

  it("says which device it's for, moves it along, and deletes it, with what's on it", async () => {
    const d = await designer();
    await d.rightClick(d.node("screen:cart")!);
    await d.pick("Device");
    expect(d.labels()).toEqual(["Desktop", "Tablet"]);
    await d.pick("Tablet");
    expect((await d.saved()).screens[0]!.device).toBe("tablet");

    await d.rightClick(d.node("screen:cart")!);
    await d.pick("Move right");
    expect((await d.saved()).screens.map((s) => s.id)).toEqual(["payment", "cart", "done"]);
    expect(d.details()).toBe("Screen 2of 3");
    await d.rightClick(d.node("screen:cart")!);
    await d.pick("Move left");
    expect((await d.saved()).screens.map((s) => s.id)).toEqual(["cart", "payment", "done"]);

    await d.rightClick(d.node("screen:payment")!);
    await d.pick("Delete screen");
    const saved = await d.saved();
    expect(on(saved)).toEqual({ cart: ["title", "actions(pay back)"], done: [] });
    // The button that led to it leads nowhere now.
    expect(widget(saved, "pay").to).toBeUndefined();
    expect(d.details()).toBe("View");
  });
});

describe("a widget's right-click menu", () => {
  it("selects the widget, and lists what can be done with it", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:pay")!);
    expect(d.details()).toBe("Button1 of 2 in row actions");
    // In a row, it moves left and right.
    expect(d.labels()).toEqual(["Add after", "Change kind", "Leads to", "Move to screen", "Move into", "Move right", "Delete button"]);
    await d.rightClick(d.node("widget:back")!);
    expect(d.labels()).toEqual(["Add after", "Change kind", "Leads to", "Move to screen", "Move into", "Move left", "Delete link"]);
    // A row or a panel can have widgets added inside it. On the screen itself, there's nothing to move it out of, or into.
    await d.rightClick(d.node("widget:actions")!);
    expect(d.labels()).toEqual(["Add inside", "Add after", "Change kind", "Leads to", "Move to screen", "Move up", "Delete row"]);
    await d.rightClick(d.node("widget:title")!);
    expect(d.labels()).toEqual(["Add after", "Change kind", "Leads to", "Move to screen", "Move into", "Move down", "Delete heading"]);
  });

  it("adds a widget after it, beside it in its row, or inside a row or a panel, and selects it", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Add after");
    expect(d.labels()).toEqual(kinds);
    await d.pick("Checkbox");
    expect(on(await d.saved()).cart).toEqual(["title", "actions(pay checkbox back)"]);
    expect(d.details()).toBe("Checkbox2 of 3 in row actions");

    await d.rightClick(d.node("widget:card")!);
    await d.pick("Add inside", "Text field");
    expect(on(await d.saved()).payment).toEqual(["card(input)", "blank"]);
    // After a panel is on its screen, not in it.
    await d.rightClick(d.node("widget:card")!);
    await d.pick("Add after", "Divider");
    expect(on(await d.saved()).payment).toEqual(["card(input)", "divider", "blank"]);
  });

  it("changes its kind: what holds widgets can only become the other kind that does", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(kinds.filter((k) => k !== "Button"));
    await d.pick("Link");
    expect(widget(await d.saved(), "pay").kind).toBe("link");
    await d.rightClick(d.node("widget:actions")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(["Panel"]);
    await d.pick("Panel");
    expect(widget(await d.saved(), "actions")).toMatchObject({ kind: "panel", widgets: [{ id: "pay" }, { id: "back" }] });
    // An empty panel can become anything.
    await d.rightClick(d.node("widget:card")!);
    await d.pick("Change kind");
    expect(d.labels()).toEqual(kinds.filter((k) => k !== "Panel"));
  });

  it("says where it leads: another screen, or nowhere", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Leads to");
    // Not its own screen, or the one it leads to already.
    expect(d.labels()).toEqual(["Done", "Nowhere"]);
    await d.pick("Done");
    expect(widget(await d.saved(), "pay").to).toBe("done");
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Leads to", "Nowhere");
    expect(widget(await d.saved(), "pay").to).toBeUndefined();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Leads to");
    expect(d.labels()).toEqual(["Payment", "Done"]);
  });

  it("moves it to another screen, into a row or a panel, or out onto its screen", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:back")!);
    await d.pick("Move into");
    // The row it's in already isn't offered.
    expect(d.labels()).toEqual(["The screen itself"]);
    await d.pick("The screen itself");
    expect(on(await d.saved()).cart).toEqual(["title", "actions(pay)", "back"]);

    await d.rightClick(d.node("widget:back")!);
    await d.pick("Move to screen");
    expect(d.labels()).toEqual(["Payment", "Done"]);
    await d.pick("Payment");
    expect(on(await d.saved())).toEqual({ cart: ["title", "actions(pay)"], payment: ["card", "blank", "back"], done: [] });
    await d.rightClick(d.node("widget:back")!);
    await d.pick("Move into");
    expect(d.labels()).toEqual(["Panel: Card [card]"]);
    await d.pick("Panel: Card [card]");
    expect(on(await d.saved()).payment).toEqual(["card(back)", "blank"]);
    // A panel can't go into itself, or into what's inside it.
    const nested = structuredClone(doc);
    nested.views.checkout!.screens![1]!.widgets = [{ id: "card", kind: "panel", text: "Card", widgets: [{ id: "inner", kind: "row" }] }, { id: "other", kind: "panel" }];
    const n = await designer(nested);
    await n.rightClick(n.node("widget:card")!);
    await n.pick("Move into");
    expect(n.labels()).toEqual(["Panel [other]"]);
  });

  it("moves it among the widgets beside it, staying on it, and deletes it, with what's inside it", async () => {
    const d = await designer();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Move right");
    expect(on(await d.saved()).cart).toEqual(["title", "actions(back pay)"]);
    expect(d.details()).toBe("Button2 of 2 in row actions");
    await d.rightClick(d.node("widget:actions")!);
    await d.pick("Move up");
    expect(on(await d.saved()).cart).toEqual(["actions(back pay)", "title"]);
    await d.rightClick(d.node("widget:actions")!);
    expect(d.labels()).toContain("Move down");
    await d.pick("Delete row");
    expect(on(await d.saved()).cart).toEqual(["title"]);
    expect(d.details()).toBe("View");
  });

  it("is the menu of an arrow too, which is its widget's", async () => {
    const d = await designer();
    await d.rightClick(d.edge("pay->payment")!);
    expect(d.details()).toBe("Button1 of 2 in row actions");
    await d.pick("Leads to", "Nowhere");
    expect(widget(await d.saved(), "pay").to).toBeUndefined();
  });
});

describe("the right-click menus of a wireframe view's notes and background", () => {
  it("has a sticky note's menu", async () => {
    const d = await designer();
    await d.rightClick(d.node("sticky:note")!);
    expect(d.details()).toBe("Sticky note");
    expect(d.labels()).toEqual(["Edit text", "Colour", "Edit notes…", "Move beside the diagram", "Delete note"]);
    await d.pick("Edit text");
    const box = d.node("sticky:note")!.querySelector("textarea")!;
    expect(document.activeElement).toBe(box);
    // Its text box keeps the browser's own menu, to paste into it.
    const event = await d.rightClick(box);
    expect(event.defaultPrevented).toBe(false);
    expect(d.menuOpen()).toBe(false);
    await key(box, "Escape");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Colour", "Blue");
    expect((await d.saved()).stickies[0]!.color).toBe("blue");
    await d.rightClick(d.node("sticky:note")!);
    await d.pick("Delete note");
    expect((await d.saved()).stickies).toEqual([]);
  });

  it("selects nothing on the background, and has what the toolbar has, with nothing to lay out", async () => {
    const d = await designer();
    await click(d.node("widget:pay")!);
    await d.rightClick(d.pane());
    expect(d.details()).toBe("View");
    expect(d.labels()).toEqual(["Add", "Export"]);
    await d.pick("Add");
    expect(d.labels()).toEqual([...kinds, "Screen", "Sticky note"]);
    await key(document.activeElement!, "Escape");
    await d.pick("Export");
    expect(d.labels()).toEqual(expect.arrayContaining(["Copy as Mermaid", "Save as Markdown…"]));
  });

  it("adds a screen at the place among the screens where it was clicked, and a sticky note at the point", async () => {
    const d = await designer();
    const [cart, payment] = [middle(view(), "screens", "cart"), middle(view(), "screens", "payment")];
    await d.rightClick(d.pane(), { x: (cart.x + payment.x) / 2, y: -200 });
    await d.pick("Add", "Screen");
    expect((await d.saved()).screens.map((s) => [s.id, s.device])).toEqual([["cart", "phone"], ["new-screen", "phone"], ["payment", "desktop"], ["done", "desktop"]]);
    expect(d.details()).toBe("Screen 2of 4");

    await d.rightClick(d.pane(), { x: 6000, y: 3000 });
    await d.pick("Add", "Sticky note");
    expect((await d.saved()).stickies.find((s) => s.id === "note-2")).toMatchObject({ text: "New note", at: [6000 - STICKY.width / 2, 2950] });
  });

  it("adds a widget from the background to the last screen, as + Add does with nothing selected, or to a first screen made for it", async () => {
    const d = await designer();
    // A screen is selected, but the click was on none.
    await click(d.node("screen:cart")!);
    await d.rightClick(d.pane(), { x: -500, y: -500 });
    await d.pick("Add", "Heading");
    expect(on(await d.saved())).toEqual({ cart: ["title", "actions(pay back)"], payment: ["card", "blank"], done: ["heading"] });
    expect(d.details()).toBe("Heading1 of 1 on Done");

    const empty = await designer({ ...doc, views: { checkout: { title: "Checkout", level: "wireframe" } } });
    await empty.rightClick(empty.pane());
    await empty.pick("Add", "Button");
    expect(on(await empty.saved())).toEqual({ "new-screen": ["button"] });
  });
});

describe("a wireframe view's right-click menu, opened with the keyboard or after an edit", () => {
  const slow = async (model: OpenArchDocument = doc): Promise<[Open, SlowHost]> => {
    const file = new SlowHost("shop.openarch", serializeDocument(model));
    return [await designer(model, file), file];
  };

  it("opens under what it's for from the keyboard", async () => {
    const d = await designer();
    put(d.node("widget:pay")!, 300, 420);
    await d.menuKey(d.node("widget:pay")!);
    expect(d.details()).toBe("Button1 of 2 in row actions");
    const menu = document.querySelector<HTMLElement>(".context-menu")!;
    expect([menu.style.left, menu.style.top]).toEqual(["300px", "420px"]);
  });

  it("waits for a slow save, then opens on the screen under the new ID its name gave it", async () => {
    const [d, file] = await slow();
    await click(d.node("screen:payment")!);
    file.hold = true;
    // Its ID follows its name, and the save that renames it hasn't landed when it's right-clicked.
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Name"]')!, "Pay");
    await d.rightClick(d.node("screen:payment")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("screen:pay")).not.toBeNull();
    await d.pick("Move left");
    expect((await d.saved()).screens.map((s) => s.id)).toEqual(["pay", "cart", "done"]);
  });

  it("opens on a widget under the new ID typed for it", async () => {
    const [d, file] = await slow();
    await click(d.node("widget:back")!);
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="ID"]')!, "go-back");
    await d.rightClick(d.node("widget:back")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.node("widget:go-back")).not.toBeNull();
    await d.pick("Delete link");
    expect(on(await d.saved()).cart).toEqual(["title", "actions(pay)"]);
  });

  it("doesn't open on a widget that goes with the screen, or the row, deleted just before, and does on one that stays", async () => {
    for (const [select, press, gone, stays] of [
      ["screen:cart", "Delete screen", "widget:back", "widget:card"],
      ["widget:actions", "Delete row", "widget:pay", "widget:title"],
    ] as const) {
      const [d, file] = await slow();
      await click(d.node(select)!);
      file.hold = true;
      await click(button(d.host, press));
      await d.rightClick(d.node(gone)!);
      file.release();
      await d.settle();
      expect(d.menuOpen(), press).toBe(false);

      const [other, again] = await slow();
      await click(other.node(select)!);
      again.hold = true;
      await click(button(other.host, press));
      await other.rightClick(other.node(stays)!);
      expect(other.menuOpen()).toBe(false);
      again.release();
      await other.settle();
      expect(other.labels(), press).toContain("Add after");
    }
  });

  it("opens once a title typed just before has given the view a new ID, on the same diagram", async () => {
    const [d, file] = await slow();
    const pane = d.pane();
    file.hold = true;
    await write(d.host.querySelector<HTMLInputElement>('input[aria-label="Title"]')!, "Paying");
    await d.rightClick(d.node("widget:back")!);
    expect(d.menuOpen()).toBe(false);
    file.release();
    await d.settle();
    expect(d.pane()).toBe(pane);
    expect(d.details()).toBe("Link2 of 2 in row actions");
    await d.pick("Delete link");
    expect(on(await d.saved("paying")).cart).toEqual(["title", "actions(pay)"]);
  });

  it("closes when an Undo is written under it, and doesn't open through one", async () => {
    const [d, file] = await slow();
    await d.rightClick(d.node("widget:pay")!);
    await d.pick("Move right");
    await d.rightClick(d.node("widget:pay")!);
    expect(d.menuOpen()).toBe(true);
    await click(button(d.host, "Undo"));
    await d.settle();
    expect(d.menuOpen()).toBe(false);
    // And with a Redo on its way.
    file.hold = true;
    await click(button(d.host, "Redo"));
    await d.rightClick(d.node("widget:pay")!);
    file.release();
    await d.settle();
    expect(d.menuOpen()).toBe(false);
  });
});
