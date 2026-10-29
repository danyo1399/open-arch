import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client";
import { describe, expect, it } from "vitest";
import { agentPrompt, type AgentEvent, type AgentRequest } from "../src/agent.js";
import { OpenCodeBackend } from "../src/opencode.js";

const SESSION = "ses_1";
const request: AgentRequest = { file: "/work/shop/shop.openarch", prompt: "Add a cart cache", selection: ["checkout-api"], viewId: "shop-containers" };

/** Just enough of the OpenCode client: an event stream the test pushes to, and a record of calls. */
function fakeOpenCode(options: { skills?: string[]; onPrompt?(push: Push): void; connect?: () => Promise<OpenCodeClient> } = {}) {
  const queue: OpenCodeEvent[] = [];
  let wake: (() => void) | undefined;
  const push: Push = (type, data = {}, sessionID = SESSION) => {
    queue.push({ type, data: { sessionID, ...data } } as unknown as OpenCodeEvent);
    wake?.();
  };
  const calls = { create: [] as Record<string, unknown>[], prompt: [] as Record<string, unknown>[], reply: [] as Record<string, unknown>[], interrupt: [] as Record<string, unknown>[] };
  const client = {
    skill: { list: async () => ({ data: (options.skills ?? ["open-arch"]).map((id) => ({ id })) }) },
    session: {
      create: async (input: Record<string, unknown>) => (calls.create.push(input), { id: SESSION }),
      prompt: async (input: Record<string, unknown>) => {
        calls.prompt.push(input);
        options.onPrompt?.(push);
        return {};
      },
      interrupt: async (input: Record<string, unknown>) => {
        calls.interrupt.push(input);
        push("session.execution.interrupted", { reason: "user" });
        return {};
      },
    },
    permission: {
      reply: async (input: { requestID: string; decision: string }) => {
        calls.reply.push(input);
        push("permission.replied", { requestID: input.requestID, reply: input.decision });
      },
    },
    event: {
      async *subscribe(opts?: { signal?: AbortSignal }) {
        yield { type: "server.connected", data: {} } as OpenCodeEvent;
        while (!opts?.signal?.aborted) {
          const next = queue.shift();
          if (next) yield next;
          else await new Promise<void>((resolve) => ((wake = resolve), opts?.signal?.addEventListener("abort", () => resolve(), { once: true })));
        }
      },
    },
  } as unknown as OpenCodeClient;
  const backend = new OpenCodeBackend({ cli: () => "/bin/open-arch", skillDir: "/app/skill", connect: options.connect ?? (async () => client) });
  return { backend, calls, push };
}

type Push = (type: string, data?: Record<string, unknown>, sessionID?: string) => void;

async function collect(backend: OpenCodeBackend, onEvent?: (event: AgentEvent) => void): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await backend.run(request, (event) => {
    events.push(event);
    onEvent?.(event);
  });
  return events;
}

describe("OpenCode backend", () => {
  it("runs a request in a session in the file's folder, with the skill and permission rules", async () => {
    const { backend, calls } = fakeOpenCode({
      onPrompt(push) {
        push("session.tool.input.started", { id: "call_1", name: "shell" });
        push("session.tool.called", { id: "call_1", input: { command: "/bin/open-arch add-element cart-cache --file /work/shop/shop.openarch" } });
        push("session.text.ended", { text: "Added the cart cache." });
        push("session.execution.succeeded");
      },
    });
    const events = await collect(backend);

    expect(calls.create[0]).toMatchObject({ location: { directory: "/work/shop" } });
    expect(calls.create[0]!.permissions).toEqual(
      expect.arrayContaining([
        { action: "shell", resource: "/bin/open-arch *", effect: "allow" },
        { action: "edit", resource: "*.openarch", effect: "deny" },
      ]),
    );
    expect(calls.prompt[0]).toMatchObject({ sessionID: SESSION, skills: [{ id: "open-arch" }] });
    expect(calls.prompt[0]!.text).toBe(agentPrompt(request, "/bin/open-arch"));
    expect(events).toContainEqual({ type: "progress", text: "$ open-arch add-element cart-cache --file shop.openarch" });
    expect(events.at(-1)).toEqual({ type: "done", summary: "Added the cart cache." });
  });

  it("sends the app's copy of the skill when the project hasn't installed it", async () => {
    const { backend, calls } = fakeOpenCode({ skills: [], onPrompt: (push) => push("session.execution.succeeded") });
    await collect(backend);
    expect(calls.prompt[0]!.skills).toBeUndefined();
    expect(calls.prompt[0]!.files).toMatchObject([{ uri: "file:///app/skill/SKILL.md" }]);
  });

  it("raises permission requests and answers them", async () => {
    const { backend, calls, push } = fakeOpenCode({ onPrompt: (p) => p("permission.asked", { id: "per_1", action: "shell", resources: ["ls -la"] }) });
    const events = await collect(backend, (event) => {
      if (event.type === "permission") void backend.reply(event.id, false).then(() => push("session.execution.succeeded"));
    });
    expect(events).toContainEqual({ type: "permission", id: "per_1", description: "Run `ls -la`" });
    expect(calls.reply).toEqual([{ sessionID: SESSION, requestID: "per_1", decision: "reject" }]);
    expect(events).toContainEqual({ type: "permission-replied", id: "per_1" });
  });

  it("ignores other sessions' events", async () => {
    const { backend } = fakeOpenCode({
      onPrompt(push) {
        push("session.text.ended", { text: "Someone else's work" }, "ses_other");
        push("session.execution.succeeded", {}, "ses_other");
        push("session.execution.failed", { error: { type: "provider.auth", message: "This API key has expired." } });
      },
    });
    const events = await collect(backend);
    expect(events.some((e) => e.type === "progress" && e.text.includes("Someone else"))).toBe(false);
    expect(events.at(-1)).toEqual({ type: "error", message: "This API key has expired." });
  });

  it("stops a running request", async () => {
    const { backend, calls } = fakeOpenCode({ onPrompt: () => setTimeout(() => void backend.cancel(), 0) });
    const events = await collect(backend);
    expect(calls.interrupt).toEqual([{ sessionID: SESSION }]);
    expect(events.at(-1)).toEqual({ type: "error", message: "Stopped." });
  });

  it("reports failures as events, and runs one request at a time", async () => {
    const offline = fakeOpenCode({ connect: () => Promise.reject(new Error("Couldn't start OpenCode")) });
    expect((await collect(offline.backend)).at(-1)).toEqual({ type: "error", message: "Couldn't start OpenCode" });

    const { backend, push } = fakeOpenCode();
    const first = collect(backend);
    await new Promise((r) => setTimeout(r, 10));
    expect(await collect(backend)).toEqual([{ type: "error", message: "The AI is already working on a request." }]);
    push("session.execution.succeeded");
    expect((await first).at(-1)).toEqual({ type: "done", summary: "Done." });
  });
});

describe("agent prompt", () => {
  it("names the file, the CLI and where the user is", () => {
    const text = agentPrompt({ ...request, file: "/My Work/shop.openarch" }, "/bin/open-arch");
    expect(text).toContain('pass `--file "/My Work/shop.openarch"` to every one');
    expect(text).toContain("`shop-containers`");
    expect(text).toContain("`checkout-api`");
    expect(text).toContain("Add a cart cache");
  });
});
