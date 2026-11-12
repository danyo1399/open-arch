/**
 * Where an event view's parts go: a row for each lane, from the top down, and a column for each
 * card, left to right in their order along the timeline. Nothing is saved: the lanes and the
 * order of the cards decide.
 */
import type { Card, Lane, Operation, ViewDef } from "@open-arch/core";
import type { Box } from "./routing.js";

/**
 * A card's size, as .event-card in styles.css draws it; how far apart the columns and the rows
 * are, with room between the cards for arrows; and the width of a lane's name, at its left.
 */
export const EVT = { cardWidth: 150, cardHeight: 92, column: 200, row: 144, headWidth: 150, pad: 25 } as const;

/** One row of the diagram: a lane, or the row above the lanes for the cards in none. */
export interface EventRow {
  /** Left out for the row of cards in no lane. */
  lane?: Lane;
  box: Box;
}

export interface EventLayout {
  /** From the top down. The row for cards in no lane comes first, when there is one. */
  rows: EventRow[];
  /** Each card's box, by its ID. */
  cards: Map<string, Box>;
  width: number;
  height: number;
}

/** The lane a card is drawn in: its own, if the view has it. */
function laneOf(view: ViewDef, card: Card): string | undefined {
  return card.lane !== undefined && view.lanes.some((l) => l.id === card.lane) ? card.lane : undefined;
}

export function eventLayout(view: ViewDef): EventLayout {
  // Cards in no lane need a row of their own, as does a view with no lanes at all.
  const loose = view.lanes.length === 0 || view.cards.some((c) => laneOf(view, c) === undefined);
  // A view with no cards yet keeps a column's room, so its lanes have something to show.
  const width = EVT.headWidth + Math.max(view.cards.length, 1) * EVT.column;
  const rows: EventRow[] = [...(loose ? [undefined] : []), ...view.lanes].map((lane, i) => ({ lane, box: { x: 0, y: i * EVT.row, w: width, h: EVT.row } }));
  const cards = new Map<string, Box>();
  view.cards.forEach((card, i) => {
    const lane = laneOf(view, card);
    const row = rows.find((r) => r.lane?.id === lane)!;
    cards.set(card.id, { x: EVT.headWidth + EVT.pad + i * EVT.column, y: row.box.y + (EVT.row - EVT.cardHeight) / 2, w: EVT.cardWidth, h: EVT.cardHeight });
  });
  return { rows, cards, width, height: rows.length * EVT.row };
}

/**
 * Where a card dropped with its middle at this point goes: the lane of the row it's on, and its
 * place along the timeline, 1 being the first. Above the rows is the top one, and below, the last.
 */
export function dropSpot(view: ViewDef, layout: EventLayout, at: { x: number; y: number }): { lane: string | undefined; position: number } {
  const rowAt = Math.min(layout.rows.length - 1, Math.max(0, Math.floor(at.y / EVT.row)));
  const column = Math.floor((at.x - EVT.headWidth) / EVT.column);
  return { lane: layout.rows[rowAt]?.lane?.id, position: Math.min(view.cards.length, Math.max(0, column)) + 1 };
}

/** The edit that moves a card dropped at this point there: none when it's where it already is. */
export function dropOps(view: ViewDef, layout: EventLayout, card: Card, at: { x: number; y: number }): Operation[] {
  const spot = dropSpot(view, layout, at);
  // One of the cards is the one being moved, so the last place is their number, not one more.
  const position = Math.min(spot.position, view.cards.length);
  const lane = laneOf(view, card);
  if (spot.lane === lane && position === card.number) return [];
  return [{ op: "update-card", view: view.id, id: card.id, ...(spot.lane !== lane && { lane: spot.lane ?? null }), ...(position !== card.number && { position }) }];
}
