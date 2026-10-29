/**
 * The AgentBackend for OpenCode 2, through its local background service. All
 * the OpenCode-specific code is here.
 *
 * Each request gets its own session in the .openarch file's folder, with the
 * open-arch skill attached and permission rules that let the agent run the
 * open-arch CLI freely, ask before any other command or edit, and never edit
 * the .openarch file itself.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { OpenCode, type OpenCodeClient, type OpenCodeEvent } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { agentPrompt, shellQuote, type AgentBackend, type AgentEvent, type AgentRequest } from "./agent.js";

const SKILL_ID = "open-arch";
const STOPPED: AgentEvent = { type: "error", message: "Stopped." };

export interface OpenCodeOptions {
  /** Path of a command that runs the open-arch CLI. */
  cli(): string;
  /** The app's copy of the skill, sent along when the project hasn't installed it. */
  skillDir: string;
  /** "provider/model" to use instead of OpenCode's default model. */
  model?: string;
  /** How to reach OpenCode. Defaults to the local service, started if needed. */
  connect?(): Promise<OpenCodeClient>;
}

interface Active {
  sessionID?: string;
  cancelled: boolean;
  /** Ends the event subscription. */
  abort: AbortController;
}

type Permission = Extract<OpenCodeEvent, { type: "permission.asked" }>["data"];

/** Apps started from the Dock or Start menu don't get the shell's PATH, so also look where OpenCode's installer puts it. */
function opencodeCommand(): string {
  const installed = join(homedir(), ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
  return existsSync(installed) ? installed : "opencode";
}

async function connectToService(): Promise<OpenCodeClient> {
  let endpoint;
  try {
    endpoint = await Service.ensure({ command: [opencodeCommand(), "serve", "--service"] });
  } catch (error) {
    throw new Error(`Couldn't start OpenCode: ${(error as Error).message}. Install OpenCode 2 from https://opencode.ai, or start it with \`opencode serve --service\`.`);
  }
  const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) });
  const { version } = await client.server.info();
  if (!version.startsWith("2.")) throw new Error(`open-arch needs OpenCode 2, but the OpenCode service running is version ${version}.`);
  return client;
}

/** "openrouter/vendor/model" → { providerID: "openrouter", id: "vendor/model" } */
function parseModel(model: string | undefined): { providerID: string; id: string } | undefined {
  const slash = model?.indexOf("/") ?? -1;
  return model && slash > 0 ? { providerID: model.slice(0, slash), id: model.slice(slash + 1) } : undefined;
}

export class OpenCodeBackend implements AgentBackend {
  private client?: Promise<OpenCodeClient>;
  private active?: Active;

  constructor(private readonly options: OpenCodeOptions) {}

  async run(request: AgentRequest, onEvent: (event: AgentEvent) => void): Promise<void> {
    if (this.active) return onEvent({ type: "error", message: "The AI is already working on a request." });
    const active: Active = { cancelled: false, abort: new AbortController() };
    this.active = active;
    try {
      onEvent(await this.execute(request, active, onEvent));
    } catch (error) {
      // The service may have restarted somewhere else; connect again next time.
      this.client = undefined;
      onEvent(active.cancelled ? STOPPED : { type: "error", message: (error as Error).message });
    } finally {
      active.abort.abort();
      this.active = undefined;
    }
  }

  async reply(permissionId: string, allow: boolean): Promise<void> {
    const sessionID = this.active?.sessionID;
    if (!sessionID) throw new Error("Nothing is waiting for an answer.");
    const client = await this.connect();
    await client.permission.reply({ sessionID, requestID: permissionId, decision: allow ? "once" : "reject" });
  }

  async cancel(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    try {
      if (active.sessionID) await (await this.connect()).session.interrupt({ sessionID: active.sessionID });
    } finally {
      active.abort.abort();
    }
  }

  private connect(): Promise<OpenCodeClient> {
    this.client ??= (this.options.connect ?? connectToService)();
    return this.client;
  }

  private async execute(request: AgentRequest, active: Active, onEvent: (event: AgentEvent) => void): Promise<AgentEvent> {
    onEvent({ type: "progress", text: "Connecting to OpenCode…" });
    const client = await this.connect();
    const location = { directory: dirname(request.file) };
    const cli = shellQuote(this.options.cli());
    const file = shellQuote(request.file);
    const short = (text: string) => text.replaceAll(cli, "open-arch").replaceAll(file, basename(request.file));

    const { data: skills } = await client.skill.list({ location });
    const projectSkill = skills.some((s) => s.id === SKILL_ID);
    if (!projectSkill) onEvent({ type: "progress", text: "This project hasn't installed the open-arch skill, so the app's copy goes with the request." });

    // Subscribe before prompting, so no event is missed.
    const run = follow(client.event.subscribe({ signal: active.abort.signal }), active, onEvent, short);
    await run.connected;
    if (active.cancelled) return STOPPED;

    const model = parseModel(this.options.model);
    const session = await client.session.create({
      location,
      title: `open-arch: ${request.prompt.trim().slice(0, 60)}`,
      ...(model ? { model } : {}),
      permissions: [
        { action: "shell", resource: "*", effect: "ask" },
        { action: "shell", resource: `${cli} *`, effect: "allow" },
        { action: "edit", resource: "*", effect: "ask" },
        { action: "edit", resource: "*.openarch", effect: "deny" },
      ],
    });
    active.sessionID = session.id;
    if (active.cancelled) return STOPPED;

    const skillFile = join(this.options.skillDir, "SKILL.md");
    await client.session.prompt({
      sessionID: session.id,
      text: agentPrompt(request, cli),
      ...(projectSkill
        ? { skills: [{ id: SKILL_ID }] }
        : { files: [{ uri: pathToFileURL(skillFile).href, name: "open-arch skill", description: `The open-arch skill. Its references are in ${join(this.options.skillDir, "references")}.` }] }),
    });
    onEvent({ type: "progress", text: "Sent. Waiting for the agent…" });
    return run.outcome;
  }
}

/**
 * Turn the session's events into AgentEvents. `connected` settles once the
 * stream is open; `outcome` is the final "done" or "error".
 */
function follow(events: AsyncIterable<OpenCodeEvent>, active: Active, onEvent: (event: AgentEvent) => void, short: (text: string) => string) {
  let opened!: { resolve(): void; reject(error: unknown): void };
  const connected = new Promise<void>((resolve, reject) => (opened = { resolve, reject }));
  const outcome = (async (): Promise<AgentEvent> => {
    const tools = new Map<string, string>();
    let summary = "";
    for await (const event of events) {
      if (event.type === "server.connected") opened.resolve();
      if (!active.sessionID || (event.data as { sessionID?: string }).sessionID !== active.sessionID) continue;
      switch (event.type) {
        case "session.tool.input.started":
          tools.set(event.data.id, event.data.name);
          break;
        case "session.tool.called": {
          const text = describeTool(tools.get(event.data.id), event.data.input, short);
          if (text) onEvent({ type: "progress", text });
          break;
        }
        case "session.tool.failed":
          onEvent({ type: "progress", text: `${tools.get(event.data.id) ?? "A tool"} failed: ${event.data.error.message}` });
          break;
        case "session.text.ended":
          if (event.data.text.trim()) {
            summary = event.data.text.trim();
            onEvent({ type: "progress", text: summary });
          }
          break;
        case "session.retry.scheduled":
          onEvent({ type: "progress", text: `Retrying: ${event.data.error.message}` });
          break;
        case "permission.asked":
          onEvent({ type: "permission", id: event.data.id, description: describePermission(event.data, short) });
          break;
        case "permission.replied":
          onEvent({ type: "permission-replied", id: event.data.requestID });
          break;
        case "session.execution.succeeded":
          return { type: "done", summary: summary || "Done." };
        case "session.execution.failed":
          return { type: "error", message: event.data.error.message };
        case "session.execution.interrupted":
          return event.data.reason === "user" ? STOPPED : { type: "error", message: `OpenCode stopped the request (${event.data.reason}).` };
      }
    }
    return active.cancelled ? STOPPED : { type: "error", message: "Lost the connection to OpenCode." };
  })();
  // If the stream ends or fails before it opens, nothing else will settle `connected`.
  outcome.then(() => opened.reject(new Error("Couldn't follow OpenCode's events.")), opened.reject);
  return { connected, outcome };
}

/** One line for a tool call, or nothing for calls with nothing to show (like Code Mode's "execute"). */
function describeTool(name: string | undefined, input: Record<string, unknown>, short: (text: string) => string): string | undefined {
  if (typeof input.command === "string") return `$ ${short(input.command)}`;
  const target = [input.filePath, input.path, input.pattern, input.id, input.url, input.query].find((v) => typeof v === "string");
  return target ? `${name ?? "tool"}: ${short(target)}` : undefined;
}

function describePermission(request: Permission, short: (text: string) => string): string {
  const what = short(request.resources.join(", "));
  const text =
    request.action === "shell"
      ? `Run \`${what}\``
      : request.action === "edit"
        ? `Edit ${what}`
        : request.action === "read"
          ? `Read ${what}`
          : request.action === "external_directory"
            ? `Use files outside the project: ${what}`
            : `${request.action}: ${what}`;
  return request.message ? `${text} (${request.message})` : text;
}
