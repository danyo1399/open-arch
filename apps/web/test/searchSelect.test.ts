// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { matchingChoices, SearchSelect, sortedChoices, type Choice } from "../src/panels/SearchSelect.js";
import { click, key, mount, picker, type } from "./dom.js";

const choices: Choice[] = [
  { value: "order-line", label: "Order line" },
  { value: "customer", label: "Customer" },
  { value: "step-10", label: "Step 10" },
  { value: "order", label: "order" },
  { value: "step-2", label: "Step 2" },
];

/** The field, picking `value`, keeping what it's changed to. */
function field(value = "customer", missing?: string) {
  const changes: string[] = [];
  const host = mount(createElement(SearchSelect, { label: "To", value, choices, missing, onChange: (v: string) => void changes.push(v) }));
  const search = () => host.querySelector<HTMLInputElement>('input[type="search"]');
  const listed = () => [...host.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  return { host, changes, search, listed };
}

describe("a field that picks from a list with a search box", () => {
  it("lists the choices in alphabetical order, case aside, with numbers in order", () => {
    expect(sortedChoices(choices).map((c) => c.label)).toEqual(["Customer", "order", "Order line", "Step 2", "Step 10"]);
  });

  it("finds the choices with every word searched for, in any order, case aside", () => {
    expect(matchingChoices(choices, "ORDER").map((c) => c.value)).toEqual(["order-line", "order"]);
    expect(matchingChoices(choices, "line order").map((c) => c.value)).toEqual(["order-line"]);
    expect(matchingChoices(choices, "  ")).toHaveLength(choices.length);
    expect(matchingChoices(choices, "invoice")).toEqual([]);
  });

  it("shows what's picked, and opens to a search box and the list in order, with it marked", async () => {
    const { host, search, listed } = field();
    expect(picker(host, "To").textContent).toBe("Customer");
    expect(search()).toBeNull();
    await click(picker(host, "To"));
    expect(picker(host, "To").getAttribute("aria-expanded")).toBe("true");
    expect(search()!.placeholder).toBe("Search");
    expect(document.activeElement).toBe(search());
    expect(listed()).toEqual(["Customer", "order", "Order line", "Step 2", "Step 10"]);
    expect(host.querySelector('[aria-selected="true"]')!.textContent).toBe("Customer");
  });

  it("filters the list as you type, and picks what's clicked", async () => {
    const { host, changes, search, listed } = field();
    await click(picker(host, "To"));
    await type(search()!, "ord");
    expect(listed()).toEqual(["order", "Order line"]);
    await click(host.querySelectorAll('[role="option"]')[1]!);
    expect(changes).toEqual(["order-line"]);
    expect(search()).toBeNull();
  });

  it("says when nothing matches", async () => {
    const { host, search, listed } = field();
    await click(picker(host, "To"));
    await type(search()!, "invoice");
    expect(listed()).toEqual([]);
    expect(host.querySelector(".search-select-none")!.textContent).toBe("Nothing matches");
    await key(search()!, "Enter");
    expect(search()).not.toBeNull();
  });

  it("moves through the list with the arrows from what's picked, and picks with Enter", async () => {
    const { host, changes, search } = field("order");
    await key(picker(host, "To"), "ArrowDown");
    expect(host.querySelector(".active")!.textContent).toBe("order");
    await key(search()!, "ArrowDown");
    await key(search()!, "ArrowDown");
    await key(search()!, "ArrowUp");
    expect(host.querySelector(".active")!.textContent).toBe("Order line");
    expect(search()!.getAttribute("aria-activedescendant")).toBe(host.querySelector(".active")!.id);
    await key(search()!, "Enter");
    expect(changes).toEqual(["order-line"]);
  });

  it("closes with Esc, changing nothing, and changes nothing when what's picked is picked again", async () => {
    const { host, changes, search } = field();
    await click(picker(host, "To"));
    await type(search()!, "step");
    await key(search()!, "Escape");
    expect(search()).toBeNull();
    expect(document.activeElement).toBe(picker(host, "To"));
    await click(picker(host, "To"));
    // The search starts again.
    expect(search()!.value).toBe("");
    await key(search()!, "Enter");
    expect(changes).toEqual([]);
  });

  it("closes, changing nothing, when the focus goes elsewhere, or Tab leaves it", async () => {
    const { host, changes, search } = field();
    const outside = host.appendChild(document.createElement("button"));
    await click(picker(host, "To"));
    await type(search()!, "step");
    // A click on something outside it, which the focus goes to.
    await act(async () => {
      search()!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    });
    expect(search()).toBeNull();
    await click(picker(host, "To"));
    await key(search()!, "Tab");
    expect(search()).toBeNull();
    expect(changes).toEqual([]);
    expect(picker(host, "To").textContent).toBe("Customer");
  });

  it("closes when its button is pressed again, keeping the focus in the search box until the click, as Safari doesn't move it to the button", async () => {
    const { host, search } = field();
    await click(picker(host, "To"));
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    await act(async () => {
      picker(host, "To").dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(search()).not.toBeNull();
    await click(picker(host, "To"));
    expect(search()).toBeNull();
    // Closed, pressing it lets the focus go to it as usual.
    const again = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    picker(host, "To").dispatchEvent(again);
    expect(again.defaultPrevented).toBe(false);
  });

  it("keeps Delete and Backspace from the designer, which would delete what's selected", async () => {
    const { host } = field();
    const heard: string[] = [];
    const listen = (e: KeyboardEvent) => void heard.push(e.key);
    window.addEventListener("keydown", listen);
    try {
      await key(picker(host, "To"), "Delete");
      await key(picker(host, "To"), "Backspace");
      await key(picker(host, "To"), "Tab");
    } finally {
      window.removeEventListener("keydown", listen);
    }
    expect(heard).toEqual(["Tab"]);
  });

  it("says what it has when that isn't one of the choices", () => {
    expect(picker(field("gone", "gone (not an entity)").host, "To").textContent).toBe("gone (not an entity)");
  });
});
