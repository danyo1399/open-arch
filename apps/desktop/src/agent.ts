/**
 * Where AI edits plug in. A backend runs one request at a time against a
 * .openarch file: the agent changes it only through the open-arch CLI, which
 * checks every change, and the designer's file watcher shows the result.
 * `opencode.ts` implements this with OpenCode 2.
 */
import { ID_PATTERN, VIEW_LEVELS } from "@open-arch/core";
import type { AgentEvent } from "../../web/src/bridge.js";
import { NAMED_LIMIT, whereText } from "../../web/src/ai/where.js";

export type { AgentEvent };

export interface AgentRequest {
  /** The .openarch file to change. The agent works in its folder. */
  file: string;
  /** What the user asked for. */
  prompt: string;
  /** Everything selected in the designer, for context, each as the agent is told it: "`shop`", "the sticky note `n1`". */
  selection: string[];
  /** The view open in the designer, and its level, for context. */
  viewId?: string;
  viewLevel?: string;
}

export interface AgentBackend {
  /** Emits progress, then exactly one "done" or "error", then resolves. Never rejects. */
  run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<void>;
  /** Answer a permission request raised during `run`. */
  reply(permissionId: string, allow: boolean): Promise<void>;
  cancel(): Promise<void>;
}

/** How long a thing selected can be, as the designer words it: one longer isn't what it sends. */
const SELECTED_LENGTH = 200;

/**
 * Where the person is in the designer, from what the page sent, as the agent is told it: only
 * strings, an ID in the form IDs take, a level there is, and no more of the selection than a
 * request names, each of a length the designer writes.
 */
export function agentContext(context: unknown): Pick<AgentRequest, "selection" | "viewId" | "viewLevel"> {
  const given = (typeof context === "object" && context !== null ? context : {}) as Record<string, unknown>;
  const things = Array.isArray(given.selection) ? given.selection.filter((thing): thing is string => typeof thing === "string" && thing.length <= SELECTED_LENGTH) : [];
  // The designer names no more than this, and then how many more there are.
  const selection = things.slice(0, NAMED_LIMIT + 1);
  const viewId = typeof given.viewId === "string" && ID_PATTERN.test(given.viewId) ? given.viewId : undefined;
  const viewLevel = viewId && (VIEW_LEVELS as readonly unknown[]).includes(given.viewLevel) ? (given.viewLevel as string) : undefined;
  return { selection, viewId, viewLevel };
}

/** Quote a path for the agent's shell when it needs it. */
export function shellQuote(path: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(path) ? path : `"${path}"`;
}

/** What the agent is told, whichever backend runs it. `cli` is the command that runs the open-arch CLI. */
export function agentPrompt(request: AgentRequest, cli: string): string {
  const file = shellQuote(request.file);
  const lines = [
    `Change the architecture model in the open-arch workspace ${file} as the user asks below.`,
    "",
    `Use the open-arch skill. Change the model only with open-arch commands: run them as \`${cli}\` and pass \`--file ${file}\` to every one. Never edit the .openarch file or its docs folder directly.`,
  ];
  const where = whereText(request);
  if (where) lines.push(`In the designer, ${where}.`);
  lines.push(
    "",
    "Request:",
    request.prompt.trim(),
    "",
    `When you're done, run \`${cli} check --file ${file}\`, then reply in one or two sentences saying what you changed.`,
  );
  return lines.join("\n");
}
