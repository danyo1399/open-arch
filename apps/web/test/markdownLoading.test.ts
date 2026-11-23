// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../src/bridge.js";
import { parseMarkdown } from "../src/panels/markdownParse.js";
import { mount } from "./dom.js";

/** The answer the agent gives: longer once it's drawn, with a heading and a table. */
const ANSWER = "# Changes\n\n| Element | Kind |\n| -- | -- |\n| `cache` | container |\n\nAdded    `cache`,\n  indented.";

afterEach(() => {
  vi.doUnmock("../src/panels/markdownParse.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Ask AI, from a fresh copy of its modules, with the agent's answer given when the request is sent, and the designer's styles. */
async function askAI() {
  const styles = document.createElement("style");
  styles.textContent = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
  document.head.append(styles);
  const { AskAI } = await import("../src/panels/AskAI.js");
  const agent = { run: async (_prompt: string, _context: unknown, onEvent: (event: AgentEvent) => void) => onEvent({ type: "done", summary: ANSWER }), cancel: async () => {} };
  const host = mount(createElement(AskAI, { agent, context: { selection: [] }, contextLabel: "", text: "", restore: async () => true, open: true, onHide() {} }));
  const box = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Add a cache");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  return host;
}

describe("Ask AI's answers while the markdown parser loads", () => {
  it("scrolls to the end of the log again once an answer that came first is drawn from its markdown", async () => {
    let arrive = () => {};
    const arrived = new Promise<void>((resolve) => (arrive = resolve));
    vi.doMock("../src/panels/markdownParse.js", async () => {
      await arrived;
      return { parseMarkdown };
    });
    const scrolled: boolean[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(!!document.querySelector(".ask-ai-done table"));
    });
    const host = await askAI();
    // The answer came before the parser: it's as it's written, its spaces and lines kept.
    const plain = host.querySelector(".ask-ai-done .markdown-plain")!;
    expect(plain.textContent).toBe(ANSWER.replaceAll("`", ""));
    expect(getComputedStyle(plain).whiteSpace).toBe("pre-wrap");
    expect(scrolled).not.toContain(true);

    arrive();
    for (let i = 0; i < 200 && !host.querySelector(".ask-ai-done h3"); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(host.querySelector(".ask-ai-done h3")!.textContent).toBe("Changes");
    // Scrolled to again with the table there.
    expect(scrolled.at(-1)).toBe(true);
  });

  it("keeps the answer as it's written when the parser can't be loaded", async () => {
    vi.doMock("../src/panels/markdownParse.js", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const host = await askAI();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(host.querySelector(".ask-ai-done .markdown-plain")!.textContent).toBe(ANSWER.replaceAll("`", ""));
    expect(host.querySelector(".ask-ai-done h3, .ask-ai-done table")).toBeNull();
  });
});
