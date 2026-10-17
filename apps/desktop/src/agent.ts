/**
 * Where AI edits will plug in. The planned OpenCode 2 integration implements
 * this in the main process with `@opencode/client`: `Service.ensure()` to find
 * or start the local OpenCode service, `session.create({ location: { directory } })`
 * on the workspace folder, `session.prompt` with the open-arch skill attached,
 * and `event.subscribe()` for progress and permission requests. The agent
 * edits the markdown files; the folder watcher reloads the designer.
 *
 * Nothing implements it yet.
 */

export interface AgentRequest {
  /** Workspace folder the agent works in. */
  root: string;
  /** What the user asked for. */
  prompt: string;
  /** IDs of the elements selected in the designer, for context. */
  selection: string[];
  /** The view open in the designer, for context. */
  viewId?: string;
}

export type AgentEvent =
  | { type: "progress"; text: string }
  | { type: "permission"; id: string; description: string }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface AgentBackend {
  run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<void>;
  /** Answer a permission request raised during `run`. */
  reply(permissionId: string, allow: boolean): Promise<void>;
  cancel(): Promise<void>;
}
