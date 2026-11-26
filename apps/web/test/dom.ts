/**
 * Renders designer components into a page for tests that click them. A test file that uses this
 * starts with `// @vitest-environment happy-dom`, so it has a page to render into.
 */
import { act, type ReactElement } from "react";
import type { MenuHost } from "../src/canvas/DiagramMenu.js";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";

// Tells React that tests wrap their updates in act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; host: HTMLElement }[] = [];

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

/** Renders an element into the page, and returns what it rendered into. */
export function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ root, host });
  return host;
}

/** Clicks an element, and lets React finish what the click started. */
export async function click(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Presses the pointer on an element and lets go without moving it, as a click on something that can be dragged. */
export async function press(target: Element): Promise<void> {
  // Apart, so React renders the press before the release.
  for (const type of ["pointerdown", "pointerup"]) {
    await act(async () => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
    });
  }
}

/** Types text into a box, replacing what's there, as a person would. */
export async function type(input: HTMLInputElement, text: string): Promise<void> {
  await act(async () => {
    // Through the page's own setter, so React sees the value change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses a key on an element. */
export async function key(target: Element, name: string): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

/** Picks an option in a select, as a person would. */
export async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The button whose text is exactly this. */
export function button(host: HTMLElement, text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`No button "${text}". Buttons: ${[...host.querySelectorAll("button")].map((b) => `"${b.textContent?.trim()}"`).join(", ")}`);
  return found;
}

/** The checkbox labelled with this text. */
export function checkbox(host: HTMLElement, text: string): HTMLInputElement {
  const label = [...host.querySelectorAll("label")].find((l) => l.textContent?.trim() === text);
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error(`No checkbox "${text}".`);
  return input;
}

/** The select in the field with this label. */
export function select(host: HTMLElement, label: string): HTMLSelectElement {
  const field = [...host.querySelectorAll("label.field")].find((l) => l.querySelector(".field-label")?.textContent === label);
  const found = field?.querySelector("select");
  if (!found) throw new Error(`No select "${label}".`);
  return found;
}

/** The button of a field that picks from a list with a search box (see SearchSelect), by the field's label. */
export function picker(host: HTMLElement, label: string): HTMLButtonElement {
  const field = [...host.querySelectorAll(".search-select")].find((f) => f.querySelector(".field-label")?.textContent === label);
  const found = field?.querySelector<HTMLButtonElement>(".search-select-button");
  if (!found) throw new Error(`No field "${label}" to pick from.`);
  return found;
}

/** What a field with a search box lists, in order: none when it's turned off. Opens the list to read it, and closes it again. */
export async function choicesIn(host: HTMLElement, label: string): Promise<{ value: string; label: string }[]> {
  const button = picker(host, label);
  if (button.disabled) return [];
  await click(button);
  const field = button.closest(".search-select")!;
  const found = [...field.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => ({ value: o.dataset.value!, label: o.textContent! }));
  await key(field.querySelector('input[type="search"]')!, "Escape");
  return found;
}

/** Picks the choice with this name in a field with a search box, as a person would: opening its list, unless it's open, searching for the name, and clicking it. */
export async function pick(host: HTMLElement, label: string, name: string): Promise<void> {
  if (picker(host, label).getAttribute("aria-expanded") !== "true") await click(picker(host, label));
  const field = picker(host, label).closest(".search-select")!;
  await type(field.querySelector<HTMLInputElement>('input[type="search"]')!, name);
  const option = [...field.querySelectorAll('[role="option"]')].find((o) => o.textContent === name);
  if (!option) throw new Error(`No "${name}" to pick in "${label}".`);
  await click(option);
}

/**
 * What a diagram's right-click menus need, for a diagram drawn on its own, with no designer round
 * it: nothing is ever on its way, so a menu is for what was clicked, in the view with this ID.
 */
export function menusFor(view: string): MenuHost {
  return { afterEdits: async (on, then) => then(on, view, 0), renames: [] };
}
