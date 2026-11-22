/** The web app's start page: the workspaces kept in this browser, and the ways to add one. */
import { emptyDocument, FILE_EXTENSION, nameFromFileName, serializeDocument } from "@open-arch/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allowed, canOpenFolders, findWorkspaces, folderList as defaultFolders, FolderHost, newWorkspace, pickFolder, type FolderHandle, type FolderList, type StoredFolder } from "./folders.js";
import { BrowserHost, browserKey, SharedHost, type WorkspaceHost } from "./hosts.js";
import { InstallPrompt } from "./InstallPrompt.js";
import { importFiles, workspaceTitle, type StoredWorkspace, type WorkspaceLibrary } from "./library.js";
import { ConfirmDialog, Modal } from "./panels/dialogs.js";
import { OpenLinkDialog } from "./panels/ShareDialog.js";
import { problemText } from "./problems.js";
import { providers, readFiles, type PickedFile } from "./providers.js";
import { userSettings } from "./settings.js";
import { shareClient } from "./share.js";
import { StartPage } from "./Start.js";

const edited = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LibraryPage({ library, folders = defaultFolders, onOpen }: { library: WorkspaceLibrary; folders?: FolderList; onOpen(host: WorkspaceHost): void }) {
  const [records, setRecords] = useState<StoredWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StoredWorkspace | null>(null);
  const [openingLink, setOpeningLink] = useState(false);
  const foldersWork = canOpenFolders();
  const [opened, setOpened] = useState<StoredFolder[] | null>(null);
  /** A folder with several workspaces in it, to pick one from. */
  const [choosing, setChoosing] = useState<{ root: FolderHandle; paths: string[] } | null>(null);
  /** A folder with no workspace in it, to make one in, at `path`, with its docs in `docs`, as `open-arch init` would. */
  const [creating, setCreating] = useState<{ root: FolderHandle; path: string; docs: string } | null>(null);

  const refresh = useCallback(() => library.list().then(setRecords, (e: unknown) => setError(problemText(e))), [library]);

  // Other tabs can add, change and delete workspaces too.
  useEffect(() => {
    void refresh();
    return library.onChange(() => void refresh());
  }, [library, refresh]);

  useEffect(() => {
    if (foldersWork) folders.list().then(setOpened, (e: unknown) => setError(problemText(e)));
  }, [folders, foldersWork]);

  const titles = useMemo(() => new Map(records?.map((r) => [r.id, workspaceTitle(r)])), [records]);

  const attempt = (task: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    task().catch((e: unknown) => setError(problemText(e)));
  };

  const open = (record: StoredWorkspace) => onOpen(new BrowserHost(library, record.id, record.fileName));

  const create = () => attempt(async () => open(await library.add(`architecture${FILE_EXTENSION}`, serializeDocument(emptyDocument("Architecture")))));

  /** Remembers the workspace in the folder, so the list has it next time, and opens it. */
  const openInFolder = async (root: FolderHandle, path: string) => {
    const record = await folders.add(root, path);
    onOpen(new FolderHost(record.id, root, path, undefined, folders));
  };

  /** One workspace in the folder opens straight away. With several, the user picks one; with none, they can make one. */
  const openFolder = () =>
    attempt(async () => {
      const root = await pickFolder();
      if (!root) return;
      const paths = await findWorkspaces(root);
      if (paths.length === 1) return openInFolder(root, paths[0]!);
      if (paths.length === 0) setCreating({ root, ...(await newWorkspace(root)) });
      else setChoosing({ root, paths });
    });

  const reopen = (record: StoredFolder) =>
    attempt(async () => {
      if (!(await allowed(record.root, true))) throw new Error(`open-arch wasn't allowed to change the files in ${record.root.name}, so it can't open ${record.path}.`);
      await openInFolder(record.root, record.path);
    });

  const createInFolder = (root: FolderHandle, path: string, docsFolder: string) =>
    attempt(async () => {
      const doc = emptyDocument(nameFromFileName(root.name) || "Architecture");
      doc.export = { docs: docsFolder };
      const { docs, skillError, agentsError } = await new FolderHost("new", root, path).create(serializeDocument(doc));
      // Opened, the designer would hide what went wrong, so it's said here, and the list has it to open.
      const problems = [docs?.error && `couldn't write its docs ${docsFolder === "." ? "beside it" : `in ${docs.dir}/`}: ${docs.error}`, skillError && `couldn't add the agent skill: ${skillError}`, agentsError && `couldn't add its section to AGENTS.md: ${agentsError}`].filter(Boolean);
      const problem = problems.length ? problems.join(" It also ") : null;
      if (problem) {
        await folders.add(root, path, doc.name);
        setOpened(await folders.list());
        throw new Error(`Created ${path} in ${root.name}, but ${problem} Open it from Folders once that's fixed.`);
      }
      await openInFolder(root, path);
    });

  const forget = (record: StoredFolder) =>
    attempt(async () => {
      await folders.remove(record.id);
      void userSettings.forget(new FolderHost(record.id, record.root, record.path).key).catch(() => undefined);
      setOpened(await folders.list());
    });

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
          {foldersWork && (
            <button className="big" onClick={openFolder} title="Edit the .openarch file in a folder on this computer, such as a Git repository">
              Open folder…
            </button>
          )}
          {shareClient && (
            <button className="big" onClick={() => setOpeningLink(true)}>
              Open link…
            </button>
          )}
        </>
      }
    >
      <InstallPrompt />
      {foldersWork && (
        <section className="library" aria-label="Folders">
          <h2>Folders</h2>
          {opened && opened.length > 0 && (
            <ul className="library-list">
              {opened.map((record) => (
                <li key={record.id} className="library-item">
                  {/* By the workspace's name, once it's been read here: a folder's name, such as docs, is often not the only one. */}
                  <button className="link library-open" onClick={() => reopen(record)} title={`Open ${record.path} in ${record.root.name}`}>
                    {record.name ?? record.root.name}
                  </button>
                  <span className="muted small library-meta" title={`${record.root.name}/${record.path}`}>
                    {record.root.name}/{record.path} · opened {edited.format(record.opened)}
                  </span>
                  <span className="library-actions">
                    <button onClick={() => forget(record)} title="Take it off this list. The folder and its files stay as they are.">
                      Forget
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Open a folder on this computer, such as a Git repository, to edit the .openarch file in it. Changes save to the file as you work, and the docs folder it names is kept up to date, ready to commit. The first save also adds the agent skill that lets AI agents change the model, and a section in AGENTS.md telling them to use it.
          </p>
        </section>
      )}
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
      {choosing && (
        <Modal title={`Which workspace in ${choosing.root.name}?`} onClose={() => setChoosing(null)} actions={<button onClick={() => setChoosing(null)}>Cancel</button>}>
          <ul className="library-list">
            {choosing.paths.map((path) => (
              <li key={path} className="library-item">
                <button
                  className="link library-open"
                  onClick={() => {
                    const root = choosing.root;
                    setChoosing(null);
                    attempt(() => openInFolder(root, path));
                  }}
                >
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {creating && (
        <Modal
          title={`No workspace in ${creating.root.name}`}
          onClose={() => setCreating(null)}
          actions={
            <>
              <button onClick={() => setCreating(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() => {
                  const { root, path, docs } = creating;
                  setCreating(null);
                  createInFolder(root, path, docs);
                }}
              >
                Create {creating.path}
              </button>
            </>
          }
        >
          <p>
            There's no {FILE_EXTENSION} file in {creating.root.name}, or in the folders below it. Create {creating.path} there, with its docs {creating.docs === "." ? "beside it" : `in ${creating.docs}/ beside it`}?
          </p>
        </Modal>
      )}
      {openingLink && <OpenLinkDialog onClose={() => setOpeningLink(false)} onOpen={(link) => onOpen(new SharedHost(shareClient, link))} />}
      {removing && (
        <ConfirmDialog
          title={`Delete “${titles.get(removing.id)}”?`}
          text={`This deletes it from this browser for good. Export it first if you might want it again.${shareClient ? " If you shared a link to it, stop sharing first: deleting it here leaves the link working." : ""}`}
          confirm="Delete"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            const id = removing.id;
            setRemoving(null);
            attempt(async () => {
              await library.remove(id);
              void userSettings.forget(browserKey(id)).catch(() => undefined);
              await refresh();
            });
          }}
        />
      )}
    </StartPage>
  );
}
