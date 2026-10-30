import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

export interface MenuItem {
  label: string;
  onSelect(): void;
}

/** Where to open a menu for a right-click, or under the element when the keyboard opened it (it reports 0, 0). */
export function menuPoint(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

/**
 * A menu at a point on the screen, as a right-click opens. A click elsewhere, Escape, scrolling or
 * resizing closes it. A note is a line of text above the items. A click on the anchor, the button
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
  const noteId = useId();
  const [at, setAt] = useState({ x, y });

  // Keep it on screen, before it's painted.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    ref.current!.querySelector("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const within = (e: Event) => e.target instanceof Node && !!ref.current?.contains(e.target);
    // A press on the anchor is left to its click, unless it ends off the anchor or turns into
    // a scroll, when there's no click. (A touch's events all go to where it started.)
    let onAnchor = false;
    const down = (e: PointerEvent) => {
      if (within(e)) return;
      onAnchor = e.target instanceof Node && !!anchor?.current?.contains(e.target);
      if (!onAnchor) onClose();
    };
    const up = (e: PointerEvent) => {
      const r = anchor?.current?.getBoundingClientRect();
      if (onAnchor && (!r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) onClose();
      onAnchor = false;
    };
    const cancel = () => {
      if (onAnchor) onClose();
      onAnchor = false;
    };
    const wheel = (e: WheelEvent) => {
      if (!within(e)) onClose();
    };
    // Capture, so the canvas can't swallow the click before it closes the menu.
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("wheel", wheel, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, anchor]);

  /** Closing with the keyboard or an item puts focus back on the anchor, not the page, where Backspace deletes the selection. */
  const close = () => {
    anchor?.current?.focus();
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys are for the menu, not the designer's shortcuts (Delete, Escape...).
    e.stopPropagation();
    const buttons = [...ref.current!.querySelectorAll("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(current + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div
      ref={ref}
      className="menu-items context-menu"
      role="menu"
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
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            close();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
