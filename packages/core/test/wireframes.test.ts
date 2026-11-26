import { describe, expect, it } from "vitest";
import {
  allWidgets,
  applyOperations,
  buildWorkspace,
  checkWorkspace,
  computeView,
  describeElement,
  exportDocs,
  OpError,
  parseDocument,
  parseOperations,
  renderMermaid,
  screenArrows,
  serializeDocument,
  type OpenArchDocument,
  type Operation,
} from "../src/index.js";
import { apply, rules, shop } from "./helpers.js";

/** The shop, with a wireframe of the web app's checkout: a cart, a payment screen and a thank-you screen. */
function checkout(): OpenArchDocument {
  const doc = shop();
  doc.views.checkout = {
    title: "Checkout",
    level: "wireframe",
    scope: "web-app",
    screens: [
      {
        id: "cart",
        name: "Cart",
        device: "phone",
        widgets: [
          { id: "cart-title", kind: "heading", text: "Your cart" },
          { id: "items", kind: "list", text: "Pizza\nGarlic bread" },
          {
            id: "actions",
            kind: "row",
            widgets: [
              { id: "keep-shopping", kind: "link", text: "Keep shopping" },
              { id: "check-out", kind: "button", text: "Check out", description: "Greyed out when the cart is empty.", to: "payment" },
            ],
          },
        ],
      },
      {
        id: "payment",
        name: "Payment",
        description: "Where the customer pays.",
        widgets: [
          {
            id: "card",
            kind: "panel",
            text: "Card",
            widgets: [
              { id: "card-number", kind: "input", text: "Card number" },
              { id: "remember", kind: "checkbox", text: "Remember this card" },
            ],
          },
          { id: "pay", kind: "button", text: "Pay", to: "done" },
          { id: "back", kind: "link", text: "Back to cart", to: "cart" },
        ],
      },
      { id: "done", name: "Thank you", widgets: [{ id: "thanks", kind: "text", text: "Your order is on its way." }] },
    ],
  };
  return doc;
}

const def = (doc: OpenArchDocument, id = "checkout") => buildWorkspace(doc).views.get(id)!;

const mermaid = (doc: OpenArchDocument, id = "checkout") => {
  const ws = buildWorkspace(doc);
  return renderMermaid(computeView(ws, ws.views.get(id)!));
};

const page = (doc: OpenArchDocument, id = "checkout") => exportDocs(buildWorkspace(doc), "shop.openarch").find((f) => f.path === `views/${id}.md`)!.content;

const fails = (doc: OpenArchDocument, ...ops: Operation[]) => {
  try {
    applyOperations(doc, ops);
  } catch (error) {
    if (error instanceof OpError) return error.message;
    throw error;
  }
  throw new Error("The operations were applied.");
};

/** Each screen's widgets as IDs, with what's inside a row or panel in brackets. */
const outline = (doc: OpenArchDocument) =>
  Object.fromEntries(def(doc).screens.map((s) => [s.id, s.widgets.map(function name(w): string {
    return w.widgets.length ? `${w.id}(${w.widgets.map(name).join(" ")})` : w.id;
  }).join(" ")]));

describe("wireframe views", () => {
  it("are read and written, with their screens in order and each widget on a line", () => {
    const text = serializeDocument(checkout());
    expect(text).toContain(`    "checkout": {
      "title": "Checkout",
      "level": "wireframe",
      "scope": "web-app",
      "screens": [
        {
          "id": "cart",
          "name": "Cart",
          "device": "phone",
          "widgets": [
            { "id": "cart-title", "kind": "heading", "text": "Your cart" },
            { "id": "items", "kind": "list", "text": "Pizza\\nGarlic bread" },
            {
              "id": "actions",
              "kind": "row",
              "widgets": [
                { "id": "keep-shopping", "kind": "link", "text": "Keep shopping" },
                { "id": "check-out", "kind": "button", "text": "Check out", "description": "Greyed out when the cart is empty.", "to": "payment" }
              ]
            }
          ]
        },
        {
          "id": "payment",
          "name": "Payment",
          "description": "Where the customer pays.",
          "widgets": [`);
    expect(text).toContain(`        {
          "id": "done",
          "name": "Thank you",
          "widgets": [
            { "id": "thanks", "kind": "text", "text": "Your order is on its way." }
          ]
        }
      ]
    },`);
    const parsed = parseDocument(text);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc.views.checkout).toEqual(checkout().views.checkout);
    expect(rules(checkout())).toEqual([]);
  });

  it("are written with empty lists when they have no screens or widgets yet, and leave out the default device", () => {
    const doc = apply(shop(), { op: "add-view", id: "sign-up", level: "wireframe" }, { op: "add-screen", view: "sign-up", id: "start", device: "desktop" });
    expect(doc.views["sign-up"]).toEqual({ title: "Sign Up", level: "wireframe", screens: [{ id: "start", name: "Start" }] });
    expect(serializeDocument(doc)).toContain(`    "sign-up": {
      "title": "Sign Up",
      "level": "wireframe",
      "screens": [
        {
          "id": "start",
          "name": "Start",
          "widgets": []
        }
      ]
    }`);
    expect(serializeDocument(apply(shop(), { op: "add-view", id: "sign-up", level: "wireframe" }))).toContain(`      "level": "wireframe",\n      "screens": []\n    }`);
    // A row or panel with nothing in it yet is a widget like any other, on one line.
    const empty = apply(doc, { op: "add-widget", view: "sign-up", id: "form", kind: "panel", screen: "start" });
    expect(serializeDocument(empty)).toContain(`          "widgets": [\n            { "id": "form", "kind": "panel" }\n          ]`);
  });

  it("are new in version 13: a version 12 file is read as it is", () => {
    const old = shop();
    const parsed = parseDocument(JSON.stringify({ ...old, openarch: 12 }));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.doc).toEqual({ ...old, openarch: 22 });
  });

  it("refuse fields of other views, and report malformed screens and widgets", () => {
    const doc = {
      ...shop(),
      views: {
        v: {
          title: "V",
          level: "wireframe",
          include: ["*"],
          layout: {},
          cards: [],
          screens: [
            { id: "Bad", name: "B" },
            { name: "No ID" },
            { id: "home", name: "Home", device: "watch", colour: "red", widgets: "none" },
            { id: "home", name: "Again" },
            {
              id: "list",
              widgets: [
                { id: "a", kind: "button", text: 3, to: "home" },
                { id: "b", kind: "slider" },
                { id: "c", text: "No kind" },
                { kind: "text" },
                { id: "a", kind: "link" },
                { id: "d", kind: "text", widgets: [{ id: "e", kind: "text" }] },
                { id: "f", kind: "panel", widgets: [{ id: "f", kind: "text" }, { id: "g", kind: "image", alt: "x" }] },
                "x",
              ],
            },
          ],
        },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.valid).toBe(false);
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual([
      "field-not-allowed views.v.include",
      "field-not-allowed views.v.layout",
      "field-not-allowed views.v.cards",
      "id-format views.v.screens[0].id",
      "field-required views.v.screens[1].id",
      "field-unknown views.v.screens[2].colour",
      "device-invalid views.v.screens[2].device",
      "field-type views.v.screens[2].widgets",
      "id-duplicate views.v.screens[3].id",
      "field-required views.v.screens[4].name",
      "field-type views.v.screens[4].widgets[0].text",
      "widget-kind-invalid views.v.screens[4].widgets[1].kind",
      "field-required views.v.screens[4].widgets[2].kind",
      "field-required views.v.screens[4].widgets[3].id",
      "id-duplicate views.v.screens[4].widgets[4].id",
      "field-not-allowed views.v.screens[4].widgets[5].widgets",
      "id-duplicate views.v.screens[4].widgets[6].widgets[0].id",
      "field-unknown views.v.screens[4].widgets[6].widgets[1].alt",
      "field-type views.v.screens[4].widgets[7]",
    ]);
    // What's malformed is left out, and the first of two with one ID is kept.
    expect(parsed.doc.views.v).toEqual({
      title: "V",
      level: "wireframe",
      screens: [
        { id: "home", name: "Home" },
        {
          id: "list",
          name: "list",
          widgets: [
            { id: "a", kind: "button", to: "home" },
            { id: "d", kind: "text" },
            { id: "f", kind: "panel", widgets: [{ id: "g", kind: "image" }] },
          ],
        },
      ],
    });
    expect(parsed.diagnostics.find((d) => d.path === "views.v.include")!.message).toBe("Wireframe views don't take `include`: they show their screens in order, each drawn from its widgets.");
    expect(parsed.diagnostics.find((d) => d.path.endsWith("widgets[5].widgets"))!.message).toBe("Only rows and panels hold widgets, and this is a text.");
    const other = parseDocument(JSON.stringify({ ...shop(), views: { v: { title: "V", level: "landscape", screens: [] } } }));
    expect(other.diagnostics.map((d) => [d.path, d.message])).toEqual([["views.v.screens", "Only wireframe views have `screens`."]]);
  });

  it("leave out a screen with a taken ID before its widgets, so their IDs stay free for the widgets after it", () => {
    const doc = {
      ...shop(),
      views: {
        v: {
          title: "V",
          level: "wireframe",
          screens: [
            { id: "home", name: "Home" },
            { id: "home", name: "Again", widgets: [{ id: "go", kind: "button" }] },
            { id: "list", name: "List", widgets: [{ id: "go", kind: "link" }] },
          ],
        },
      },
    };
    const parsed = parseDocument(JSON.stringify(doc));
    expect(parsed.diagnostics.map((d) => `${d.rule} ${d.path}`)).toEqual(["id-duplicate views.v.screens[1].id"]);
    expect(parsed.doc.views.v!.screens).toEqual([
      { id: "home", name: "Home" },
      { id: "list", name: "List", widgets: [{ id: "go", kind: "link" }] },
    ]);
  });

  it("know where each widget is: its screen, the row or panel it's in, and its place there", () => {
    const view = def(checkout());
    expect(allWidgets(view).map((w) => [w.id, w.screen, w.parent ?? "", w.number, w.path])).toEqual([
      ["cart-title", "cart", "", 1, "views.checkout.screens[0].widgets[0]"],
      ["items", "cart", "", 2, "views.checkout.screens[0].widgets[1]"],
      ["actions", "cart", "", 3, "views.checkout.screens[0].widgets[2]"],
      ["keep-shopping", "cart", "actions", 1, "views.checkout.screens[0].widgets[2].widgets[0]"],
      ["check-out", "cart", "actions", 2, "views.checkout.screens[0].widgets[2].widgets[1]"],
      ["card", "payment", "", 1, "views.checkout.screens[1].widgets[0]"],
      ["card-number", "payment", "card", 1, "views.checkout.screens[1].widgets[0].widgets[0]"],
      ["remember", "payment", "card", 2, "views.checkout.screens[1].widgets[0].widgets[1]"],
      ["pay", "payment", "", 2, "views.checkout.screens[1].widgets[1]"],
      ["back", "payment", "", 3, "views.checkout.screens[1].widgets[2]"],
      ["thanks", "done", "", 1, "views.checkout.screens[2].widgets[0]"],
    ]);
    expect(view.screens.map((s) => [s.id, s.number, s.device])).toEqual([
      ["cart", 1, "phone"],
      ["payment", 2, "desktop"],
      ["done", 3, "desktop"],
    ]);
    expect(allWidgets(view.screens[1]!).map((w) => w.id)).toEqual(["card", "card-number", "remember", "pay", "back"]);
  });

  it("draw an arrow from each widget that leads to another screen", () => {
    expect(screenArrows(def(checkout()))).toEqual([
      { from: "check-out", screen: "cart", to: "payment" },
      { from: "pay", screen: "payment", to: "done" },
      { from: "back", screen: "payment", to: "cart" },
    ]);
  });

  it("are checked: a widget leads to a screen of the view, and not to its own", () => {
    const doc = checkout();
    const payment = doc.views.checkout!.screens![1]!;
    payment.widgets![1]!.to = "dne";
    payment.widgets![2]!.to = "payment";
    expect(checkWorkspace(buildWorkspace(doc)).map((d) => `${d.severity} ${d.rule} ${d.path} ${d.message} ${d.fix ?? ""}`)).toEqual([
      'error widget-to-unknown views.checkout.screens[1].widgets[1].to Widget "pay" leads to "dne", which isn\'t a screen of this view. Did you mean "done"?',
      'warning widget-to-own-screen views.checkout.screens[1].widgets[2].to Widget "back" leads to the screen it\'s on, so no arrow is drawn. Point `to` at another screen, or remove it.',
    ]);
    // The view is still drawn, without the arrows that lead nowhere.
    expect(screenArrows(def(doc))).toEqual([{ from: "check-out", screen: "cart", to: "payment" }]);
  });

  it("can be of a system or a container, whose screens they show, or of nothing", () => {
    const ws = buildWorkspace(checkout());
    const cv = computeView(ws, ws.views.get("checkout")!);
    expect(cv.boundary?.id).toBe("web-app");
    expect(cv.nodes).toEqual([]);
    expect(cv.edges).toEqual([]);
    expect(describeElement(ws, "web-app")!.views.filter((v) => v.view.id === "checkout")).toEqual([{ view: ws.views.get("checkout"), as: "screens" }]);
    expect(describeElement(ws, "shop")!.views.map((v) => v.view.id)).not.toContain("checkout");
    expect(apply(shop(), { op: "add-view", id: "shop-screens", level: "wireframe", scope: "shop" }).views["shop-screens"]!.title).toBe("Shop wireframes");
    expect(apply(shop(), { op: "add-view", id: "web-screens", level: "wireframe", scope: "web-app" }).views["web-screens"]!.title).toBe("Web App wireframes");
    expect(fails(shop(), { op: "add-view", id: "x", level: "wireframe", scope: "controller" })).toBe('A wireframe view\'s scope must be a system or container, but "controller" is a component.');
    const scoped = checkout();
    expect(apply(scoped, { op: "rename", id: "web-app", to: "site" }).views.checkout!.scope).toBe("site");
  });
});

describe("wireframe views in the docs", () => {
  it("show in Mermaid as a flowchart from left to right, with a frame for each screen and its widgets top to bottom", () => {
    expect(mermaid(checkout())).toBe(
      [
        "flowchart LR",
        '  subgraph screen__cart["Cart · Phone"]',
        "    direction TB",
        '    cart_title["<b>Your cart</b>"]',
        '    items["• Pizza<br/>• Garlic bread"]',
        // A row is a subgraph of its widgets side by side, with no frame, and with no title it has a blank one.
        '    subgraph actions[" "]',
        "      direction LR",
        '      keep_shopping["<u>Keep shopping</u>"]',
        '      check_out(["Check out"])',
        "      keep_shopping ~~~ check_out",
        "    end",
        "    cart_title ~~~ items",
        "    items ~~~ actions",
        "  end",
        '  subgraph screen__payment["Payment"]',
        "    direction TB",
        '    subgraph card["Card"]',
        "      direction TB",
        '      card_number["Card number: ________"]',
        '      remember["☐ Remember this card"]',
        "      card_number ~~~ remember",
        "    end",
        '    pay(["Pay"])',
        '    back["<u>Back to cart</u>"]',
        "    card ~~~ pay",
        "    pay ~~~ back",
        "  end",
        '  subgraph screen__done["Thank you"]',
        "    direction TB",
        '    thanks["Your order is on its way."]',
        "  end",
        "  screen__cart ~~~ screen__payment",
        "  screen__payment ~~~ screen__done",
        // An arrow from a widget would turn its screen on its side, so arrows go from screen to screen.
        '  screen__cart -->|"Check out"| screen__payment',
        '  screen__payment -->|"Pay"| screen__done',
        '  screen__payment -->|"Back to cart"| screen__cart',
        "  classDef widgetPlain fill:none,stroke:none,color:#000000",
        "  class cart_title,items,keep_shopping,remember,back,thanks widgetPlain",
        "  classDef widgetControl fill:#ffffff,stroke:#8a94a6,color:#000000",
        "  class card_number widgetControl",
        "  classDef widgetButton fill:#dde3ea,stroke:#5d6b7e,color:#000000",
        "  class check_out,pay widgetButton",
        "  style screen__cart fill:#ffffff,stroke:#444444",
        "  style screen__payment fill:#ffffff,stroke:#444444",
        "  style screen__done fill:#ffffff,stroke:#444444",
        "  style actions fill:none,stroke:none",
        "  style card fill:none,stroke:#8a94a6",
      ].join("\n"),
    );
  });

  it("draw each kind of widget as near as Mermaid can, and escape what it reads as markup", () => {
    const doc = apply(
      shop(),
      { op: "add-view", id: "checkout", level: "wireframe" },
      { op: "add-screen", view: "checkout", id: "home", name: 'The "home" page', device: "tablet" },
      { op: "add-widget", view: "checkout", id: "tabs", kind: "tabs", screen: "home", text: "All\nShoes" },
      { op: "add-widget", view: "checkout", id: "find", kind: "input", screen: "home" },
      { op: "add-widget", view: "checkout", id: "sort", kind: "select", screen: "home", text: "Sort by" },
      { op: "add-widget", view: "checkout", id: "photo", kind: "image", screen: "home", text: "A <shoe>" },
      { op: "add-widget", view: "checkout", id: "blank", kind: "image", screen: "home" },
      { op: "add-widget", view: "checkout", id: "prices", kind: "table", screen: "home", text: "Item | Price\nShoe | $5" },
      { op: "add-widget", view: "checkout", id: "or", kind: "divider", screen: "home", text: "or" },
      { op: "add-widget", view: "checkout", id: "line", kind: "divider", screen: "home" },
      { op: "add-widget", view: "checkout", id: "end", kind: "text", screen: "home" },
      { op: "add-widget", view: "checkout", id: "go", kind: "button", screen: "home", text: "Go\nnow" },
      { op: "add-widget", view: "checkout", id: "filters", kind: "panel", screen: "home", text: "Filters | all" },
    );
    const text = mermaid(doc);
    expect(text).toContain('  subgraph screen__home["The #quot;home#quot; page · Tablet"]\n');
    expect(text).toContain('    tabs["<b><u>All</u></b> │ Shoes"]\n');
    expect(text).toContain('    find["________"]\n');
    expect(text).toContain('    sort["Sort by ▾"]\n');
    expect(text).toContain('    photo[["<i>Image</i><br/>A #lt;shoe#gt;"]]\n');
    expect(text).toContain('    blank[["<i>Image</i>"]]\n');
    expect(text).toContain('    prices["<b>Item │ Price</b><br/>Shoe │ $5"]\n');
    expect(text).toContain('    or["──── or ────"]\n');
    expect(text).toContain('    line["────────────"]\n');
    expect(text).toContain('    end_["Text"]\n');
    expect(text).toContain('    go(["Go<br/>now"])\n');
    // A panel with nothing in it has no direction, which Mermaid draws as a box with its title.
    expect(text).toContain('    subgraph filters["Filters #124; all"]\n    end\n');
    expect(text).toContain("  style filters fill:none,stroke:#8a94a6");
  });

  it("draw one arrow from a screen to another, with the text of each widget that leads there, and none where a widget leads nowhere", () => {
    const doc = checkout();
    const cart = doc.views.checkout!.screens![0]!;
    cart.widgets!.push({ id: "pay-now", kind: "button", text: "Pay now", to: "payment" }, { id: "again", kind: "button", text: "Check out", to: "payment" }, { id: "icon", kind: "image", to: "done" }, { id: "self", kind: "link", to: "cart" });
    const text = mermaid(doc);
    expect(text).toContain('  screen__cart -->|"Check out<br/>Pay now"| screen__payment\n');
    expect(text).toContain('  screen__cart -->|"Image"| screen__done\n');
    expect(text).not.toContain("screen__cart -->|\"Link\"|");
    expect(text.match(/screen__cart -->/g)).toHaveLength(2);
  });

  it("say so in Mermaid when there are no screens, and draw a screen with nothing on it as a box", () => {
    const doc = apply(shop(), { op: "add-view", id: "checkout", level: "wireframe" });
    expect(mermaid(doc)).toBe("flowchart LR\n  %% This view has no screens yet.");
    expect(page(doc)).toContain("## Screens\n\nNone yet.\n");
    const empty = apply(doc, { op: "add-screen", view: "checkout", id: "home" });
    expect(mermaid(empty)).toBe(["flowchart LR", '  subgraph screen__home["Home"]', "  end", "  style screen__home fill:#ffffff,stroke:#444444"].join("\n"));
    expect(page(empty)).toContain("### 1. Home\n\nDesktop screen.\n\nNothing on it yet.\n");
  });

  it("are documented with a table of each screen's widgets, numbered within the rows and panels they're in", () => {
    const text = page(checkout());
    expect(text).toContain("\nWireframe view of [Web App](../elements/web-app.md).\n");
    expect(text).toContain(
      [
        "## Screens",
        "",
        "### 1. Cart",
        "",
        "Phone screen.",
        "",
        "| # | Widget | Text | Leads to | Description |",
        "|---|---|---|---|---|",
        "| 1 | Heading | Your cart |  |  |",
        "| 2 | List | Pizza / Garlic bread |  |  |",
        "| 3 | Row |  |  |  |",
        "| 3.1 | Link | Keep shopping |  |  |",
        "| 3.2 | Button | Check out | Payment | Greyed out when the cart is empty. |",
        "",
        "### 2. Payment",
        "",
        "Desktop screen. Where the customer pays.",
        "",
      ].join("\n"),
    );
    expect(text).toContain("| 1.1 | Text field | Card number |  |  |");
    expect(text).toContain("| 3 | Link | Back to cart | Cart |  |");
    expect(text).not.toContain("## Elements");
    const element = exportDocs(buildWorkspace(checkout()), "shop.openarch").find((f) => f.path === "elements/web-app.md")!.content;
    expect(element).toContain("- [Checkout](../views/checkout.md) (its screens)");
    // A table's cells keep their bars, escaped, and a widget that leads to a screen the view doesn't have names it.
    const odd = checkout();
    odd.views.checkout!.screens![2]!.widgets!.push({ id: "prices", kind: "table", text: "Item | Price", to: "nowhere" });
    expect(page(odd)).toContain("| 2 | Table | Item \\| Price | nowhere |  |");
  });
});

describe("wireframe operations", () => {
  const base = () => apply(shop(), { op: "add-view", id: "checkout", level: "wireframe" });
  const screens = (doc: OpenArchDocument) => doc.views.checkout!.screens!.map((s) => s.id);

  it("add, change, move, rename and remove screens, and the widgets that lead to them follow", () => {
    const added = applyOperations(base(), [
      { op: "add-screen", view: "checkout", id: "payment" },
      { op: "add-screen", view: "checkout", id: "cart", name: " Your cart ", description: " What's in it. ", device: "phone", position: 1 },
    ]);
    expect(added.summary).toEqual(["added screen payment to view checkout", "added screen cart to view checkout, as screen 1"]);
    let doc = added.doc;
    expect(doc.views.checkout!.screens).toEqual([{ id: "cart", name: "Your cart", description: "What's in it.", device: "phone" }, { id: "payment", name: "Payment" }]);
    doc = apply(doc, { op: "add-widget", view: "checkout", id: "pay", kind: "button", screen: "cart", to: "payment" });
    const moved = applyOperations(doc, [{ op: "update-screen", view: "checkout", id: "cart", position: 2 }]);
    expect(moved.summary).toEqual(["moved screen cart to screen 2 in view checkout"]);
    expect(screens(moved.doc)).toEqual(["payment", "cart"]);
    const stayed = applyOperations(doc, [{ op: "update-screen", view: "checkout", id: "cart", position: 1 }, { op: "update-screen", view: "checkout", id: "cart", newId: "cart" }]);
    expect(stayed.summary).toEqual(["screen cart is already screen 1 in view checkout", 'screen cart is already "cart" in view checkout']);
    expect(stayed.doc).toEqual(doc);
    const changed = applyOperations(doc, [{ op: "update-screen", view: "checkout", id: "cart", name: "Cart", description: null, device: "desktop" }]);
    expect(changed.summary).toEqual(["updated screen cart in view checkout"]);
    expect(changed.doc.views.checkout!.screens![0]).toEqual({ id: "cart", name: "Cart", widgets: [{ id: "pay", kind: "button", to: "payment" }] });
    const renamed = applyOperations(doc, [{ op: "update-screen", view: "checkout", id: "payment", newId: "pay-now", position: 1 }]);
    expect(renamed.summary).toEqual(["renamed screen payment to pay-now in view checkout, and moved it to screen 1"]);
    expect(screens(renamed.doc)).toEqual(["pay-now", "cart"]);
    expect(renamed.doc.views.checkout!.screens![1]!.widgets).toEqual([{ id: "pay", kind: "button", to: "pay-now" }]);
    const removed = applyOperations(doc, [{ op: "remove-screen", view: "checkout", id: "payment" }]);
    expect(removed.summary).toEqual(["removed screen payment from view checkout, and the arrow to it from 1 widget"]);
    expect(removed.doc.views.checkout!.screens).toEqual([{ id: "cart", name: "Your cart", description: "What's in it.", device: "phone", widgets: [{ id: "pay", kind: "button" }] }]);
    expect(applyOperations(removed.doc, [{ op: "remove-screen", view: "checkout", id: "cart" }]).summary).toEqual(["removed screen cart from view checkout, with 1 widget on it"]);
  });

  it("add widgets onto a screen, or into a row or a panel, at the end or at a position", () => {
    const doc = apply(base(), { op: "add-screen", view: "checkout", id: "cart" }, { op: "add-screen", view: "checkout", id: "payment" });
    const added = applyOperations(doc, [
      { op: "add-widget", view: "checkout", id: "items", kind: "list", screen: "cart", text: " Pizza\nGarlic bread ", description: " One line each. " },
      { op: "add-widget", view: "checkout", id: "title", kind: "heading", screen: "cart", text: "Your cart", position: 1 },
      { op: "add-widget", view: "checkout", id: "actions", kind: "row", screen: "cart" },
      { op: "add-widget", view: "checkout", id: "check-out", kind: "button", in: "actions", text: "Check out", to: "payment" },
      { op: "add-widget", view: "checkout", id: "back", kind: "link", in: "actions", screen: "cart", position: 1 },
    ]);
    expect(added.summary).toEqual([
      "added list items to screen cart in view checkout",
      "added heading title to screen cart in view checkout, as widget 1 there",
      "added row actions to screen cart in view checkout",
      "added button check-out to row actions in view checkout",
      "added link back to row actions in view checkout, as widget 1 there",
    ]);
    expect(added.doc.views.checkout!.screens![0]!.widgets).toEqual([
      { id: "title", kind: "heading", text: "Your cart" },
      { id: "items", kind: "list", text: "Pizza\nGarlic bread", description: "One line each." },
      { id: "actions", kind: "row", widgets: [{ id: "back", kind: "link" }, { id: "check-out", kind: "button", text: "Check out", to: "payment" }] },
    ]);
    // Leading to its own screen is allowed, with a warning that no arrow is drawn.
    const own = applyOperations(added.doc, [{ op: "add-widget", view: "checkout", id: "refresh", kind: "link", screen: "cart", to: "cart" }]);
    expect(own.warnings.map((w) => w.rule)).toEqual(["widget-to-own-screen"]);
  });

  it("change, move, rename and remove widgets", () => {
    let doc = apply(
      base(),
      { op: "add-screen", view: "checkout", id: "cart" },
      { op: "add-screen", view: "checkout", id: "payment" },
      { op: "add-widget", view: "checkout", id: "title", kind: "heading", screen: "cart", text: "Cart" },
      { op: "add-widget", view: "checkout", id: "actions", kind: "row", screen: "cart" },
      { op: "add-widget", view: "checkout", id: "back", kind: "link", in: "actions" },
      { op: "add-widget", view: "checkout", id: "pay", kind: "button", in: "actions", to: "payment", description: "Goes on." },
      { op: "add-widget", view: "checkout", id: "card", kind: "panel", screen: "payment" },
    );
    expect(outline(doc)).toEqual({ cart: "title actions(back pay)", payment: "card" });
    const changed = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "pay", kind: "link", text: " Pay now ", description: null, to: null }]);
    expect(changed.summary).toEqual(["updated widget pay in view checkout"]);
    expect(changed.doc.views.checkout!.screens![0]!.widgets![1]!.widgets![1]).toEqual({ id: "pay", kind: "link", text: "Pay now" });
    // Within its row, onto its screen, into a panel on another screen, and onto another screen.
    const along = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "pay", position: 1 }]);
    expect(along.summary).toEqual(["moved widget pay to row actions, as widget 1 there, in view checkout"]);
    expect(outline(along.doc)).toEqual({ cart: "title actions(pay back)", payment: "card" });
    const out = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "pay", in: null, position: 1 }]);
    expect(out.summary).toEqual(["moved widget pay to screen cart, as widget 1 there, in view checkout"]);
    expect(outline(out.doc)).toEqual({ cart: "pay title actions(back)", payment: "card" });
    const across = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "pay", in: "card", text: "Pay" }]);
    expect(across.summary).toEqual(["updated widget pay in view checkout, and moved it to panel card, as widget 1 there"]);
    expect(outline(across.doc)).toEqual({ cart: "title actions(back)", payment: "card(pay)" });
    // It now leads to the screen it's on, which is a warning, not an error.
    expect(across.warnings.map((w) => w.rule)).toEqual(["widget-to-own-screen"]);
    const screen = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "actions", screen: "payment" }]);
    expect(outline(screen.doc)).toEqual({ cart: "title", payment: "card actions(back pay)" });
    // A row emptied of its widgets has none left in the file.
    const emptied = apply(doc, { op: "update-widget", view: "checkout", id: "back", screen: "cart" }, { op: "update-widget", view: "checkout", id: "pay", screen: "cart" });
    expect(emptied.views.checkout!.screens![0]!.widgets![1]).toEqual({ id: "actions", kind: "row" });
    // Where it already is, it doesn't move, and the answer says so. The same goes for the ID it has.
    const stayed = applyOperations(doc, [
      { op: "update-widget", view: "checkout", id: "pay", position: 2 },
      { op: "update-widget", view: "checkout", id: "pay", in: "actions" },
      { op: "update-widget", view: "checkout", id: "title", screen: "cart", in: null },
      { op: "update-widget", view: "checkout", id: "title", newId: "title" },
    ]);
    expect(stayed.summary).toEqual([
      "widget pay is already widget 2 in row actions in view checkout",
      "widget pay is already widget 2 in row actions in view checkout",
      "widget title is already widget 1 on screen cart in view checkout",
      'widget title is already "title" in view checkout',
    ]);
    expect(stayed.doc).toEqual(doc);
    const renamed = applyOperations(doc, [{ op: "update-widget", view: "checkout", id: "actions", newId: "buttons", kind: "panel", position: 1 }]);
    expect(renamed.summary).toEqual(["renamed widget actions to buttons in view checkout, and moved it to screen cart, as widget 1 there"]);
    expect(outline(renamed.doc)).toEqual({ cart: "buttons(back pay) title", payment: "card" });
    doc = apply(doc, { op: "update-widget", view: "checkout", id: "title", kind: "text", text: null });
    expect(doc.views.checkout!.screens![0]!.widgets![0]).toEqual({ id: "title", kind: "text" });
    const removed = applyOperations(doc, [{ op: "remove-widget", view: "checkout", id: "actions" }]);
    expect(removed.summary).toEqual(["removed widget actions from view checkout, with 2 widgets inside it"]);
    expect(outline(removed.doc)).toEqual({ cart: "title", payment: "card" });
    const last = applyOperations(apply(doc, { op: "add-widget", view: "checkout", id: "number", kind: "input", in: "card" }), [{ op: "remove-widget", view: "checkout", id: "number" }]);
    expect(last.summary).toEqual(["removed widget number from view checkout"]);
    expect(last.doc.views.checkout!.screens![1]!.widgets).toEqual([{ id: "card", kind: "panel" }]);
  });

  it("drop a panel's empty list of widgets when it becomes a kind that holds none, so the file stays valid", () => {
    const doc = apply(base(), { op: "add-screen", view: "checkout", id: "cart" });
    doc.views.checkout!.screens![0]!.widgets = [{ id: "card", kind: "panel", widgets: [] }];
    const changed = apply(doc, { op: "update-widget", view: "checkout", id: "card", kind: "button" });
    expect(changed.views.checkout!.screens![0]!.widgets).toEqual([{ id: "card", kind: "button" }]);
    expect(parseDocument(serializeDocument(changed)).diagnostics).toEqual([]);
  });

  it("refuse what doesn't fit", () => {
    const doc = apply(
      base(),
      { op: "add-screen", view: "checkout", id: "cart" },
      { op: "add-screen", view: "checkout", id: "payment" },
      { op: "add-widget", view: "checkout", id: "actions", kind: "row", screen: "cart" },
      { op: "add-widget", view: "checkout", id: "pay", kind: "button", in: "actions" },
      { op: "add-widget", view: "checkout", id: "inner", kind: "panel", in: "actions" },
    );
    expect(fails(doc, { op: "add-screen", view: "checkout", id: "cart" })).toBe('View "checkout" already has a screen "cart".');
    expect(fails(doc, { op: "add-screen", view: "checkout", id: "Bad" })).toMatch(/isn't a valid ID/);
    expect(fails(doc, { op: "add-screen", view: "checkout", id: "x", position: 4 })).toBe('View "checkout" has 2 screens, so a new one\'s position can be 1 to 3.');
    expect(fails(doc, { op: "add-screen", view: "checkout", id: "x", device: "watch" as never })).toBe("Unknown device \"watch\". Use one of: desktop, tablet, phone.");
    expect(fails(doc, { op: "add-screen", view: "landscape", id: "x" })).toBe('View "landscape" is a landscape view. Only wireframe views have screens and widgets.');
    expect(fails(doc, { op: "update-screen", view: "checkout", id: "cart" })).toBe('Say what to change on screen "cart": newId, name, description, device, position.');
    expect(fails(doc, { op: "update-screen", view: "checkout", id: "cart", position: 3 })).toBe('View "checkout" has 2 screens, so "position" must be 1 to 2.');
    expect(fails(doc, { op: "update-screen", view: "checkout", id: "cart", name: " " })).toBe("A screen's name can't be empty.");
    expect(fails(doc, { op: "update-screen", view: "checkout", id: "cart", newId: "payment" })).toBe('View "checkout" already has a screen "payment".');
    expect(fails(doc, { op: "remove-screen", view: "checkout", id: "crat" })).toBe('View "checkout" has no screen "crat". Did you mean "cart"?');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "pay", kind: "link", screen: "cart" })).toBe('View "checkout" already has a widget "pay".');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "Bad", kind: "link", screen: "cart" })).toMatch(/isn't a valid ID/);
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "buton" as never, screen: "cart" })).toBe(
      'Unknown kind of widget "buton". Did you mean "button"? Use one of: heading, text, button, link, input, checkbox, select, image, list, table, tabs, divider, panel, row.',
    );
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link" })).toBe("Say where the widget goes: the screen it's on, or the row or panel it's in.");
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", screen: "home" })).toBe('View "checkout" has no screen "home". Its screens: cart, payment.');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", in: "pay" })).toBe('Widget "pay" is a button. Only rows and panels hold widgets.');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", in: "actons" })).toBe('View "checkout" has no widget "actons". Did you mean "actions"?');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", in: "actions", screen: "payment" })).toBe('The row "actions" is on screen "cart", not "payment".');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", screen: "cart", to: "done" })).toBe('View "checkout" has no screen "done". Its screens: cart, payment.');
    expect(fails(doc, { op: "add-widget", view: "checkout", id: "x", kind: "link", screen: "cart", position: 3 })).toBe('The screen "cart" has 1 widget, so a widget\'s position there can be 1 to 2.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "pay" })).toBe('Say what to change on widget "pay": newId, kind, text, description, to, screen, in, position.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "pay", position: 3 })).toBe('The row "actions" has 2 widgets, so "position" there must be 1 to 2.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "actions", kind: "button" })).toBe('Widget "actions" holds 2 widgets, so it can only be a row or a panel. Move them out of it, or remove them, first.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "actions", in: "actions" })).toBe('Widget "actions" can\'t go inside itself.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "actions", in: "inner" })).toBe('Widget "actions" can\'t go inside itself.');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "pay", newId: "inner" })).toBe('View "checkout" already has a widget "inner".');
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "pay", newId: "Bad" })).toMatch(/isn't a valid ID/);
    expect(fails(doc, { op: "update-widget", view: "checkout", id: "pay", to: "done" })).toBe('View "checkout" has no screen "done". Its screens: cart, payment.');
    expect(fails(base(), { op: "remove-widget", view: "checkout", id: "pay" })).toBe('View "checkout" has no widget "pay". Add one with add-widget.');
    expect(fails(doc, { op: "show-in-view", view: "checkout", id: "shop" })).toMatch(/^A wireframe view draws its screens, not elements/);
    expect(fails(doc, { op: "hide-in-view", view: "checkout", id: "shop" })).toMatch(/^A wireframe view draws its screens, not elements/);
    expect(fails(doc, { op: "update-view", id: "checkout", include: ["*"] })).toMatch(/^A wireframe view draws its screens, not elements/);
    expect(fails(doc, { op: "add-view", id: "x", level: "wireframe", include: ["shop"] })).toMatch(/^A wireframe view draws its screens, not elements/);
    expect(fails(doc, { op: "set-layout", view: "checkout", positions: {} })).toBe("A wireframe view is laid out from its screens and their widgets, so it has no box positions. Move a widget with update-widget.");
  });

  it("are checked when sent as JSON", () => {
    expect(parseOperations({ op: "update-widget", view: "v", id: "a", text: null, to: null, in: null })).toEqual([{ op: "update-widget", view: "v", id: "a", text: null, to: null, in: null }]);
    expect(() => parseOperations({ op: "add-widget", view: "v", id: "a", screen: "s" })).toThrow('add-widget needs "kind".');
    expect(() => parseOperations({ op: "add-widget", view: "v", id: "a", kind: "text", position: 0 })).toThrow('add-widget: "position" must be a number, 1 or more: 1 is the first.');
    expect(() => parseOperations({ op: "add-screen", view: "v" })).toThrow('add-screen needs "id".');
  });

  it("keep a wireframe view and its sticky notes when other elements are renamed or removed, and the view's own ID changes", () => {
    const doc = apply(checkout(), { op: "add-sticky", view: "checkout", id: "note", text: "Read left to right." });
    expect(apply(doc, { op: "rename", id: "api", to: "backend" }).views.checkout).toEqual(doc.views.checkout);
    expect(apply(doc, { op: "remove-element", id: "api" }).views.checkout).toEqual(doc.views.checkout);
    expect(apply(doc, { op: "rename", id: "checkout", to: "buying" }).views.buying).toEqual(doc.views.checkout);
  });
});
