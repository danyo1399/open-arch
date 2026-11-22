import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const ORIGIN = "https://example.com/open-arch/";

/** Each build's cache: its name, and the files in it by URL. */
type Caches = Record<string, Record<string, string>>;

/**
 * Runs sw.js, as build `version` writes it, with these caches and host (null for none: offline), and returns what it answers a
 * GET for `path` with: a file's, or with `navigate`, the app opening at it. `fetched` gets each request
 * it sends the host.
 */
async function answer(version: string, stored: Caches, host: Record<string, string> | null, path: string, { navigate = false, fetched = [] as Request[] } = {}): Promise<string> {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = { location: new URL(`${ORIGIN}sw.js`), addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] = listener) };
  const caches = {
    keys: async () => Object.keys(stored),
    open: async (name: string) => {
      const files = (stored[name] ??= {});
      return {
        match: async (request: Request | string) => {
          const url = typeof request === "string" ? request : request.url;
          return url in files ? new Response(files[url]) : undefined;
        },
      };
    },
  };
  const fetch = async (request: Request) => {
    fetched.push(request);
    if (!host) throw new TypeError("Failed to fetch");
    return request.url in host ? new Response(host[request.url]) : new Response("not found", { status: 404 });
  };
  new Function("self", "caches", "fetch", `const VERSION = ${JSON.stringify(version)};\nconst FILES = [];\n${SOURCE}`)(self, caches, fetch);
  let response: Promise<Response> | undefined;
  // A Request can't be made with the navigate mode, so the app opening is one in shape.
  const request = navigate ? { method: "GET", url: `${ORIGIN}${path}`, mode: "navigate" } : new Request(`${ORIGIN}${path}`);
  listeners.fetch!({ request, respondWith: (r: Promise<Response>) => (response = r) });
  return (await response!).text();
}

describe("the service worker", () => {
  it("serves a file from its own build's cache", async () => {
    expect(await answer("a", { "open-arch-a": { [`${ORIGIN}assets/notes-a.js`]: "notes a" } }, {}, "assets/notes-a.js")).toBe("notes a");
  });

  // A tab opened online runs the latest build while the worker before it still serves it. Once
  // the host has a newer build, the file is only in the waiting worker's cache.
  it("serves the next build's file from that build's cache, after the host has replaced it", async () => {
    const stored = { "open-arch-a": { [`${ORIGIN}assets/notes-a.js`]: "notes a" }, "open-arch-b": { [`${ORIGIN}assets/notes-b.js`]: "notes b" } };
    expect(await answer("a", stored, { [`${ORIGIN}assets/notes-c.js`]: "notes c" }, "assets/notes-b.js")).toBe("notes b");
  });

  // Files the build doesn't name by their contents, like its icons, are different in each build.
  it("serves its own build's copy of a file another build's cache has too", async () => {
    const stored = { "open-arch-b": { [`${ORIGIN}manifest.webmanifest`]: "manifest b" }, "open-arch-a": { [`${ORIGIN}manifest.webmanifest`]: "manifest a" } };
    expect(await answer("a", stored, {}, "manifest.webmanifest")).toBe("manifest a");
  });

  it("leaves other apps' caches alone", async () => {
    const stored = { "open-arch-a": {}, "another-app": { [`${ORIGIN}assets/notes-b.js`]: "theirs" } };
    expect(await answer("a", stored, { [`${ORIGIN}assets/notes-b.js`]: "notes b" }, "assets/notes-b.js")).toBe("notes b");
  });

  // Past the browser's cache, so it's the build that the browser's check for a new worker installs.
  it("opens the app the host has now, past the browser's cache", async () => {
    const fetched: Request[] = [];
    const stored = { "open-arch-a": { [ORIGIN]: "app a" } };
    expect(await answer("a", stored, { [ORIGIN]: "app b" }, "", { navigate: true, fetched })).toBe("app b");
    expect(fetched.map((request) => request.cache)).toEqual(["no-cache"]);
  });

  it("opens its own build's app offline", async () => {
    const stored = { "open-arch-b": { [ORIGIN]: "app b" }, "open-arch-a": { [ORIGIN]: "app a" } };
    expect(await answer("a", stored, null, "?share=1", { navigate: true })).toBe("app a");
  });

  it("fetches a file no cache has", async () => {
    expect(await answer("a", { "open-arch-a": {} }, { [`${ORIGIN}assets/notes-b.js`]: "notes b" }, "assets/notes-b.js")).toBe("notes b");
  });
});
