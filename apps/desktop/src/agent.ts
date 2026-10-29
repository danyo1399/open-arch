/**
 * Where AI edits plug in. A backend runs one request at a time against a
 * .openarch file: the agent changes it only through the open-arch CLI, which
 * checks every change, and the designer's file watcher shows the result.
 * `opencode.ts` implements this with OpenCode 2.
 */
import type { AgentEvent } from "../../web/src/bridge.js";

export type { AgentEvent };

export interface AgentRequest {
  /** The .openarch file to change. The agent works in its folder. */
  file: string;
  /** What the user asked for. */
  prompt: string;
  /** IDs of the elements selected in the designer, for context. */
  selection: string[];
  /** The view open in the designer, for context. */
  viewId?: string;
}

export interface AgentBackend {
  /** Emits progress, then exactly one "done" or "error", then resolves. Never rejects. */
  run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<void>;
  /** Answer a permission request raised during `run`. */
  reply(permissionId: string, allow: boolean): Promise<void>;
  cancel(): Promise<void>;
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
  if (request.viewId) lines.push(`The user has the view \`${request.viewId}\` open in the designer.`);
  if (request.selection.length > 0) lines.push(`They have selected: ${request.selection.map((id) => `\`${id}\``).join(", ")}.`);
  lines.push(
    "",
    "Request:",
    request.prompt.trim(),
    "",
    `When you're done, run \`${cli} check --file ${file}\`, then reply in one or two sentences saying what you changed.`,
  );
  return lines.join("\n");
}
