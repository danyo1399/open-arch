// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { FolderList, pickFolder, writeDocs, type FolderHandle } from "../src/folders.js";
import { WorkspaceLibrary } from "../src/library.js";
import { LibraryPage } from "../src/LibraryPage.js";
import { errorText } from "../src/panels/AskAI.js";
import { ShareDialog } from "../src/panels/ShareDialog.js";
import { isProblem, problemText, UNKNOWN_PROBLEM } from "../src/problems.js";
import { PNG_FILE, saveFile } from "../src/providers.js";
import { Settings } from "../src/settings.js";
import type { ShareClient } from "../src/share.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const until = async (host: HTMLElement, text: string) => {
  for (let i = 0; i < 200 && !host.textContent?.includes(text); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(host.textContent).toContain(text);
};

afterEach(() => {
  vi.restoreAllMocks();
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
    for (const thrown of [new Error(""), "", undefined, null, 42, {}]) expect(problemText(thrown)).toBe(UNKNOWN_PROBLEM);
  });

  it("tells a kind of failure apart, whatever was thrown", () => {
    expect(isProblem(new DOMException("No.", "AbortError"), "AbortError")).toBe(true);
    expect(isProblem(new Error("No."), "AbortError")).toBe(false);
    for (const thrown of [undefined, null, "AbortError"]) expect(isProblem(thrown, "AbortError")).toBe(false);
  });

  it("from Ask AI takes off the desktop app's prefix, and says so when nothing's left", () => {
    expect(errorText(new Error("Error invoking remote method 'agentRun': Error: OpenCode isn't installed."))).toBe("OpenCode isn't installed.");
    expect(errorText(new Error("Error invoking remote method 'agentRun': Error: "))).toBe(UNKNOWN_PROBLEM);
    expect(errorText(undefined)).toBe(UNKNOWN_PROBLEM);
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

  it("from the browser's storage says the browser didn't say what", async () => {
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
    const file = { name: "a.openarch", text: JSON.stringify({ openarch: 11, name: "A", elements: {}, views: {} }) };
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
});
