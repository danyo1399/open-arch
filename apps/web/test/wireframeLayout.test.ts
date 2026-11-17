import { buildWorkspace, screenArrows, type OpenArchDocument, type ViewDef } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { arrowRoutes, screenDropOps, WF, widgetDropOps, widgetDropSpot, widgetHeight, wireframeLayout } from "../src/canvas/wireframeLayout.js";

const doc: OpenArchDocument = {
  openarch: 15,
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
                { id: "back", kind: "link", text: "Back", to: "home" },
                { id: "pay", kind: "button", text: "Pay", to: "payment" },
              ],
            },
          ],
        },
        {
          id: "payment",
          name: "Payment",
          widgets: [
            { id: "card", kind: "panel", text: "Card", widgets: [{ id: "number", kind: "input", text: "Number" }] },
            { id: "done", kind: "button", text: "Done", to: "home" },
          ],
        },
        { id: "home", name: "Home", device: "tablet" },
      ],
    },
  },
};

const view = (model: OpenArchDocument = doc): ViewDef => buildWorkspace(model).views.get("checkout")!;
const widget = (v: ViewDef, id: string) => {
  const find = (list: ViewDef["screens"][number]["widgets"]): ViewDef["screens"][number]["widgets"][number] | undefined => {
    for (const w of list) {
      if (w.id === id) return w;
      const inside = find(w.widgets);
      if (inside) return inside;
    }
    return undefined;
  };
  return v.screens.map((s) => find(s.widgets)).find(Boolean)!;
};

describe("wireframeLayout", () => {
  it("puts the screens left to right, each as wide as its device and at least as tall", () => {
    const layout = wireframeLayout(view());
    expect(layout.screens.get("cart")).toEqual({ x: 0, y: 0, w: WF.width.phone, h: WF.minHeight.phone });
    expect(layout.screens.get("payment")).toEqual({ x: WF.width.phone + WF.between, y: 0, w: WF.width.desktop, h: WF.minHeight.desktop });
    expect(layout.screens.get("home")!.x).toBe(WF.width.phone + WF.width.desktop + 2 * WF.between);
    expect(layout.width).toBe(WF.width.phone + WF.width.desktop + WF.width.tablet + 2 * WF.between);
    expect(layout.height).toBe(WF.minHeight.phone);
  });

  it("puts a screen's widgets top to bottom with a gap between, a row's side by side, and a panel's inside it", () => {
    const v = view();
    const layout = wireframeLayout(v);
    const inner = WF.width.phone - 2 * WF.pad;
    const title = layout.widgets.get("title")!;
    expect(title).toEqual({ x: WF.pad, y: WF.head + WF.pad, w: inner, h: widgetHeight(widget(v, "title"), inner) });
    const actions = layout.widgets.get("actions")!;
    expect(actions.y).toBe(title.y + title.h + WF.gap);
    const half = (inner - WF.gap) / 2;
    expect(layout.widgets.get("back")).toMatchObject({ x: WF.pad, y: actions.y, w: half });
    expect(layout.widgets.get("pay")).toMatchObject({ x: WF.pad + half + WF.gap, y: actions.y, w: half });
    // A row is as tall as its tallest widget, a button here.
    expect(actions.h).toBe(34);
    const card = layout.widgets.get("card")!;
    const number = layout.widgets.get("number")!;
    expect(number).toMatchObject({ x: card.x + WF.pad, y: card.y + WF.title + 4, w: card.w - 2 * WF.pad });
    expect(card.h).toBe(WF.title + 4 + number.h + WF.pad);
    expect(layout.widgets.get("done")!.y).toBe(card.y + card.h + WF.gap);
  });

  it("makes a screen taller than its device's least height when what's on it needs more", () => {
    const tall = structuredClone(doc);
    tall.views.checkout!.screens![2]!.widgets = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}`, kind: "image" as const }));
    const layout = wireframeLayout(view(tall));
    const last = layout.widgets.get("item-19")!;
    expect(layout.screens.get("home")!.h).toBe(last.y + last.h + WF.pad);
    expect(layout.height).toBe(layout.screens.get("home")!.h);
  });

  it("makes a widget as tall as its text needs: more lines, and long lines that wrap, take more room", () => {
    const v = view();
    const text = { ...widget(v, "title"), kind: "text" as const, text: "One\nTwo" };
    expect(widgetHeight(text, 300)).toBe(2 * WF.line);
    expect(widgetHeight({ ...text, text: "x".repeat(100) }, 300)).toBe(3 * WF.line);
    expect(widgetHeight({ ...text, text: undefined }, 300)).toBe(42);
    expect(widgetHeight({ ...text, kind: "list", text: "a\nb\nc\nd" }, 300)).toBe(80);
    expect(widgetHeight({ ...text, kind: "input", text: undefined }, 300)).toBe(32);
    expect(widgetHeight({ ...text, kind: "input", text: "Email" }, 300)).toBe(52);
  });
});

describe("dropping a widget", () => {
  const v = view();
  const layout = wireframeLayout(v);
  const middle = (id: string) => {
    const b = layout.widgets.get(id)!;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  };

  it("moves it into the innermost row or panel under it, at its place there", () => {
    const number = layout.widgets.get("number")!;
    // Just below the field, in the Card panel: after it.
    expect(widgetDropOps(v, layout, widget(v, "pay"), { x: number.x + 10, y: number.y + number.h + 4 })).toEqual([{ op: "update-widget", view: "checkout", id: "pay", in: "card", position: 2 }]);
    // On the left of the row: before the link.
    const back = layout.widgets.get("back")!;
    expect(widgetDropOps(v, layout, widget(v, "title"), { x: back.x + 2, y: back.y + 5 })).toEqual([{ op: "update-widget", view: "checkout", id: "title", in: "actions", position: 1 }]);
  });

  it("moves it onto the screen under it, at its place among the widgets there", () => {
    const done = layout.widgets.get("done")!;
    expect(widgetDropOps(v, layout, widget(v, "back"), { x: done.x + 10, y: done.y + done.h + 30 })).toEqual([{ op: "update-widget", view: "checkout", id: "back", screen: "payment", position: 3 }]);
    expect(widgetDropOps(v, layout, widget(v, "actions"), { x: WF.pad + 5, y: WF.head + 2 })).toEqual([{ op: "update-widget", view: "checkout", id: "actions", screen: "cart", position: 1 }]);
    const home = layout.screens.get("home")!;
    expect(widgetDropOps(v, layout, widget(v, "done"), { x: home.x + 20, y: home.y + 100 })).toEqual([{ op: "update-widget", view: "checkout", id: "done", screen: "home", position: 1 }]);
  });

  it("changes nothing where it already is, or over no screen, and never puts a row or panel inside itself", () => {
    expect(widgetDropOps(v, layout, widget(v, "pay"), middle("pay"))).toEqual([]);
    expect(widgetDropOps(v, layout, widget(v, "title"), middle("title"))).toEqual([]);
    expect(widgetDropOps(v, layout, widget(v, "title"), { x: -50, y: 20 })).toEqual([]);
    // The row dropped over its own link lands on the screen, where it was.
    expect(widgetDropSpot(v, layout, widget(v, "actions"), middle("back"))).toMatchObject({ holder: undefined, position: 2 });
    expect(widgetDropOps(v, layout, widget(v, "actions"), middle("back"))).toEqual([]);
  });
});

describe("dropping a screen", () => {
  it("moves it to its place among the others, left to right, or not at all", () => {
    const v = view();
    const layout = wireframeLayout(v);
    const home = layout.screens.get("home")!;
    expect(screenDropOps(v, layout, v.screens[0]!, { x: home.x + home.w / 2 + 10, y: 50 })).toEqual([{ op: "update-screen", view: "checkout", id: "cart", position: 3 }]);
    expect(screenDropOps(v, layout, v.screens[2]!, { x: -100, y: 50 })).toEqual([{ op: "update-screen", view: "checkout", id: "home", position: 1 }]);
    expect(screenDropOps(v, layout, v.screens[1]!, { x: layout.screens.get("payment")!.x + 30, y: 50 })).toEqual([]);
  });
});

describe("crowded wireframes", () => {
  it("never gives a widget in a crowded row a width of less than nothing", () => {
    const crowded = structuredClone(doc);
    crowded.views.checkout!.screens![0]!.widgets![1]!.widgets = Array.from({ length: 30 }, (_, i) => ({ id: `b-${i}`, kind: "button" as const }));
    const layout = wireframeLayout(view(crowded));
    expect(Array.from({ length: 30 }, (_, i) => layout.widgets.get(`b-${i}`)!.w).every((w) => w >= 0)).toBe(true);
  });

  it("keeps any number of arrows to screens further away in the gap beside their screen, and in the middle of the one they lead to", () => {
    const many = structuredClone(doc);
    many.views.checkout!.screens![0]!.widgets = Array.from({ length: 20 }, (_, i) => ({ id: `go-${i}`, kind: "link" as const, to: "home" }));
    const v = view(many);
    const layout = wireframeLayout(v);
    const routes = arrowRoutes(v, layout, screenArrows(v));
    const [cart, home] = [layout.screens.get("cart")!, layout.screens.get("home")!];
    for (let i = 0; i < 20; i++) {
      const route = routes.get(`go-${i}->home`)!;
      expect(route[1]!.x).toBeGreaterThan(cart.x + cart.w);
      expect(route[1]!.x).toBeLessThanOrEqual(cart.x + cart.w + WF.between / 2);
      expect(Math.abs(route[3]!.x - (home.x + home.w / 2))).toBeLessThanOrEqual(home.w / 2);
    }
  });
});

describe("arrowRoutes", () => {
  it("takes an arrow to the next screen, or the one before, across the gap between them, each at its own place", () => {
    const v = view();
    const layout = wireframeLayout(v);
    const routes = arrowRoutes(v, layout, screenArrows(v));
    const [cart, payment, home] = ["cart", "payment", "home"].map((id) => layout.screens.get(id)!);
    const pay = layout.widgets.get("pay")!;
    const gap = cart!.x + cart!.w;
    // Pay leads to the next screen, Done to the next one after Payment: each the only arrow in its gap.
    expect(routes.get("pay->payment")).toEqual([
      { x: pay.x + pay.w, y: pay.y + pay.h / 2 },
      { x: gap + WF.between / 2, y: pay.y + pay.h / 2 },
      { x: gap + WF.between / 2, y: pay.y + pay.h / 2 },
      { x: payment!.x, y: pay.y + pay.h / 2 },
    ]);
    const done = layout.widgets.get("done")!;
    expect(routes.get("done->home")![3]).toEqual({ x: home!.x, y: done.y + done.h / 2 });
  });

  it("takes an arrow to a screen further away under the screens, and up into it, leaving its widget on the side facing it", () => {
    const v = view();
    const layout = wireframeLayout(v);
    const routes = arrowRoutes(v, layout, screenArrows(v));
    const back = layout.widgets.get("back")!;
    const home = layout.screens.get("home")!;
    const below = layout.height + WF.under;
    expect(routes.get("back->home")).toEqual([
      { x: back.x + back.w, y: back.y + back.h / 2 },
      { x: WF.width.phone + WF.track, y: back.y + back.h / 2 },
      { x: WF.width.phone + WF.track, y: below },
      { x: home.x + home.w / 2 - WF.track, y: below },
      { x: home.x + home.w / 2 - WF.track, y: home.h },
    ]);
  });
});
