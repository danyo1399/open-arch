/**
 * Renders designer components into a page for tests that click them. A test file that uses this
 * starts with `// @vitest-environment happy-dom`, so it has a page to render into.
 */
import { act, type ReactElement } from "react";
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
