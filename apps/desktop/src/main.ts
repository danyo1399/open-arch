/**
 * Electron main process: one window running the same designer UI as the web
 * app. It opens and saves .openarch files with Node, and every save also
 * rewrites the docs folder the workspace names. "Ask AI" requests go to an
 * OpenCode agent, which changes the file with the bundled CLI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDocument, FILE_EXTENSION, loadWorkspace, type OpenArchDocument } from "@open-arch/core";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { syncDocs, writeWorkspaceFile } from "open-arch/workspace";
import type { AgentContext } from "../../web/src/bridge.js";
import type { AgentBackend, AgentEvent } from "./agent.js";
import { OpenCodeBackend } from "./opencode.js";
import { userDataFolder } from "./user-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.OPEN_ARCH_DEV_URL;
const FILTERS = [{ name: "open-arch workspace", extensions: [FILE_EXTENSION.slice(1)] }];

// Before the app is ready, so Electron's own storage moves with it. Asking
// Electron for its folder creates it, but nothing is kept there.
const electronUserData = app.getPath("userData");
const userData = userDataFolder({
  packaged: app.isPackaged,
  current: electronUserData,
  appData: app.getPath("appData"),
  name: app.name,
  appDir: join(here, ".."),
});
if (userData !== electronUserData) app.setPath("userData", userData);

/** Files the user opened, created or saved through the app. The renderer can only touch these. */
const opened = new Set<string>();
const watchers = new Map<number, FSWatcher>();
/** One agent per window, each running one request at a time. */
const agents = new Map<number, AgentBackend>();

const statePath = () => join(app.getPath("userData"), "state.json");

function readState(): { lastFile?: string } {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as { lastFile?: string };
  } catch {
    return {};
  }
}

/** Allow the renderer to use this file, and remember it for next time. */
function grant(path: string): { path: string; name: string } {
  const abs = resolve(path);
  opened.add(abs);
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...readState(), lastFile: abs }));
  return { path: abs, name: basename(abs) };
}

function allowed(path: string): string {
  const abs = resolve(path);
  if (!opened.has(abs)) throw new Error("That file wasn't opened in this app.");
  return abs;
}

/** "payments-platform.openarch" → "Payments Platform" */
function nameFromFile(path: string): string {
  return basename(path, FILE_EXTENSION)
    .split(/[-_\s.]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

/** Save a document and refresh its docs folder; returns what happened to the docs, for the UI. */
function save(file: string, doc: OpenArchDocument) {
  writeWorkspaceFile(file, doc);
  const docs = syncDocs(file, loadWorkspace(readFileSync(file, "utf8")));
  return docs ? { dir: relative(dirname(file), docs.dir) || ".", written: docs.written.length, deleted: docs.deleted.length, skipped: docs.skipped } : null;
}

function parseOrThrow(text: string): OpenArchDocument {
  const ws = loadWorkspace(text);
  if (!ws.valid) throw new Error(`Refusing to save: the workspace has structural errors (${ws.diagnostics.map((d) => d.message).join(" ")})`);
  return ws.doc;
}

async function askForNewPath(event: IpcMainInvokeEvent, title: string): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { title, defaultPath: `architecture${FILE_EXTENSION}`, filters: FILTERS };
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  return result.filePath.endsWith(FILE_EXTENSION) ? result.filePath : `${result.filePath}${FILE_EXTENSION}`;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 480,
    title: "open-arch",
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // Links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  const id = win.webContents.id;
  win.on("closed", () => {
    stopWatching(id);
    void agents.get(id)?.cancel();
    agents.delete(id);
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(here, "renderer", "index.html"));
  return win;
}

function stopWatching(id: number): void {
  watchers.get(id)?.close();
  watchers.delete(id);
}

function handle(channel: string, fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void {
  ipcMain.handle(channel, fn as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown);
}

handle("openFile", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { title: "Open a workspace", properties: ["openFile"] as "openFile"[], filters: FILTERS };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const file = result.canceled ? undefined : result.filePaths[0];
  return file ? grant(file) : null;
});

handle("newFile", async (event) => {
  const file = await askForNewPath(event, "New workspace");
  if (!file) return null;
  const doc = emptyDocument(nameFromFile(file) || "Architecture");
  doc.export = { docs: `${basename(file, FILE_EXTENSION)}-docs` };
  save(file, doc);
  return grant(file);
});

handle("saveAs", async (event, text: string) => {
  const doc = parseOrThrow(text);
  const file = await askForNewPath(event, "Save workspace as");
  if (!file) return null;
  save(file, doc);
  return grant(file);
});

handle("lastFile", () => {
  const file = readState().lastFile;
  return file && existsSync(file) ? grant(file) : null;
});

handle("load", (_event, path: string) => readFileSync(allowed(path), "utf8"));

handle("save", (_event, path: string, text: string) => save(allowed(path), parseOrThrow(text)));

ipcMain.on("watch", (event, path: string) => {
  const sender: WebContents = event.sender;
  stopWatching(sender.id);
  const file = allowed(path);
  let timer: NodeJS.Timeout | undefined;
  // Watch the folder, not the file: saves (ours, the CLI's, editors') replace the file rather than edit it.
  const watcher = watch(dirname(file), (_kind, name) => {
    if (name !== null && name !== basename(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => !sender.isDestroyed() && sender.send("file-changed"), 200);
  });
  watcher.on("error", () => stopWatching(sender.id));
  watchers.set(sender.id, watcher);
});

ipcMain.on("unwatch", (event) => stopWatching(event.sender.id));

// --- Ask AI ---------------------------------------------------------------------

/**
 * The CLI the agent runs, built by scripts/build.mjs. Packaged apps unpack it
 * from the archive, since the agent's shell and OpenCode read it as plain files.
 */
const cliDir = join(here, "cli").replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
let binDir: string | undefined;

/** A command for the agent's shell that runs the bundled CLI with Electron's own Node. */
function cliCommand(): string {
  // A private folder, so nobody else can swap the script the agent may run without asking.
  if (!binDir || !existsSync(binDir)) binDir = mkdtempSync(join(app.getPath("temp"), "open-arch-agent-"));
  const script = join(cliDir, "bin", "open-arch.js");
  if (process.platform === "win32") {
    const shim = join(binDir, "open-arch.cmd");
    writeFileSync(shim, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${script}" %*\r\n`);
    return shim;
  }
  const shim = join(binDir, "open-arch");
  writeFileSync(shim, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return shim;
}

function agentFor(sender: WebContents): AgentBackend {
  let agent = agents.get(sender.id);
  if (!agent) {
    agent = new OpenCodeBackend({ cli: cliCommand, skillDir: join(cliDir, "bin", "open-arch"), model: process.env.OPEN_ARCH_AGENT_MODEL });
    agents.set(sender.id, agent);
  }
  return agent;
}

handle("agentRun", async (event, run: number, path: string, prompt: string, context: AgentContext) => {
  const sender = event.sender;
  const emit = (e: AgentEvent) => !sender.isDestroyed() && sender.send("agent-event", run, e);
  try {
    const file = allowed(path);
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Say what to change.");
    const selection = Array.isArray(context?.selection) ? context.selection.filter((id) => typeof id === "string") : [];
    const viewId = typeof context?.viewId === "string" ? context.viewId : undefined;
    await agentFor(sender).run({ file, prompt, selection, viewId }, emit);
  } catch (error) {
    emit({ type: "error", message: (error as Error).message });
  }
});

handle("agentReply", (event, permissionId: string, allow: boolean) => agentFor(event.sender).reply(String(permissionId), allow === true));

handle("agentCancel", (event) => agents.get(event.sender.id)?.cancel());

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (binDir) rmSync(binDir, { recursive: true, force: true });
});
