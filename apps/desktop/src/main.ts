/**
 * Electron main process: one window running the same designer UI as the web
 * app, with file access through Node instead of the browser.
 */
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_CONFIG_TEXT, type FileChange } from "@open-arch/core";
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { findRoot, readWorkspace, writeChanges } from "open-arch/workspace";

const here = dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.OPEN_ARCH_DEV_URL;

/** Folders the user picked, and workspaces opened from them. The renderer can only touch these. */
const picked = new Set<string>();
const opened = new Set<string>();
const watchers = new Map<number, FSWatcher>();

const statePath = () => join(app.getPath("userData"), "state.json");

function readState(): { lastWorkspace?: string } {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as { lastWorkspace?: string };
  } catch {
    return {};
  }
}

function rememberWorkspace(root: string): void {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ ...readState(), lastWorkspace: root }));
}

function allowed(root: string, from: Set<string> = opened): string {
  const abs = resolve(root);
  if (!from.has(abs)) throw new Error("That folder wasn't opened in this app.");
  return abs;
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
  win.on("closed", () => stopWatching(id));
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

handle("pickFolder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { title: "Open an open-arch workspace", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const folder = result.canceled ? undefined : result.filePaths[0];
  if (!folder) return null;
  picked.add(resolve(folder));
  return folder;
});

handle("lastWorkspace", () => {
  const root = readState().lastWorkspace;
  if (!root || !existsSync(join(root, CONFIG_FILE))) return null;
  picked.add(resolve(root));
  return root;
});

handle("findWorkspace", (_event, folder: string) => {
  try {
    const root = resolve(findRoot(allowed(folder, picked)));
    opened.add(root);
    rememberWorkspace(root);
    return { root, name: basename(root) };
  } catch (error) {
    return { error: (error as Error).message, canCreate: existsSync(folder) };
  }
});

handle("createWorkspace", (_event, target: string) => {
  const folder = allowed(target, picked);
  if (!existsSync(join(folder, CONFIG_FILE))) writeFileSync(join(folder, CONFIG_FILE), DEFAULT_CONFIG_TEXT);
  for (const sub of ["model", "views"]) mkdirSync(join(folder, sub), { recursive: true });
});

handle("load", (_event, root: string) => readWorkspace(allowed(root)));

handle("write", (_event, root: string, changes: FileChange[]) => writeChanges(allowed(root), changes));

ipcMain.on("watch", (event, root: string) => {
  const sender: WebContents = event.sender;
  stopWatching(sender.id);
  let timer: NodeJS.Timeout | undefined;
  const watcher = watch(allowed(root), { recursive: true }, () => {
    // Editors and agents often write a file in several steps; wait for them to finish.
    clearTimeout(timer);
    timer = setTimeout(() => !sender.isDestroyed() && sender.send("workspace-changed"), 250);
  });
  watcher.on("error", () => stopWatching(sender.id));
  watchers.set(sender.id, watcher);
});

ipcMain.on("unwatch", (event) => stopWatching(event.sender.id));

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
