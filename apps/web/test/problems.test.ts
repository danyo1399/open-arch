// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { FolderList, pickFolder, writeDocs, type FolderHandle } from "../src/folders.js";
import { WorkspaceLibrary } from "../src/library.js";
import { LibraryPage } from "../src/LibraryPage.js";
import type { AgentBridge, AgentEvent, DesktopBridge } from "../src/bridge.js";
import { AskAI } from "../src/panels/AskAI.js";
import { ShareDialog } from "../src/panels/ShareDialog.js";
import { isNamed, problemText, UNKNOWN_PROBLEM } from "../src/problems.js";
import { PNG_FILE, saveFile } from "../src/providers.js";
import { Settings } from "../src/settings.js";
import { ShareClient } from "../src/share.js";
import { DesktopStart } from "../src/Start.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const until = async (host: HTMLElement, text: string) => {
  for (let i = 0; i < 200 && !host.textContent?.includes(text); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(host.textContent).toContain(text);
};

const realClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  vi.restoreAllMocks();
  if (realClipboard) Object.defineProperty(navigator, "clipboard", realClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  for (const name of ["showDirectoryPicker", "showSaveFilePicker"]) delete (window as unknown as Record<string, unknown>)[name];
});

/** Makes the browser refuse to open IndexedDB, without saying why. */
function refuseStorage() {
  vi.spyOn(indexedDB, "open").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      Object.defineProperty(request, "error", { value: null });
      request.onerror?.(new Event("error"));
    });
    return request;
  });
}

describe("what went wrong", () => {
  it("is the message, or what was thrown when that's text, or else a sentence saying so", () => {
    expect(problemText(new Error("Not allowed."))).toBe("Not allowed.");
    expect(problemText("Locked.")).toBe("Locked.");
    // An error from another frame or a worker isn't an Error here, but has a message.
    expect(problemText({ name: "NotAllowedError", message: "Not allowed there." })).toBe("Not allowed there.");
    for (const thrown of [new Error(""), new Error("   "), "", " \n ", undefined, null, 42, {}]) expect(problemText(thrown)).toBe(UNKNOWN_PROBLEM);
  });

  it("tells a kind of failure apart, whatever was thrown", () => {
    expect(isNamed(new DOMException("No.", "AbortError"), "AbortError")).toBe(true);
    expect(isNamed(new Error("No."), "AbortError")).toBe(false);
    for (const thrown of [undefined, null, "AbortError"]) expect(isNamed(thrown, "AbortError")).toBe(false);
  });

  it("in Ask AI, from the agent or the desktop app, says so when it gives no reason", async () => {
    const errors = async (run: AgentBridge["run"]) => {
      const agent = { run, reply: async () => {}, cancel: async () => {} } as AgentBridge;
      const host = mount(createElement(AskAI, { agent, path: "a.openarch", context: { selection: [] }, contextLabel: "", text: "", restore: async () => true, open: true, onClose() {} }));
      const box = host.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Add a cache");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
      await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
      return [...host.querySelectorAll(".ask-ai-log .error, .error")].map((e) => e.textContent);
    };
    // An error event with no text.
    expect(await errors(async (_path, _prompt, _context, onEvent: (event: AgentEvent) => void) => onEvent({ type: "error", message: "" }))).toContain(UNKNOWN_PROBLEM);
    // The desktop app's prefix, with nothing after it.
    expect(
      await errors(async () => {
        throw new Error("Error invoking remote method 'agentRun': Error: ");
      }),
    ).toContain(UNKNOWN_PROBLEM);
    // With a reason, the prefix comes off.
    expect(
      await errors(async () => {
        throw new Error("Error invoking remote method 'agentRun': Error: OpenCode isn't installed.");
      }),
    ).toContain("OpenCode isn't installed.");
  });

  it("from a picker that fails without saying why is passed on as it was, not as a different error", async () => {
    Object.assign(window, { showSaveFilePicker: () => Promise.reject(null), showDirectoryPicker: () => Promise.reject(undefined) });
    await expect(saveFile("a.png", "x", PNG_FILE)).rejects.toBeNull();
    await expect(pickFolder()).rejects.toBeUndefined();
  });

  it("from reading a page in the docs folder is passed on as it was", async () => {
    const docs = new FakeFolder("docs");
    docs.getFileHandle = () => Promise.reject(undefined);
    await expect(writeDocs(docs as FolderHandle, [{ path: "README.md", content: "x" }])).rejects.toBeUndefined();
  });

  it("from the browser's storage says no reason was given", async () => {
    refuseStorage();
    await expect(new WorkspaceLibrary(`refused-${Math.random()}`).list()).rejects.toThrow(`This browser won't let open-arch store workspaces: ${UNKNOWN_PROBLEM}`);
    await expect(new Settings(`refused-${Math.random()}`).share("a")).rejects.toThrow(`This browser won't let open-arch keep your settings: ${UNKNOWN_PROBLEM}`);
    await expect(new FolderList(`refused-${Math.random()}`).list()).rejects.toThrow(`This browser won't let open-arch remember folders: ${UNKNOWN_PROBLEM}`);
  });

  it("on the start page, when the workspaces can't be listed", async () => {
    const library = new WorkspaceLibrary(`library-${Math.random()}`);
    library.list = () => Promise.reject(undefined);
    const host = mount(createElement(LibraryPage, { library, onOpen() {} }));
    await until(host, UNKNOWN_PROBLEM);
  });

  it("in the share dialog, when the share server fails without saying why", async () => {
    const client = { create: () => Promise.reject(undefined) } as unknown as ShareClient;
    const file = { name: "a.openarch", text: JSON.stringify({ openarch: 20, name: "A", elements: {}, views: {} }) };
    const host = mount(createElement(ShareDialog, { client, workspace: "browser/a", file, designer: "https://designer.example/", settings: new Settings(`share-${Math.random()}`), onClose() {} }));
    await until(host, "Create link");
    await click(button(host, "Create link"));
    await until(host, UNKNOWN_PROBLEM);
  });

  it("in the designer, when an action fails without saying why", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(undefined) } });
    const host = mount(createElement(App, {}));
    await until(host, "Try the example");
    await click(button(host, "Try the example"));
    for (let i = 0; i < 200 && !host.querySelector(".ws-name"); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    await click(button(host, "Export"));
    // The menu opens over the page, outside what the app is drawn in.
    await click([...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((item) => item.textContent?.trim() === "Copy as Mermaid")!);
    await until(host, UNKNOWN_PROBLEM);
  });

  it("on the desktop app's start page, when opening or making a file fails without saying why", async () => {
    for (const action of ["Open…", "New workspace"]) {
      const desktop = { openFile: () => Promise.reject(undefined), newFile: () => Promise.reject(new Error("  ")) } as unknown as DesktopBridge;
      const host = mount(createElement(DesktopStart, { desktop, onOpen() {} }));
      await click(button(host, action));
      await until(host, UNKNOWN_PROBLEM);
      host.remove();
    }
  });

  it("from the share server, when its reason is blank, says what it answered", async () => {
    const client = new ShareClient("https://share.example", async () => new Response(JSON.stringify({ error: " " }), { status: 500 }));
    await expect(client.create({ name: "a.openarch", text: "{}" })).rejects.toThrow("the share server answered 500.");
  });
});
