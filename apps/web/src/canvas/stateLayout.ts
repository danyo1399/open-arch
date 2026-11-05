/**
 * Sizes and shapes for a state view's diagram: how big a state is drawn before it's been
 * measured, and the loop a transition from a state back to itself makes beside it.
 */
import type { State } from "@open-arch/core";
import type { Box } from "./routing.js";

/** A state's width, as .state-box in styles.css draws it. */
export const STATE_W = 180;

/** About how tall a state is drawn: its name, and its description wrapped at about 26 characters a line. */
export function stateHeight(state: Pick<State, "description">): number {
  const lines = state.description ? Math.max(1, Math.ceil(state.description.length / 26)) : 0;
  return 46 + (lines ? 6 + lines * 16 : 0);
}

/**
 * The loop for a state's `k`th transition back to itself (0 is the first): up out of its top edge
 * near the right corner and back down into it, each further loop a little taller and wider; and
 * where its label's centre goes, clear above the loop.
 */
export function selfLoop(box: Box, k: number): { path: string; end: { x: number; y: number }; label: { x: number; y: number } } {
  const reach = 48 + k * 26;
  const start = { x: box.x + box.w - 64 - k * 10, y: box.y };
  const end = { x: box.x + box.w - 18, y: box.y };
  const path = `M ${start.x} ${start.y} C ${start.x} ${start.y - reach}, ${end.x} ${end.y - reach}, ${end.x} ${end.y}`;
  // A cubic curve with both control points `reach` up rises three quarters of the way.
  return { path, end, label: { x: (start.x + end.x) / 2, y: box.y - reach * 0.75 - 20 } };
}

/** How far above a state its `count` loops back to itself, and the label of the tallest, reach. */
export function loopsRise(count: number): number {
  return count ? (48 + (count - 1) * 26) * 0.75 + 40 : 0;
}
