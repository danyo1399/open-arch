// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { loadWorkspace, serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { strFromU8, unzipSync } from "fflate";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentBridge, AgentEvent, DesktopBridge } from "../src/bridge.js";
import { App } from "../src/App.js";
import { Designer } from "../src/Designer.js";
import { FolderHost } from "../src/folders.js";
import { DesktopHost, MemoryHost, workspaceZip, type WorkspaceHost } from "../src/hosts.js";
import { browserLibrary } from "../src/library.js";
import { afterChange, canUndo } from "../src/panels/AskAI.js";
import { button, checkbox, click, mount, type } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";
import { fakeModel, reply, toolAnswers } from "./llm.js";

const shop: OpenArchDocument = {
  openarch: 21,
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
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {}, askFetch: model.fetch }));
  await until(() => !!host.querySelector(".ws-name"));
  return { file, model, ...driver(host) };
}

/** What a test does with the designer's Ask AI, in whatever it's mounted in. */
function driver(host: HTMLElement) {
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
  /** Renames the workspace in its details, as a change made by hand. */
  const rename = async (to: string) => {
    await click(host.querySelector(".ws-name")!);
    const name = host.querySelector<HTMLInputElement>(".properties input")!;
    await type(name, to);
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await until(() => host.querySelector(".ws-name")!.textContent === to);
  };
  /** Whether the panel offers to undo what the AI changed. */
  const offersUndo = () => [...panel().querySelectorAll("button")].some((b) => b.textContent?.trim() === "Undo AI change");
  return { host, panel, field, configure, ask, send, log, rename, offersUndo };
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
    expect(model.asked[0]!.body.messages[1]).toEqual({ role: "user", content: "(In the designer, the view `context` (level `context`) is open.)\n\nAdd a payment provider the shop uses" });
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

  it("tells the model what's selected, as the operations name it, and shows the person the same", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, model, ask, panel } = await designer([{ text: "It's the shop." }]);
    await click(button(host, "Ask AI"));
    await until(() => !!host.querySelector('.react-flow__node[data-id="shop"]'));
    await click(host.querySelector('.react-flow__node[data-id="shop"]')!);
    expect(panel().textContent).toContain("In “Shop context” · shop selected");
    // Selecting something that isn't an element tells it too.
    await click(host.querySelector(".ws-name")!);
    expect(panel().textContent).toContain("In “Shop context” · the workspace selected");
    await ask("What is this?");
    expect(model.asked[0]!.body.messages[1]).toEqual({ role: "user", content: "(In the designer, the view `context` (level `context`) is open, and the workspace is selected.)\n\nWhat is this?" });
  });

  it("offers to undo only what the AI changed, and only while the workspace is as the AI left it", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, file, ask, rename, offersUndo, panel } = await designer([
      { text: "A customer buys from the shop." },
      { calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description: "Sells things." }] } }] },
      { text: "Described." },
      { text: "It sells things." },
    ]);
    await click(button(host, "Ask AI"));
    // A question changes nothing, and a change made by hand after it isn't the AI's to undo.
    await ask("Who uses the shop?");
    expect(offersUndo()).toBe(false);
    await rename("Shop, by hand");
    expect(offersUndo()).toBe(false);
    expect(panel().textContent).not.toContain("The AI changed the model.");

    // The AI's change is offered to undo.
    await ask("Describe the shop");
    await until(offersUndo);
    expect(panel().textContent).toContain("The AI changed the model.");
    const left = await file.load();
    expect(loadWorkspace(left).elements.get("shop")?.description).toBe("Sells things.");

    // Once the person changes something too, undoing the AI's change would take theirs with it: Undo and History are the way back.
    await rename("Shop, renamed again");
    expect(offersUndo()).toBe(false);
    // Their change taken back, the workspace is as the AI left it again.
    await click(button(host, "Undo"));
    await until(offersUndo);
    expect(await file.load()).toBe(left);

    // A question after it leaves nothing of the AI's to undo from that request.
    await ask("What does the shop do?");
    expect(offersUndo()).toBe(false);
    expect(await file.load()).toBe(left);
  });

  it("puts the workspace back as it was before the request, the person's earlier changes kept", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, file, ask, rename, offersUndo, log, panel } = await designer([{ calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description: "Sells things." }] } }] }, { text: "Described." }]);
    await click(button(host, "Ask AI"));
    await rename("Shop, by hand");
    const before = await file.load();
    await ask("Describe the shop");
    await until(offersUndo);
    await click(button(panel(), "Undo AI change"));
    await until(() => log().at(-1) === "Undid the AI's change.");
    expect(await file.load()).toBe(before);
    expect(loadWorkspace(before).doc.name).toBe("Shop, by hand");
    expect(offersUndo()).toBe(false);
  });

  it("keeps what the person changed by hand while a request ran, when the AI's change is undone", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    let answer: (response: Response) => void = () => {};
    const describe = { calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description: "Sells things." }] } }] };
    const { host, file, send, rename, offersUndo, log, panel } = await designer([() => new Promise<Response>((resolve) => (answer = resolve)), { text: "Described." }]);
    await click(button(host, "Ask AI"));
    await send("Describe the shop");
    // Renamed by hand while the model is still thinking, before its change lands on top.
    await rename("Shop, by hand");
    const byHand = await file.load();
    answer(reply(describe));
    await until(offersUndo);
    expect(loadWorkspace(await file.load())).toMatchObject({ doc: { name: "Shop, by hand", elements: { shop: { description: "Sells things." } } } });

    await click(button(panel(), "Undo AI change"));
    await until(() => log().at(-1) === "Undid the AI's change.");
    // Back to just before the AI's change, not to when the request was sent: the rename is kept.
    expect(await file.load()).toBe(byHand);
    expect(loadWorkspace(byHand).doc.name).toBe("Shop, by hand");
  });

  it("doesn't offer to undo the AI's changes when the person changed something between two of them", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    let answer: (response: Response) => void = () => {};
    const change = (description: string) => ({ calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description }] } }] });
    const { host, file, send, rename, offersUndo, panel } = await designer([change("Sells things."), () => new Promise<Response>((resolve) => (answer = resolve)), { text: "Described, twice." }]);
    await click(button(host, "Ask AI"));
    await send("Describe the shop, then say more");
    await until(() => panel().textContent!.includes("Changed the model: updated shop"));
    // Between the AI's first change and its second.
    await rename("Shop, by hand");
    answer(reply(change("Sells things, to customers.")));
    await until(() => !!panel().querySelector(".ask-ai-done"));
    expect(loadWorkspace(await file.load())).toMatchObject({ doc: { name: "Shop, by hand", elements: { shop: { description: "Sells things, to customers." } } } });
    // No text takes back both of the AI's changes and keeps the rename, so there's nothing to offer: History has each step.
    expect(offersUndo()).toBe(false);
    expect(panel().textContent).not.toContain("The AI changed the model.");
    await click(host.querySelector('.topbar button[aria-label="History"]')!);
    expect([...host.querySelectorAll(".history button")].map((row) => row.firstElementChild!.textContent)).toEqual(["Updated shop", "Updated workspace", "Updated shop", "Before these changes"]);
  });

  it("undoes every change the AI made in one request together, when nothing came between them", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const change = (description: string) => ({ calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description }] } }] });
    const { host, file, ask, offersUndo, log, panel } = await designer([change("Sells things."), change("Sells things, to customers."), { text: "Described, twice." }]);
    await click(button(host, "Ask AI"));
    await ask("Describe the shop, then say more");
    await until(offersUndo);
    await click(button(panel(), "Undo AI change"));
    await until(() => log().at(-1) === "Undid the AI's change.");
    expect(await file.load()).toBe(serializeDocument(shop));
  });

  it("keeps a running request's log and its Stop when the settings are forgotten in another tab", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, send, log, panel } = await designer([(_asked, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)))]);
    await click(button(host, "Ask AI"));
    await send("Describe the shop");
    localStorage.removeItem("open-arch.ai");
    await act(async () => void window.dispatchEvent(new Event("storage")));
    // Still the request, which can be stopped: not a form over it.
    expect(panel().querySelector(".ask-ai-settings")).toBeNull();
    expect(log()).toEqual(["Describe the shop"]);
    await click(button(panel(), "Stop"));
    await until(() => !!panel().querySelector(".ask-ai-settings"));
    // With the request over, it asks for the settings there aren't.
    expect(panel().querySelector<HTMLFormElement>("form:not(.ask-ai-settings)")!.hidden).toBe(true);
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

  it("waits to save a workspace that's only in this tab while a request runs, and starts afresh in the copy it keeps", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    // The app itself, which opens the copy a Save keeps as a workspace of its own.
    const describe = { calls: [{ name: "change_model", args: { operations: [{ op: "update-workspace", description: "Sells things." }] } }] };
    const model = fakeModel([describe, { text: "Described." }, (_asked, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason))), { text: "Hello." }]);
    vi.stubGlobal("fetch", model.fetch);
    const page = mount(createElement(App, {}));
    await until(() => [...page.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Try the example"));
    await click(button(page, "Try the example"));
    await until(() => !!page.querySelector(".ws-name"));
    const { host, ask, send, log, panel } = driver(page);
    await click(button(host, "Ask AI"));
    // The panel says what Save does to the conversation, for a workspace that's only in this tab.
    const note = "This workspace is only in this tab. Save opens the copy it keeps, which ends this conversation.";
    expect(panel().textContent).toContain(note);
    await ask("Describe the workspace");
    await send("And say more");

    // A request is running: saving now would cut it off, so it says so and saves nothing.
    await click(button(host, "Save"));
    await until(() => !!host.querySelector(".toast"));
    expect(host.querySelector(".toast")!.textContent).toContain("Ask AI is still working on a request. Stop it, or wait for it to finish, then save: saving opens the copy that's kept, and ends the conversation.");
    expect(location.hash).toBe("");
    expect(host.querySelector(".storage")!.textContent).toBe("Not saved");
    expect(log()).toEqual(["Describe the workspace", "Changed the model: updated workspace", "Described.", "And say more"]);
    expect(button(panel(), "Stop")).toBeTruthy();

    // Stopped, it saves: the copy has what the AI changed, and opens with Ask AI as new, the conversation gone.
    await click(button(panel(), "Stop"));
    await until(() => log().at(-1) === "Stopped.");
    await click(button(host, "Save"));
    await until(() => location.hash.length > 1 && host.querySelector(".storage")?.textContent === "Saved in this browser");
    const id = location.hash.slice(1);
    try {
      expect(loadWorkspace((await browserLibrary.get(id))!.text).doc.description).toBe("Sells things.");
      expect(panel().hidden).toBe(true);
      await click(button(host, "Ask AI"));
      expect(log()).toEqual([]);
      // Kept in the browser, there's no Save to end a conversation.
      expect(panel().textContent).not.toContain(note);
      await ask("Hello");
      expect(model.asked.at(-1)!.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    } finally {
      await browserLibrary.remove(id);
      history.replaceState(null, "", location.pathname);
    }
  });

  it("takes no request while a Save is on its way to opening the copy it keeps", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const { host, model, send, ask, log, panel } = await designer([{ text: "Hello." }]);
    // Keeping the copy in the browser takes a moment, which is held here.
    const add = browserLibrary.add.bind(browserLibrary);
    let keep = () => {};
    const held = new Promise<void>((resolve) => (keep = resolve));
    let kept: ReturnType<typeof add> | null = null;
    vi.spyOn(browserLibrary, "add").mockImplementation((name, text) => (kept = held.then(() => add(name, text))));
    await click(button(host, "Ask AI"));
    await click(button(host, "Save"));
    // Sent in that moment: it would be cut off as the copy opens, so it isn't sent, and says why. What was typed stays.
    await send("Hello");
    expect(log()).toEqual(["The workspace is being saved. Ask again once the copy it keeps has opened."]);
    expect(panel().querySelector("textarea")!.value).toBe("Hello");
    expect(model.asked).toEqual([]);
    await act(async () => {
      keep();
      await kept;
    });
    try {
      // Saved, a request goes as usual.
      await ask("Hello");
      expect(model.asked).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      await browserLibrary.remove((await kept!).id);
    }
  });

  it("doesn't write over a change by hand that's still being saved when Undo AI change is pressed", async () => {
    localStorage.setItem("open-arch.ai", JSON.stringify(SETTINGS));
    const file = new MemoryHost("shop.openarch", serializeDocument(shop));
    // A save that can be held, as a slow one is.
    const save = file.save.bind(file);
    let held: Promise<void> | null = null;
    let letGo = () => {};
    file.save = async (next: string) => {
      await held;
      return save(next);
    };
    const { host, ask, offersUndo, log, panel } = await designer([{ calls: [{ name: "change_model", args: { operations: [{ op: "update-element", id: "shop", description: "Sells things." }] } }] }, { text: "Described." }], file);
    await click(button(host, "Ask AI"));
    await ask("Describe the shop");
    await until(offersUndo);

    // A new name typed in the details, saved as its box is left, slowly.
    held = new Promise((resolve) => (letGo = resolve));
    await click(host.querySelector(".ws-name")!);
    const name = host.querySelector<HTMLInputElement>(".properties input")!;
    await type(name, "Shop, by hand");
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    // Pressed before that save has finished, while the offer still shows.
    expect(offersUndo()).toBe(true);
    await click(button(panel(), "Undo AI change"));
    held = null;
    await act(async () => letGo());
    await until(() => host.querySelector(".ws-name")!.textContent === "Shop, by hand");
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    // The rename is kept, the AI's change with it: nothing was put back over it, and the offer is gone.
    const kept = loadWorkspace(await file.load());
    expect(kept.doc.name).toBe("Shop, by hand");
    expect(kept.elements.get("shop")?.description).toBe("Sells things.");
    expect(log()).not.toContain("Undid the AI's change.");
    expect(offersUndo()).toBe(false);
    // Their change taken back, it's as the AI left it, and can be undone after all.
    await click(button(host, "Undo"));
    await until(offersUndo);
    await click(button(panel(), "Undo AI change"));
    await until(() => log().at(-1) === "Undid the AI's change.");
    expect(await file.load()).toBe(serializeDocument(shop));
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
    expect(panel().textContent).not.toContain("only in this tab");

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

describe("what Undo AI change is offered for", () => {
  it("is the agent's own change, where the agent says what it changed", () => {
    expect(canUndo(null, "a")).toBe(false);
    // As its change left it.
    expect(canUndo({ before: "a", after: "b" }, "b")).toBe(true);
    // Changed again since, by someone else.
    expect(canUndo({ before: "a", after: "b" }, "c")).toBe(false);
    // Back as it was before the request: nothing to undo.
    expect(canUndo({ before: "a", after: "b" }, "a")).toBe(false);
    expect(canUndo({ before: "a", after: "a" }, "a")).toBe(false);
  });

  it("goes back to just before the agent's first change, through changes that follow on from one another", () => {
    // The first change in a request.
    expect(afterChange(null, { before: "b", after: "c" })).toEqual({ before: "b", after: "c" });
    // The next starts from what the last left: together they're one thing to undo.
    expect(afterChange({ before: "b", after: "c" }, { before: "c", after: "d" })).toEqual({ before: "b", after: "d" });
    // One made on top of someone else's change: nothing is offered, for the rest of the request too.
    expect(afterChange({ before: "b", after: "c" }, { before: "x", after: "y" })).toBe("mixed");
    expect(afterChange("mixed", { before: "y", after: "z" })).toBe("mixed");
  });

  it("is any change since the request was sent, where the agent doesn't say, as the desktop app's doesn't", () => {
    expect(canUndo({ before: "a" }, "a")).toBe(false);
    expect(canUndo({ before: "a" }, "b")).toBe(true);
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
    expect(asked).toEqual([["/work/shop.openarch", "Tidy up", { viewId: "context", viewLevel: "context", selection: [] }]]);
    expect(log()).toEqual(["Tidy up", "$ open-arch show", "Nothing to change."]);
    expect(model.asked).toEqual([]);
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).not.toContain("New chat");

    // Its agent changes the file on disk, and the designer reloads it without saying so each time: the panel says what changed.
    await act(async () => edited(serializeDocument({ ...shop, name: "Shop, tidied" })));
    await until(() => host.querySelector(".ws-name")!.textContent === "Shop, tidied");
    expect(host.querySelector(".toast")).toBeNull();
    // What changed since the request was sent is taken to be the agent's, which doesn't say what it changed.
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent?.trim())).toContain("Undo AI change");
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
