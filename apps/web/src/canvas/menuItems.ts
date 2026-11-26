/**
 * The items every diagram's right-click menus share, so the same thing reads and works the same
 * on each kind of view. Each item does what it does in the toolbar or the details, which have
 * them all too, for a touch screen.
 */
import { STICKY_COLORS, type Operation, type Sticky } from "@open-arch/core";
import type { MenuAction, MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import type { Selection } from "./Canvas.js";

/** What a menu's items change the diagram with: its `edit`, and what selects. */
export interface MenuEdits {
  edit(edit: Edit): Promise<boolean>;
  select(selection: Selection): void;
}

/**
 * A menu's items, and after them the one that deletes, set apart by a line when it isn't the
 * only one. What it deleted isn't selected after: `then` is, or nothing.
 */
export function withDelete({ edit, select }: MenuEdits, items: MenuItem[], label: string, op: Operation, then: Selection = null): MenuItem[] {
  return [...items, { label, danger: true, divider: items.length > 0, onSelect: () => void edit([op]).then(() => select(then)) }];
}

/**
 * The items that move one of a numbered list up or down it, where there's room: `what` is what
 * its kind is called, as in "Move up, to flow 2". Its number is its place in the list, as the
 * docs list them.
 */
export function moveItems(what: string, number: number, count: number, move: (to: number) => void): MenuAction[] {
  return [
    ...(number > 1 ? [{ label: `Move up, to ${what} ${number - 1}`, onSelect: () => move(number - 1) }] : []),
    ...(number < count ? [{ label: `Move down, to ${what} ${number + 1}`, onSelect: () => move(number + 1) }] : []),
  ];
}

/**
 * Whether a list of arrows has none from `from` to `to` that says `text` yet, which the
 * operations that add and change flows and links refuse a second of. `but` is the arrow being
 * changed, which doesn't count. A menu only offers what can be made.
 */
export function noSuchArrow<T extends { from: string; to: string; text?: string }>(arrows: readonly T[], from: string, to: string, text?: string, but?: T): boolean {
  return !arrows.some((a) => a !== but && a.from === from && a.to === to && (a.text ?? "") === (text ?? ""));
}

/**
 * A sticky note's menu. `editText` edits its text in place, where the diagram can, and
 * `openNotes` opens its notes, where the designer can. A note that was moved can go back where
 * the designer puts it: `back` says where that is, as in "Move beside the diagram". Where it
 * does, a note that was resized can have the usual size back too. A sequence view lists its
 * notes beside it, at the usual size, so there they have no text to edit in place, no place to
 * go back to, and no size of their own.
 */
export function stickyItems(edits: MenuEdits, view: string, sticky: Sticky, { editText, openNotes, back }: { editText?: () => void; openNotes?: () => void; back?: string }): MenuItem[] {
  const set = (fields: Omit<Extract<Operation, { op: "update-sticky" }>, "op" | "view" | "id">) => () => void edits.edit([{ op: "update-sticky", view, id: sticky.id, ...fields }]);
  return withDelete(
    edits,
    [
      ...(editText ? [{ label: "Edit text", onSelect: editText }] : []),
      { label: "Colour", items: STICKY_COLORS.filter((color) => color !== sticky.color).map((color) => ({ label: color[0]!.toUpperCase() + color.slice(1), onSelect: set({ color }) })) },
      ...(openNotes ? [{ label: "Edit notes…", onSelect: openNotes }] : []),
      ...(sticky.at && back ? [{ label: back, onSelect: set({ at: null }) }] : []),
      ...(sticky.size && back ? [{ label: "Usual size", onSelect: set({ size: null }) }] : []),
    ],
    "Delete note",
    { op: "remove-sticky", view, id: sticky.id },
  );
}

/**
 * The menu of a diagram's background: what its toolbar does. `add` is what + Add adds, put where
 * the click was. `paste`, on a view of boxes, pastes what was copied there. `autoLayout` lays the
 * diagram out again, where there's something to lay out.
 */
export function diagramItems(add: MenuItem[], autoLayout: (() => void) | undefined, exportItems: MenuItem[], paste?: () => void): MenuItem[] {
  return [
    { label: "Add", items: add },
    ...(paste ? [{ label: "Paste", onSelect: paste }] : []),
    ...(autoLayout ? [{ label: "Auto layout", onSelect: autoLayout }] : []),
    ...(exportItems.length > 0 ? [{ label: "Export", items: exportItems }] : []),
  ];
}
