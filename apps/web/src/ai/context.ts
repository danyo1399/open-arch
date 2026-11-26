/**
 * Where the person is in the designer, as either Ask AI is told it with each request: the view
 * they have open, and everything they have selected on it, named as the operations name it.
 */
import { ID_PATTERN, type ComputedView, type ViewDef, type Workspace } from "@open-arch/core";
import type { AgentContext } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import { arrowRelationships, boardItemsOf } from "../model.js";
import { NAMED_LIMIT } from "./where.js";

/**
 * An ID as the agent is told it. Only an ID in the form IDs take goes into the request, as what's
 * in it reads as the person's own words: any other text, from whoever made the file, could be
 * written to read as an instruction.
 */
const code = (id: string) => (ID_PATTERN.test(id) ? `\`${id}\`` : "(an ID that isn't valid)");

/**
 * What's selected, each thing as the agent is told it, with its IDs in backticks: "`shop`", "the
 * sticky note `n1`", "step 3". A relationship is named by its ends, and its index when it isn't
 * the first between them, as the operations name it. Nothing when nothing is selected. Nothing
 * that's free text, such as a name or a title, is in it, for the same reason as in `code`: an
 * attribute is named by its number among its entity's attributes, and the agent reads its name.
 */
export function selectedThings(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, selection: Selection): string[] {
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
    case "blocks":
      return [...selection.blocks.map((id) => `the block ${code(id)}`), ...selection.stickies.map((id) => `the sticky note ${code(id)}`)];
    case "flow":
      return [`flow ${selection.number}`];
    case "entity":
      return [`the entity ${code(selection.id)}`];
    case "attribute": {
      const at = view?.entities.find((e) => e.id === selection.entity)?.attributes.findIndex((a) => a.name === selection.name) ?? -1;
      return [`${at < 0 ? "an attribute" : `attribute ${at + 1}`} of the entity ${code(selection.entity)}`];
    }
    case "link":
      return [`link ${selection.number}`];
    case "workspace":
      return ["the workspace"];
  }
}

/** What either Ask AI is given of where the person is, and the line its panel shows them of it, with the view's title. */
export function askContext(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, selection: Selection): { context: AgentContext; label: string } {
  const all = selectedThings(ws, view, computed, selection);
  // A lot selected, such as everything on a big view, is named only in part, so it doesn't swell every request.
  const selected = all.length > NAMED_LIMIT ? [...all.slice(0, NAMED_LIMIT), `${all.length - NAMED_LIMIT} more`] : all;
  // The view's title is free text, so the agent is given its ID and level, and reads the title if it needs it.
  const context: AgentContext = view ? { viewId: view.id, viewLevel: view.level, selection: selected } : { selection: selected };
  const label = [view ? `In “${view.title}”` : "No view open", selected.length > 0 && `${selected.join(", ").replaceAll("`", "")} selected`].filter(Boolean).join(" · ");
  return { context, label };
}
