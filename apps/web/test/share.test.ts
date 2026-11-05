import "fake-indexeddb/auto";
import { strFromU8 } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exampleHost, SharedHost } from "../src/hosts.js";
import { Settings } from "../src/settings.js";
import { linkTo, readLink, seal, ShareClient, unseal, newKey, type Share } from "../src/share.js";
import { BUILD_TIMEOUT, startShareServer, type RunningServer } from "./shareServer.js";

let server: RunningServer;
/** Every URL the designer asked the share server for. */
let requested: string[];
let online: boolean;

beforeAll(async () => {
  server = await startShareServer();
}, BUILD_TIMEOUT);
afterAll(() => server?.stop());

/** A client of the share server, which notes what it asks for, and can be offline. */
function client(): ShareClient {
  return new ShareClient(`${server.url}/`, async (input, init) => {
    if (!online) throw new TypeError("Failed to fetch");
    requested.push(String(input));
    return fetch(input, init);
  });
}

beforeEach(() => {
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
    const parts = { id: "abcdefghijklmnopqrstuv", hash: "ABCDEFGHIJKLMNOPQRSTUV", key: newKey() };
    const link = linkTo("https://designer.example/open-arch/?old=1#elsewhere", parts);
    expect(link).toBe(`https://designer.example/open-arch/?share=abcdefghijklmnopqrstuv&v=ABCDEFGHIJKLMNOPQRSTUV#key=${parts.key}`);
    expect(new URL(link).hash).toBe(`#key=${parts.key}`);
    expect(readLink(` ${link} `)).toEqual(parts);
    expect(readLink(link.replace(/#.*/, ""))).toBeNull();
    expect(readLink("not a link")).toBeNull();
  });

  it("uploads only what the server can't read, and opens it from the link", async () => {
    const share = await client().create(await shop(), 5);
    expect(share).toMatchObject({ updated: 5 });
    const stored = new Uint8Array(await (await fetch(`${server.url}/v1/workspaces/${share.id}/${share.hash}`)).arrayBuffer());
    expect(strFromU8(stored, true)).not.toContain("Shop");

    const link = readLink(linkTo("https://designer.example/", share))!;
    expect(await client().open(link)).toEqual({ ...(await shop()), hash: share.hash });
    // The key never went to the server, nor the token in a URL.
    expect(requested.some((url) => url.includes(share.key) || url.includes(share.token))).toBe(false);
    expect(requested).toEqual([`${server.url}/v1/workspaces`, `${server.url}/v1/workspaces/${share.id}`, `${server.url}/v1/workspaces/${share.id}/${share.hash}`]);
  });

  it("replaces the version before, and opens the latest from a link to an older one", async () => {
    const first = await client().create(await shop());
    const changed = { name: "shop.openarch", text: (await shop()).text.replace('"Shop"', '"Shop, changed"') };
    const second = await client().update(first, changed);
    expect(second.id).toBe(first.id);
    expect(second.key).toBe(first.key);
    expect(second.hash).not.toBe(first.hash);

    expect(await client().open(first)).toEqual({ ...changed, hash: second.hash });

    // The first version is gone: its URL sends whoever asks for it on to the latest's.
    const old = await fetch(`${server.url}/v1/workspaces/${first.id}/${first.hash}`, { redirect: "manual" });
    expect(old.status).toBe(302);
    expect(old.headers.get("Location")).toBe(`/v1/workspaces/${first.id}/${second.hash}`);
    expect(old.headers.get("Cache-Control")).toBe("no-store");

    // When the server can't say which is the latest, as offline, the link's version is asked for:
    // a browser that cached it would open that, and the server sends it on to the latest.
    let calls = 0;
    const flaky = new ShareClient(server.url, async (input, init) => {
      if (calls++ === 0) throw new TypeError("Failed to fetch");
      return fetch(input, init);
    });
    expect(await flaky.open(first)).toEqual({ ...changed, hash: second.hash });
  });

  it("changes the link of a workspace opened from an older one to the latest's", async () => {
    const first = await client().create(await shop());
    const changed = { name: "shop.openarch", text: (await shop()).text.replace('"Shop"', '"Shop, changed"') };
    const second = await client().update(first, changed);
    const host = new SharedHost(client(), first);
    const changes: string[] = [];
    host.onLinkChange(() => changes.push(host.link.hash));
    expect(host.link.hash).toBe(first.hash);
    expect(await host.load()).toBe(changed.text);
    expect(host.link).toMatchObject({ id: first.id, hash: second.hash, key: first.key });
    expect(changes).toEqual([second.hash]);

    // Opened from the latest's link, it stays as it is.
    const current = new SharedHost(client(), second);
    current.onLinkChange(() => changes.push("changed"));
    await current.load();
    expect(changes).toEqual([second.hash]);
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

  it("stops sharing a workspace the server no longer has", async () => {
    // As after a server that keeps them in memory restarts: it answers 404 for it.
    const lost: Share = { id: "A".repeat(22), hash: "B".repeat(22), key: newKey(), token: "t".repeat(43), updated: 1 };
    await expect(client().remove(lost)).resolves.toBeUndefined();
  });

  it("doesn't take any other 404 to mean a workspace is gone", async () => {
    const share = await client().create(await shop());
    // A wrong address for the server, as a proxy sending it elsewhere would give: 404, "nothing here".
    const astray = new ShareClient(`${server.url}/elsewhere`);
    await expect(astray.remove(share)).rejects.toThrow("Couldn't stop sharing it: There's nothing here.");
    // So it's still shared, and the token still stops it.
    expect((await fetch(`${server.url}/v1/workspaces/${share.id}`)).status).toBe(200);
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
