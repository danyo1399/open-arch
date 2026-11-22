/**
 * How a request tells an agent where the person is in the designer. Its own module, with nothing
 * else in it, as the desktop app's agent uses it too.
 */
import type { AgentContext } from "../bridge.js";

const code = (id: string) => `\`${id}\``;

/** How many of the things selected a request names: past it, the designer says how many more there are, as one more thing. */
export const NAMED_LIMIT = 50;

/** How a request tells the agent where the person is: "the view `context` (level `context`) is open, and `shop` is selected". Empty when there's nothing to say. */
export function whereText(context: AgentContext): string {
  const view = context.viewId && `the view ${code(context.viewId)}${context.viewLevel ? ` (level ${code(context.viewLevel)})` : ""} is open`;
  const selected = context.selection.length > 0 && `${context.selection.join(", ")} ${context.selection.length === 1 ? "is" : "are"} selected`;
  return [view, selected].filter(Boolean).join(", and ");
}
