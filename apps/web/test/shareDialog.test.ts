// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenLinkDialog, ShareDialog } from "../src/panels/ShareDialog.js";
import { Settings } from "../src/settings.js";
import { readLink, ShareClient, type LinkParts } from "../src/share.js";
import { button, click, mount, type } from "./dom.js";
import { BUILD_TIMEOUT, startShareServer, type RunningServer } from "./shareServer.js";

let server: RunningServer;
let client: ShareClient;

beforeAll(async () => {
  server = await startShareServer();
  client = new ShareClient(server.url);
}, BUILD_TIMEOUT);
afterAll(() => server?.stop());

/** Lets the dialog's uploads and settings finish, until the dialog shows `text`. */
const until = async (host: HTMLElement, text: string) => {
  for (let i = 0; i < 500 && !host.textContent?.includes(text); i++) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(host.textContent).toContain(text);
};

/** What the share server says about a workspace's latest version: 200 while it's shared, 410 once it isn't. */
const latest = async (id: string) => (await fetch(`${server.url}/v1/workspaces/${id}`)).status;

const file = { name: "a.openarch", text: '{"openarch": 9, "name": "A", "elements": {}, "views": {}}' };

function dialog(settings: Settings, text = file.text) {
  return mount(createElement(ShareDialog, { client, workspace: "browser/a", file: { ...file, text }, designer: "https://designer.example/", settings, onClose() {} }));
}

describe("ShareDialog", () => {
  it("makes a link, updates it, and stops sharing it", async () => {
    const settings = new Settings(`share-dialog-${Math.random()}`);
    let host = dialog(settings);
    await until(host, "encrypted on this device");
    await click(button(host, "Create link"));
    await until(host, "Made a link.");
    const link = host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value;
    const parts = readLink(link)!;
    expect(link.startsWith("https://designer.example/?share=")).toBe(true);
    expect(await settings.share("browser/a")).toMatchObject(parts);
    expect(await latest(parts.id)).toBe(200);

    // Opened again, it shows the same link, and updating it keeps the workspace's ID and key.
    host.remove();
    host = dialog(settings, file.text.replace('"A"', '"A2"'));
    await until(host, "Update link");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value).toBe(link);
    await click(button(host, "Update link"));
    await until(host, "Updated the link.");
    const updated = readLink(host.querySelector<HTMLInputElement>('input[aria-label="Link"]')!.value)!;
    expect(updated).toMatchObject({ id: parts.id, key: parts.key });
    expect(updated.hash).not.toBe(parts.hash);
    expect(host.textContent).toContain("Updated the link.");

    await click(button(host, "Stop sharing…"));
    await click(button(host, "Stop sharing"));
    await until(host, "Stopped sharing it.");
    expect(await latest(parts.id)).toBe(410);
    expect(await settings.share("browser/a")).toBeUndefined();
    expect(button(host, "Create link")).toBeTruthy();
  });
});

describe("OpenLinkDialog", () => {
  it("opens a whole link, and says what's wrong with part of one", async () => {
    const opened: LinkParts[] = [];
    const host = mount(createElement(OpenLinkDialog, { onOpen: (link: LinkParts) => void opened.push(link), onClose() {} }));
    const input = host.querySelector("input")!;
    const key = "k".repeat(43);
    await type(input, "https://designer.example/?share=abcdefghijklmnopqrstuv&v=ABCDEFGHIJKLMNOPQRSTUV");
    await click(button(host, "Open"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("That isn't a whole share link.");
    expect(opened).toEqual([]);

    await type(input, `https://designer.example/?share=abcdefghijklmnopqrstuv&v=ABCDEFGHIJKLMNOPQRSTUV#key=${key}`);
    await click(button(host, "Open"));
    expect(opened).toEqual([{ id: "abcdefghijklmnopqrstuv", hash: "ABCDEFGHIJKLMNOPQRSTUV", key }]);
  });
});
