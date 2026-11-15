// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { strFromU8, unzipSync } from "fflate";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { exampleHost } from "../src/hosts.js";
import { SKILL_TARGETS } from "../src/skill.js";
import { button, click, mount } from "./dom.js";
import { FakeFolder } from "./fakeFolder.js";

const until = async (done: () => boolean) => {
  for (let i = 0; i < 200 && !done(); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Export zip", () => {
  it("downloads the open example with its docs and the agent skill", async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => (blobs.push(blob as Blob), "blob:zip"));
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const host = mount(createElement(App, {}));
    await until(() => !!host.textContent?.includes("Try the example"));
    await click(button(host, "Try the example"));
    await until(() => !!host.querySelector(".ws-name"));
    await click(button(host, "Export zip"));

    expect(names).toEqual(["shop.zip"]);
    const files = unzipSync(new Uint8Array(await blobs[0]!.arrayBuffer()));
    expect(strFromU8(files["shop/shop.openarch"]!)).toBe(await exampleHost().load());
    expect(Object.keys(files)).toContain("shop/docs/README.md");
    for (const target of SKILL_TARGETS) expect(Object.keys(files)).toContain(`shop/${target}/SKILL.md`);
  });
});

describe("Export to folder", () => {
  it("writes the open example to a folder the user picks, and says so", async () => {
    const root = new FakeFolder("repo");
    Object.assign(window, { showDirectoryPicker: async () => root });
    const host = mount(createElement(App, {}));
    await until(() => !!host.textContent?.includes("Try the example"));
    await click(button(host, "Try the example"));
    await until(() => !!host.querySelector(".ws-name"));
    await click(button(host, "Export to folder…"));
    await until(() => !!host.textContent?.includes("Exported shop.openarch"));
    expect(host.textContent).toContain("Exported shop.openarch, its docs, the agent skill and AGENTS.md to repo.");
    expect(root.files()["shop.openarch"]).toBe(await exampleHost().load());
    expect(Object.keys(root.files())).toContain("AGENTS.md");
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it("isn't offered where the browser can't write to a folder", async () => {
    const host = mount(createElement(App, {}));
    await until(() => !!host.textContent?.includes("Try the example"));
    await click(button(host, "Try the example"));
    await until(() => !!host.querySelector(".ws-name"));
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Export to folder…")).toBe(false);
  });
});
