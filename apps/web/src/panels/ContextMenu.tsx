import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

interface MenuEntry {
  label: string;
  /** Starts a group: a line above it sets it apart from the items before. */
  divider?: boolean;
}

/** An item that does something. */
export interface MenuAction extends MenuEntry {
  /** Deletes something, so it's shown in red. */
  danger?: boolean;
  onSelect(): void;
}

/** An item that opens a submenu beside it. */
export interface Submenu extends MenuEntry {
  items: MenuItem[];
}

export type MenuItem = MenuAction | Submenu;

/** Where to open a menu for a right-click, or under the element when the keyboard opened it (it reports 0, 0). */
export function menuPoint(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

/** How close a menu comes to the edge of the screen. */
const MARGIN = 4;
/** A list's padding and border: a submenu this far above its item has its first item level with it. */
const INSET = 5;
/** How far a submenu overlaps the list it opens from. */
const OVERLAP = 2;

interface Size {
  width: number;
  height: number;
}

/** How much of each edge of the screen a phone keeps for itself: the notch, the status bar, the home indicator. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The screen's safe-area insets, from the --safe-* properties in styles.css. None where the browser has none. */
function safeArea(): Insets {
  const style = getComputedStyle(document.documentElement);
  const inset = (side: keyof Insets) => parseFloat(style.getPropertyValue(`--safe-${side}`)) || 0;
  return { top: inset("top"), right: inset("right"), bottom: inset("bottom"), left: inset("left") };
}

/**
 * Where a menu's list of this size goes on a screen this size: at x, y if it fits there. A
 * submenu that would run off the right goes on the other side of its list instead, with its
 * right edge at `before`. Whatever still doesn't fit is moved onto the screen, clear of the
 * parts a phone keeps for itself.
 */
export function placeMenu(at: { x: number; y: number; before?: number }, size: Size, screen: Size, insets: Insets = NO_INSETS): { x: number; y: number } {
  const fit = (start: number, length: number, from: number, to: number) => Math.max(from + MARGIN, Math.min(start, to - length - MARGIN));
  const right = screen.width - insets.right;
  const x = at.before !== undefined && at.x + size.width > right - MARGIN ? at.before - size.width : at.x;
  return { x: fit(x, size.width, insets.left, right), y: fit(at.y, size.height, insets.top, screen.height - insets.bottom) };
}

/**
 * A menu at a point on the screen, as a right-click opens. A click elsewhere, Escape, scrolling or
 * resizing closes it. A note is a line of text above the items. A press on the anchor, the button
 * that opened it, is left to that button, so it can close the menu rather than open it again.
 */
export function ContextMenu({
  x,
  y,
  items,
  note,
  anchor,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  note?: string;
  anchor?: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outside = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && (ref.current?.contains(target) || anchor?.current?.contains(target))) return;
      onClose();
    };
    // Capture, so the canvas can't swallow the click before it closes the menu.
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, anchor]);

  /** Closing with the keyboard or an item puts focus back on the anchor, not the page, where Backspace deletes the selection. */
  const close = () => {
    anchor?.current?.focus();
    onClose();
  };

  return (
    // The menu's list and any submenu open beside it.
    <div ref={ref} className="context-menu-lists">
      <MenuList x={x} y={y} items={items} note={note} focus onClose={close} />
    </div>
  );
}

/** A submenu that's open: which item it's for, where it goes, and whether it takes the focus. */
interface OpenSubmenu {
  index: number;
  x: number;
  y: number;
  before: number;
  focus: boolean;
}

/**
 * One list of a menu: the menu itself, or a submenu beside it. A submenu opens when the mouse
 * is over its item or it's clicked, and → or Enter open it with the focus in it. ← and Escape
 * close it again.
 */
function MenuList({
  id,
  x,
  y,
  before,
  items,
  note,
  label,
  focus,
  onClose,
  onBack,
}: {
  id?: string;
  x: number;
  y: number;
  /** For a submenu, where its right edge goes if there's no room on the right of its list. */
  before?: number;
  items: MenuItem[];
  note?: string;
  label?: string;
  /** Whether its first item takes the focus when it opens. */
  focus: boolean;
  /** Closes the whole menu. */
  onClose(): void;
  /** For a submenu, closes it and puts the focus back on its item. */
  onBack?(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const submenuId = useId();
  const [at, setAt] = useState({ x, y });
  const [open, setOpen] = useState<OpenSubmenu | null>(null);

  // Keep it on screen, before it's painted.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setAt(placeMenu({ x, y, before }, r, { width: window.innerWidth, height: window.innerHeight }, safeArea()));
    if (focus) ref.current!.querySelector("button")?.focus();
  }, [x, y, before, focus]);

  /** Its items' buttons, one per item, in order. */
  const buttons = () => [...ref.current!.querySelectorAll<HTMLButtonElement>(":scope > button")];

  const openSubmenu = (index: number, takeFocus: boolean) => {
    const list = ref.current!.getBoundingClientRect();
    const item = buttons()[index]!.getBoundingClientRect();
    setOpen({ index, x: list.right - OVERLAP, y: item.top - INSET, before: list.left + OVERLAP, focus: takeFocus });
  };

  /** The open submenu closes; the focus, if it was in there, comes back to this list rather than the page. */
  const closeSubmenu = (focusOn: HTMLButtonElement | undefined) => {
    if (!open) return;
    if (!ref.current!.contains(document.activeElement)) focusOn?.focus();
    setOpen(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys are for the menu, not the designer's shortcuts (Delete, Escape...).
    e.stopPropagation();
    const all = buttons();
    const current = all.indexOf(document.activeElement as HTMLButtonElement);
    const item = items[current];
    if (e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Escape" || (e.key === "ArrowLeft" && onBack)) {
      e.preventDefault();
      (onBack ?? onClose)();
    } else if (e.key === "ArrowRight" && item && "items" in item) {
      e.preventDefault();
      openSubmenu(current, true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setOpen(null);
      all[(current + step + all.length) % all.length]?.focus();
    }
  };

  // The mouse over an item opens its submenu, or closes the one open for another item.
  // A touch isn't a hover: a tap opens a submenu with its click.
  const onPointerEnter = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.pointerType !== "mouse" || open?.index === index) return;
    const item = items[index]!;
    closeSubmenu(e.currentTarget);
    if ("items" in item) openSubmenu(index, false);
  };

  const submenu = open && items[open.index];
  return (
    <>
      <div
        ref={ref}
        id={id}
        className="menu-items context-menu"
        role="menu"
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
        style={{ left: at.x, top: at.y }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {note && (
          <p id={noteId} className="menu-note muted small">
            {note}
          </p>
        )}
        {/* By place, not label: elements can share a name, and so can items named after them. */}
        {items.map((item, index) => (
          <Fragment key={index}>
            {item.divider && <hr />}
            {"items" in item ? (
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open?.index === index}
                aria-controls={open?.index === index ? submenuId : undefined}
                onPointerEnter={(e) => onPointerEnter(e, index)}
                // From the keyboard (detail 0), the focus goes into the submenu too.
                onClick={(e) => openSubmenu(index, e.detail === 0)}
              >
                {item.label}
                <span className="submenu-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            ) : (
              <button
                role="menuitem"
                className={item.danger ? "danger" : undefined}
                onPointerEnter={(e) => onPointerEnter(e, index)}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            )}
          </Fragment>
        ))}
      </div>
      {open && submenu && "items" in submenu && (
        <MenuList
          id={submenuId}
          x={open.x}
          y={open.y}
          before={open.before}
          items={submenu.items}
          label={submenu.label}
          focus={open.focus}
          onClose={onClose}
          onBack={() => closeSubmenu(buttons()[open.index])}
        />
      )}
    </>
  );
}
