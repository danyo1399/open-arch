/**
 * How the web app's Ask AI reaches a model: the address of a server that speaks OpenAI's chat
 * API, the key for it, and the model to ask. They're this person's, kept in this browser's local
 * storage and nowhere else: never in the .openarch file, an export, a zip or a shared link.
 */
import { useCallback, useEffect, useState } from "react";

export interface AiSettings {
  /** Where the server's API is, such as `https://api.openai.com/v1`, without `/chat/completions`. */
  baseUrl: string;
  /** Sent as the request's bearer token. Empty for a server that needs none, such as one on this computer. */
  apiKey: string;
  model: string;
}

const SETTINGS_KEY = "open-arch.ai";
const FILES_KEY = "open-arch.ai.files";

/** The browser's local storage, or undefined where the page has none, or isn't allowed it. */
function localStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * An address as it's kept: without spaces round it, a `/` at its end, or the `/chat/completions`
 * a request adds, in case the whole endpoint was pasted.
 */
export function cleanBaseUrl(text: string): string {
  return text
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/+$/, "");
}

/** What's wrong with settings as typed, or null when they can be used. */
export function settingsProblem(settings: AiSettings): string | null {
  const address = cleanBaseUrl(settings.baseUrl);
  if (!address) return "Give the server's address, such as https://api.openai.com/v1.";
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return "The address must be a full web address, such as https://api.openai.com/v1.";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "The address must start with https:// or http://.";
  if (!settings.model.trim()) return "Give the model to ask, such as gpt-5.";
  // A request's header takes plain characters only, and the browser refuses to send any other without saying which.
  if (/[^\x21-\x7e]/.test(settings.apiKey.trim())) return "The API key has a character a request can't carry, such as a space, a line break or a curly quote. Copy the key again, on its own.";
  return null;
}

/** The settings kept in this browser, or null when there are none, or they can't be read. */
export function readAiSettings(storage: Storage | undefined = localStore()): AiSettings | null {
  try {
    const kept = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? "null") as Partial<AiSettings> | null;
    if (!kept || typeof kept.baseUrl !== "string" || typeof kept.model !== "string") return null;
    const settings = { baseUrl: kept.baseUrl, apiKey: typeof kept.apiKey === "string" ? kept.apiKey : "", model: kept.model };
    return settingsProblem(settings) ? null : settings;
  } catch {
    return null;
  }
}

/** Keeps the settings in this browser, or with null forgets them. Throws when the browser won't keep them. */
export function writeAiSettings(settings: AiSettings | null, storage: Storage | undefined = localStore()): void {
  if (!storage) throw new Error("This browser has no local storage for the page, so the settings can't be kept.");
  if (!settings) return storage.removeItem(SETTINGS_KEY);
  storage.setItem(SETTINGS_KEY, JSON.stringify({ baseUrl: cleanBaseUrl(settings.baseUrl), apiKey: settings.apiKey.trim(), model: settings.model.trim() }));
}

/** The workspaces, by their host's key, whose folder's files the model may read. */
function fileFolders(storage: Storage | undefined): string[] {
  try {
    const kept: unknown = JSON.parse(storage?.getItem(FILES_KEY) ?? "[]");
    return Array.isArray(kept) ? kept.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

/** Whether the model may read the files in a workspace's folder. It may not until the person says so, for each folder. */
export function readsFiles(workspace: string, storage: Storage | undefined = localStore()): boolean {
  return fileFolders(storage).includes(workspace);
}

/** Lets the model read the files in a workspace's folder, or stops it. Throws when the browser won't keep the choice. */
export function setReadsFiles(workspace: string, allowed: boolean, storage: Storage | undefined = localStore()): void {
  if (!storage) throw new Error("This browser has no local storage for the page, so the choice can't be kept.");
  const others = fileFolders(storage).filter((key) => key !== workspace);
  storage.setItem(FILES_KEY, JSON.stringify(allowed ? [...others, workspace] : others));
}

export interface AiSetting {
  settings: AiSettings | null;
  /** Keeps new settings, or with null forgets them. Throws when the browser won't keep them. */
  save(settings: AiSettings | null): void;
  /** Whether the model may read the files in this workspace's folder. */
  readsFiles: boolean;
  setReadsFiles(allowed: boolean): void;
}

/** The settings, and whether the model may read this workspace's folder, as kept in this browser: a change made in another tab shows here too. */
export function useAiSettings(workspace: string): AiSetting {
  const [settings, setSettings] = useState(() => readAiSettings());
  const [files, setFiles] = useState(() => readsFiles(workspace));
  useEffect(() => {
    const read = () => {
      setSettings(readAiSettings());
      setFiles(readsFiles(workspace));
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, [workspace]);
  const save = useCallback((next: AiSettings | null) => {
    writeAiSettings(next);
    setSettings(readAiSettings());
  }, []);
  const allow = useCallback(
    (allowed: boolean) => {
      setReadsFiles(workspace, allowed);
      setFiles(allowed);
    },
    [workspace],
  );
  return { settings, save, readsFiles: files, setReadsFiles: allow };
}
