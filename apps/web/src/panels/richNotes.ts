/**
 * The notes editor's formatted view: markdown edited as it reads, with headings, lists, links,
 * tables and code drawn as they are, by Milkdown. Notes stay markdown: what's written here is
 * saved as markdown, and markdown typed here, like "## " or "- ", turns into what it stands for.
 *
 * It's a module of its own, loaded the first time the editor shows it, so the designer doesn't
 * load it until then.
 */
import { Editor, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx, type CmdKey } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { lift } from "@milkdown/kit/prose/commands";
import type { MarkType, Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose, $view, callCommand } from "@milkdown/kit/utils";
import "@milkdown/kit/prose/view/style/prosemirror.css";

/** What the toolbar's buttons do: marks on the text selected, and what the line it's on is. */
export type Format = "bold" | "italic" | "strike" | "code" | "h1" | "h2" | "h3" | "bullets" | "numbers" | "quote" | "codeBlock";

export interface RichNotes {
  readonly view: EditorView;
  /** The notes as markdown. Until they're changed, that's the text it was made from, exactly as it was. */
  markdown(): string;
  /** The formats the selection has. */
  formats(): Set<Format>;
  /** Turns a format on, or off where the selection has it. */
  format(format: Format): void;
  /** The address of the link the selection is in, if it's in one. */
  linkHere(): string | null;
  /**
   * Links the text selected to `href`, or else the link the cursor is in, or else adds `href` as
   * a link at the cursor. Null takes off the link the cursor is in, and any in the text selected.
   */
  link(href: string | null): void;
  /** Whether the notes can be changed: not while they're being saved. */
  setEditable(editable: boolean): void;
  destroy(): Promise<void>;
}

interface Options {
  /** Shown while there are no notes. */
  placeholder: string;
  /** After each change to the notes or the selection, for the toolbar. */
  onChange(): void;
}

/** A shown picture would load from wherever its address points, a tracker's too, so it's drawn as its name. The docs show it. */
const pictureView = $view(imageSchema.node, () => (node) => {
  const dom = document.createElement("span");
  dom.className = "notes-picture";
  dom.contentEditable = "false";
  dom.textContent = `Picture: ${node.attrs.alt || node.attrs.src}`;
  dom.title = `${node.attrs.src}\nPictures aren't loaded here. The docs show them.`;
  return { dom };
});

/** The bullet a markdown text's lists use, so lists written with "*" keep it; "-" for one without lists. */
function bulletOf(text: string): "-" | "*" | "+" {
  return (/^[ \t]{0,3}([-*+])[ \t]/m.exec(text)?.[1] as "-" | "*" | "+" | undefined) ?? "-";
}

/** Whether the selection has this mark: all of it, or where the cursor is, what's typed next. */
function hasMark(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  return empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
}

/** The link the cursor is in, or else the first one in the text selected: where it starts and ends, and its address. */
function linkAround(state: EditorState): { from: number; to: number; href: string } | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { from, to } = state.selection;
  const cursor = state.doc.resolve(from);
  let at: number | null = null;
  let mark = type.isInSet(cursor.marks()) ?? (cursor.nodeAfter ? type.isInSet(cursor.nodeAfter.marks) : undefined);
  if (mark) at = from;
  else {
    state.doc.nodesBetween(from, to, (node, pos) => {
      const link = at === null && node.isText ? type.isInSet(node.marks) : undefined;
      if (link) [at, mark] = [Math.max(pos, from), link];
    });
  }
  if (at === null || !mark) return null;
  // The runs of text in the line with this link; the one round where it was found is the link.
  const $at = state.doc.resolve(at);
  const runs: { from: number; to: number }[] = [];
  let pos = $at.start();
  $at.parent.forEach((child: ProseNode) => {
    const last = runs[runs.length - 1];
    if (mark!.isInSet(child.marks)) {
      if (last?.to === pos) last.to = pos + child.nodeSize;
      else runs.push({ from: pos, to: pos + child.nodeSize });
    }
    pos += child.nodeSize;
  });
  const run = runs.find((r) => at! >= r.from && at! <= r.to);
  return run ? { ...run, href: String(mark.attrs.href ?? "") } : null;
}

/** Puts the editor in `root`, holding `text`. */
export async function richNotes(root: HTMLElement, text: string, { placeholder, onChange }: Options): Promise<RichNotes> {
  let editable = true;
  // Says when the notes or the selection change, and shows the placeholder while there are no notes.
  const watch = $prose(
    () =>
      new Plugin({
        view: () => ({ update: () => onChange() }),
        props: {
          editable: () => editable,
          // A link is text to edit here, not a way to leave the designer: a click doesn't follow it.
          handleDOMEvents: {
            click: (_view, e) => void ((e.target as Element).closest?.("a") && e.preventDefault()),
            auxclick: (_view, e) => void ((e.target as Element).closest?.("a") && e.preventDefault()),
          },
          decorations: (state) => {
            const only = state.doc.childCount === 1 ? state.doc.firstChild : null;
            if (!only || !only.isTextblock || only.content.size > 0) return null;
            return DecorationSet.create(state.doc, [Decoration.node(0, only.nodeSize, { class: "notes-empty", "data-placeholder": placeholder })]);
          },
        },
      }),
  );
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, text);
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: bulletOf(text) }));
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(pictureView)
    .use(watch)
    .create();
  const view = editor.ctx.get(editorViewCtx);
  const serialize = () => editor.ctx.get(serializerCtx)(view.state.doc).replace(/\n+$/, "");
  // Milkdown writes markdown its own way: a table's rulers, say, or a list's numbers. So the text
  // it was made from is kept, and what it writes is only used once the notes are changed.
  const unchanged = serialize();
  const run = (command: { key: CmdKey<any> }, payload?: unknown) => editor.action(callCommand(command.key, payload));

  const formats = () => {
    const { state } = view;
    const { schema, selection } = state;
    const out = new Set<Format>();
    if (hasMark(state, schema.marks.strong)) out.add("bold");
    if (hasMark(state, schema.marks.emphasis)) out.add("italic");
    if (hasMark(state, schema.marks.strike_through)) out.add("strike");
    if (hasMark(state, schema.marks.inlineCode)) out.add("code");
    const { $from } = selection;
    const line = $from.parent;
    if (line.type.name === "heading" && [1, 2, 3].includes(line.attrs.level as number)) out.add(`h${line.attrs.level as 1 | 2 | 3}`);
    if (line.type.name === "code_block") out.add("codeBlock");
    // The list closest round the cursor is the one its button takes it out of.
    for (let depth = $from.depth; depth > 0; depth--) {
      const name = $from.node(depth).type.name;
      if (name === "blockquote") out.add("quote");
      if ((name === "bullet_list" || name === "ordered_list") && !out.has("bullets") && !out.has("numbers")) out.add(name === "bullet_list" ? "bullets" : "numbers");
    }
    return out;
  };

  return {
    view,
    markdown: () => {
      const now = serialize();
      return now === unchanged ? text : now;
    },
    formats,
    format: (format) => {
      const on = formats().has(format);
      if (format === "bold") run(toggleStrongCommand);
      else if (format === "italic") run(toggleEmphasisCommand);
      else if (format === "strike") run(toggleStrikethroughCommand);
      else if (format === "code") run(toggleInlineCodeCommand);
      else if (format === "h1" || format === "h2" || format === "h3") {
        if (on) run(turnIntoTextCommand);
        else run(wrapInHeadingCommand, Number(format[1]));
      } else if (format === "bullets" || format === "numbers") {
        // In the other kind of list, it's taken out of that one first.
        if (formats().has(format === "bullets" ? "numbers" : "bullets")) run(liftListItemCommand);
        if (on) run(liftListItemCommand);
        else run(format === "bullets" ? wrapInBulletListCommand : wrapInOrderedListCommand);
      } else if (format === "quote") {
        if (on) lift(view.state, view.dispatch);
        else run(wrapInBlockquoteCommand);
      } else if (format === "codeBlock") {
        if (on) run(turnIntoTextCommand);
        else run(createCodeBlockCommand);
      }
      view.focus();
    },
    linkHere: () => linkAround(view.state)?.href ?? null,
    link: (href) => {
      const { state } = view;
      const type = state.schema.marks.link!;
      const around = linkAround(state);
      const { from, to, empty } = state.selection;
      const tr = state.tr;
      if (href === null) {
        if (around) tr.removeMark(around.from, around.to, type);
        if (!empty) tr.removeMark(from, to, type);
      } else if (!empty) tr.removeMark(from, to, type).addMark(from, to, type.create({ href }));
      else if (around) tr.removeMark(around.from, around.to, type).addMark(around.from, around.to, type.create({ href }));
      else tr.insert(from, state.schema.text(href, [type.create({ href })]));
      if (tr.docChanged) view.dispatch(tr);
      view.focus();
    },
    setEditable: (on) => {
      editable = on;
      view.setProps({});
    },
    destroy: async () => {
      await editor.destroy();
    },
  };
}
