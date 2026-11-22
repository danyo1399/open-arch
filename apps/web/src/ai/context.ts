/**
 * Where the person is in the designer, as either Ask AI is told it with each request: the view
 * they have open, and everything they have selected on it, named as the operations name it.
 */
import type { ComputedView, ViewDef, Workspace } from "@open-arch/core";
import type { AgentContext } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import { arrowRelationships, boardItemsOf } from "../model.js";

const code = (id: string) => `\`${id}\``;

/**
 * What's selected, each thing as the agent is told it, with its IDs in backticks: "`shop`", "the
 * sticky note `n1`", "step 3". A relationship is named by its ends, and its index when it isn't
 * the first between them, as the operations name it. Nothing when nothing is selected.
 */
export function selectedThings(ws: Workspace, computed: ComputedView | null, selection: Selection): string[] {
  if (!selection) return [];
  switch (selection.kind) {
    case "element":
      return [code(selection.id)];
    case "several":
      return [...selection.elements.map(code), ...selection.stickies.map((id) => `the sticky note ${code(id)}`)];
    case "arrow": {
      const drawn = arrowRelationships(ws, computed, selection.from, selection.to, selection.relation);
      if (drawn.length === 0) return [`the arrow from ${code(selection.from)} to ${code(selection.to)}`];
      return drawn.map(({ ref }) => `the relationship from ${code(ref.from)} to ${code(ref.to)}${ref.index > 0 ? ` (index ${ref.index})` : ""}`);
    }
    case "sticky":
      return [`the sticky note ${code(selection.id)}`];
    case "step":
      return [`step ${selection.number}`];
    case "state":
      return [`the state ${code(selection.id)}`];
    case "transition":
      return [`transition ${selection.number}`];
    case "node":
      return [`the node ${code(selection.id)}`];
    case "connection":
      return [`connection ${selection.number}`];
    case "instance":
      return [`${code(selection.element)} running in the node ${code(selection.node)}`];
    case "lane":
      return [`the lane ${code(selection.id)}`];
    case "card":
      return [`the card ${code(selection.id)}`];
    case "cardArrow":
      return [`the arrow from the card ${code(selection.from)} to the card ${code(selection.to)}`];
    case "screen":
      return [`the screen ${code(selection.id)}`];
    case "widget":
      return [`the widget ${code(selection.id)}`];
    case "shape":
    case "boardArrow":
    case "board": {
      const { shapes, arrows, stickies } = boardItemsOf(selection);
      return [...shapes.map((id) => `the shape ${code(id)}`), ...arrows.map((id) => `the arrow ${code(id)}`), ...stickies.map((id) => `the sticky note ${code(id)}`)];
    }
    case "block":
      return [`the block ${code(selection.id)}`];
    case "flow":
      return [`flow ${selection.number}`];
    case "entity":
      return [`the entity ${code(selection.id)}`];
    case "attribute":
      return [`the attribute ${code(selection.name)} of the entity ${code(selection.entity)}`];
    case "link":
      return [`link ${selection.number}`];
    case "workspace":
      return ["the workspace"];
  }
}

/** What either Ask AI is given of where the person is, and the line its panel shows them of it. */
export function askContext(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, selection: Selection): { context: AgentContext; label: string } {
  const selected = selectedThings(ws, computed, selection);
  const context: AgentContext = view ? { viewId: view.id, viewTitle: view.title, viewLevel: view.level, selection: selected } : { selection: selected };
  const label = [view ? `In “${view.title}”` : "No view open", selected.length > 0 && `${selected.join(", ").replaceAll("`", "")} selected`].filter(Boolean).join(" · ");
  return { context, label };
}
