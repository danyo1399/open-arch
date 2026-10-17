import { DEFAULT_CONFIG_TEXT } from "@open-arch/core";
import { useEffect, useRef, useState } from "react";
import { Designer } from "./Designer.js";
import { desktopBridge, DesktopHost, type DesktopBridge } from "./desktop.js";
import { canOpenFolders, createWorkspace, exampleHost, findWorkspace, FolderHost, hostFromFileList, MemoryHost, pickFolder, type WorkspaceHost } from "./hosts.js";
import { Modal } from "./panels/dialogs.js";

type PendingCreate = { name: string; create(): Promise<void> };

export function App() {
  const [host, setHost] = useState<WorkspaceHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCreate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const desktop = desktopBridge();
  const writable = !!desktop || canOpenFolders();

  const openDesktopFolder = async (bridge: DesktopBridge, folder: string) => {
    const found = await bridge.findWorkspace(folder);
    if ("root" in found) return setHost(new DesktopHost(bridge, found.root, found.name));
    if (!found.canCreate) return setError(found.error);
    setPending({
      name: folder,
      create: async () => {
        await bridge.createWorkspace(folder);
        await openDesktopFolder(bridge, folder);
      },
    });
  };

  // The desktop app reopens the last workspace.
  useEffect(() => {
    if (!desktop) return;
    void desktop.lastWorkspace().then((root) => {
      if (root) void openDesktopFolder(desktop, root);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openFolder = async () => {
    setError(null);
    try {
      if (desktop) {
        const folder = await desktop.pickFolder();
        if (folder) await openDesktopFolder(desktop, folder);
        return;
      }
      const dir = await pickFolder();
      if (!dir) return;
      const found = await findWorkspace(dir);
      if (found) return setHost(new FolderHost(found.dir));
      setPending({
        name: dir.name,
        create: async () => {
          await createWorkspace(dir);
          setHost(new FolderHost(dir));
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openReadOnly = async (files: FileList | null) => {
    if (!files?.length) return;
    const result = await hostFromFileList(files);
    if ("error" in result) setError(result.error);
    else setHost(result);
  };

  if (host) return <Designer host={host} onClose={() => setHost(null)} />;

  return (
    <div className="start">
      <div className="start-card">
        <h1>open-arch</h1>
        <p className="lede">Architecture diagrams kept as markdown files, so people and AI agents can both read and change them.</p>
        <div className="start-actions">
          {writable ? (
            <button className="primary big" onClick={openFolder}>
              Open folder…
            </button>
          ) : (
            <>
              <button className="primary big" onClick={() => fileInput.current?.click()}>
                Open folder (read-only)…
              </button>
              <input ref={(el) => {
                fileInput.current = el;
                el?.setAttribute("webkitdirectory", "");
              }} type="file" multiple hidden onChange={(e) => void openReadOnly(e.target.files)} />
            </>
          )}
          <button className="big" onClick={() => setHost(exampleHost())}>
            Try the example
          </button>
          {!desktop && (
            <button className="big" onClick={() => setHost(new MemoryHost("workspace", DEFAULT_CONFIG_TEXT, []))}>
              Start an empty workspace
            </button>
          )}
        </div>
        {!writable && (
          <p className="muted small">
            This browser can't save to folders, so edits stay in this tab; use <strong>Download .zip</strong> to keep them. To edit files in place, use Chrome or Edge, or the desktop app.
          </p>
        )}
        {writable && !desktop && <p className="muted small">Pick a folder that contains open-arch.yaml, or an empty folder to start a new workspace. Changes are saved to the files as you work.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      {pending && (
        <Modal
          title="Start a new workspace here?"
          onClose={() => setPending(null)}
          actions={
            <>
              <button onClick={() => setPending(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  const p = pending;
                  setPending(null);
                  p.create().catch((e: Error) => setError(e.message));
                }}
              >
                Create workspace
              </button>
            </>
          }
        >
          <p>
            There's no open-arch.yaml in <strong>{pending.name}</strong> or the folders below it. Create a new, empty workspace there? This adds open-arch.yaml and the model and views folders.
          </p>
        </Modal>
      )}
    </div>
  );
}
