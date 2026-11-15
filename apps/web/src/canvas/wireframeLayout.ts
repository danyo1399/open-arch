/**
 * Where a wireframe view's parts go: its screens left to right in their order, each as wide as
 * its device, with its widgets top to bottom inside it, a panel's inside the panel and a row's
 * side by side. Nothing is saved: the order of the screens and of the widgets decides.
 */
import { WIDGET_HOLDERS, type Operation, type Screen, type ScreenArrow, type ScreenDevice, type ViewDef, type Widget } from "@open-arch/core";
import type { Point } from "./autoLayout.js";
import type { Box } from "./routing.js";

/**
 * Sizes, as .wf-screen and .wf-widget in styles.css draw them: each device's width, and the
 * least height, in its proportions; the bar with the screen's name; the room round and between
 * widgets; the room between screens, for the arrows; a line of text, and roughly how wide a
 * character of it is, to tell how many lines a text wraps to.
 */
export const WF = {
  width: { desktop: 520, tablet: 400, phone: 280 } as Record<ScreenDevice, number>,
  minHeight: { desktop: 340, tablet: 460, phone: 500 } as Record<ScreenDevice, number>,
  head: 32,
  pad: 14,
  gap: 10,
  between: 160,
  line: 18,
  char: 7,
  /** A panel's title, and a row's text above it. */
  title: 24,
  /** What an empty row or panel keeps, so there's somewhere to drop a widget. */
  empty: 36,
  /** How far below the screens the first arrow to a screen further away runs, and how far apart such arrows are. */
  under: 36,
  track: 14,
} as const;

export interface WireframeLayout {
  /** Each screen's box, by its ID. */
  screens: Map<string, Box>;
  /** Each widget's box, by its ID, on the diagram, not in its screen. */
  widgets: Map<string, Box>;
  width: number;
  height: number;
}

/** The lines of a widget's text, without blank ones. */
export function textLines(text: string | undefined): string[] {
  return (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/** How many lines `text` takes, wrapped to `width`, with characters about `char` wide. At least one. */
function wrapped(lines: string[], width: number, char: number): number {
  const perLine = Math.max(1, Math.floor(width / char));
  return Math.max(1, lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0));
}

/** How tall a widget that isn't a row or a panel is, at this width. */
export function widgetHeight(w: Widget, width: number): number {
  const lines = textLines(w.text);
  switch (w.kind) {
    case "heading":
      return wrapped(lines.length ? lines : ["Heading"], width, 11) * 26;
    case "text":
      // Without text, three grey lines stand in for it.
      return lines.length ? wrapped(lines, width, WF.char) * WF.line : 3 * 14;
    case "button":
    case "tabs":
      return 34;
    case "link":
      return wrapped(lines.length ? lines : ["Link"], width, WF.char) * WF.line;
    case "input":
    case "select":
      return (lines.length ? WF.line + 2 : 0) + 32;
    case "checkbox":
      return wrapped(lines.length ? lines : ["Checkbox"], width - 24, WF.char) * WF.line + 4;
    case "image":
      return Math.round(Math.min(180, Math.max(56, width * 0.45)));
    case "list":
      return Math.max(lines.length, 3) * 20;
    case "table":
      return Math.max(lines.length, 3) * 26 + 2;
    case "divider":
      return 20;
    default:
      return WF.empty;
  }
}

/**
 * Lays out widgets from (`x`, `y`), `width` across: top to bottom, or side by side in a row,
 * sharing its width. Says how tall they are together.
 */
function place(widgets: Widget[], x: number, y: number, width: number, across: boolean, out: Map<string, Box>): number {
  if (across) {
    const each = (width - WF.gap * (widgets.length - 1)) / Math.max(widgets.length, 1);
    return Math.max(0, ...widgets.map((w, i) => placeOne(w, x + i * (each + WF.gap), y, each, out)));
  }
  let at = y;
  widgets.forEach((w, i) => {
    if (i) at += WF.gap;
    at += placeOne(w, x, at, width, out);
  });
  return at - y;
}

/** Lays out one widget, and what's inside it, and says how tall it is. */
function placeOne(w: Widget, x: number, y: number, width: number, out: Map<string, Box>): number {
  let height: number;
  if (w.kind === "panel") {
    const top = textLines(w.text).length ? WF.title + 4 : WF.pad;
    height = top + (w.widgets.length ? place(w.widgets, x + WF.pad, y + top, width - 2 * WF.pad, false, out) : WF.empty) + WF.pad;
  } else if (w.kind === "row") {
    const top = textLines(w.text).length ? WF.title : 0;
    height = top + (w.widgets.length ? place(w.widgets, x, y + top, width, true, out) : WF.empty);
  } else height = widgetHeight(w, width);
  out.set(w.id, { x, y, w: width, h: height });
  return height;
}

export function wireframeLayout(view: ViewDef): WireframeLayout {
  const screens = new Map<string, Box>();
  const widgets = new Map<string, Box>();
  let x = 0;
  let height = 0;
  for (const screen of view.screens) {
    const width = WF.width[screen.device];
    const content = place(screen.widgets, x + WF.pad, WF.head + WF.pad, width - 2 * WF.pad, false, widgets);
    const h = Math.max(WF.minHeight[screen.device], WF.head + WF.pad + content + WF.pad);
    screens.set(screen.id, { x, y: 0, w: width, h });
    height = Math.max(height, h);
    x += width + WF.between;
  }
  return { screens, widgets, width: Math.max(0, x - WF.between), height };
}

/**
 * The way each arrow goes, by the ID React Flow knows it by (see arrowId), as corners to draw
 * through. It leaves its widget on the side facing the screen it leads to. To the next screen
 * along, or the one before, it crosses the gap between the two, each arrow in that gap at its own
 * place across it, and goes into the screen's near side. To a screen further away, it'd cross the
 * screens between, so it goes down beside its own screen, along under them all, each such arrow
 * at its own depth, and up into the bottom of the screen it leads to.
 */
export function arrowRoutes(view: ViewDef, layout: WireframeLayout, arrows: ScreenArrow[]): Map<string, Point[]> {
  const index = new Map(view.screens.map((s, i) => [s.id, i]));
  const routes = new Map<string, Point[]>();
  const gaps = new Map<number, ScreenArrow[]>();
  const under: ScreenArrow[] = [];
  for (const a of arrows) {
    const [from, to] = [index.get(a.screen)!, index.get(a.to)!];
    if (Math.abs(from - to) === 1) gaps.set(Math.min(from, to), [...(gaps.get(Math.min(from, to)) ?? []), a]);
    else under.push(a);
  }
  const start = (a: ScreenArrow, forward: boolean): Point => {
    const w = layout.widgets.get(a.from)!;
    return { x: forward ? w.x + w.w : w.x, y: w.y + w.h / 2 };
  };
  for (const [left, list] of gaps) {
    const [a, b] = [layout.screens.get(view.screens[left]!.id)!, layout.screens.get(view.screens[left + 1]!.id)!];
    list.forEach((arrow, i) => {
      const forward = index.get(arrow.to)! > index.get(arrow.screen)!;
      const from = start(arrow, forward);
      const target = forward ? b : a;
      const across = a.x + a.w + ((i + 1) * (b.x - a.x - a.w)) / (list.length + 1);
      // Into the screen at the widget's height, unless the screen is shorter.
      const y = Math.min(Math.max(from.y, target.y + WF.head), target.y + target.h - WF.pad);
      routes.set(arrowId(arrow), [from, { x: across, y: from.y }, { x: across, y }, { x: forward ? target.x : target.x + target.w, y }]);
    });
  }
  under.forEach((arrow, i) => {
    const forward = index.get(arrow.to)! > index.get(arrow.screen)!;
    const from = start(arrow, forward);
    const [own, target] = [layout.screens.get(arrow.screen)!, layout.screens.get(arrow.to)!];
    const side = forward ? own.x + own.w + WF.track * (i + 1) : own.x - WF.track * (i + 1);
    const depth = layout.height + WF.under + WF.track * i;
    // Into the bottom of the screen, nearer the side it comes from, apart from the others.
    const into = target.x + target.w / 2 + (forward ? -1 : 1) * WF.track * (i + 1);
    routes.set(arrowId(arrow), [from, { x: side, y: from.y }, { x: side, y: depth }, { x: into, y: depth }, { x: into, y: target.y + target.h }]);
  });
  return routes;
}

/** An arrow's ID: the widget it comes from, and the screen it leads to. */
export const arrowId = (a: ScreenArrow) => `${a.from}->${a.to}`;

const inside = (b: Box, at: { x: number; y: number }) => at.x >= b.x && at.x <= b.x + b.w && at.y >= b.y && at.y <= b.y + b.h;

/** A widget and everything inside it. */
function andInside(w: Widget): Widget[] {
  return [w, ...w.widgets.flatMap(andInside)];
}

/**
 * Where a widget dropped with its middle at this point goes: into the innermost row or panel
 * under it, or else onto the screen under it, at its place among the widgets there, 1 being the
 * first. None when it's over no screen. A widget can't go into itself, or into what's inside it.
 */
export function widgetDropSpot(view: ViewDef, layout: WireframeLayout, widget: Widget, at: { x: number; y: number }): { screen: Screen; holder?: Widget; position: number } | undefined {
  const screen = view.screens.find((s) => inside(layout.screens.get(s.id)!, at));
  if (!screen) return undefined;
  const moving = new Set(andInside(widget).map((w) => w.id));
  const holders = screen.widgets.flatMap(andInside).filter((w) => WIDGET_HOLDERS.includes(w.kind) && !moving.has(w.id) && inside(layout.widgets.get(w.id)!, at));
  // The innermost is the smallest: a row or panel is bigger than anything inside it.
  const area = (w: Widget) => layout.widgets.get(w.id)!.w * layout.widgets.get(w.id)!.h;
  const holder = holders.sort((a, b) => area(a) - area(b))[0];
  const across = holder?.kind === "row";
  const others = (holder ? holder.widgets : screen.widgets).filter((w) => w.id !== widget.id);
  const before = others.filter((w) => {
    const b = layout.widgets.get(w.id)!;
    return across ? b.x + b.w / 2 < at.x : b.y + b.h / 2 < at.y;
  });
  return { screen, holder, position: before.length + 1 };
}

/** The edit that moves a widget dropped at this point there: none when it's where it already is, or over no screen. */
export function widgetDropOps(view: ViewDef, layout: WireframeLayout, widget: Widget, at: { x: number; y: number }): Operation[] {
  const spot = widgetDropSpot(view, layout, widget, at);
  if (!spot) return [];
  const same = spot.holder ? widget.parent === spot.holder.id : widget.parent === undefined && widget.screen === spot.screen.id;
  if (same && spot.position === widget.number) return [];
  const where = spot.holder ? { in: spot.holder.id } : { screen: spot.screen.id };
  return [{ op: "update-widget", view: view.id, id: widget.id, ...where, position: spot.position }];
}

/** The edit that moves a screen dropped with its middle at this point along: none when it's where it already is. */
export function screenDropOps(view: ViewDef, layout: WireframeLayout, screen: Screen, at: { x: number; y: number }): Operation[] {
  const others = view.screens.filter((s) => s.id !== screen.id);
  const position = others.filter((s) => {
    const b = layout.screens.get(s.id)!;
    return b.x + b.w / 2 < at.x;
  }).length + 1;
  return position === screen.number ? [] : [{ op: "update-screen", view: view.id, id: screen.id, position }];
}
