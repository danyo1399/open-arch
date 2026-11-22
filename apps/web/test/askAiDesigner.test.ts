// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBridge, AgentEvent, DesktopBridge } from "../src/bridge.js";
import { Designer } from "../src/Designer.js";
import { FolderHost } from "../src/folders.js";
import { BrowserHost, DesktopHost, MemoryHost, workspaceZip, type WorkspaceHost } from "../src/hosts.js";
import { browserLibrary } from "../src/library.js";
import { button, checkbox, click, mount, type } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";
import { fakeModel, toolAnswers } from "./llm.js";

const shop: OpenArchDocument = {
  openarch: 19,
  name: "Shop",
  elements: { customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things" }] }, shop: { kind: "system", name: "Shop" } },
  views: { context: { title: "Shop context", level: "context", scope: "shop" } },
};

const SETTINGS = { baseUrl: "https://llm.example/v1", apiKey: "sk-very-secret", model: "small-model" };

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete (window as { openArchDesktop?: unknown }).openArchDesktop;
});

/** Makes the browser refuse to keep anything more in local storage, as one whose storage is full does. What's there can still be read. */
function fillStorage() {
  const real = localStorage;
  const full = {
    getItem: (key: string) => real.getItem(key),
    removeItem: (key: string) => real.removeItem(key),
    setItem: () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    },
  };
  vi.stubGlobal("localStorage", full);
}

const until = async (done: () => boolean) => {
  for (let i = 0; i < 300 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(done()).toBe(true);
};

/** The designer on a workspace, with Ask AI's model played by a script. */
async function designer(script: Parameters<typeof fakeModel>[0] = [], file: WorkspaceHost = new MemoryHost("shop.openarch", serializeDocument(shop))) {
  const model = fakeModel(script);
  // As the app does, it carries on with the copy a Save keeps.
  const kept: WorkspaceHost[] = [];
  const Shell = () => {
    const [open, setOpen] = useState(file);
    return createElement(Designer, { host: open, onClose() {}, onHostChange: (next) => (kept.push(next), setOpen(next)), askFetch: model.fetch });
  };
  const host = mount(createElement(Shell));
  await until(() => !!host.querySelector(".ws-name"));
  const panel = () => host.querySelector<HTMLElement>(".ask-ai")!;
  const field = (label: string) => panel().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  /** Fills in the settings and saves them. */
  const configure = async (settings = SETTINGS) => {
    await type(field("Server address"), settings.baseUrl);
    await type(field("API key"), settings.apiKey);
    await type(field("Model"), settings.model);
    await click(button(panel(), "Save"));
  };
  /** Types a request and sends it, and waits for the answer. */
  const ask = async (prompt: string) => {
    const box = panel().querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, prompt);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void box.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await until(() => !!panel().querySelector(".ask-ai-done, .ask-ai-error"));
  };
  const log = () => [...panel().querySelectorAll(".ask-ai-log > p, .ask-ai-log > div.ask-ai-permission")].map((e) => e.textContent);
  /** Types a request and sends it, without waiting for anything. */
  const send = async (prompt: string) => {
    const box = panel().querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, prompt);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => void box.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  };
  return { host, file, kept, model, panel, field, configure, ask, send, log };
}

describe("Ask AI in the web designer", () => {
  it("is offered for any workspace, and asks for the server, the key and the model before anything else", async () => {
    const { host, panel, field, configure } = await designer();
    expect(panel().hidden).toBe(true);
    await click(button(host, "Ask AI"));
    expect(panel().hidden).toBe(false);
    expect(button(host, "Ask AI").getAttribute("aria-pressed")).toBe("true");
    // Nothing to ask with yet: the settings, and no box to type a request in.
    expect(panel().querySelector(".ask-ai-settings")).not.toBeNull();
    expect(panel().querySelector<HTMLFormElement>("form:not(.ask-ai-settings)")!.hidden).toBe(true);
    expect(field("API key").type).toBe("password");
    expect(panel().textContent).toContain("These are kept in this browser, in its local storage, until you forget them. They're never saved in the workspace, an export or a shared link.");
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("Cancel");

    // Settings that can't be used say why, and aren't kept.
    await click(button(panel(), "Save"));
    expect(panel().querySelector('[role="alert"]')!.textContent).toBe("Give the server's address, such as https://api.openai.com/v1.");
    expect(localStorage.length).toBe(0);

    await configure({ ...SETTINGS, baseUrl: " https://llm.example/v1/chat/completions " });
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    expect(panel().querySelector<HTMLFormElement>("form")!.hidden).toBe(false);
    expect(panel().querySelector("textarea")!.getAttribute("aria-label")).toBe("What do you want to ask, or change?");
    expect(JSON.parse(localStorage.getItem("open-arch.ai")!)).toEqual(SETTINGS);
  });

  it("answers a question, and changes the workspace through the designer's own edits, which Undo takes back", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, file, model, ask, log, panel } = await designer([
      { text: "I'll look.", calls: [{ name: "show_model", args: {} }] },
      { calls: [{ name: "change_model", args: { operations: [{ op: "add-element", id: "payments", kind: "system", name: "Payments", external: true }, { op: "add-relationship", from: "shop", to: "payments", description: "Takes payment with" }] } }] },
      { text: "I added `payments`, which the **shop** takes payment with." },
    ]);
    await click(button(host, "Ask AI"));
    // With settings kept, it's ready to ask straight away.
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    await ask("Add a payment provider the shop uses");

    expect(log()).toEqual(["Add a payment provider the shop uses", "I'll look.", "Looked at the model", "Changed the model: added system payments; added relationship shop -> payments", "I added payments, which the shop takes payment with."]);
    expect(panel().querySelector(".ask-ai-done code")!.textContent).toBe("payments");
    // It went to the server in the settings, with the key, and with where the person is.
    expect(model.asked).toHaveLength(3);
    expect(model.asked[0]).toMatchObject({ url: "https://llm.example/v1/chat/completions", authorization: "Bearer sk-very-secret", body: { model: "small-model" } });
    expect(model.asked[0]!.body.messages[1]).toEqual({ role: "user", content: "(In the designer, the view `context` is open.)\n\nAdd a payment provider the shop uses" });
    expect(toolAnswers(model.asked[1]!)[0]).toContain("Shop: shop.openarch (2 elements, 1 views)");

    // The change is the workspace's, saved as any edit is, and one step of its history.
    const saved = loadWorkspace(await file.load());
    expect(saved.elements.get("payments")).toMatchObject({ kind: "system", external: true });
    expect(saved.elements.get("shop")!.uses).toMatchObject([{ to: "payments", description: "Takes payment with" }]);
    expect(button(host, "Undo").disabled).toBe(false);

    await click(button(panel(), "Undo AI change"));
    await until(() => log().at(-1) === "Undid the AI's change.");
    expect(await file.load()).toBe(serializeDocument(shop));
  });

  it("keeps the settings in the browser's local storage only: nothing of them is in the workspace, its zip or what's sent to the model", async () => {
    const { host, file, model, configure, ask } = await designer([{ calls: [{ name: "change_model", args: { operations: [{ op: "update-workspace", description: "Sells things." }] } }] }, { text: "Described." }]);
    await click(button(host, "Ask AI"));
    await configure();
    await ask("Describe the workspace");
    const text = await file.load();
    expect(loadWorkspace(text).doc.description).toBe("Sells things.");
    const secrets = [SETTINGS.apiKey, "llm.example", SETTINGS.model];
    for (const secret of secrets) expect(text).not.toContain(secret);
    const zipped = Object.values(unzipSync(workspaceZip(loadWorkspace(text), file.name, text))).map((bytes) => strFromU8(bytes)).join("\n"); // prettier-ignore
    for (const secret of secrets) expect(zipped).not.toContain(secret);
    // The key goes to the model's server as the request's own, never in what the model reads.
    for (const asked of model.asked) expect(JSON.stringify(asked.body)).not.toContain(SETTINGS.apiKey);
    expect(Object.keys(localStorage)).toEqual(["open-arch.ai"]);
  });

  it("shows the settings again to change them, or to forget them, key and all", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, panel, field } = await designer();
    await click(button(host, "Ask AI"));
    await click(button(panel(), "Settings"));
    expect([field("Server address").value, field("API key").value, field("Model").value]).toEqual([SETTINGS.baseUrl, SETTINGS.apiKey, SETTINGS.model]);
    // Cancel leaves them as they were.
    await type(field("Model"), "another-model");
    await click(button(panel(), "Cancel"));
    expect(JSON.parse(localStorage.getItem("open-arch.ai")!)).toEqual(SETTINGS);
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();

    await click(button(panel(), "Settings"));
    await type(field("Model"), "another-model");
    await click(button(panel(), "Save"));
    expect(JSON.parse(localStorage.getItem("open-arch.ai")!)).toEqual({ ...SETTINGS, model: "another-model" });

    await click(button(panel(), "Settings"));
    await click(button(panel(), "Forget"));
    expect(localStorage.getItem("open-arch.ai")).toBeNull();
    // With none, it asks for them again.
    expect(panel().querySelector(".ask-ai-settings")).not.toBeNull();
    expect(field("API key").value).toBe("");
  });

  it("carries a conversation on, and starts a new one when asked", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, model, ask, log, panel } = await designer([{ text: "It's shop." }, { text: "A customer." }, { text: "Hello." }]);
    await click(button(host, "Ask AI"));
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("New chat");
    await ask("Which system is there?");
    await ask("Who uses it?");
    expect(model.asked[1]!.body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(log()).toEqual(["Which system is there?", "It's shop.", "Who uses it?", "A customer."]);

    await click(button(panel(), "New chat"));
    expect(log()).toEqual([]);
    await ask("Hello");
    expect(model.asked[2]!.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("follows the settings as another tab changes them", async () => {
    const { host, panel, field } = await designer();
    await click(button(host, "Ask AI"));
    expect(panel().querySelector(".ask-ai-settings")).not.toBeNull();
    // Kept in another tab: this one is ready to ask.
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    await act(async () => void window.dispatchEvent(new Event("storage")));
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    // Forgotten there: this one asks for them again, with nothing left in the boxes.
    localStorage.removeItem("open-arch.ai");
    await act(async () => void window.dispatchEvent(new Event("storage")));
    expect(panel().querySelector(".ask-ai-settings")).not.toBeNull();
    expect(field("API key").value).toBe("");
  });

  it("says so when the browser won't keep the settings, or the tick for a folder's files", async () => {
    const root = new FakeFolder("shop-repo");
    root.put("shop.openarch", serializeDocument(shop));
    const { host, panel, configure } = await designer([], new FolderHost("7", root, "shop.openarch", { pollMs: 3_600_000 }));
    await click(button(host, "Ask AI"));
    fillStorage();
    await configure();
    expect(panel().querySelector('.ask-ai-settings [role="alert"]')!.textContent).toBe("The quota has been exceeded.");
    vi.unstubAllGlobals();
    expect(localStorage.length).toBe(0);
    await click(button(panel(), "Save"));
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    expect(panel().querySelector('[role="alert"]')).toBeNull();

    fillStorage();
    const tick = () => checkbox(panel(), "Let the AI read the files in shop-repo");
    await click(tick());
    expect(panel().querySelector('[role="alert"]')!.textContent).toBe("The quota has been exceeded.");
    expect(tick().checked).toBe(false);
    expect(localStorage.getItem("open-arch.ai.files")).toBeNull();
    // Opening the settings doesn't show it as theirs.
    await click(button(panel(), "Settings"));
    expect(panel().querySelector('.ask-ai-settings [role="alert"]')).toBeNull();
  });

  it("stops a request when asked, and has no settings to change while one runs", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    // The server never answers, and the request ends when it's stopped, as the page's own does.
    const { host, send, log, panel } = await designer([(_asked, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)))]);
    await click(button(host, "Ask AI"));
    await send("Describe the shop");
    const buttons = () => [...panel().querySelectorAll("button")].map((b) => b.textContent?.trim());
    expect(buttons()).toContain("Stop");
    expect(buttons()).not.toContain("Settings");
    expect(panel().querySelector("textarea")!.disabled).toBe(true);
    await click(button(panel(), "Stop"));
    await until(() => !!panel().querySelector(".ask-ai-error"));
    expect(log()).toEqual(["Describe the shop", "Stopped."]);
    expect(buttons()).toContain("Settings");
    expect(panel().querySelector("textarea")!.disabled).toBe(false);
  });

  it("changes the workspace where it's kept by then, when it's saved while a request runs", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    let answer: (response: Response) => void = () => {};
    const change = { calls: [{ name: "change_model", args: { operations: [{ op: "update-workspace", description: "Sells things." }] } }] };
    const { host, file, kept, send, panel } = await designer([() => new Promise<Response>((resolve) => (answer = resolve)), { text: "Described." }]);
    await click(button(host, "Ask AI"));
    await send("Describe the workspace");
    // The example is kept in the browser while the model is still thinking.
    await click(button(host, "Save"));
    await until(() => kept.length === 1);
    const saved = kept[0] as BrowserHost;
    expect(saved).toBeInstanceOf(BrowserHost);
    answer(await (await import("./llm.js")).reply(change));
    await until(() => !!panel().querySelector(".ask-ai-done"));
    // The change is in the copy the browser keeps, which is what's open now, not only in the example left behind.
    expect(loadWorkspace((await browserLibrary.get(saved.id))!.text).doc.description).toBe("Sells things.");
    expect(loadWorkspace(await file.load()).doc.description).toBeUndefined();
    await browserLibrary.remove(saved.id);
  });

  it("says what went wrong when the model's server refuses", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, ask, panel } = await designer([() => new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), { status: 401 })]);
    await click(button(host, "Ask AI"));
    await ask("Hello");
    expect(panel().querySelector(".ask-ai-error")!.textContent).toBe("The server refused the API key (401): Incorrect API key provided.");
  });

  it("lets the model read a folder's files only once the person ticks it, for that folder", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const root = new FakeFolder("shop-repo");
    root.put("shop.openarch", serializeDocument(shop));
    root.put("src/cart.ts", "export const cart = redis.get();\n");
    const script = () => [{ calls: [{ name: "search_files", args: { text: "redis" } }] }, { text: "Done." }];
    const { host, model, ask, panel } = await designer([...script(), ...script()], new FolderHost("7", root, "shop.openarch", { pollMs: 3_600_000 }));
    await click(button(host, "Ask AI"));
    const tick = () => checkbox(panel(), "Let the AI read the files in shop-repo");
    expect(tick().checked).toBe(false);

    await ask("Where's the cart kept?");
    expect(model.asked[0]!.body.tools!.map((t) => t.function.name)).toEqual(["show_model", "search_model", "check_model", "change_model", "read_guide"]);
    expect(model.asked[0]!.body.messages[0]!.content).toContain("You can't read files or run commands");
    expect(toolAnswers(model.asked[1]!)).toEqual(["There are no files to read: the workspace wasn't opened from a folder, or the person hasn't let its files be read."]);

    await click(tick());
    expect(tick().checked).toBe(true);
    expect(JSON.parse(localStorage.getItem("open-arch.ai.files")!)).toEqual(["folder/7"]);
    await ask("Where's the cart kept?");
    expect(model.asked[2]!.body.tools!.map((t) => t.function.name)).toEqual(["show_model", "search_model", "check_model", "change_model", "read_guide", "find_files", "read_file", "search_files"]);
    expect(model.asked[2]!.body.messages[0]!.content).toContain("opened from the folder shop-repo");
    expect(toolAnswers(model.asked[3]!).at(-1)).toBe("src/cart.ts:1: export const cart = redis.get();");
    expect(panel().textContent).toContain("Searched the files for “redis”");
  });

  it("still says what happens outside it, such as the file changing, while its panel is open", async () => {
    const root = new FakeFolder("shop-repo");
    root.put("shop.openarch", serializeDocument(shop));
    const { host } = await designer([], new FolderHost("7", root, "shop.openarch", { pollMs: 10 }));
    await click(button(host, "Ask AI"));
    root.put("shop.openarch", serializeDocument({ ...shop, name: "Shop, renamed by Git" }));
    await until(() => host.querySelector(".ws-name")!.textContent === "Shop, renamed by Git");
    expect(host.querySelector(".toast")!.textContent).toContain("The workspace changed outside this window, so it was reloaded.");
  });

  it("has no files to offer for a workspace that isn't in a folder", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, panel } = await designer();
    await click(button(host, "Ask AI"));
    expect(panel().querySelector('input[type="checkbox"]')).toBeNull();
  });
});

describe("Ask AI in the desktop app", () => {
  /** The agent's edit to the file on disk, which the app tells the designer about. */
  let edited: (text: string) => void = () => {};

  /** The desktop app's bridge, with an agent that says what it was asked. */
  function desktop(agent?: AgentBridge): DesktopBridge {
    let text = serializeDocument(shop);
    const watchers: (() => void)[] = [];
    edited = (next) => {
      text = next;
      for (const changed of watchers) changed();
    };
    const bridge = { load: async () => text, save: async () => ({ docs: null }), watch: (_path: string, onChange: () => void) => (watchers.push(onChange), () => {}), agent } as unknown as DesktopBridge;
    Object.assign(window, { openArchDesktop: bridge });
    return bridge;
  }

  it("asks the app's agent about the open file, not a model from the page", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const asked: unknown[][] = [];
    const agent: AgentBridge = {
      run: async (path, prompt, context, onEvent: (event: AgentEvent) => void) => {
        asked.push([path, prompt, context]);
        onEvent({ type: "progress", text: "$ open-arch show" });
        onEvent({ type: "done", summary: "Nothing to change." });
      },
      reply: async () => {},
      cancel: async () => {},
    };
    const bridge = desktop(agent);
    const { host, model, ask, log, panel } = await designer([], new DesktopHost(bridge, "/work/shop.openarch", "shop.openarch"));
    await click(button(host, "Ask AI"));
    // The desktop app's own panel: no settings to fill in, and a box for changes.
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    expect(host.querySelectorAll(".ask-ai")).toHaveLength(1);
    expect(panel().querySelector("textarea")!.getAttribute("aria-label")).toBe("What should the AI change?");
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("Settings");
    await ask("Tidy up");
    expect(asked).toEqual([["/work/shop.openarch", "Tidy up", { viewId: "context", selection: [] }]]);
    expect(log()).toEqual(["Tidy up", "$ open-arch show", "Nothing to change."]);
    expect(model.asked).toEqual([]);
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("New chat");

    // Its agent changes the file on disk, and the designer reloads it without saying so each time: the panel says what changed.
    await act(async () => edited(serializeDocument({ ...shop, name: "Shop, tidied" })));
    await until(() => host.querySelector(".ws-name")!.textContent === "Shop, tidied");
    expect(host.querySelector(".toast")).toBeNull();
    await click(panel().querySelector('button[aria-label="Close Ask AI"]')!);
    expect(host.querySelector(".toast")!.textContent).toContain("The workspace changed outside this window, so it was reloaded.");
  });

  it("isn't offered where the app has no agent for the workspace, such as an example", async () => {
    desktop();
    const { host } = await designer();
    expect([...host.querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("Ask AI");
    expect(host.querySelector(".ask-ai")).toBeNull();
  });
});
