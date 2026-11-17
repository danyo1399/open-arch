/**
 * What collapses, expands and sizes the side panels beside the diagram (see PanelSettings): a
 * strip on a panel's inner edge to drag, with a button to collapse it, and the strip a collapsed
 * panel becomes, to expand it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampPanel, PANEL_LIMITS, type PanelSize } from "../settings.js";

/**
 * Where a panel is: the Views & model panel left of the diagram, and the Details panel right of
 * it, or under it on a screen up to 900 pixels wide (STACKED in Designer.tsx).
 */
export type PanelPlace = "left" | "right" | "bottom";

/** The CSS property on the app each size is drawn from (see .app in styles.css). */
export const PANEL_PROPERTY: Record<PanelSize, string> = {
  browseWidth: "--browse-width",
  detailsWidth: "--details-width",
  detailsHeight: "--details-height",
};

/** The top bar's height. */
const TOP_BAR = 46;
/**
 * How wide and how tall the diagram stays, at least, as a panel is dragged bigger. styles.css
 * caps the panels' sizes with the same numbers, and the top bar's height, in .app: change them
 * together.
 */
const DIAGRAM_ROOM = { width: 320, height: 160 };
/** How far an arrow key moves an edge. */
const STEP = 16;

/**
 * The largest a panel can be in an app of this size (inside its padding), as styles.css draws
 * it. Beside the diagram, each panel can take half of what's left once the diagram has its room,
 * so the diagram keeps it with both at their largest. With the details under the diagram, the
 * Views & model panel can take all of it.
 */
export function panelMax(size: PanelSize, stacked: boolean, app: { width: number; height: number }): number {
  const room =
    size === "detailsHeight" ? app.height - TOP_BAR - DIAGRAM_ROOM.height : stacked ? app.width - DIAGRAM_ROOM.width : (app.width - DIAGRAM_ROOM.width) / 2;
  return Math.max(PANEL_LIMITS[size].min, Math.min(PANEL_LIMITS[size].max, Math.floor(room)));
}

/** The app's size inside its padding, which keeps it clear of a phone's notch. */
function appSize(app: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(app);
  const px = (value: string) => parseFloat(value) || 0;
  return {
    width: app.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    height: app.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
  };
}

function Chevron({ points }: { points: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}
const LEFT = "15 18 9 12 15 6";
const RIGHT = "9 18 15 12 9 6";
const UP = "18 15 12 9 6 15";
const DOWN = "6 9 12 15 18 9";
/** Which way a panel collapses: towards the window's edge it's on. */
const COLLAPSES: Record<PanelPlace, string> = { left: LEFT, right: RIGHT, bottom: DOWN };
const EXPANDS: Record<PanelPlace, string> = { left: RIGHT, right: LEFT, bottom: UP };

interface PanelEdgeProps {
  place: PanelPlace;
  /** What the panel is called, as on a phone's tabs. */
  label: string;
  size: PanelSize;
  /** Whether the details are under the diagram, so the Views & model panel has the width to itself. */
  stacked: boolean;
  /** Keeps the panel's new size, or its usual size for undefined. */
  onResize(value: number | undefined): void;
  onCollapse(): void;
  /** Whether its collapse button takes the focus, as the panel's strip was just pressed to expand it. */
  focus?: boolean;
}

/**
 * The inner edge of an open panel, laid over it: a strip to drag to resize it, which arrow keys
 * move too and a double-click puts back to its usual size, and a button to collapse it. It's as
 * big as the panel, so it knows the panel's size, and only the strip and the button take the
 * pointer. While it's dragged, the app's style changes as it moves, so the designer isn't drawn
 * again each time; the size is kept when it's let go.
 */
export function PanelEdge({ place, label, size, stacked, onResize, onCollapse, focus }: PanelEdgeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const across = place !== "bottom";
  /** Pulling the edge this way makes the panel bigger: right for the left panel, left for the right one, up for the bottom one. */
  const grows = place === "left" ? 1 : -1;
  const drag = useRef<{ app: HTMLElement; pointer: number; from: number; start: number; max: number; value: number; was: string } | null>(null);
  /** The panel's size and the largest it can be, as they're drawn, for screen readers. */
  const [shown, setShown] = useState({ now: 0, max: PANEL_LIMITS[size].max });

  const app = () => ref.current!.closest<HTMLElement>(".app")!;
  const measure = () => {
    const rect = ref.current!.getBoundingClientRect();
    return Math.round(across ? rect.width : rect.height);
  };
  const largest = () => panelMax(size, stacked, appSize(app()));

  // After every render, and as the window changes size, which can make the panel smaller.
  const update = () => {
    const now = measure();
    const max = largest();
    setShown((s) => (s.now === now && s.max === max ? s : { now, max }));
  };
  const latest = useRef(update);
  latest.current = update;
  useLayoutEffect(update);
  useEffect(() => {
    let frame = 0;
    const resized = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => latest.current());
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
      cancelAnimationFrame(frame);
    };
  }, []);

  /** Stops dragging. Unless the size is to be kept, the panel goes back to the size it had. */
  const end = (keep: boolean) => {
    const d = drag.current!;
    drag.current = null;
    delete document.documentElement.dataset.resizing;
    if (keep) return;
    if (d.was) d.app.style.setProperty(PANEL_PROPERTY[size], d.was);
    else d.app.style.removeProperty(PANEL_PROPERTY[size]);
  };
  // Gone mid-drag, say as the window becomes a phone's: the page stops looking like it's dragging.
  useEffect(() => () => void (drag.current && end(false)), []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = measure();
    const on = app();
    drag.current = { app: on, pointer: e.pointerId, from: across ? e.clientX : e.clientY, start, max: largest(), value: start, was: on.style.getPropertyValue(PANEL_PROPERTY[size]) };
    // The page shows the resize pointer, and selects no text, wherever the pointer goes.
    document.documentElement.dataset.resizing = across ? "across" : "down";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    d.value = Math.min(d.max, clampPanel(size, d.start + ((across ? e.clientX : e.clientY) - d.from) * grows));
    d.app.style.setProperty(PANEL_PROPERTY[size], `${d.value}px`);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointer) return;
    // Let go where it started, it stays as it was: at its usual size, if it had that.
    const moved = d.value !== d.start;
    end(moved);
    if (moved) onResize(d.value);
  };
  /** The drag stopped without being let go, say for a touch the browser took over: the panel goes back. */
  const onCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === e.pointerId) end(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const bigger = across ? (grows > 0 ? "ArrowRight" : "ArrowLeft") : "ArrowUp";
    const smaller = across ? (grows > 0 ? "ArrowLeft" : "ArrowRight") : "ArrowDown";
    const max = largest();
    const to =
      e.key === bigger ? measure() + STEP : e.key === smaller ? measure() - STEP : e.key === "Home" ? PANEL_LIMITS[size].min : e.key === "End" ? max : null;
    if (to === null) return;
    e.preventDefault();
    const value = Math.min(max, clampPanel(size, to));
    if (value !== measure()) onResize(value);
  };

  return (
    <div ref={ref} className={`panel-edge panel-edge-${place}`}>
      <div
        className="panel-resize"
        role="separator"
        aria-orientation={across ? "vertical" : "horizontal"}
        aria-label={`Resize ${label}`}
        aria-valuemin={PANEL_LIMITS[size].min}
        aria-valuemax={shown.max}
        aria-valuenow={shown.now}
        tabIndex={0}
        title="Drag to resize. Double-click for the usual size."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onCancel}
        onLostPointerCapture={onCancel}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onResize(undefined)}
      />
      <button className="panel-collapse" onClick={onCollapse} autoFocus={focus} aria-expanded={true} aria-label={`Collapse ${label}`} title={`Collapse ${label}`}>
        <Chevron points={COLLAPSES[place]} />
      </button>
    </div>
  );
}

interface PanelRailProps {
  place: PanelPlace;
  label: string;
  /** What's in the panel, in a few words, as on a phone's tabs. */
  detail: string;
  /** Whether the detail is bad news, like errors. */
  bad?: boolean;
  onExpand(): void;
  /** Whether it takes the focus, as the panel's collapse button was just pressed. */
  focus?: boolean;
}

/** A collapsed panel: a strip that says what's in it, and expands it when it's clicked. */
export function PanelRail({ place, label, detail, bad, onExpand, focus }: PanelRailProps) {
  return (
    <button className={`panel-rail panel-rail-${place}`} onClick={onExpand} autoFocus={focus} aria-expanded={false} title={`Expand ${label}`}>
      <Chevron points={EXPANDS[place]} />
      <span className="panel-rail-text">
        <span className="panel-rail-label">{label}</span>
        <span className={bad ? "panel-rail-detail error" : "panel-rail-detail"}>{detail}</span>
      </span>
    </button>
  );
}
