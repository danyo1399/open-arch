import { emptyDocument, FILE_EXTENSION, serializeDocument } from "@open-arch/core";
import { useEffect, useRef, useState } from "react";
import { Designer } from "./Designer.js";
import { canSaveFiles, desktopBridge, DesktopHost, exampleHost, FileHandleHost, hostFromFile, MemoryHost, pickFileToOpen, tourHost, type WorkspaceHost } from "./hosts.js";

export function App() {
  const [host, setHost] = useState<WorkspaceHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const desktop = desktopBridge();
  const savesFiles = !!desktop || canSaveFiles();

  // The desktop app reopens the last file.
  useEffect(() => {
    if (!desktop) return;
    void desktop.lastFile().then((file) => {
      if (file) setHost(new DesktopHost(desktop, file.path, file.name));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attempt = (task: () => Promise<void>) => {
    setError(null);
    task().catch((e: Error) => setError(e.message));
  };

  const open = () =>
    attempt(async () => {
      if (desktop) {
        const file = await desktop.openFile();
        if (file) setHost(new DesktopHost(desktop, file.path, file.name));
      } else if (canSaveFiles()) {
        const handle = await pickFileToOpen();
        if (handle) setHost(new FileHandleHost(handle));
      } else {
        fileInput.current?.click();
      }
    });

  const create = () =>
    attempt(async () => {
      if (desktop) {
        const file = await desktop.newFile();
        if (file) setHost(new DesktopHost(desktop, file.path, file.name));
      } else {
        setHost(new MemoryHost(`architecture${FILE_EXTENSION}`, serializeDocument(emptyDocument("Architecture"))));
      }
    });

  if (host) return <Designer key={host.name + host.storage} host={host} onClose={() => setHost(null)} onHostChange={setHost} />;

  return (
    <div className="start">
      <div className="start-card">
        <h1>open-arch</h1>
        <p className="lede">Architecture diagrams for people and AI agents. One model in a .openarch file; the views are drawn from it, and the docs are generated from it.</p>
        <div className="start-actions">
          <button className="primary big" onClick={open}>
            Open…
          </button>
          <button className="big" onClick={create}>
            New workspace
          </button>
          <button className="big" onClick={() => setHost(tourHost())}>
            Take the tour
          </button>
          <button className="big" onClick={() => setHost(exampleHost())}>
            Try the example
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`${FILE_EXTENSION},application/json`}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) attempt(async () => setHost(await hostFromFile(file)));
            }}
          />
        </div>
        <p className="muted small">New to architecture diagrams? The tour walks through a made-up food delivery business one zoom level at a time, with sticky notes explaining what you see.</p>
        {desktop && <p className="muted small">Changes save to the file as you work, and the docs folder it names is kept up to date.</p>}
        {!desktop && savesFiles && <p className="muted small">Changes save to the file as you work. Use Export docs for markdown pages with diagrams.</p>}
        {!savesFiles && (
          <p className="muted small">
            This browser can't save back to files, so changes stay in this tab until you click <strong>Download</strong>. Chrome and Edge, and the desktop app, save as you work.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
