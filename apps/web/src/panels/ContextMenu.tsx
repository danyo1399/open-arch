import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

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

/** A menu at a point on the screen, as a right-click opens. A click elsewhere, Escape, scrolling or resizing closes it. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });

  // Keep it on screen, before it's painted.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setAt({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    ref.current!.querySelector("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!(e.target instanceof Node && ref.current?.contains(e.target))) onClose();
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
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys are for the menu, not the designer's shortcuts (Delete, Escape...).
    e.stopPropagation();
    const buttons = [...ref.current!.querySelectorAll("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(current + step + buttons.length) % buttons.length]?.focus();
    }
  };

  return (
    <div ref={ref} className="menu-items context-menu" role="menu" style={{ left: at.x, top: at.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
