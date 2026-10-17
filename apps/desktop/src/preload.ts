/**
 * Runs in the sandboxed renderer before the page. Exposes the small file API
 * the designer's DesktopHost uses, and nothing else from Node or Electron.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { FileChange } from "@open-arch/core";
import type { DesktopBridge } from "../../web/src/bridge.js";

const bridge: DesktopBridge = {
  pickFolder: () => ipcRenderer.invoke("pickFolder"),
  lastWorkspace: () => ipcRenderer.invoke("lastWorkspace"),
  findWorkspace: (folder: string) => ipcRenderer.invoke("findWorkspace", folder),
  createWorkspace: (folder: string) => ipcRenderer.invoke("createWorkspace", folder),
  load: (root: string) => ipcRenderer.invoke("load", root),
  write: (root: string, changes: FileChange[]) => ipcRenderer.invoke("write", root, changes),
  watch(root: string, onChange: () => void) {
    const listener = () => onChange();
    ipcRenderer.on("workspace-changed", listener);
    ipcRenderer.send("watch", root);
    return () => {
      ipcRenderer.removeListener("workspace-changed", listener);
      ipcRenderer.send("unwatch");
    };
  },
};

contextBridge.exposeInMainWorld("openArchDesktop", bridge);
