import "fake-indexeddb/auto";
import { strFromU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../../server/src/handler.js";
import { MemoryStore } from "../../server/src/store.js";
import { exampleHost, SharedHost } from "../src/hosts.js";
import { Settings } from "../src/settings.js";
import { linkTo, readLink, seal, ShareClient, unseal, newKey, type Share } from "../src/share.js";

let store: MemoryStore;
/** Every URL the designer asked the share server for. */
let requested: string[];
let online: boolean;

/** A client whose requests go straight to the share server's handler, with its files in memory. */
function client(): ShareClient {
  return new ShareClient("https://share.example/", async (input, init) => {
    if (!online) throw new TypeError("Failed to fetch");
    const request = new Request(input, init);
    requested.push(request.url);
    return handle(request, { store, client: { ip: "203.0.113.7", country: null, city: null, asn: null, asOrganization: null, userAgent: null, origin: null, referer: null, ray: null } });
  });
}

beforeEach(() => {
  store = new MemoryStore();
  requested = [];
  online = true;
});

const shop = async () => ({ name: "shop.openarch", text: await exampleHost().load() });

describe("sharing a link", () => {
  it("compresses and encrypts a workspace so only the key opens it", async () => {
    const file = await shop();
    const key = newKey();
    const sealed = await seal(file, key);
    expect(sealed[0]).toBe(1);
    // Compressed, it's a fraction of the size.
    expect(sealed.length).toBeLessThan(file.text.length / 3);
    expect(strFromU8(sealed, true)).not.toContain("Shop");
    expect(await unseal(sealed, key)).toEqual(file);
    await expect(unseal(sealed, newKey())).rejects.toThrow("The link's key doesn't open this workspace.");
    const tampered = sealed.slice();
    tampered[20]! ^= 1;
    await expect(unseal(tampered, key)).rejects.toThrow("The link's key doesn't open this workspace.");
  });

  it("puts the key after the #, so it's never sent to a server", async () => {
    const parts = { id: "abcdefghijklmnop", hash: "ABCDEFGHIJKLMNOPQRSTUV", key: newKey() };
    const link = linkTo("https://designer.example/open-arch/?old=1#elsewhere", parts);
    expect(link).toBe(`https://designer.example/open-arch/?share=abcdefghijklmnop&v=ABCDEFGHIJKLMNOPQRSTUV#key=${parts.key}`);
    expect(new URL(link).hash).toBe(`#key=${parts.key}`);
    expect(readLink(` ${link} `)).toEqual(parts);
    expect(readLink(link.replace(/#.*/, ""))).toBeNull();
    expect(readLink("not a link")).toBeNull();
  });

  it("uploads only what the server can't read, and opens it from the link", async () => {
    const share = await client().create(await shop(), 5);
    expect(share).toMatchObject({ updated: 5 });
    const [stored] = [...store.files.values()];
    expect(strFromU8(stored!, true)).not.toContain("Shop");

    const link = readLink(linkTo("https://designer.example/", share))!;
    expect(await client().open(link)).toEqual(await shop());
    // The key never went to the server, nor the token in a URL.
    expect(requested.some((url) => url.includes(share.key) || url.includes(share.token))).toBe(false);
    expect(requested).toEqual(["https://share.example/v1/workspaces", `https://share.example/v1/workspaces/${share.id}`, `https://share.example/v1/workspaces/${share.id}/${share.hash}`]);
  });

  it("opens the latest version from a link to an older one, or the link's own when offline", async () => {
    const first = await client().create(await shop());
    const changed = { name: "shop.openarch", text: (await shop()).text.replace('"Shop"', '"Shop, changed"') };
    const second = await client().update(first, changed);
    expect(second.id).toBe(first.id);
    expect(second.key).toBe(first.key);
    expect(second.hash).not.toBe(first.hash);

    expect((await client().open(first)).text).toBe(changed.text);

    // Offline, the server can't say which is the latest: the link's version is what the browser may have cached.
    let calls = 0;
    const flaky = new ShareClient("https://share.example", async (input, init) => {
      if (calls++ === 0) throw new TypeError("Failed to fetch");
      return handle(new Request(input, init), { store, client: { ip: null, country: null, city: null, asn: null, asOrganization: null, userAgent: null, origin: null, referer: null, ray: null } });
    });
    expect((await flaky.open(first)).text).toBe((await shop()).text);
  });

  it("lets only whoever shared it update it, and stops the links when they stop sharing", async () => {
    const share = await client().create(await shop());
    const stranger: Share = { ...share, token: "not-the-token" };
    await expect(client().update(stranger, await shop())).rejects.toThrow("Couldn't update the link: Only whoever shared this workspace can change it.");

    await client().remove(share);
    await expect(client().open(share)).rejects.toThrow(/^This workspace isn't shared any more/);
    // Stopping again is fine: it isn't shared either way.
    await client().remove(share);
  });

  it("says when the share server can't be reached", async () => {
    online = false;
    await expect(client().create(await shop())).rejects.toThrow("Couldn't share it: the share server didn't answer. Check you're online.");
  });

  it("opens a shared link as a workspace that's only in this tab until it's saved", async () => {
    const share = await client().create({ name: "../../shop", text: (await shop()).text });
    const host = new SharedHost(client(), share);
    expect(host).toMatchObject({ storage: "memory", key: `shared/${share.id}` });
    expect(await host.load()).toBe((await shop()).text);
    // Only the last part of the name it was shared with, as a .openarch file.
    expect(host.name).toBe("shop.openarch");
    // Loaded once, however many times it's asked.
    expect(await Promise.all([host.load(), host.load()])).toHaveLength(2);
    expect(requested.filter((url) => url.includes(share.hash))).toHaveLength(1);

    await host.save("changed");
    expect(await host.load()).toBe("changed");
  });

  it("won't open a shared file the designer couldn't edit", async () => {
    const share = await client().create({ name: "bad.openarch", text: "{}" });
    await expect(new SharedHost(client(), share).load()).rejects.toThrow("bad.openarch isn't an open-arch workspace.");
    await expect(new SharedHost(null, share).load()).rejects.toThrow("This designer can't open shared links");
  });

  it("keeps the link a workspace was shared as in the settings, until it's forgotten", async () => {
    const settings = new Settings(`share-settings-${Math.random()}`);
    const share = await client().create(await shop());
    expect(await settings.share("browser/a")).toBeUndefined();
    await settings.setShare("browser/a", share);
    expect(await settings.share("browser/a")).toEqual(share);
    await settings.forget("browser/a");
    expect(await settings.share("browser/a")).toBeUndefined();
  });
});
