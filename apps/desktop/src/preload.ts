/**
 * Runs in the sandboxed renderer before the page. Exposes the small file API
 * the designer's DesktopHost uses, and nothing else from Node or Electron.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AgentContext, AgentEvent, DesktopBridge } from "../../web/src/bridge.js";

let agentRuns = 0;

const bridge: DesktopBridge = {
  openFile: () => ipcRenderer.invoke("openFile"),
  newFile: () => ipcRenderer.invoke("newFile"),
  saveAs: (text: string) => ipcRenderer.invoke("saveAs", text),
  lastFile: () => ipcRenderer.invoke("lastFile"),
  load: (path: string) => ipcRenderer.invoke("load", path),
  save: (path: string, text: string) => ipcRenderer.invoke("save", path, text),
  watch(path: string, onChange: () => void) {
    const listener = () => onChange();
    ipcRenderer.on("file-changed", listener);
    ipcRenderer.send("watch", path);
    return () => {
      ipcRenderer.removeListener("file-changed", listener);
      ipcRenderer.send("unwatch");
    };
  },
  agent: {
    run(path: string, prompt: string, context: AgentContext, onEvent: (event: AgentEvent) => void) {
      const id = ++agentRuns;
      // Listen until the run's last event, which main sends before the call returns.
      const listener = (_event: IpcRendererEvent, run: number, event: AgentEvent) => {
        if (run !== id) return;
        onEvent(event);
        if (event.type === "done" || event.type === "error") ipcRenderer.removeListener("agent-event", listener);
      };
      ipcRenderer.on("agent-event", listener);
      return ipcRenderer.invoke("agentRun", id, path, prompt, context);
    },
    reply: (permissionId: string, allow: boolean) => ipcRenderer.invoke("agentReply", permissionId, allow),
    cancel: () => ipcRenderer.invoke("agentCancel"),
  },
};

contextBridge.exposeInMainWorld("openArchDesktop", bridge);
