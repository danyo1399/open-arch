import { describe, expect, it, vi } from "vitest";
import { UNKNOWN_PROBLEM } from "../../web/src/problems.js";
import type { AgentEvent, AgentRequest } from "../src/agent.js";
import { OpenCodeBackend } from "../src/opencode.js";

/** What starting OpenCode's background service fails with, in each test. */
const failure = vi.hoisted(() => ({ thrown: undefined as unknown }));

vi.mock("@opencode/client/service", () => ({
  Service: {
    ensure: () => Promise.reject(failure.thrown),
    headers: () => ({}),
  },
}));

const request: AgentRequest = { file: "/work/shop/shop.openarch", prompt: "Add a cart cache", selection: [] };

/** The error a request ends with when OpenCode's service won't start. */
async function startError(thrown: unknown): Promise<AgentEvent | undefined> {
  failure.thrown = thrown;
  const events: AgentEvent[] = [];
  await new OpenCodeBackend({ cli: () => "/bin/open-arch", skillDir: "/app/skill" }).run(request, (event) => events.push(event));
  return events.at(-1);
}

describe("starting OpenCode", () => {
  const install = "Install OpenCode 2 from https://opencode.ai, or start it with `opencode serve --service`.";

  it("says why it couldn't, and how to fix it", async () => {
    expect(await startError(new Error("spawn opencode ENOENT."))).toEqual({ type: "error", message: `Couldn't start OpenCode: spawn opencode ENOENT. ${install}` });
  });

  it("says no reason was given when the service gives none", async () => {
    for (const thrown of [undefined, new Error(""), "  "]) {
      expect(await startError(thrown)).toEqual({ type: "error", message: `Couldn't start OpenCode: ${UNKNOWN_PROBLEM} ${install}` });
    }
  });
});
