/** A stand-in for a model's server, for tests of Ask AI in the web app: a `fetch` that answers chat requests as a script says. */
import type { ChatMessage, ToolSpec } from "../src/ai/client.js";

/** What a request asked: where it went, with what key, and the conversation and tools it sent. */
export interface Asked {
  url: string;
  authorization: string | null;
  body: { model: string; stream: boolean; messages: ChatMessage[]; tools?: ToolSpec[] };
}

/** A model's message, as the script gives it: text, and the tools it calls, each with its arguments. */
export interface Scripted {
  text?: string;
  calls?: { name: string; args: unknown }[];
}

/** One line of a stream: a piece of an answer, as servers send it. */
export const data = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;

/** A streamed answer, from its lines. Each is sent on its own, so a line can be cut anywhere by the test. */
export function stream(pieces: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

let made = 0;

/** A model's message as a stream: its text in two pieces, then each tool call with its arguments in two. */
export function reply({ text = "", calls = [] }: Scripted): Response {
  const half = Math.ceil(text.length / 2);
  const delta = (delta: unknown, finish: string | null = null) => data({ choices: [{ index: 0, delta, finish_reason: finish }] });
  return stream([
    delta({ role: "assistant", content: "" }),
    ...(text ? [delta({ content: text.slice(0, half) }), delta({ content: text.slice(half) })] : []),
    ...calls.flatMap((call, index) => {
      const args = JSON.stringify(call.args);
      const cut = Math.ceil(args.length / 2);
      return [
        delta({ tool_calls: [{ index, id: `call_${++made}`, type: "function", function: { name: call.name, arguments: "" } }] }),
        delta({ tool_calls: [{ index, function: { arguments: args.slice(0, cut) } }] }),
        delta({ tool_calls: [{ index, function: { arguments: args.slice(cut) } }] }),
      ];
    }),
    delta({}, calls.length ? "tool_calls" : "stop"),
    "data: [DONE]\n\n",
  ]);
}

/**
 * A `fetch` that answers each request with the script's next answer: a model's message, or a
 * function that makes the response from what was asked, and is given the signal that stops the
 * request. `asked` lists the requests it got.
 */
export function fakeModel(script: (Scripted | ((asked: Asked, signal?: AbortSignal | null) => Response | Promise<Response>))[]): { fetch: typeof fetch; asked: Asked[] } {
  const asked: Asked[] = [];
  const left = [...script];
  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: Asked = {
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Asked["body"],
    };
    asked.push(request);
    init?.signal?.throwIfAborted();
    const next = left.shift();
    if (!next) throw new Error("The test's model was asked more times than its script has answers.");
    return typeof next === "function" ? next(request, init?.signal) : reply(next);
  };
  return { fetch: send as typeof fetch, asked };
}

/** The tools' answers in a request's conversation, in order. */
export function toolAnswers(asked: Asked): string[] {
  return asked.body.messages.flatMap((m) => (m.role === "tool" ? [m.content] : []));
}
