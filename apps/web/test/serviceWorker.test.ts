import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const ORIGIN = "https://example.com/open-arch/";

/** Each build's cache: its name, and the files in it by URL. */
type Caches = Record<string, Record<string, string>>;

/** Runs sw.js, as build `version` writes it, with these caches and host, and returns what it answers a GET for `path` with. */
async function answer(version: string, stored: Caches, host: Record<string, string>, path: string): Promise<string> {
  const listeners: Record<string, (event: unknown) => void> = {};
  const self = { location: new URL(`${ORIGIN}sw.js`), addEventListener: (type: string, listener: (event: unknown) => void) => (listeners[type] = listener) };
  const caches = {
    keys: async () => Object.keys(stored),
    open: async (name: string) => {
      const files = (stored[name] ??= {});
      return { match: async (request: Request) => (request.url in files ? new Response(files[request.url]) : undefined) };
    },
  };
  const fetch = async (request: Request) => (request.url in host ? new Response(host[request.url]) : new Response("not found", { status: 404 }));
  new Function("self", "caches", "fetch", `const VERSION = ${JSON.stringify(version)};\nconst FILES = [];\n${SOURCE}`)(self, caches, fetch);
  let response: Promise<Response> | undefined;
  listeners.fetch!({ request: new Request(`${ORIGIN}${path}`), respondWith: (r: Promise<Response>) => (response = r) });
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

  it("leaves other apps' caches alone", async () => {
    const stored = { "open-arch-a": {}, "another-app": { [`${ORIGIN}assets/notes-b.js`]: "theirs" } };
    expect(await answer("a", stored, { [`${ORIGIN}assets/notes-b.js`]: "notes b" }, "assets/notes-b.js")).toBe("notes b");
  });

  it("fetches a file no cache has", async () => {
    expect(await answer("a", { "open-arch-a": {} }, { [`${ORIGIN}assets/notes-b.js`]: "notes b" }, "assets/notes-b.js")).toBe("notes b");
  });
});
