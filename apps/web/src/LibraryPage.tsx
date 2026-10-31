/** The web app's start page: the workspaces kept in this browser, and the ways to add one. */
import { emptyDocument, FILE_EXTENSION, serializeDocument } from "@open-arch/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserHost, type WorkspaceHost } from "./hosts.js";
import { importFiles, workspaceTitle, type StoredWorkspace, type WorkspaceLibrary } from "./library.js";
import { ConfirmDialog } from "./panels/dialogs.js";
import { providers, readFiles, type PickedFile } from "./providers.js";
import { StartPage } from "./Start.js";

const edited = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LibraryPage({ library, onOpen }: { library: WorkspaceLibrary; onOpen(host: WorkspaceHost): void }) {
  const [records, setRecords] = useState<StoredWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StoredWorkspace | null>(null);

  const refresh = useCallback(() => library.list().then(setRecords, (e: Error) => setError(e.message)), [library]);

  // Other tabs can add, change and delete workspaces too.
  useEffect(() => {
    void refresh();
    return library.onChange(() => void refresh());
  }, [library, refresh]);

  const titles = useMemo(() => new Map(records?.map((r) => [r.id, workspaceTitle(r)])), [records]);

  const attempt = (task: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    task().catch((e: Error) => setError(e.message));
  };

  const open = (record: StoredWorkspace) => onOpen(new BrowserHost(library, record.id, record.fileName));

  const create = () => attempt(async () => open(await library.add(`architecture${FILE_EXTENSION}`, serializeDocument(emptyDocument("Architecture")))));

  /** One file opens straight away; several go in the list. */
  const importFrom = (files: PickedFile[] | Promise<PickedFile[]>) =>
    attempt(async () => {
      const { added, problems, open: opened } = await importFiles(library, await files);
      if (opened) return open(opened);
      await refresh();
      if (added.length > 0) setNotice(`Imported ${added.length === 1 ? "1 workspace" : `${added.length} workspaces`}.`);
      if (problems.length > 0) setError(problems.join(" "));
    });

  return (
    <StartPage
      error={error}
      onOpen={onOpen}
      onDropFiles={(files) => importFrom(readFiles(files))}
      actions={
        <>
          <button className="primary big" onClick={create}>
            New workspace
          </button>
          {providers.map((provider) => (
            <button key={provider.id} className="big" onClick={() => importFrom(provider.pick())}>
              {provider.importLabel}
            </button>
          ))}
        </>
      }
    >
      <section className="library" aria-label="Your workspaces">
        <h2>Your workspaces</h2>
        {notice && (
          <p className="small" role="status">
            {notice}
          </p>
        )}
        {records?.length === 0 && <p className="muted">Nothing here yet. Workspaces you create or import are kept here, in this browser.</p>}
        {records && records.length > 0 && (
          <ul className="library-list">
            {records.map((record) => (
              <li key={record.id} className="library-item">
                <button className="link library-open" onClick={() => open(record)} title={`Open ${titles.get(record.id)}`}>
                  {titles.get(record.id)}
                </button>
                <span className="muted small library-meta">
                  {record.fileName} · edited {edited.format(record.updated)}
                </span>
                <span className="library-actions">
                  {providers.map((provider) => (
                    <button key={provider.id} onClick={() => attempt(async () => void (await provider.save(record.fileName, record.text)))}>
                      {provider.exportLabel}
                    </button>
                  ))}
                  <button className="danger" onClick={() => setRemoving(record)}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          Workspaces save in this browser as you work, on this device only, and clearing the site's data deletes them. Export a copy of any you want to keep or share. To import, you can also drop .openarch files here.
        </p>
      </section>
      {removing && (
        <ConfirmDialog
          title={`Delete “${titles.get(removing.id)}”?`}
          text="This deletes it from this browser for good. Export it first if you might want it again."
          confirm="Delete"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            attempt(async () => {
              await library.remove(id);
              await refresh();
            });
          }}
        />
      )}
    </StartPage>
  );
}
