/**
 * Sizes and shapes for an entity view's diagram: how big an entity is drawn, from its name and
 * its attributes, before it's been measured, and the crow's foot drawn at each end of a link,
 * saying how many of the entity at that end there can be.
 */
import type { Cardinality, Entity } from "@open-arch/core";

/** The narrowest and widest an entity is drawn. Its attributes' names and types are cut short past the widest. */
export const ENTITY_W = { min: 200, max: 360 } as const;

/**
 * How an entity is drawn, as .entity-box in styles.css draws it: its border, the room round its
 * name, a line of its name or description, a row for an attribute, a key's badge, and how wide a
 * character of an attribute's name or type is, in a monospace font.
 */
export const ENTITY = { border: 1.5, headPad: 8, nameLine: 18, descLine: 16, rowsPad: 3, row: 22, rowPad: 10, key: 22, gap: 8, char: 7.2, nameChar: 8.4 } as const;

/** How many of the attributes' keys the widest row has, which sets the width of the keys' column. */
export function keyColumns(entity: Pick<Entity, "attributes">): number {
  return Math.max(0, ...entity.attributes.map((a) => a.keys.length));
}

/** An entity's width: as wide as its name or its widest attribute's row needs, between ENTITY_W.min and ENTITY_W.max. */
export function entityWidth(entity: Pick<Entity, "name" | "attributes">): number {
  const keys = keyColumns(entity);
  const keysW = keys ? keys * ENTITY.key + ENTITY.gap : 0;
  const row = (name: string, type: string | undefined) => 2 * ENTITY.rowPad + keysW + name.length * ENTITY.char + (type ? ENTITY.gap * 1.5 + type.length * ENTITY.char : 0);
  const longestLine = Math.max(...entity.name.split(/\r?\n/).map((l) => l.trim().length));
  const wanted = Math.max(2 * ENTITY.headPad + longestLine * ENTITY.nameChar, ...entity.attributes.map((a) => row(a.name, a.type)));
  return Math.round(Math.min(ENTITY_W.max, Math.max(ENTITY_W.min, wanted + 2 * ENTITY.border)));
}

/** How many lines text takes, wrapped at `perLine` characters, each of its own lines at least one. */
function linesOf(text: string, perLine: number): number {
  return text.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/** About how tall an entity is drawn: its name and description, wrapped to its width, then a row for each attribute, or one saying it has none. */
export function entityHeight(entity: Pick<Entity, "name" | "description" | "attributes">): number {
  const inside = entityWidth(entity) - 2 * ENTITY.border - 2 * ENTITY.headPad;
  const name = linesOf(entity.name, Math.max(1, Math.floor(inside / ENTITY.nameChar))) * ENTITY.nameLine;
  const description = entity.description ? 2 + linesOf(entity.description, Math.max(1, Math.floor(inside / 6.6))) * ENTITY.descLine : 0;
  const head = 2 * ENTITY.headPad + name + description + ENTITY.border;
  const rows = 2 * ENTITY.rowsPad + Math.max(1, entity.attributes.length) * ENTITY.row;
  return Math.round(2 * ENTITY.border + head + rows);
}

/**
 * The crow's foot at one end of a link, drawn along the line with the entity at its right, as an
 * SVG marker draws it pointing along the line: its paths, and the circle, if it has one. Exactly
 * one is two bars; zero or one a bar and a circle; one or more a crow's foot and a bar; zero or
 * more a crow's foot and a circle. The marker is CROW_FOOT.w by CROW_FOOT.h, with the entity's
 * edge at x = CROW_FOOT.w and the line at y = CROW_FOOT.h / 2.
 */
export const CROW_FOOT = { w: 26, h: 16 } as const;

export function crowFoot(cardinality: Cardinality): { paths: string[]; circle?: { cx: number; cy: number; r: number } } {
  const { w, h } = CROW_FOOT;
  const mid = h / 2;
  // A bar across the line, x from the entity's edge.
  const bar = (x: number) => `M ${w - x} 1 V ${h - 1}`;
  // Three prongs that spread out to the entity's edge from a point on the line.
  const foot = `M ${w - 12} ${mid} L ${w} 1 M ${w - 12} ${mid} L ${w} ${h - 1} M ${w - 12} ${mid} H ${w}`;
  const circle = { cx: w - 20, cy: mid, r: 4 };
  switch (cardinality) {
    case "one":
      return { paths: [bar(5), bar(10)] };
    case "zero-or-one":
      return { paths: [bar(6)], circle: { ...circle, cx: w - 14 } };
    case "one-or-more":
      return { paths: [foot, bar(16)] };
    case "zero-or-more":
      return { paths: [foot], circle };
  }
}
