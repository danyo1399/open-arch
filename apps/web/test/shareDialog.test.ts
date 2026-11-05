// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { describe, expect, it } from "vitest";
import { handle } from "../../server/src/handler.js";
import { MemoryStore } from "../../server/src/store.js";
import { OpenLinkDialog, ShareDialog } from "../src/panels/ShareDialog.js";
import { Settings } from "../src/settings.js";
import { readLink, ShareClient, type LinkParts } from "../src/share.js";
import { button, click, mount, type } from "./dom.js";

const store = new MemoryStore();
const client = new ShareClient("https://share.example", (input, init) =>
  handle(new Request(input, init), { store, client: { ip: null, country: null, city: null, asn: null, asOrganization: null, userAgent: null, origin: null, referer: null, ray: null } }),
);

/** Lets the dialog's uploads and settings finish, and React render what they found. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
};

const file = { name: "a.openarch", text: '{"openarch": 9, "name": "A", "elements": {}, "views": {}}' };

function dialog(settings: Settings, text = file.text) {
  return mount(createElement(ShareDialog, { client, workspace: "browser/a", file: { ...file, text }, designer: "https://designer.example/", settings, onClose() {} }));
}

describe("ShareDialog", () => {
  it("makes a link, updates it, and stops sharing it", async () => {
    const settings = new Settings(`share-dialog-${Math.random()}`);
    let host = dialog(settings);
    await settle();
    expect(host.textContent).toContain("encrypted on this device");
    await click(button(host, "Create link"));
    await settle();
    const link = host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value;
    const parts = readLink(link)!;
    expect(link.startsWith("https://designer.example/?share=")).toBe(true);
    expect(await settings.share("browser/a")).toMatchObject(parts);
    expect(store.workspaces.has(parts.id)).toBe(true);

    // Opened again, it shows the same link, and updating it keeps the workspace's ID and key.
    host.remove();
    host = dialog(settings, file.text.replace('"A"', '"A2"'));
    await settle();
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value).toBe(link);
    await click(button(host, "Update link"));
    await settle();
    const updated = readLink(host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value)!;
    expect(updated).toMatchObject({ id: parts.id, key: parts.key });
    expect(updated.hash).not.toBe(parts.hash);
    expect(host.textContent).toContain("Updated the link.");

    await click(button(host, "Stop sharing…"));
    await click(button(host, "Stop sharing"));
    await settle();
    expect(store.workspaces.get(parts.id)?.deleted).not.toBeNull();
    expect(await settings.share("browser/a")).toBeUndefined();
    expect(host.textContent).toContain("Stopped sharing it.");
    expect(button(host, "Create link")).toBeTruthy();
  });
});

describe("OpenLinkDialog", () => {
  it("opens a whole link, and says what's wrong with part of one", async () => {
    const opened: LinkParts[] = [];
    const host = mount(createElement(OpenLinkDialog, { onOpen: (link: LinkParts) => void opened.push(link), onClose() {} }));
    const input = host.querySelector("input")!;
    const key = "k".repeat(43);
    await type(input, "https://designer.example/?share=abcdefghijklmnop&v=ABCDEFGHIJKLMNOPQRSTUV");
    await click(button(host, "Open"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("That isn't a whole share link.");
    expect(opened).toEqual([]);

    await type(input, `https://designer.example/?share=abcdefghijklmnop&v=ABCDEFGHIJKLMNOPQRSTUV#key=${key}`);
    await click(button(host, "Open"));
    expect(opened).toEqual([{ id: "abcdefghijklmnop", hash: "ABCDEFGHIJKLMNOPQRSTUV", key }]);
  });
});
