import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, ChatError, chatUrl, type ChatMessage, type ToolSpec } from "../src/ai/client.js";
import { data, fakeModel, reply, stream } from "./llm.js";

const settings = { baseUrl: "https://llm.example/v1", apiKey: "sk-secret", model: "small" };
const hello: ChatMessage[] = [{ role: "user", content: "Hello" }];
const tool: ToolSpec = { type: "function", function: { name: "show_model", description: "Read the model.", parameters: { type: "object", properties: {} } } };
const piece = (delta: unknown, finish: string | null = null) => data({ choices: [{ index: 0, delta, finish_reason: finish }] });

afterEach(() => vi.unstubAllGlobals());

describe("asking a model from the page", () => {
  it("sends the conversation and the tools to the server's chat endpoint, with the key, and asks for a stream", async () => {
    const model = fakeModel([{ text: "Hi there." }]);
    const answer = await chat(settings, hello, [tool], { fetch: model.fetch });
    expect(answer).toEqual({ content: "Hi there.", toolCalls: [], cutShort: false });
    expect(model.asked).toEqual([{ url: "https://llm.example/v1/chat/completions", authorization: "Bearer sk-secret", body: { model: "small", messages: hello, stream: true, tools: [tool] } }]);
  });

  it("sends no key to a server that needs none, and no tools when there are none", async () => {
    const model = fakeModel([{ text: "Hi." }]);
    await chat({ ...settings, apiKey: "" }, hello, [], { fetch: model.fetch });
    expect(model.asked[0]!.authorization).toBeNull();
    expect(model.asked[0]!.body).not.toHaveProperty("tools");
  });

  it("goes to the endpoint whatever was pasted as the address", () => {
    for (const baseUrl of ["https://llm.example/v1", "https://llm.example/v1/", " https://llm.example/v1/chat/completions ", "https://llm.example/v1/chat/completions/"]) {
      expect(chatUrl({ ...settings, baseUrl })).toBe("https://llm.example/v1/chat/completions");
    }
  });

  it("hands on each piece of the text as it arrives, and puts tool calls together from their pieces", async () => {
    const heard: string[] = [];
    const model = fakeModel([{ text: "Looking.", calls: [{ name: "show_model", args: { id: "shop" } }, { name: "search_model", args: { text: "cache" } }] }]);
    const answer = await chat(settings, hello, [tool], { fetch: model.fetch, onText: (text) => heard.push(text) });
    expect(heard).toEqual(["Look", "ing."]);
    expect(answer.content).toBe("Looking.");
    expect(answer.toolCalls.map((c) => [c.type, c.function.name, JSON.parse(c.function.arguments)])).toEqual([
      ["function", "show_model", { id: "shop" }],
      ["function", "search_model", { text: "cache" }],
    ]);
    expect(new Set(answer.toolCalls.map((c) => c.id)).size).toBe(2);
  });

  it("reads a stream cut anywhere: mid-line, mid-character, with either line ending, and with lines that aren't the answer's", async () => {
    const whole = `: keep-alive\r\n\r\nevent: message\r\n${piece({ content: "Añadí " }).trim()}\r\n\r\ndata: not json\r\n\r\n${piece({ content: "la caché ✓" }).trim()}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const bytes = new TextEncoder().encode(whole);
    // Every byte on its own, so every line and every character of more than one byte is cut.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const answer = await chat(settings, hello, [], { fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) });
    expect(answer.content).toBe("Añadí la caché ✓");
  });

  it("reads the last line of a stream that ends without a line break, and one with no [DONE]", async () => {
    const answer = await chat(settings, hello, [], { fetch: async () => stream([piece({ content: "One" }), piece({ content: " two" }).trimEnd()]) });
    expect(answer.content).toBe("One two");
  });

  it("puts tool calls together however a server sends their pieces", async () => {
    const call = (part: object) => piece({ tool_calls: [part] });
    const names = async (pieces: string[]) => (await chat(settings, hello, [tool], { fetch: async () => stream(pieces) })).toolCalls.map((c) => `${c.id} ${c.function.name} ${c.function.arguments}`);
    // Numbered, the ID and the name only in the first piece: as OpenAI sends them.
    expect(
      await names([
        call({ index: 0, id: "a", function: { name: "show_model", arguments: "" } }),
        call({ index: 1, id: "b", function: { name: "check_model", arguments: "{}" } }),
        call({ index: 0, function: { arguments: '{"id":' } }),
        call({ index: 0, function: { arguments: '"shop"}' } }),
      ]),
    ).toEqual(['a show_model {"id":"shop"}', "b check_model {}"]);
    // Every call numbered 0, each whole in one piece.
    expect(await names([call({ index: 0, id: "a", function: { name: "show_model", arguments: "{}" } }), call({ index: 0, id: "b", function: { name: "check_model", arguments: "{}" } })])).toEqual(["a show_model {}", "b check_model {}"]);
    // No numbers: a piece with an ID starts a call, or carries on the call with that ID, and one without goes on the last.
    expect(
      await names([
        call({ id: "a", function: { name: "show_model", arguments: '{"id"' } }),
        call({ function: { arguments: ':"shop"}' } }),
        call({ id: "b", function: { name: "check_model", arguments: "{" } }),
        call({ id: "b", function: { name: "check_model", arguments: "}" } }),
      ]),
    ).toEqual(['a show_model {"id":"shop"}', "b check_model {}"]);
    // Every call numbered 0 and no IDs, each whole in one piece: a name starts a new call once the one before has all its arguments, even the same name.
    const unmarked = await names([
      call({ index: 0, function: { name: "read_file", arguments: '{"path":"a.ts"}' } }),
      call({ index: 0, function: { name: "read_file", arguments: '{"path":"b.ts"}' } }),
      call({ index: 0, function: { name: "check_model", arguments: "{}" } }),
    ]);
    expect(unmarked.map((c) => c.replace(/^call_\d+ /, ""))).toEqual(['read_file {"path":"a.ts"}', 'read_file {"path":"b.ts"}', "check_model {}"]);
    // A server that sends the name again with each piece of one call's arguments: still one call, with its name once.
    const repeated = await names([
      call({ index: 0, function: { name: "show_model", arguments: '{"id":' } }),
      call({ index: 0, function: { name: "show_model", arguments: '"shop"}' } }),
    ]);
    expect(repeated.map((c) => c.replace(/^call_\d+ /, ""))).toEqual(['show_model {"id":"shop"}']);
    // No IDs at all, and the arguments written out, not as text: each call still gets an ID of its own, which no later reply's call gets too.
    const unnamed = [call({ index: 0, function: { name: "show_model", arguments: { id: "shop" } } }), call({ index: 1, function: { name: "check_model", arguments: {} } })];
    const made = [...(await names(unnamed)), ...(await names(unnamed))];
    expect(made.map((c) => c.replace(/^call_\d+ /, ""))).toEqual(['show_model {"id":"shop"}', "check_model {}", 'show_model {"id":"shop"}', "check_model {}"]);
    expect(new Set(made.map((c) => c.split(" ")[0])).size).toBe(4);
  });

  it("reads an answer sent whole, from a server that doesn't stream", async () => {
    const whole = { choices: [{ message: { role: "assistant", content: "Done.", tool_calls: [{ id: "a", type: "function", function: { name: "show_model", arguments: "{}" } }] }, finish_reason: "tool_calls" }] };
    const heard: string[] = [];
    const answer = await chat(settings, hello, [tool], { fetch: async () => Response.json(whole), onText: (text) => heard.push(text) });
    expect(answer).toEqual({ content: "Done.", toolCalls: [{ id: "a", type: "function", function: { name: "show_model", arguments: "{}" } }], cutShort: false });
    expect(heard).toEqual(["Done."]);
    await expect(chat(settings, hello, [], { fetch: async () => new Response("{", { headers: { "content-type": "application/json" } }) })).rejects.toThrow(/^The server's answer couldn't be read: /);
  });

  it("reads a stream from a response it can't read a piece at a time", async () => {
    const whole = piece({ content: "One" }) + piece({ content: " two" }) + "data: [DONE]\n\n";
    const response = { ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), body: null, text: async () => whole } as unknown as Response;
    expect((await chat(settings, hello, [], { fetch: async () => response })).content).toBe("One two");
  });

  it("says when the model ran out of room", async () => {
    const answer = await chat(settings, hello, [], { fetch: async () => stream([piece({ content: "The shop has" }, "length"), "data: [DONE]\n\n"]) });
    expect(answer).toEqual({ content: "The shop has", toolCalls: [], cutShort: true });
  });

  it("says why the server refused, with what it said", async () => {
    const refused = (status: number, body: string) => chat(settings, hello, [], { fetch: async () => new Response(body, { status }) }).catch((e: unknown) => e);
    const key = await refused(401, JSON.stringify({ error: { message: "Incorrect API key provided." } }));
    expect(key).toBeInstanceOf(ChatError);
    expect((key as Error).message).toBe("The server refused the API key (401): Incorrect API key provided.");
    expect(((await refused(403, JSON.stringify({ error: "Not allowed here." }))) as Error).message).toBe("The server refused the API key (403): Not allowed here.");
    expect(((await refused(404, JSON.stringify({ message: "No model small." }))) as Error).message).toBe("The server didn't find the address or the model (404): No model small.");
    expect(((await refused(429, JSON.stringify({ detail: "Slow down." }))) as Error).message).toBe("The server says there were too many requests, or the account has run out of credit (429): Slow down.");
    // Not JSON: the start of what it sent. Nothing at all: just the status.
    const page = `<html>${"Bad gateway. ".repeat(100)}</html>`;
    expect(((await refused(502, page)) as Error).message).toBe(`The server answered with an error (502): ${page.slice(0, 300)}`);
    expect(((await refused(500, "")) as Error).message).toBe("The server answered with an error (500).");
  });

  it("says so when a stream carries an error instead of an answer", async () => {
    const failed = chat(settings, hello, [], { fetch: async () => stream([piece({ content: "The" }), data({ error: { message: "Overloaded." } })]) });
    await expect(failed).rejects.toThrow(new ChatError("The server answered with an error: Overloaded."));
  });

  it("says what's usually wrong when the server can't be reached, which the browser doesn't", async () => {
    const unreachable = (baseUrl: string): Promise<Error> =>
      chat({ ...settings, baseUrl }, hello, [], { fetch: async () => Promise.reject(new TypeError("Failed to fetch")) }).then(
        () => new Error("It answered, when it couldn't be reached."),
        (e: unknown) => e as Error,
      );
    const error = await unreachable("https://llm.example/v1");
    expect(error).toBeInstanceOf(ChatError);
    expect(error.message).toBe(
      "Couldn't reach llm.example: Failed to fetch. Check the address, and that you're online. The server also has to allow requests from a web page (CORS): one on this computer, such as Ollama, needs this page's address among its allowed origins.",
    );
    // On an HTTPS page, the browser blocks plain HTTP, except to this computer.
    vi.stubGlobal("location", { protocol: "https:", origin: "https://designer.example" });
    expect((await unreachable("http://192.168.1.20:1234/v1")).message).toBe(
      "Couldn't reach 192.168.1.20:1234: this page is served over HTTPS, so the browser won't let it call an http:// address, except one on this computer (localhost). Give the server an https:// address.",
    );
    for (const local of ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://[::1]:8080/v1"]) {
      expect((await unreachable(local)).message).toContain("needs this page's address (https://designer.example) among its allowed origins.");
    }
  });

  it("stops when it's told to, before the answer or partway through it", async () => {
    const stop = new AbortController();
    stop.abort();
    const model = fakeModel([{ text: "Hi." }]);
    await expect(chat(settings, hello, [], { fetch: model.fetch, signal: stop.signal })).rejects.toMatchObject({ name: "AbortError" });

    const later = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(piece({ content: "The" })));
        later.signal.addEventListener("abort", () => controller.error(later.signal.reason));
      },
    });
    const heard: string[] = [];
    const asking = chat(settings, hello, [], { fetch: async () => new Response(body), signal: later.signal, onText: (text) => (heard.push(text), later.abort()) });
    await expect(asking).rejects.toMatchObject({ name: "AbortError" });
    expect(heard).toEqual(["The"]);
  });

  it("says so when the answer stops partway for another reason", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("The connection was lost."));
      },
    });
    await expect(chat(settings, hello, [], { fetch: async () => new Response(body) })).rejects.toThrow(new ChatError("The answer stopped partway: The connection was lost."));
  });

  it("answers the test's own stand-in for a model as a server would", async () => {
    expect(await (await reply({ text: "ab" })).text()).toContain('"content":"a"');
  });
});
