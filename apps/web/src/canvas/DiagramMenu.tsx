/**
 * A diagram's right-click menus: the one for a thing on the diagram, which the click selects, and
 * the one for the diagram itself, after a click on the background. What each offers is the
 * diagram's own; how one opens, follows what it's for and closes is here, the same for every
 * kind of view. See diagramMenu.ts for how what a menu is for is followed.
 */
import type { ViewDef } from "@open-arch/core";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ContextMenu, menuPoint, type MenuItem } from "../panels/ContextMenu.js";
import type { Point } from "./autoLayout.js";
import type { Selection } from "./Canvas.js";
import { followMenu, isSelected, menuOn, menuThere, selectionFor, type MenuFor, type MenuRename } from "./diagramMenu.js";

/** What a diagram's menus need from the designer, which hears every edit as it lands. */
export interface MenuHost {
  /**
   * Tells `then` what a right-click menu is for once the edits made before have landed: `on`, as
   * those edits left it, the ID its view then has, and how many of `renames` there are by then.
   * Null when what it's for is gone by then, or was lost on the way.
   */
  afterEdits(on: MenuFor, then: (on: MenuFor | null, view: string, followed: number) => void): Promise<void>;
  /** Every change to the workspace that a menu follows, as this render's diagram reflects them, in order. */
  renames: MenuRename[];
}

/**
 * A right-click menu that's open: where it opened on the screen, that point on the diagram, and
 * what it's for, as it was when the menu opened: in the view with this ID then, after so many of
 * the changes a menu follows. It's followed through the ones after.
 */
interface OpenMenu {
  x: number;
  y: number;
  at: Point;
  on: MenuFor;
  view: string;
  followed: number;
}

interface DiagramMenuOptions {
  view: ViewDef;
  selection: Selection;
  select(selection: Selection): void;
  host: MenuHost;
  /** Where a point on the screen is on the diagram, for what a menu adds there. */
  toDiagram(point: { x: number; y: number }): Point;
  /** What the menu for this offers, in the diagram as it's drawn now. `at` is where on the diagram the menu opened. */
  items(on: MenuFor, at: Point): MenuItem[];
}

/**
 * A diagram's right-click menus. `open` opens the menu for what a right-click was on: `on` is
 * what a click there selects, or null for the background. `menu` is the open menu, to draw.
 *
 * The click selects at once, so it's clear what the menu is for, but the menu opens once the
 * edits made before have landed, as the notes editor does: text typed in the details is saved as
 * the click takes the focus from it, and can give what was clicked, or the view, a new ID. So
 * the menu is made from the diagram as those edits leave it, for what was clicked as they left
 * it, and its items name no ID or number that one of them was about to change. If what was
 * clicked is gone by then, or was lost on the way, as through an Undo, no menu opens. Whatever
 * would close an open menu calls off one that's waiting: a press, a key, the wheel, or the window
 * changing size or losing the focus. So nothing done here is queued behind the wait, for the
 * menu to open ahead of.
 *
 * An open menu is followed through the changes made since it opened, as it was to open. It
 * closes once what it's for is lost, as through an Undo or a file changed elsewhere, or gone, or
 * no longer what's selected: a menu never acts on anything but what it was opened on, and what's
 * shown as selected. The diagram's own menu is for nothing that's selected, so it stays.
 */
export function useDiagramMenu({ view, selection, select, host, toDiagram, items }: DiagramMenuOptions): { open(event: ReactMouseEvent | MouseEvent, on: Selection): void; menu: ReactNode } {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const close = useCallback(() => setMenu(null), []);
  /** Counts the menus asked for, so only the last one opens, and none once the diagram is closed. */
  const asked = useRef(0);
  useEffect(
    () => () => {
      asked.current++;
    },
    [],
  );

  const open = (event: ReactMouseEvent | MouseEvent, on: Selection) => {
    // A note's text box, while it's typed in, keeps the browser's own menu, to paste into it.
    if (event.target instanceof Element && event.target.closest("textarea")) return;
    event.preventDefault();
    // Opened with the keyboard, it goes under what it's for.
    const point = event.currentTarget instanceof Element ? menuPoint({ clientX: event.clientX, clientY: event.clientY, currentTarget: event.currentTarget }) : { x: event.clientX, y: event.clientY };
    const at = toDiagram(point);
    select(on);
    const clicked = menuOn(on);
    const mine = ++asked.current;
    if (!clicked || !menuThere(view, clicked)) return;
    const callOff = () => {
      if (asked.current === mine) asked.current++;
    };
    // As an open menu hears them: a press, a key and the wheel before anything on the page does, and the window's own resize and blur.
    const heard = [...["pointerdown", "keydown", "wheel"].map((type) => [type, true] as const), ...["resize", "blur"].map((type) => [type, false] as const)];
    for (const [type, capture] of heard) window.addEventListener(type, callOff, capture);
    void host
      .afterEdits(clicked, (target, landed, followed) => {
        if (asked.current !== mine || !target) return;
        // An edit that landed on the way may have selected something else, such as a block under
        // its new ID. What was clicked is selected again: the menu is only open while it is. That
        // edit's own select has run by now, as it follows straight on from the edit, a step before
        // the queue gets to this. One that selected a step later would close the menu instead.
        select(selectionFor(target));
        setMenu({ ...point, at, on: target, view: landed, followed });
      })
      .finally(() => {
        for (const [type, capture] of heard) window.removeEventListener(type, callOff, capture);
      });
  };

  /** What the open menu is for now, or null once it's lost, gone or no longer what's selected. */
  const shown = (): MenuItem[] => {
    if (!menu) return [];
    const { on } = followMenu(menu.on, menu.view, host.renames.slice(menu.followed));
    if (!on || !menuThere(view, on)) return [];
    if (on.kind !== "diagram" && !isSelected(on, selection)) return [];
    return items(on, menu.at);
  };
  const offered = shown();
  const gone = !!menu && offered.length === 0;
  useEffect(() => {
    if (gone) setMenu(null);
  }, [gone]);

  return { open, menu: menu && offered.length > 0 ? <ContextMenu x={menu.x} y={menu.y} items={offered} onClose={close} /> : null };
}
