/** The start page, before a workspace is open: the desktop app's here, the web app's in LibraryPage.tsx. */
import { useState, type DragEvent, type ReactNode } from "react";
import type { DesktopBridge } from "./bridge.js";
import { DesktopHost, exampleHost, SharedHost, tourHost, type WorkspaceHost } from "./hosts.js";
import { OpenLinkDialog } from "./panels/ShareDialog.js";
import { shareClient } from "./share.js";

interface StartPageProps {
  /** Buttons before the examples. */
  actions: ReactNode;
  error: string | null;
  onOpen(host: WorkspaceHost): void;
  /** When set, files dropped on the page are passed here. */
  onDropFiles?(files: File[]): void;
  children?: ReactNode;
}

export function StartPage({ actions, error, onOpen, onDropFiles, children }: StartPageProps) {
  const [dropping, setDropping] = useState(false);
  const carriesFiles = (e: DragEvent) => !!onDropFiles && e.dataTransfer.types.includes("Files");
  return (
    <div
      className={`start${dropping ? " dropping" : ""}`}
      onDragOver={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        onDropFiles!([...e.dataTransfer.files]);
      }}
    >
      <div className="start-card">
        <h1>open-arch</h1>
        <p className="lede">Architecture diagrams for people and AI agents. One model in a .openarch file; the views are drawn from it, and the docs are generated from it.</p>
        <div className="start-actions">
          {actions}
          <button className="big" onClick={() => onOpen(tourHost())}>
            Take the tour
          </button>
          <button className="big" onClick={() => onOpen(exampleHost())}>
            Try the example
          </button>
        </div>
        <p className="muted small">New to architecture diagrams? The tour walks through a made-up food delivery business one zoom level at a time, with sticky notes explaining what you see.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}

export function DesktopStart({ desktop, onOpen }: { desktop: DesktopBridge; onOpen(host: WorkspaceHost): void }) {
  const [error, setError] = useState<string | null>(null);
  const [openingLink, setOpeningLink] = useState(false);

  const attempt = (task: () => Promise<void>) => {
    setError(null);
    task().catch((e: Error) => setError(e.message));
  };

  const open = () =>
    attempt(async () => {
      const file = await desktop.openFile();
      if (file) onOpen(new DesktopHost(desktop, file.path, file.name));
    });

  const create = () =>
    attempt(async () => {
      const file = await desktop.newFile();
      if (file) onOpen(new DesktopHost(desktop, file.path, file.name));
    });

  return (
    <StartPage
      error={error}
      onOpen={onOpen}
      actions={
        <>
          <button className="primary big" onClick={open}>
            Open…
          </button>
          <button className="big" onClick={create}>
            New workspace
          </button>
          {shareClient && (
            <button className="big" onClick={() => setOpeningLink(true)}>
              Open link…
            </button>
          )}
        </>
      }
    >
      <p className="muted small">Changes save to the file as you work, and the docs folder it names is kept up to date.</p>
      {openingLink && <OpenLinkDialog onClose={() => setOpeningLink(false)} onOpen={(link) => onOpen(new SharedHost(shareClient, link))} />}
    </StartPage>
  );
}
