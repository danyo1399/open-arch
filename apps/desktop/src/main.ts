/**
 * Electron main process: one window running the same designer UI as the web
 * app. It opens and saves .openarch files with Node, and every save also
 * rewrites the docs folder the workspace names, and keeps the agent skill and
 * AGENTS.md's open-arch section at the top of its Git repository. "Ask AI"
 * requests go to an OpenCode agent, which changes the file with the bundled
 * CLI.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_EXTENSION, loadWorkspace, type OpenArchDocument } from "@open-arch/core";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { AgentContext } from "../../web/src/bridge.js";
import { problemText } from "../../web/src/problems.js";
import { agentContext, type AgentBackend, type AgentEvent } from "./agent.js";
import { AgentSetup } from "./agent-setup.js";
import { OpenCodeBackend } from "./opencode.js";
import { newDocument, Saver } from "./saving.js";
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

/**
 * Allow the renderer to use this file, and remember it for next time. Opened again, its first save
 * brings the skill and AGENTS.md up to date again, unless it's `fresh`: just made, and set up then.
 */
function grant(path: string, fresh = false): { path: string; name: string } {
  const abs = resolve(path);
  opened.add(abs);
  if (!fresh) agentSetup.opened(abs);
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...readState(), lastFile: abs }));
  return { path: abs, name: basename(abs) };
}

function allowed(path: string): string {
  const abs = resolve(path);
  if (!opened.has(abs)) throw new Error("That file wasn't opened in this app.");
  return abs;
}

/** The folder of the skill the app bundles, as the CLI has it. */
function bundledSkill(): string {
  return join(cliDir, "bin", "open-arch");
}

const agentSetup = new AgentSetup(bundledSkill);

const saver = new Saver(agentSetup);

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
  return saver.make(file, newDocument(file), (made) => grant(made, true));
});

handle("saveAs", async (event, text: string) => {
  const doc = parseOrThrow(text);
  const file = await askForNewPath(event, "Save workspace as");
  if (!file) return null;
  return saver.make(file, doc, (made) => grant(made, true));
});

handle("lastFile", () => {
  const file = readState().lastFile;
  return file && existsSync(file) ? grant(file) : null;
});

handle("load", (_event, path: string) => readFileSync(allowed(path), "utf8"));

handle("save", (_event, path: string, text: string) => saver.save(allowed(path), parseOrThrow(text)));

handle("writeDocs", (_event, path: string, text: string) => saver.docs(allowed(path), String(text)));

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
    await agentFor(sender).run({ file, prompt, ...agentContext(context) }, emit);
  } catch (error) {
    emit({ type: "error", message: problemText(error) });
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
