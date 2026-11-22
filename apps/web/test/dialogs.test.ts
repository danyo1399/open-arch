// @vitest-environment happy-dom
import { buildWorkspace, type OpenArchDocument, type Operation } from "@open-arch/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { changeTime, HistoryDialog, linkable, NewViewDialog, NotesEditor } from "../src/panels/dialogs.js";
import type { Version } from "../src/state.js";
import { button, choose, click, key, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 20,
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

/** Whether the keys for shortcuts are ⌘ rather than Ctrl, as ProseMirror decides. */
const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);

/**
 * The notes editor for the Orders API, starting from `text`, with the notes saved as `saved`.
 * It keeps what it saves and how often it closed; `saves` says whether a save goes through.
 * It's shown as markdown, in its text box, unless `formatted`, once that has loaded.
 */
async function notesEditor(text: string, saved: string | undefined = text, saves: boolean | Promise<boolean> = true, formatted = false) {
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
  await loaded(host);
  if (!formatted) await click(button(host, "Markdown"));
  return {
    host,
    dialog: host.querySelector("dialog")!,
    box: host.querySelector("textarea")!,
    /** The formatted notes. */
    notes: () => host.querySelector<HTMLElement>(".notes-formatted .ProseMirror")!,
    saving,
    closes,
    /** The notes saved now, as an edit from elsewhere, or the box's own, would leave them. */
    saved: (next: string | undefined) => act(() => setSaved(next)),
  };
}

/** Waits for the formatted notes to load. */
async function loaded(host: HTMLElement) {
  await act(() => vi.waitFor(() => expect(host.querySelector(".notes-formatted .ProseMirror")).not.toBeNull()));
}

/** Selects all of the formatted notes, as Ctrl+A (⌘A on a Mac) does. */
async function selectAll(notes: HTMLElement) {
  await act(async () => void notes.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })));
}

describe("linkable", () => {
  it("is web, mail, phone and FTP addresses, and ones relative to the page, but not other schemes", () => {
    for (const href of ["https://example.com", "HTTP://example.com", "mailto:a@example.com", "tel:+441234", "ftp://example.com/f", "docs/setup.md", "#top", "?q=1", "/root", ""]) expect(linkable(href)).toBe(true);
    for (const href of ["javascript:alert(1)", "JavaScript:alert(1)", " java\tscript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd"]) expect(linkable(href)).toBe(false);
  });
});

describe("NotesEditor", () => {
  it("opens over the page, on the text from the box, named for whose notes they are", async () => {
    const { host, dialog, box } = await notesEditor("Takes **orders**.");
    expect(dialog.open).toBe(true);
    expect(host.querySelector("h2")!.textContent).toBe("Notes on Orders API");
    expect(box.value).toBe("Takes **orders**.");
  });

  it("shows the notes formatted first, as they read, and as markdown after the switch, and back, as they are now", async () => {
    const { host, notes, saving, closes } = await notesEditor("## Refunds\n\nTakes **orders**.\n\n- One", undefined, true, true);
    expect(button(host, "Formatted").getAttribute("aria-pressed")).toBe("true");
    expect(notes().querySelector("h2")!.textContent).toBe("Refunds");
    expect(notes().querySelector("strong")!.textContent).toBe("orders");
    expect(notes().querySelector("li")!.textContent).toBe("One");
    expect(host.querySelector("textarea")).toBeNull();

    await click(button(host, "Markdown"));
    const box = host.querySelector("textarea")!;
    expect(box.value).toBe("## Refunds\n\nTakes **orders**.\n\n- One");
    expect(host.querySelector(".notes-toolbar")).toBeNull();
    box.value = "Takes *refunds*.";
    await click(button(host, "Formatted"));
    await loaded(host);
    expect(notes().querySelector("em")!.textContent).toBe("refunds");
    await click(button(host, "Done"));
    expect(saving).toEqual(["Takes *refunds*."]);
    expect(closes).toHaveLength(1);
  });

  it("fills its box with the formatted notes, so a click below the last line stays in them", async () => {
    // This page has no layout, so it reads the stylesheet. From the text up to the box with the
    // border, each box grows to fill the one it's in. A height of 100% wouldn't: the boxes in
    // between have no height of their own, so a click below the last line would leave the notes.
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    document.head.append(style);
    try {
      const { notes } = await notesEditor("Takes orders.", undefined, true, true);
      let inner: HTMLElement = notes();
      while (!inner.classList.contains("notes-formatted")) {
        const outer = inner.parentElement!;
        expect(getComputedStyle(outer)).toMatchObject({ display: "flex", flexDirection: "column" });
        expect(getComputedStyle(inner).flexGrow).toBe("1");
        inner = outer;
      }
    } finally {
      style.remove();
    }
  });

  it("saves notes changed in the formatted view as markdown, and keeps the text as it was when they aren't", async () => {
    const same = await notesEditor("+ Plus bullets\n\n| a |\n|---|\n| 1 |", "", true, true);
    await click(button(same.host, "Done"));
    // Saved as they were opened, not as the formatted view would write them.
    expect(same.saving).toEqual(["+ Plus bullets\n\n| a |\n|---|\n| 1 |"]);

    const { host, notes, saving } = await notesEditor("Takes orders.", undefined, true, true);
    await selectAll(notes());
    await click(host.querySelector('.notes-toolbar button[aria-label^="Bold"]')!);
    expect(button(host.querySelector(".notes-toolbar")!, "B").getAttribute("aria-pressed")).toBe("true");
    expect(notes().querySelector("strong")!.textContent).toBe("Takes orders.");
    await act(async () => void notes().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true })));
    expect(saving).toEqual(["**Takes orders.**"]);
  });

  it("saves on Esc and Ctrl+Enter in the formatted view too, which the editor would keep for itself", async () => {
    for (const press of [{ key: "Escape" }, { key: "Enter", ctrlKey: !mac, metaKey: mac }]) {
      const { host, notes, saving, closes } = await notesEditor("Takes orders.", "", true, true);
      const event = new KeyboardEvent("keydown", { ...press, bubbles: true, cancelable: true });
      await act(async () => void notes().dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(saving).toEqual(["Takes orders."]);
      expect(closes).toHaveLength(1);
      host.remove();
    }
  });

  it("links the text selected to the address typed, and takes the link off", async () => {
    const { host, notes, saving } = await notesEditor("See the docs.", undefined, true, true);
    await selectAll(notes());
    await click(button(host, "Link"));
    const address = host.querySelector<HTMLInputElement>('input[aria-label="Link address"]')!;
    expect(button(host, "Add link").disabled).toBe(true);
    await type(address, "https://example.com/docs");
    await click(button(host, "Add link"));
    expect(host.querySelector('input[aria-label="Link address"]')).toBeNull();
    expect(notes().querySelector("a")!.getAttribute("href")).toBe("https://example.com/docs");

    // In the link, the button offers to change it or take it off; Esc puts it away and leaves the editor open.
    await click(button(host, "Link"));
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Link address"]')!.value).toBe("https://example.com/docs");
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => void host.querySelector('input[aria-label="Link address"]')!.dispatchEvent(esc));
    expect(esc.defaultPrevented).toBe(true);
    expect(host.querySelector('input[aria-label="Link address"]')).toBeNull();
    await click(button(host, "Link"));
    await click(button(host, "Remove link"));
    expect(notes().querySelector("a")).toBeNull();
    await click(button(host, "Done"));
    expect(saving).toEqual([]);
  });

  it("links only to addresses the notes can link to", async () => {
    const { host, notes, saving } = await notesEditor("See the docs.", undefined, true, true);
    await selectAll(notes());
    await click(button(host, "Link"));
    const address = host.querySelector<HTMLInputElement>('input[aria-label="Link address"]')!;
    await type(address, "javascript:alert(1)");
    expect(button(host, "Add link").disabled).toBe(true);
    expect(host.textContent).toContain("A link goes to a web, email, phone or FTP address, or to a path like docs/setup.md.");
    // Enter doesn't add it either.
    await act(async () => void address.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(notes().querySelector("a")).toBeNull();
    await type(address, "docs/setup.md");
    expect(host.textContent).not.toContain("A link goes to");
    await click(button(host, "Add link"));
    await click(button(host, "Done"));
    expect(saving).toEqual(["[See the docs.](docs/setup.md)"]);
  });

  it("can't make code a link", async () => {
    // The cursor starts at the top, here in a code block.
    const block = await notesEditor("```\nlet x\n```", undefined, true, true);
    expect(button(block.host, "Link").disabled).toBe(true);
    block.host.remove();

    const { host, notes } = await notesEditor("Plain words.", undefined, true, true);
    await selectAll(notes());
    expect(button(host, "Link").disabled).toBe(false);
    // With the box for an address open, making the text code puts it away.
    await click(button(host, "Link"));
    expect(host.querySelector('input[aria-label="Link address"]')).not.toBeNull();
    await click(host.querySelector('.notes-toolbar button[aria-label^="Code, in"]')!);
    expect(button(host, "Link").disabled).toBe(true);
    expect(host.querySelector('input[aria-label="Link address"]')).toBeNull();
  });

  it("saves what was written when Done is pressed, and closes", async () => {
    const { host, box, saving, closes } = await notesEditor("Takes orders.");
    box.value = "Takes orders.\n\nAnd refunds them.";
    await click(button(host, "Done"));
    expect(saving).toEqual(["Takes orders.\n\nAnd refunds them."]);
    expect(closes).toHaveLength(1);
  });

  it("closes without saving when nothing changed", async () => {
    const { host, saving, closes } = await notesEditor("Takes orders.");
    await click(button(host, "Done"));
    expect(saving).toEqual([]);
    expect(closes).toHaveLength(1);
  });

  it("saves on Esc and Ctrl+Enter too, so a stray key doesn't lose what was written", async () => {
    const esc = await notesEditor("");
    esc.box.value = "Written.";
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => void esc.dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(esc.saving).toEqual(["Written."]);
    expect(esc.closes).toHaveLength(1);

    const enter = await notesEditor("");
    enter.box.value = "Written.";
    await act(async () => void enter.box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, metaKey: true, bubbles: true })));
    expect(enter.saving).toEqual(["Written."]);
    expect(enter.closes).toHaveLength(1);
  });

  it("leaves the notes as they were on Cancel", async () => {
    const { host, box, saving, closes } = await notesEditor("Takes orders.");
    box.value = "Something else.";
    await click(button(host, "Cancel"));
    expect(saving).toEqual([]);
    expect(closes).toHaveLength(1);
  });

  it("stays open with the text when a save doesn't go through, even if the dialog is closed anyway", async () => {
    const { host, dialog, box, saving, closes } = await notesEditor("Takes orders.", "Takes orders.", false);
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

  it("says when the notes are changed elsewhere while it's open, but not when the box's own text is saved", async () => {
    const { host, saved } = await notesEditor("Typed in the box.", "Saved before.");
    const warning = "These notes were changed elsewhere since you opened them. Done saves yours in their place.";
    expect(host.textContent).not.toContain(warning);
    saved("Typed in the box.");
    expect(host.textContent).not.toContain(warning);
    saved("An agent's notes.");
    expect(host.textContent).toContain(warning);
  });

  it("says when what the notes are on is no longer in the model, and keeps the text rather than saving it", async () => {
    const { host, dialog, box, saving, closes, saved } = await notesEditor("Takes orders.");
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
    const { host, dialog, box, saving, closes } = await notesEditor("Takes orders.", "Takes orders.", new Promise<boolean>((resolve) => (finish = resolve)));
    box.value = "Takes refunds.";
    await click(button(host, "Done"));
    expect(box.readOnly).toBe(true);
    expect(button(host, "Done").disabled).toBe(true);
    expect(button(host, "Cancel").disabled).toBe(true);
    expect(button(host, "Formatted").disabled).toBe(true);
    // Esc, and the browser closing it, wait for the save too.
    await act(async () => void dialog.dispatchEvent(new Event("cancel", { cancelable: true })));
    await act(async () => dialog.close());
    expect(saving).toEqual(["Takes refunds."]);
    expect(dialog.open).toBe(true);
    expect(closes).toEqual([]);
    await act(async () => finish(true));
    expect(closes).toHaveLength(1);
  });

  it("can't be changed in the formatted view while a save runs", async () => {
    let finish: (ok: boolean) => void = () => {};
    const { host, notes, closes } = await notesEditor("Takes orders.", "", new Promise<boolean>((resolve) => (finish = resolve)), true);
    expect(notes().getAttribute("contenteditable")).toBe("true");
    await click(button(host, "Done"));
    expect(notes().getAttribute("contenteditable")).toBe("false");
    expect([...host.querySelectorAll<HTMLButtonElement>(".notes-toolbar button")].every((b) => b.disabled)).toBe(true);
    expect(button(host, "Markdown").disabled).toBe(true);
    await act(async () => finish(true));
    expect(closes).toHaveLength(1);
  });
});

describe("HistoryDialog", () => {
  const noon = new Date(2026, 0, 5, 12, 0).getTime();
  const versions: Version[] = [
    { number: 4, change: null, at: null },
    { number: 5, change: "Added system shop", at: noon },
    { number: 6, change: "Updated shop", at: noon + 60_000 },
    { number: 9, change: "Removed shop", at: noon + 120_000 },
  ];
  /** The dialog on these versions, showing the one numbered `current`. It keeps the versions picked. */
  function history(list: Version[], current: number) {
    const picked: number[] = [];
    /** What goes wrong with the next pick, if anything does. */
    const next: { problem: string | null } = { problem: null };
    const onGo = async (version: number) => {
      picked.push(version);
      return next.problem;
    };
    const host = mount(createElement(HistoryDialog, { versions: list, current, onGo, onClose() {} }));
    return { host, picked, next, rows: [...host.querySelectorAll<HTMLButtonElement>(".history button")] };
  }

  it("lists the changes newest first, with when each was made, and marks the one showing now and the ones undone", () => {
    const { host, rows } = history(versions, 6);
    expect(rows.map((r) => [...r.children].map((c) => c.textContent))).toEqual([
      ["Removed shop", "Undone", changeTime(noon + 120_000)],
      ["Updated shop", "Now", changeTime(noon + 60_000)],
      ["Added system shop", changeTime(noon)],
      ["Before these changes"],
    ]);
    expect(rows.map((r) => r.querySelector("time")?.dateTime)).toEqual([new Date(noon + 120_000).toISOString(), new Date(noon + 60_000).toISOString(), new Date(noon).toISOString(), undefined]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(rows.map((r) => r.className)).toEqual(["row undone", "row active", "row", "row"]);
    expect(rows.map((r) => r.getAttribute("aria-current"))).toEqual(["false", "true", "false", "false"]);
    expect(host.textContent).toContain("It isn't saved in the file, exported or shared.");
  });

  it("opens on the version showing now", () => {
    const { rows } = history(versions, 5);
    expect(document.activeElement).toBe(rows[2]);
  });

  it("goes to the version picked: an earlier one, the one before every change, or one that was undone", async () => {
    const { rows, picked } = history(versions, 6);
    await click(rows[2]!);
    await click(rows[3]!);
    await click(rows[0]!);
    expect(picked).toEqual([5, 4, 9]);
  });

  it("says so when no changes have been made since the workspace was opened or reloaded", () => {
    const { host, rows } = history([{ number: 0, change: null, at: null }], 0);
    expect(rows).toEqual([]);
    expect(host.textContent).toContain("No changes since the workspace was opened, or reloaded.");
  });

  it("says when a change was made: the time of day, after the day when that wasn't today", () => {
    const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    expect(changeTime(noon, noon + 3_600_000)).toBe(new Date(noon).toLocaleTimeString([], options));
    // A workspace left open overnight: yesterday's noon isn't taken for today's.
    const nextDay = noon + 24 * 3_600_000;
    expect(changeTime(noon, nextDay)).toBe(new Date(noon).toLocaleString([], { month: "short", day: "numeric", ...options }));
    expect(changeTime(noon, nextDay)).not.toBe(changeTime(nextDay, nextDay));
  });

  it("says what went wrong with a pick in the dialog, where the designer's own message is under it, until a pick goes through", async () => {
    const { host, rows, next } = history(versions, 6);
    const alert = () => host.querySelector('dialog [role="alert"]');
    expect(alert()).toBeNull();
    next.problem = "Couldn't save: The folder is gone.";
    await click(rows[2]!);
    expect(alert()!.textContent).toBe("Couldn't save: The folder is gone.");
    // The list is as it was.
    expect(rows.map((r) => r.className)).toEqual(["row undone", "row active", "row", "row"]);
    next.problem = null;
    await click(rows[2]!);
    expect(alert()).toBeNull();
  });

  it("shows all of a long change, on as many lines as it needs, with when it was made on one", () => {
    // This page has no layout, so it reads the stylesheet. Other rows cut their text short on one
    // line, which would leave two long changes that differ at the end looking the same.
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    document.head.append(style);
    try {
      const { rows } = history([...versions, { number: 10, change: "Added transition 3 to view order-states-of-the-checkout: placed -> paid", at: noon }], 10);
      const [label, , time] = [...rows[0]!.children];
      expect(getComputedStyle(label!)).toMatchObject({ whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" });
      expect(getComputedStyle(time!).whiteSpace).toBe("nowrap");
    } finally {
      style.remove();
    }
  });
});
