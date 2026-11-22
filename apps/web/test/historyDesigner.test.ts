// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { serializeDocument, type OpenArchDocument } from "@open-arch/core";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { Designer } from "../src/Designer.js";
import { MemoryHost } from "../src/hosts.js";
import { button, click, mount, type } from "./dom.js";

const shop: OpenArchDocument = {
  openarch: 19,
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
    expect(host.querySelector(".modal")!.textContent).toContain("No changes yet.");
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
