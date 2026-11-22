/**
 * Talks to a model from the page, over OpenAI's chat completions API, which most providers and
 * local servers speak: one request with the conversation and the tools the model may call, and
 * its reply read as it streams. Nothing goes through a server of open-arch's.
 */
import { isNamed, problemText } from "../problems.js";
import { cleanBaseUrl, type AiSettings } from "./settings.js";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; /** The arguments, as the JSON text the model wrote. */ arguments: string };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** A tool the model may call: its name, what it's for, and its arguments as a JSON Schema. */
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Reply {
  content: string;
  toolCalls: ToolCall[];
  /** The model ran out of room before it finished, so what it wrote may stop partway. */
  cutShort: boolean;
}

export interface ChatOptions {
  /** Stops the request. */
  signal?: AbortSignal;
  /** Hears each piece of the reply's text as it arrives. */
  onText?(text: string): void;
  /** The page's `fetch`, unless a test gives its own. */
  fetch?: typeof fetch;
}

/** A request that didn't get an answer, said so the person can put it right. */
export class ChatError extends Error {}

/** Where requests go: the address with the endpoint on it. */
export const chatUrl = (settings: AiSettings) => `${cleanBaseUrl(settings.baseUrl)}/chat/completions`;

const isLocal = (host: string) => host === "localhost" || host === "[::1]" || host.endsWith(".localhost") || /^127(\.\d+){3}$/.test(host);

/** Why no answer came back at all: the browser doesn't say, so this says what's usually wrong. */
function unreachable(settings: AiSettings, error: unknown): string {
  const url = new URL(chatUrl(settings));
  const page = typeof location === "undefined" ? null : location;
  if (page?.protocol === "https:" && url.protocol === "http:" && !isLocal(url.hostname)) {
    return `Couldn't reach ${url.host}: this page is served over HTTPS, so the browser won't let it call an http:// address, except one on this computer (localhost). Give the server an https:// address.`;
  }
  const origin = page?.origin && page.origin !== "null" ? ` (${page.origin})` : "";
  return `Couldn't reach ${url.host}: ${problemText(error)}. Check the address, and that you're online. The server also has to allow requests from a web page (CORS): one on this computer, such as Ollama, needs this page's address${origin} among its allowed origins.`;
}

/** What a server said in an error's body: its message when it's the usual JSON, or else the start of the text. */
function said(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: unknown; message?: unknown; detail?: unknown };
    const error = json.error as { message?: unknown } | string | undefined;
    for (const text of [typeof error === "object" ? error?.message : error, json.message, json.detail]) if (typeof text === "string" && text.trim()) return text.trim();
  } catch {
    // Not JSON: say what it sent.
  }
  return body.trim().slice(0, 300);
}

/** Why the server refused the request. */
async function refusal(response: Response): Promise<string> {
  const why = said(await response.text().catch(() => ""));
  const status = response.status;
  const what =
    status === 401 || status === 403
      ? "The server refused the API key"
      : status === 404
        ? "The server didn't find the address or the model"
        : status === 429
          ? "The server says there were too many requests, or the account has run out of credit"
          : "The server answered with an error";
  return `${what} (${status})${why ? `: ${why}` : "."}`;
}

/** How many IDs were made up for calls a server gave none, so no two are the same, in one reply or across a conversation. */
let madeUp = 0;

/** The pieces of tool calls as they stream in, put together. */
class Calls {
  private readonly calls: { id: string; name: string; args: string }[] = [];
  /** Where the call a server numbers `index` is in `calls`. */
  private readonly places = new Map<number, number>();

  add(part: { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }): void {
    const id = typeof part.id === "string" ? part.id : "";
    const name = typeof part.function?.name === "string" ? part.function.name : "";
    // By its number; without one, by its ID; with neither, it's more of the last call.
    let at = typeof part.index === "number" ? this.places.get(part.index) : id ? this.calls.findIndex((c) => c.id === id) : this.calls.length - 1;
    // Some servers number every call 0: a new ID there starts a new call.
    if (at !== undefined && at >= 0 && id && this.calls[at]!.id && this.calls[at]!.id !== id) at = undefined;
    if (at === undefined || at < 0) {
      at = this.calls.push({ id, name: "", args: "" }) - 1;
      if (typeof part.index === "number") this.places.set(part.index, at);
    }
    const call = this.calls[at]!;
    call.id ||= id;
    // The name comes whole with the call's first piece; a server that sends it again sends the ID again too.
    if (name) call.name = id || !call.name ? name : call.name + name;
    const args = part.function?.arguments;
    if (typeof args === "string") call.args += args;
    // Written out, not as text: a server that doesn't stream the arguments.
    else if (args && typeof args === "object") call.args = JSON.stringify(args);
  }

  /** The calls with a name, each with an ID: its server's, or one made up for it, which a few servers leave out. */
  list(): ToolCall[] {
    return this.calls.filter((c) => c.name).map((c) => ({ id: c.id || `call_${++madeUp}`, type: "function", function: { name: c.name, arguments: c.args } }));
  }
}

interface Chunk {
  error?: unknown;
  choices?: { delta?: Part; message?: Part; finish_reason?: unknown }[];
}
type Part = { content?: unknown; tool_calls?: unknown };

/**
 * Asks the model for its next message in a conversation. Resolves to the text it wrote and the
 * tools it wants called. Throws a ChatError when the server can't be reached or refuses, and an
 * AbortError when the request is stopped.
 */
export async function chat(settings: AiSettings, messages: ChatMessage[], tools: ToolSpec[], options: ChatOptions = {}): Promise<Reply> {
  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(chatUrl(settings), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages, stream: true, ...(tools.length ? { tools } : {}) }),
      signal: options.signal,
    });
  } catch (error) {
    if (isNamed(error, "AbortError")) throw error;
    throw new ChatError(unreachable(settings, error));
  }
  if (!response.ok) throw new ChatError(await refusal(response));

  let content = "";
  let cutShort = false;
  const calls = new Calls();
  const take = (chunk: Chunk) => {
    if (chunk.error) throw new ChatError(`The server answered with an error: ${said(JSON.stringify(chunk)) || "it didn't say why"}`);
    const choice = chunk.choices?.[0];
    // A stream sends `delta`s; an answer sent whole has one `message`.
    const part = choice?.delta ?? choice?.message;
    if (typeof part?.content === "string" && part.content) {
      content += part.content;
      options.onText?.(part.content);
    }
    if (Array.isArray(part?.tool_calls)) for (const call of part.tool_calls) if (call && typeof call === "object") calls.add(call);
    if (choice?.finish_reason === "length") cutShort = true;
  };

  // A server that doesn't stream answers with the whole message as JSON.
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    let whole: Chunk;
    try {
      whole = (await response.json()) as Chunk;
    } catch (error) {
      if (isNamed(error, "AbortError")) throw error;
      throw new ChatError(`The server's answer couldn't be read: ${problemText(error)}`);
    }
    take(whole);
    return { content, toolCalls: calls.list(), cutShort };
  }

  // Server-sent events: a line of `data: <JSON>` for each piece, then `data: [DONE]`.
  const line = (text: string) => {
    if (!text.startsWith("data:")) return;
    const data = text.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      // Not a piece of the answer, such as a server's keep-alive.
      return;
    }
    take(chunk);
  };
  const reader = response.body?.getReader();
  if (!reader) {
    for (const text of (await response.text()).split(/\r?\n/)) line(text);
    return { content, toolCalls: calls.list(), cutShort };
  }
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      rest += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = rest.split(/\r?\n/);
      // The last line may be only the start of one.
      rest = done ? "" : lines.pop()!;
      for (const text of lines) line(text);
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof ChatError || isNamed(error, "AbortError")) throw error;
    throw new ChatError(`The answer stopped partway: ${problemText(error)}`);
  }
  return { content, toolCalls: calls.list(), cutShort };
}
