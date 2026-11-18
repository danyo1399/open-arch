// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { button, click, mount } from "./dom.js";

// happy-dom can't draw the diagram, so the picture stands in for it.
const drawn = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/image.js", async (original) => ({
  ...(await original<typeof import("../src/image.js")>()),
  diagramImage: async () => {
    drawn.calls++;
    return new Blob(["png"], { type: "image/png" });
  },
}));

const until = async (host: HTMLElement, done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
  expect(done()).toBe(true);
};

const realItem = globalThis.ClipboardItem;
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.ClipboardItem = realItem;
  drawn.calls = 0;
});

/** The example's first view, open in the designer, with its Export menu open. */
async function exportMenu(): Promise<{ host: HTMLElement; items: () => HTMLElement[] }> {
  const host = mount(createElement(App, {}));
  await until(host, () => !!host.textContent?.includes("Try the example"));
  await click(button(host, "Try the example"));
  await until(host, () => !!host.querySelector(".ws-name"));
  await click(button(host, "Export"));
  // The menu opens over the page, outside what the app is drawn in.
  return { host, items: () => [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')] };
}

describe("Copy as PNG", () => {
  it("puts a picture of the view on the clipboard, to paste somewhere else", async () => {
    let drawnWhenAsked = -1;
    const write = vi.spyOn(navigator.clipboard, "write").mockImplementation(async () => void (drawnWhenAsked = drawn.calls));
    const { host, items } = await exportMenu();
    expect(items().map((item) => item.textContent?.trim())).toEqual(["Copy as Mermaid", "Save as Markdown…", "Copy as PNG", "Save as PNG…", "Save as SVG…", "Save as PDF…"]);
    await click(items().find((item) => item.textContent?.trim() === "Copy as PNG")!);
    await until(host, () => !!host.textContent?.includes("Copied a picture of"));
    // The clipboard is asked for before the picture is drawn, while the click still counts.
    expect(drawnWhenAsked).toBe(0);
    expect(drawn.calls).toBe(1);
    const [item] = write.mock.calls[0]![0];
    expect(await (await item!.getType("image/png")).text()).toBe("png");
    host.remove();
  });

  it("isn't offered in a browser that can't put a picture on the clipboard", async () => {
    // @ts-expect-error A browser without ClipboardItem, such as an older Firefox.
    delete globalThis.ClipboardItem;
    const { host, items } = await exportMenu();
    expect(items().map((item) => item.textContent?.trim())).toEqual(["Copy as Mermaid", "Save as Markdown…", "Save as PNG…", "Save as SVG…", "Save as PDF…"]);
    host.remove();
  });
});
