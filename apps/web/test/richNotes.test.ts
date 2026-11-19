// @vitest-environment happy-dom
import { TextSelection } from "@milkdown/kit/prose/state";
import { afterEach, describe, expect, it } from "vitest";
import { richNotes, type RichNotes } from "../src/panels/richNotes.js";

const open: { editor: RichNotes; root: HTMLElement }[] = [];
afterEach(async () => {
  for (const { editor, root } of open.splice(0)) {
    await editor.destroy();
    root.remove();
  }
});

/** The formatted editor, holding `text`, with how many times it said something changed. */
async function editor(text: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const seen = { changes: 0 };
  const made = await richNotes(root, text, { placeholder: "Write here", onChange: () => seen.changes++ });
  open.push({ editor: made, root });
  return { editor: made, root, seen };
}

/** Selects the text from `from` to `to`, as positions in the document. */
function select(e: RichNotes, from: number, to = from) {
  const { view } = e;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
}

/** Selects the first place this text is, in the document. */
function selectText(e: RichNotes, text: string) {
  let at = -1;
  e.view.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(text)) at = pos + node.text!.indexOf(text);
  });
  if (at < 0) throw new Error(`No "${text}" in the notes.`);
  select(e, at, at + text.length);
}

describe("the notes editor's formatted view", () => {
  it("draws the markdown as it reads", async () => {
    const { root } = await editor("## Refunds\n\nGives **refunds** and `codes`.\n\n- One\n- Two\n\n> Quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nlet x\n```");
    expect(root.querySelector("h2")?.textContent).toBe("Refunds");
    expect(root.querySelector("strong")?.textContent).toBe("refunds");
    expect(root.querySelector("code")?.textContent).toBe("codes");
    expect([...root.querySelectorAll("ul li")].map((li) => li.textContent)).toEqual(["One", "Two"]);
    expect(root.querySelector("blockquote")?.textContent).toBe("Quoted");
    expect([...root.querySelectorAll("table td")].map((td) => td.textContent)).toEqual(["1", "2"]);
    expect(root.querySelector("pre")?.textContent).toContain("let x");
  });

  it("gives back the text it was given, exactly, until the notes are changed", async () => {
    const text = "+ Plus\n+ Bullets\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSetext\n======";
    const { editor: e } = await editor(text);
    expect(e.markdown()).toBe(text);
    // Changed and changed back, they're as they were.
    selectText(e, "Plus");
    e.format("bold");
    expect(e.markdown()).toContain("**Plus**");
    e.format("bold");
    expect(e.markdown()).toBe(text);
  });

  it("turns formats on and off, and says which the selection has", async () => {
    const { editor: e, seen } = await editor("Takes orders.");
    const before = seen.changes;
    selectText(e, "orders");
    expect(e.formats()).toEqual(new Set());
    e.format("bold");
    e.format("italic");
    expect(e.formats()).toEqual(new Set(["bold", "italic"]));
    expect(seen.changes).toBeGreaterThan(before);
    expect(e.markdown()).toBe("Takes ***orders***.");
    // Code is only code: it takes off the other formats.
    e.format("code");
    expect(e.formats()).toEqual(new Set(["code"]));
    expect(e.markdown()).toBe("Takes `orders`.");
  });

  it("makes a line a heading, a list item, a quote or code, and back", async () => {
    const { editor: e } = await editor("Takes orders.");
    select(e, 2);
    e.format("h2");
    expect(e.formats().has("h2")).toBe(true);
    expect(e.markdown()).toBe("## Takes orders.");
    e.format("h2");
    expect(e.markdown()).toBe("Takes orders.");
    e.format("bullets");
    expect(e.formats().has("bullets")).toBe(true);
    expect(e.markdown()).toBe("- Takes orders.");
    // A bulleted line made a numbered one leaves the bullets.
    e.format("numbers");
    expect([...e.formats()].filter((f) => f === "bullets" || f === "numbers")).toEqual(["numbers"]);
    expect(e.markdown()).toBe("1. Takes orders.");
    e.format("numbers");
    expect(e.markdown()).toBe("Takes orders.");
    e.format("quote");
    expect(e.markdown()).toBe("> Takes orders.");
    e.format("quote");
    expect(e.markdown()).toBe("Takes orders.");
    e.format("codeBlock");
    expect(e.formats().has("codeBlock")).toBe(true);
    expect(e.markdown()).toBe("```\nTakes orders.\n```");
  });

  it("keeps the bullet a text's lists use", async () => {
    const { editor: e } = await editor("* One\n\nBetween\n\nTwo");
    selectText(e, "Two");
    e.format("bullets");
    expect(e.markdown()).toBe("* One\n\nBetween\n\n* Two");
  });

  it("links the text selected, changes the link the cursor is in, and takes it off", async () => {
    const { editor: e } = await editor("See the docs.");
    selectText(e, "the docs");
    e.link("https://example.com/docs");
    expect(e.markdown()).toBe("See [the docs](https://example.com/docs).");
    selectText(e, "docs");
    select(e, e.view.state.selection.from);
    expect(e.linkHere()).toBe("https://example.com/docs");
    e.link("https://example.com/new");
    expect(e.markdown()).toBe("See [the docs](https://example.com/new).");
    e.link(null);
    expect(e.markdown()).toBe("See the docs.");
    expect(e.linkHere()).toBeNull();
    // With nothing selected, the address goes in as a link.
    select(e, 1);
    e.link("https://example.com");
    expect(e.markdown()).toBe("<https://example.com>See the docs.");
  });

  it("shows raw HTML as text, gives a link of another kind no address, and doesn't load pictures", async () => {
    const { root, editor: e } = await editor('Hi <img src="x" onerror="alert(1)">\n\n[Run](javascript:alert(1)) and [web](https://example.com)\n\n![Logo](https://tracker.example/pixel.png)');
    expect(root.querySelector("img:not(.ProseMirror-separator)")).toBeNull();
    expect(root.textContent).toContain('<img src="x" onerror="alert(1)">');
    expect([...root.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Run", ""],
      ["web", "https://example.com"],
    ]);
    expect(root.querySelector(".notes-picture")?.textContent).toBe("Picture: Logo");
    // What they are is kept, for the docs.
    expect(e.markdown()).toContain("![Logo](https://tracker.example/pixel.png)");
  });

  it("shows the placeholder only while there are no notes, and can't be changed while it isn't editable", async () => {
    const { root, editor: e } = await editor("");
    expect(root.querySelector(".notes-empty")?.getAttribute("data-placeholder")).toBe("Write here");
    e.view.dispatch(e.view.state.tr.insertText("Now some."));
    expect(root.querySelector(".notes-empty")).toBeNull();
    expect(e.markdown()).toBe("Now some.");
    e.setEditable(false);
    expect(root.querySelector(".ProseMirror")!.getAttribute("contenteditable")).toBe("false");
    e.setEditable(true);
    expect(root.querySelector(".ProseMirror")!.getAttribute("contenteditable")).toBe("true");
  });
});
