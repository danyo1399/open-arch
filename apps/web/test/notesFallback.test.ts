// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotesEditor } from "../src/panels/dialogs.js";
import { button, click, mount } from "./dom.js";

// As when the app is offline and the formatted view was never loaded.
vi.mock("../src/panels/richNotes.js", () => ({ richNotes: () => Promise.reject(new Error("Failed to fetch")) }));

describe("the notes editor without its formatted view", () => {
  it("shows the notes as markdown, says why, and still saves them", async () => {
    const saving: string[] = [];
    const host = mount(createElement(NotesEditor, { name: "Orders API", text: "Takes orders.", saved: "Takes orders.", onSave: async (t: string) => (saving.push(t), true), onClose() {} }));
    // Each look lets React draw what loading, or failing to, changed.
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector("textarea")).not.toBeNull();
    });
    expect(host.textContent).toContain("The formatted view couldn't be loaded, so the notes are shown as markdown.");
    expect(button(host, "Formatted").disabled).toBe(true);
    expect(button(host, "Markdown").getAttribute("aria-pressed")).toBe("true");
    const box = host.querySelector("textarea")!;
    expect(box.value).toBe("Takes orders.");
    box.value = "Takes refunds.";
    await click(button(host, "Done"));
    expect(saving).toEqual(["Takes refunds."]);
  });
});
