/**
 * The bridge the Electron preload script puts on `window.openArchDesktop`.
 * When it's there, the designer is running in the desktop app and reads and
 * writes files through Node instead of the browser.
 */
import type { FileChange } from "@open-arch/core";
import type { DesktopBridge, WorkspaceSnapshot } from "./bridge.js";
import type { WorkspaceHost } from "./hosts.js";

export type { DesktopBridge, FindResult } from "./bridge.js";

export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { openArchDesktop?: DesktopBridge }).openArchDesktop;
}

export class DesktopHost implements WorkspaceHost {
  readonly storage = "disk";

  constructor(
    private readonly bridge: DesktopBridge,
    private readonly root: string,
    readonly name: string,
  ) {}

  load(): Promise<WorkspaceSnapshot> {
    return this.bridge.load(this.root);
  }

  write(changes: FileChange[]): Promise<void> {
    return this.bridge.write(this.root, changes);
  }

  watch(onChange: () => void): () => void {
    return this.bridge.watch(this.root, onChange);
  }
}
