// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 21,
  name: "Shop",
  elements: { customer: { kind: "person", name: "Customer", uses: [{ to: "shop", description: "Buys things" }] }, shop: { kind: "system", name: "Shop" } },
  views: { context: { title: "Shop context", level: "context", scope: "shop" } },
};

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};

/** The whole designer on the shop, with a way to rename the workspace in its settings, as one change. */
async function designer() {
  const file = new MemoryHost("shop.openarch", serializeDocument(shop));
  const host = mount(createElement(Designer, { host: file, onClose() {}, onHostChange() {} }));
  await until(() => !!host.querySelector(".ws-name"));
  const named = () => host.querySelector(".ws-name")!.textContent;
  const rename = async (to: string) => {
    await click(host.querySelector(".ws-name")!);
    const name = host.querySelector<HTMLInputElement>(".properties input")!;
    await type(name, to);
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await until(() => named() === to);
  };
  /** The top bar's History button. */
  const open = () => host.querySelector<HTMLButtonElement>('.topbar button[aria-label="History"]');
  /** The History list's rows, newest first. */
  const rows = () => [...host.querySelectorAll<HTMLButtonElement>(".history button")];
  return { host, file, named, rename, open, rows };
}

describe("History in the designer", () => {
  it("lists the changes made, goes back to the one picked and forward again, and saves none of it in the file", async () => {
    const { host, file, named, rename, open, rows } = await designer();
    await rename("Shop B");
    await rename("Shop C");
    await click(open()!);
    expect(rows().map((r) => r.firstElementChild!.textContent)).toEqual(["Updated workspace", "Updated workspace", "Before these changes"]);
    expect(rows()[0]!.getAttribute("aria-current")).toBe("true");

    // Back to before either change. The list stays open, with both still there to make again.
    await click(rows()[2]!);
    await until(() => named() === "Shop");
    expect(named()).toBe("Shop");
    expect(rows().map((r) => r.className)).toEqual(["row undone", "row undone", "row active"]);
    expect(await file.load()).toBe(serializeDocument(shop));
    expect(button(host, "Redo").disabled).toBe(false);
    expect(button(host, "Undo").disabled).toBe(true);

    await click(rows()[1]!);
    await until(() => named() === "Shop B");
    expect(named()).toBe("Shop B");
    expect(rows().map((r) => r.className)).toEqual(["row undone", "row active", "row"]);
    expect(await file.load()).toBe(serializeDocument({ ...shop, name: "Shop B" }));

    await click(button(host.querySelector(".modal")!, "Close"));
    expect(host.querySelector(".history")).toBeNull();
  });

  it("says there are no changes yet in a workspace just opened", async () => {
    const { host, open, rows } = await designer();
    await click(open()!);
    expect(rows()).toEqual([]);
    expect(host.querySelector(".modal")!.textContent).toContain("No changes since the workspace was opened, or reloaded.");
  });

  it("says so in the list when a version can't be saved, and stays on the one showing", async () => {
    const { host, file, named, rename, open, rows } = await designer();
    await rename("Shop B");
    await click(open()!);
    file.save = async () => {
      throw new Error("The folder is gone.");
    };
    await click(rows()[1]!);
    await until(() => !!host.querySelector('.modal [role="alert"]'));
    expect(host.querySelector('.modal [role="alert"]')!.textContent).toBe("Couldn't save: The folder is gone.");
    expect(named()).toBe("Shop B");
    expect(rows().map((r) => r.className)).toEqual(["row active", "row"]);

    // Once it can be saved, the pick goes through, and the message comes down.
    file.save = MemoryHost.prototype.save;
    await click(rows()[1]!);
    await until(() => named() === "Shop");
    expect(named()).toBe("Shop");
    expect(host.querySelector('.modal [role="alert"]')).toBeNull();
  });

  it("opens without a message that was up already, and doesn't take one for a pick's", async () => {
    const { host, rename, open, rows } = await designer();
    await rename("Shop B");
    // A change that's refused: a workspace needs a name.
    await click(host.querySelector(".ws-name")!);
    const name = host.querySelector<HTMLInputElement>(".properties input")!;
    await type(name, " ");
    await act(async () => void name.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    await until(() => !!host.querySelector(".toast-error"));
    expect(host.querySelector(".toast-error")).not.toBeNull();

    await click(open()!);
    expect(host.querySelector('.modal [role="alert"]')).toBeNull();
    await click(rows()[1]!);
    await until(() => rows()[1]!.className === "row active");
    expect(rows().map((r) => r.className)).toEqual(["row undone", "row active"]);
    expect(host.querySelector('.modal [role="alert"]')).toBeNull();
  });

  it("has an icon for a button, as tall as the buttons with text beside it, which keeps its size when the top bar is tight", async () => {
    // This page has no layout, so it reads the stylesheet.
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
    document.head.append(style);
    try {
      const { open } = await designer();
      expect(open()!.className).toBe("square");
      expect(open()!.querySelector("svg")).not.toBeNull();
      // A line of text, and a text button's padding and border.
      expect(getComputedStyle(open()!).minHeight).toBe("calc(1lh + 12px)");
      // Only the text gives way.
      expect(getComputedStyle(open()!).flexShrink).toBe("0");
    } finally {
      style.remove();
    }
  });

  it("is in the menu on a narrow screen", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const { host, open } = await designer();
      expect(open()).toBeNull();
      await click(host.querySelector('button[aria-label="More"]')!);
      const item = [...document.querySelectorAll<HTMLElement>('.context-menu [role="menuitem"]')].find((i) => i.textContent?.trim() === "History");
      expect(item).toBeDefined();
      await click(item!);
      expect(host.querySelector(".modal h2")!.textContent).toBe("History");
    } finally {
      window.matchMedia = real;
    }
  });
});
