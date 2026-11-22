import { describe, expect, it } from "vitest";
import { cleanBaseUrl, readAiSettings, readsFiles, setReadsFiles, settingsProblem, writeAiSettings } from "../src/ai/settings.js";

/** A browser's local storage, in memory. */
class FakeStorage implements Storage {
  readonly items = new Map<string, string>();
  /** A browser that won't keep anything more, such as one whose storage is full. */
  full = false;
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    this.items.set(key, value);
  }
}

const settings = { baseUrl: "https://api.openai.com/v1", apiKey: "sk-secret", model: "gpt-5" };

describe("Ask AI's settings, in the web app", () => {
  it("are kept in the browser's local storage, tidied, and read back from it", () => {
    const storage = new FakeStorage();
    expect(readAiSettings(storage)).toBeNull();
    writeAiSettings({ baseUrl: " https://api.openai.com/v1/chat/completions/ ", apiKey: " sk-secret\n", model: " gpt-5 " }, storage);
    expect([...storage.items.keys()]).toEqual(["open-arch.ai"]);
    expect(JSON.parse(storage.getItem("open-arch.ai")!)).toEqual(settings);
    expect(readAiSettings(storage)).toEqual(settings);
  });

  it("are forgotten when asked, key and all", () => {
    const storage = new FakeStorage();
    writeAiSettings(settings, storage);
    writeAiSettings(null, storage);
    expect(storage.length).toBe(0);
    expect(readAiSettings(storage)).toBeNull();
  });

  it("can have no key, for a server that needs none", () => {
    const storage = new FakeStorage();
    writeAiSettings({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama" }, storage);
    expect(readAiSettings(storage)).toEqual({ baseUrl: "http://localhost:11434/v1", apiKey: "", model: "llama" });
  });

  it("read as none when what's kept isn't settings that can be used", () => {
    const storage = new FakeStorage();
    for (const kept of ["{", "null", "[]", '"text"', "{}", '{"baseUrl":"https://a.example/v1"}', '{"baseUrl":"","model":"m"}', '{"baseUrl":"not an address","model":"m"}', '{"baseUrl":"https://a.example/v1","model":"  "}', '{"baseUrl":7,"model":"m"}']) {
      storage.setItem("open-arch.ai", kept);
      expect(readAiSettings(storage), kept).toBeNull();
    }
    // A key that isn't text is no key.
    storage.setItem("open-arch.ai", '{"baseUrl":"https://a.example/v1","apiKey":7,"model":"m"}');
    expect(readAiSettings(storage)).toEqual({ baseUrl: "https://a.example/v1", apiKey: "", model: "m" });
  });

  it("say why they can't be kept, where the browser has no storage for the page or won't keep more", () => {
    expect(readAiSettings(undefined)).toBeNull();
    expect(() => writeAiSettings(settings, undefined)).toThrow("This browser has no local storage for the page, so the settings can't be kept.");
    expect(() => setReadsFiles("folder/a", true, undefined)).toThrow("This browser has no local storage for the page, so the choice can't be kept.");
    const storage = new FakeStorage();
    storage.full = true;
    expect(() => writeAiSettings(settings, storage)).toThrow("The quota has been exceeded.");
    // A browser that refuses the page its storage altogether reads as none.
    const refused = { getItem: () => { throw new DOMException("Denied.", "SecurityError"); } } as unknown as Storage; // prettier-ignore
    expect(readAiSettings(refused)).toBeNull();
    expect(readsFiles("folder/a", refused)).toBe(false);
  });

  it("say what's wrong with an address or a model as typed", () => {
    expect(settingsProblem(settings)).toBeNull();
    expect(settingsProblem({ ...settings, apiKey: "" })).toBeNull();
    expect(settingsProblem({ ...settings, baseUrl: "http://localhost:11434/v1" })).toBeNull();
    expect(settingsProblem({ ...settings, baseUrl: "  " })).toBe("Give the server's address, such as https://api.openai.com/v1.");
    expect(settingsProblem({ ...settings, baseUrl: "api.openai.com/v1" })).toBe("The address must be a full web address, such as https://api.openai.com/v1.");
    expect(settingsProblem({ ...settings, baseUrl: "ftp://api.openai.com/v1" })).toBe("The address must start with https:// or http://.");
    expect(settingsProblem({ ...settings, model: " " })).toBe("Give the model to ask, such as gpt-5.");
  });

  it("tidy an address down to where the API is", () => {
    expect(cleanBaseUrl("  https://a.example/v1//  ")).toBe("https://a.example/v1");
    expect(cleanBaseUrl("https://a.example/v1/chat/completions")).toBe("https://a.example/v1");
    expect(cleanBaseUrl("https://a.example/v1/Chat/Completions/")).toBe("https://a.example/v1");
    expect(cleanBaseUrl("https://a.example")).toBe("https://a.example");
  });

  it("let the model read a folder's files only once the person says so, a folder at a time", () => {
    const storage = new FakeStorage();
    expect(readsFiles("folder/a", storage)).toBe(false);
    setReadsFiles("folder/a", true, storage);
    setReadsFiles("folder/a", true, storage);
    setReadsFiles("folder/b", true, storage);
    expect(JSON.parse(storage.getItem("open-arch.ai.files")!)).toEqual(["folder/a", "folder/b"]);
    expect([readsFiles("folder/a", storage), readsFiles("folder/b", storage), readsFiles("folder/c", storage)]).toEqual([true, true, false]);
    setReadsFiles("folder/a", false, storage);
    expect([readsFiles("folder/a", storage), readsFiles("folder/b", storage)]).toEqual([false, true]);
    // Something else kept there reads as no folder.
    for (const kept of ["{", '{"folder/b":true}', "[7]"]) {
      storage.setItem("open-arch.ai.files", kept);
      expect(readsFiles("folder/b", storage), kept).toBe(false);
    }
  });
});
