// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { MenuButton } from "../src/panels/ContextMenu.js";
import { button, click, mount } from "./dom.js";

function menu() {
  const chosen: string[] = [];
  const host = mount(createElement(MenuButton, { items: [{ label: "Copy", onSelect: () => void chosen.push("copy") }], children: "Export" }));
  return { host, chosen, open: () => button(host, "Export").getAttribute("aria-expanded") === "true", items: () => [...document.querySelectorAll<HTMLButtonElement>('.context-menu [role="menuitem"]')] };
}

/** Presses the pointer on an element, as the start of a click. */
async function pointerDown(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
  });
}

/** A click with the mouse, which says how many presses it was, unlike one from the keyboard. */
async function mouseClick(target: Element): Promise<void> {
  await pointerDown(target);
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
}

describe("MenuButton", () => {
  it("opens its menu on the page, and an item runs and closes it", async () => {
    const { host, chosen, open, items } = menu();
    expect(open()).toBe(false);
    await mouseClick(button(host, "Export"));
    expect(open()).toBe(true);
    // On the page itself, not inside whatever the button is in.
    expect(host.querySelector(".context-menu")).toBeNull();
    await click(items()[0]!);
    expect(chosen).toEqual(["copy"]);
    expect(open()).toBe(false);
  });

  it("closes its menu when the button is clicked again, rather than opening it again", async () => {
    const { host, open, items } = menu();
    await mouseClick(button(host, "Export"));
    await mouseClick(button(host, "Export"));
    expect(open()).toBe(false);
    expect(items()).toEqual([]);
  });

  it("opens and closes from the keyboard, which presses nothing", async () => {
    const { host, open } = menu();
    await click(button(host, "Export"));
    expect(open()).toBe(true);
    await click(button(host, "Export"));
    expect(open()).toBe(false);
  });
});
