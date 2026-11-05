/** Sharing the open workspace as a link (share.ts), and opening a link someone shared. */
import { useEffect, useState } from "react";
import { copyText } from "../hosts.js";
import { userSettings, type Settings } from "../settings.js";
import { linkTo, readLink, type LinkParts, type Share, type ShareClient, type SharedFile } from "../share.js";
import { Modal } from "./dialogs.js";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface ShareDialogProps {
  client: ShareClient;
  /** The workspace's host key: its link is kept by it. */
  workspace: string;
  /** The workspace as it is now, to upload. */
  file: SharedFile;
  /** The designer that links open in. */
  designer: string;
  settings?: Settings;
  onClose(): void;
}

export function ShareDialog({ client, workspace, file, designer, settings = userSettings, onClose }: ShareDialogProps) {
  /** Undefined until what's kept has been read; null when it isn't shared. */
  const [share, setShare] = useState<Share | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    settings
      .share(workspace)
      .then((s) => !cancelled && setShare(s ?? null))
      .catch(() => !cancelled && setShare(null));
    return () => {
      cancelled = true;
    };
  }, [settings, workspace]);

  const attempt = (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    task()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const keep = async (next: Share, text: string) => {
    setShare(next);
    setNotice(text);
    // If it can't be kept, the link still works, but this browser can't update it later.
    await settings.setShare(workspace, next).catch(() => setError("The link works, but this browser couldn't keep it, so it can't update the link or stop sharing it later."));
  };

  const create = () => attempt(async () => keep(await client.create(file), "Made a link. Copy it, and send it to whoever should see this workspace."));
  const update = () => attempt(async () => keep(await client.update(share!, file), "Updated the link. It opens this version now, and so do links you already sent. The version before is deleted."));
  const stop = () =>
    attempt(async () => {
      await client.remove(share!);
      await settings.setShare(workspace, undefined);
      setShare(null);
      setStopping(false);
      setNotice("Stopped sharing it. Its links don't open it any more.");
    });

  const link = share ? linkTo(designer, share) : null;
  const copy = () =>
    attempt(async () => {
      await copyText(link!);
      setNotice("Copied the link.");
    });

  if (share === undefined) return null;

  if (stopping) {
    return (
      <Modal
        title="Stop sharing?"
        onClose={onClose}
        actions={
          <>
            <button onClick={() => setStopping(false)} disabled={busy}>
              Cancel
            </button>
            <button className="danger primary" onClick={stop} disabled={busy}>
              Stop sharing
            </button>
          </>
        }
      >
        <p>The copy on the share server is deleted, and the links you sent stop opening it. Anyone who saved a copy keeps theirs.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="Share a link"
      onClose={onClose}
      actions={
        share ? (
          <>
            <button className="danger" onClick={() => setStopping(true)} disabled={busy}>
              Stop sharing…
            </button>
            <button onClick={update} disabled={busy}>
              Update link
            </button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={create} disabled={busy}>
              {busy ? "Sharing…" : "Create link"}
            </button>
          </>
        )
      }
    >
      {share ? (
        <>
          <label className="field">
            <span className="field-label">Link</span>
            <span className="share-link">
              <input value={link!} readOnly onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
              <button onClick={copy} disabled={busy}>
                Copy
              </button>
            </span>
            <span className="field-hint">Shared {when.format(share.updated)}. Changes since then aren't in it until you update it.</span>
          </label>
          <p className="muted small">Anyone with the link can open the workspace and save a copy. Only you, from this device, can update it or stop sharing it.</p>
        </>
      ) : (
        <>
          <p>Anyone with the link can open this workspace and save a copy. Only you, from this device, can update it or stop sharing it.</p>
          <p className="muted small">
            It's encrypted on this device before it's uploaded. The key is in the link, after the #, which browsers never send to a server, so the share server can't read it. The server keeps the address it was uploaded from, to stop abuse.
          </p>
        </>
      )}
      {notice && (
        <p className="small" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** Asks for a link someone shared, to open it. */
export function OpenLinkDialog({ onOpen, onClose }: { onOpen(link: LinkParts): void; onClose(): void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const open = () => {
    const link = readLink(text);
    if (link) onOpen(link);
    else setProblem("That isn't a whole share link. One looks like https://…/?share=…&v=…#key=…, with the part after the # too.");
  };
  return (
    <Modal
      title="Open a shared link"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={open} disabled={!text.trim()}>
            Open
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Link</span>
        <input
          value={text}
          placeholder="https://…/?share=…"
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && text.trim() && open()}
        />
      </label>
      <p className="muted small">Edits to it stay here, as an example's do, until you save a copy.</p>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}
