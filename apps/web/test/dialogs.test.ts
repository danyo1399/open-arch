// @vitest-environment happy-dom
import { buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { act, createElement, useState } from "react";
import { describe, expect, it } from "vitest";
import { NewViewDialog, NotesEditor } from "../src/panels/dialogs.js";
import { button, choose, click, key, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 16,
  name: "Shop",
  elements: { customer: { kind: "person", name: "Customer" }, shop: { kind: "system", name: "Shop" } },
  views: {},
};

/** The New view dialog for this model. It keeps the views it creates. */
function dialog(model: OpenArchDocument = shop) {
  const created: { op: Operation; id: string }[] = [];
  const host = mount(createElement(NewViewDialog, { ws: buildWorkspace(model), onCreate: (op: Operation, id: string) => void created.push({ op, id }), onClose() {} }));
  const level = host.querySelector("select")!;
  const title = host.querySelector<HTMLInputElement>("input")!;
  return { host, created, level, title, create: button(host, "Create view") };
}

describe("NewViewDialog", () => {
  it("needs a title for a sequence view", async () => {
    const { created, level, title, create } = dialog();
    await choose(level, "sequence");
    expect(title.placeholder).toBe("e.g. Placing an order");
    expect(create.disabled).toBe(true);
    await key(title, "Enter");
    expect(created).toEqual([]);

    await type(title, "Placing an order");
    expect(create.disabled).toBe(false);
    await click(create);
    expect(created).toEqual([{ op: { op: "add-view", id: "placing-an-order", level: "sequence", scope: undefined, title: "Placing an order" }, id: "placing-an-order" }]);
  });

  it("gives other views the title in the box when it's left empty", async () => {
    const { created, level, title } = dialog();
    expect(title.placeholder).toBe("Shop containers");
    await choose(level, "landscape");
    expect(title.placeholder).toBe("System landscape");
    await key(title, "Enter");
    expect(created).toEqual([{ op: { op: "add-view", id: "system-landscape", level: "landscape", scope: undefined, title: "System landscape" }, id: "system-landscape" }]);
  });

  it("makes a class view of a component, named after it", async () => {
    const model: OpenArchDocument = {
      ...shop,
      elements: { ...shop.elements, api: { kind: "container", name: "API", parent: "shop" }, orders: { kind: "component", name: "Orders", parent: "api" } },
    };
    const { host, created, level, title } = dialog(model);
    await choose(level, "class");
    expect(host.textContent).toContain("Of which component");
    expect(title.placeholder).toBe("Orders classes");
    await key(title, "Enter");
    expect(created).toEqual([{ op: { op: "add-view", id: "orders-classes", level: "class", scope: "orders", title: "Orders classes" }, id: "orders-classes" }]);
  });

  it("creates nothing when the level needs a scope the model doesn't have", async () => {
    const { host, created, level, title, create } = dialog();
    await choose(level, "component");
    expect(host.textContent).toContain("There are no containers or libraries yet.");
    expect(create.disabled).toBe(true);
    await type(title, "Parts");
    expect(create.disabled).toBe(true);
    await key(title, "Enter");
    expect(created).toEqual([]);
  });
});

describe("NewViewDialog for a wireframe view", () => {
  it("makes one of a system or a container, named after it, or of nothing in particular, which needs a title", async () => {
    const model: OpenArchDocument = { ...shop, elements: { ...shop.elements, web: { kind: "container", name: "Web App", parent: "shop" } } };
    const { host, created, level, title, create } = dialog(model);
    await choose(level, "wireframe");
    expect(host.textContent).toContain("The screens of");
    const scope = host.querySelectorAll("select")[1]!;
    expect([...scope.options].map((o) => o.textContent)).toEqual(["Nothing in particular", "Shop [System]", "Web App [Container]"]);
    expect(title.placeholder).toBe("e.g. Checkout");
    expect(create.disabled).toBe(true);
    await choose(scope, "web");
    expect(title.placeholder).toBe("Web App wireframes");
    await key(title, "Enter");
    expect(created).toEqual([{ op: { op: "add-view", id: "web-app-wireframes", level: "wireframe", scope: "web", title: "Web App wireframes" }, id: "web-app-wireframes" }]);
  });
});

/**
 * The notes editor for the Orders API, starting from `text`, with the notes saved as `saved`.
 * It keeps what it saves and how often it closed; `saves` says whether a save goes through.
 */
function notesEditor(text: string, saved: string | undefined = text, saves: boolean | Promise<boolean> = true) {
  const saving: string[] = [];
  const closes: true[] = [];
  let setSaved: (saved: string | undefined) => void = () => {};
  function Editor() {
    const [now, set] = useState<string | undefined>(saved);
    setSaved = set;
    return createElement(NotesEditor, {
      name: "Orders API",
      text,
      saved: now,
      onSave: async (t: string) => (saving.push(t), saves),
      onClose: () => void closes.push(true),
    });
  }
  const host = mount(createElement(Editor));
  return {
    host,
    dialog: host.querySelector("dialog")!,
    box: host.querySelector("textarea")!,
    saving,
    closes,
    /** The notes saved now, as an edit from elsewhere, or the box's own, would leave them. */
    saved: (next: string | undefined) => act(() => setSaved(next)),
  };
}

describe("NotesEditor", () => {
  it("opens over the page, on the text from the box, named for whose notes they are", () => {
    const { host, dialog, box } = notesEditor("Takes **orders**.");
    expect(dialog.open).toBe(true);
    expect(host.querySelector("h2")!.textContent).toBe("Notes on Orders API");
    expect(box.value).toBe("Takes **orders**.");
  });

  it("saves what was written when Done is pressed, and closes", async () => {
    const { host, box, saving, closes } = notesEditor("Takes orders.");
    box.value = "Takes orders.\n\nAnd refunds them.";
    await click(button(host, "Done"));
    expect(saving).toEqual(["Takes orders.\n\nAnd refunds them."]);
    expect(closes).toHaveLength(1);
  });

  it("closes without saving when nothing changed", async () => {
    const { host, saving, closes } = notesEditor("Takes orders.");
    await click(button(host, "Done"));
    expect(saving).toEqual([]);
    expect(closes).toHaveLength(1);
  });

  it("saves on Esc and Ctrl+Enter too, so a stray key doesn't lose what was written", async () => {
    const esc = notesEditor("");
    esc.box.value = "Written.";
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => void esc.dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(esc.saving).toEqual(["Written."]);
    expect(esc.closes).toHaveLength(1);

    const enter = notesEditor("");
    enter.box.value = "Written.";
    await act(async () => void enter.box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, metaKey: true, bubbles: true })));
    expect(enter.saving).toEqual(["Written."]);
    expect(enter.closes).toHaveLength(1);
  });

  it("leaves the notes as they were on Cancel", async () => {
    const { host, box, saving, closes } = notesEditor("Takes orders.");
    box.value = "Something else.";
    await click(button(host, "Cancel"));
    expect(saving).toEqual([]);
    expect(closes).toHaveLength(1);
  });

  it("stays open with the text when a save doesn't go through, even if the dialog is closed anyway", async () => {
    const { host, dialog, box, saving, closes } = notesEditor("Takes orders.", "Takes orders.", false);
    box.value = "Takes refunds.";
    await click(button(host, "Done"));
    expect(closes).toEqual([]);
    expect(host.textContent).toContain("These notes weren't saved. They're still here: try again, or copy them to keep them.");
    expect(box.value).toBe("Takes refunds.");
    // As a browser does when Esc is pressed twice: it closes without asking the page.
    await act(async () => dialog.close());
    expect(saving).toEqual(["Takes refunds.", "Takes refunds."]);
    expect(dialog.open).toBe(true);
    expect(closes).toEqual([]);
  });

  it("says when the notes are changed elsewhere while it's open, but not when the box's own text is saved", () => {
    const { host, saved } = notesEditor("Typed in the box.", "Saved before.");
    const warning = "These notes were changed elsewhere since you opened them. Done saves yours in their place.";
    expect(host.textContent).not.toContain(warning);
    saved("Typed in the box.");
    expect(host.textContent).not.toContain(warning);
    saved("An agent's notes.");
    expect(host.textContent).toContain(warning);
  });

  it("says when what the notes are on is no longer in the model, and keeps the text rather than saving it", async () => {
    const { host, dialog, box, saving, closes, saved } = notesEditor("Takes orders.");
    saved(undefined);
    expect(host.textContent).toContain("Orders API was changed or deleted elsewhere, so these notes can't be saved. Copy them to keep them.");
    await click(button(host, "Done"));
    await act(async () => dialog.close());
    expect(saving).toEqual([]);
    expect(closes).toEqual([]);
    expect(dialog.open).toBe(true);
    expect(box.value).toBe("Takes orders.");
    await click(button(host, "Cancel"));
    expect(closes).toHaveLength(1);
  });

  it("can't be changed or closed while a save runs, so it closes on what was saved", async () => {
    let finish: (ok: boolean) => void = () => {};
    const { host, dialog, box, saving, closes } = notesEditor("Takes orders.", "Takes orders.", new Promise<boolean>((resolve) => (finish = resolve)));
    box.value = "Takes refunds.";
    await click(button(host, "Done"));
    expect(box.readOnly).toBe(true);
    expect(button(host, "Done").disabled).toBe(true);
    expect(button(host, "Cancel").disabled).toBe(true);
    // Esc, and the browser closing it, wait for the save too.
    await act(async () => void dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    await act(async () => dialog.close());
    expect(saving).toEqual(["Takes refunds."]);
    expect(dialog.open).toBe(true);
    expect(closes).toEqual([]);
    await act(async () => finish(true));
    expect(closes).toHaveLength(1);
  });
});
