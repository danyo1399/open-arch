import { kindLabel, kindList, LEVEL_TITLE, SCOPE_KINDS, VIEW_LEVELS, type Operation, type ViewLevel, type Workspace } from "@open-arch/core";
import { addViewOp, deletePlan, SCOPE_LABELS } from "../model.js";
import type { Version } from "../state.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Format, RichNotes } from "./richNotes.js";

export function Modal({ title, children, actions, onClose }: { title: string; children: ReactNode; actions: ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <h2>{title}</h2>
      <div className="modal-body">{children}</div>
      <div className="modal-actions">{actions}</div>
    </dialog>
  );
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

interface NotesEditorProps {
  /** Whose notes they are: an element's name, a view's title, a relationship's two ends, or a sticky note's text. */
  name: string;
  /** The text to start from: what's in the box in the details panel. */
  text: string;
  /** The notes as they're saved now, or undefined when what they're on is no longer in the model. */
  saved: string | undefined;
  /** It can't save until it knows which relationship it's on, a moment after it opens. */
  ready?: boolean;
  /** Saves the text, and says whether it was saved. */
  onSave(text: string): Promise<boolean>;
  onClose(): void;
}

/** The kinds of address the formatted view links to, as Milkdown does: it shows any other, such as javascript:, as text that goes nowhere. Ask AI's answers link to the same. */
export const LINK_SCHEMES = ["http:", "https:", "mailto:", "tel:", "ftp:"];

/** An address's scheme, such as "https:", in lowercase, or undefined when it has none. */
export function schemeOf(href: string): string | undefined {
  // Browsers skip spaces and control characters in a scheme, so "java script:" is still one.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000-\u0020]/g, ""))?.[1];
  return scheme && `${scheme.toLowerCase()}:`;
}

/** Whether an address can be a link in notes: one of those, or one with no scheme, relative to the page the notes are on. */
export function linkable(href: string): boolean {
  const scheme = schemeOf(href);
  return !scheme || LINK_SCHEMES.includes(scheme);
}

/** The formatted view's toolbar: what each button does, what it shows, and what it says it does. */
const TOOLS: { format: Format; label: string; title: string; className?: string }[] = [
  { format: "bold", label: "B", title: `Bold (${mod}B)`, className: "tool-bold" },
  { format: "italic", label: "I", title: `Italic (${mod}I)`, className: "tool-italic" },
  { format: "strike", label: "S", title: "Strikethrough", className: "tool-strike" },
  { format: "code", label: "Code", title: "Code, in a line of text" },
  { format: "h1", label: "H1", title: "Heading" },
  { format: "h2", label: "H2", title: "Smaller heading" },
  { format: "h3", label: "H3", title: "Smallest heading" },
  { format: "bullets", label: "• List", title: "Bulleted list" },
  { format: "numbers", label: "1. List", title: "Numbered list" },
  { format: "quote", label: "Quote", title: "Quote" },
  { format: "codeBlock", label: "Code block", title: "Code block, for lines of code or a Mermaid diagram" },
];

/**
 * The formatted view: the editor in richNotes.ts, loaded the first time it's shown. Each time
 * it's shown it gets a box of its own, so one that's still loading as it goes never lands in
 * the next one.
 */
function FormattedNotes({ text, onReady, onFail, onChange, onDone }: { text: string; onReady(editor: RichNotes): void; onFail(): void; onChange(): void; onDone(): void }) {
  const root = useRef<HTMLDivElement>(null);
  // What it says is the latest, so a change seen as it loads goes to this render's callbacks.
  const said = useRef({ onReady, onFail, onChange });
  said.current = { onReady, onFail, onChange };
  useEffect(() => {
    const box = document.createElement("div");
    root.current!.append(box);
    let editor: RichNotes | null = null;
    let gone = false;
    import("./richNotes.js")
      .then(({ richNotes }) => richNotes(box, text, { placeholder: "Longer documentation. Markdown works too, like ## for a heading or - for a list.", onChange: () => said.current.onChange() }))
      .then((made) => {
        if (gone) return void made.destroy();
        editor = made;
        said.current.onReady(made);
        made.view.focus();
      })
      .catch(() => !gone && said.current.onFail());
    return () => {
      gone = true;
      void editor?.destroy();
      box.remove();
    };
  }, [text]);
  return (
    <div
      ref={root}
      className="notes-formatted"
      // Before the editor sees them: it takes Esc for itself, which would never reach the dialog.
      onKeyDownCapture={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey))) {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
    />
  );
}

/**
 * Notes in an editor as big as the window, for writing at length. They're shown formatted, as
 * they read, and edited that way, or as markdown, the way they're saved. Done, Ctrl+Enter (⌘Enter
 * on a Mac) and Esc all save them, so a stray key doesn't lose what was written, and Undo takes
 * them back. Cancel leaves them as they were. A save that doesn't go through keeps the editor
 * open, with the text still in it, and so does what the notes are on going.
 */
export function NotesEditor({ name, text, saved, ready = true, onSave, onClose }: NotesEditorProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  // What was saved when it opened, to tell when the notes are changed elsewhere meanwhile.
  const [opened] = useState(saved);
  const [failed, setFailed] = useState(false);
  // While a save runs, the text can't change and nothing else can close the editor, so what it
  // closes on is what was saved. A ref, as a second key can come before the render that shows it.
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  /** Formatted, as the notes read, or the markdown they're saved as. */
  const [view, setView] = useState<"formatted" | "markdown">("formatted");
  /** The markdown the view shown now started from. */
  const [source, setSource] = useState(text);
  /** The formatted view's editor, once it's loaded, and whether it couldn't be. */
  const rich = useRef<RichNotes | null>(null);
  const [richReady, setRichReady] = useState(false);
  const [richFailed, setRichFailed] = useState(false);
  /** The formats the selection has, for the toolbar. */
  const [formats, setFormats] = useState<Set<Format>>(() => new Set());
  /** While a link's address is being typed: the address, and whether the selection was in a link already. */
  const [linking, setLinking] = useState<{ href: string; had: boolean } | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    rich.current?.setEditable(!saving);
  }, [saving, richReady]);
  /** The notes as they are now, in markdown. */
  const current = () => (view === "markdown" ? box.current!.value : (rich.current?.markdown() ?? source));
  /** Keeps the editor open, with the text, as Esc pressed twice can close it whatever the page does. */
  const stayOpen = () => {
    if (!ref.current!.open) ref.current!.showModal();
  };
  const done = async () => {
    if (busy.current) return stayOpen();
    const next = current();
    if (next === saved) return onClose();
    if (!ready || saved === undefined) return stayOpen();
    busy.current = true;
    setSaving(true);
    const ok = await onSave(next);
    busy.current = false;
    setSaving(false);
    if (ok) return onClose();
    setFailed(true);
    stayOpen();
  };
  /** Shows the notes formatted or as markdown, as they are now. */
  const show = (next: "formatted" | "markdown") => {
    if (next === view || busy.current) return;
    setSource(current());
    rich.current = null;
    setRichReady(false);
    setFormats(new Set());
    setLinking(null);
    setView(next);
  };
  const editor = richReady ? rich.current : null;
  // Code is only code, so it can't be a link; the box for its address goes while the cursor's in code.
  const canLink = !!editor && !saving && !formats.has("code") && !formats.has("codeBlock");
  useEffect(() => {
    if (!canLink) setLinking(null);
  }, [canLink]);
  const setLink = (href: string | null) => {
    editor?.link(href);
    setLinking(null);
  };
  // The box's own text landing after it opened, as leaving the box saves it, isn't a change from elsewhere.
  const changed = saved !== undefined && saved !== opened && saved !== text;
  return (
    <dialog
      ref={ref}
      className="modal notes-editor"
      aria-label={`Notes on ${name}`}
      onCancel={(e) => {
        e.preventDefault();
        void done();
      }}
      onClose={() => void done()}
    >
      <div className="notes-head">
        <h2>Notes on {name}</h2>
        <div className="segmented" role="group" aria-label="Show the notes">
          <button aria-pressed={view === "formatted"} onClick={() => show("formatted")} disabled={saving || richFailed} title="As they read, with headings, lists and links drawn as they are">
            Formatted
          </button>
          <button aria-pressed={view === "markdown"} onClick={() => show("markdown")} disabled={saving} title="As markdown, the way they're saved">
            Markdown
          </button>
        </div>
      </div>
      {view === "formatted" && (
        <div className="notes-toolbar" role="toolbar" aria-label="Formatting">
          {TOOLS.map((tool) => (
            <button
              key={tool.format}
              className={tool.className}
              title={tool.title}
              aria-label={tool.title}
              aria-pressed={formats.has(tool.format)}
              disabled={!editor || saving}
              // Pressing a button leaves the cursor and the selection in the notes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor?.format(tool.format);
                setFormats(editor?.formats() ?? new Set());
              }}
            >
              {tool.label}
            </button>
          ))}
          <button
            title="Link"
            aria-label="Link"
            aria-pressed={linking !== null}
            disabled={!canLink}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const here = editor?.linkHere() ?? null;
              setLinking(linking ? null : { href: here ?? "", had: here !== null });
            }}
          >
            Link
          </button>
        </div>
      )}
      {view === "formatted" && linking && (
        <form
          className="notes-link"
          onSubmit={(e) => {
            e.preventDefault();
            if (linkable(linking.href)) setLink(linking.href.trim() || null);
          }}
        >
          <input
            autoFocus
            aria-label="Link address"
            placeholder="https://…"
            value={linking.href}
            onChange={(e) => setLinking({ ...linking, href: e.target.value })}
            onKeyDown={(e) => {
              // Esc puts the link away, rather than closing the editor.
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              setLinking(null);
              editor?.view.focus();
            }}
          />
          <button type="submit" className="primary" disabled={!linking.href.trim() || !linkable(linking.href)}>
            {linking.had ? "Change link" : "Add link"}
          </button>
          {linking.had && (
            <button type="button" onClick={() => setLink(null)}>
              Remove link
            </button>
          )}
        </form>
      )}
      {view === "formatted" && linking && !linkable(linking.href) && (
        <p className="error small notes-link-error" role="alert">
          A link goes to a web, email, phone or FTP address, or to a path like docs/setup.md.
        </p>
      )}
      {view === "formatted" ? (
        <>
          {!richReady && <p className="muted small notes-loading">Loading the notes…</p>}
          <FormattedNotes
            text={source}
            onReady={(made) => {
              rich.current = made;
              setRichReady(true);
              setFormats(made.formats());
            }}
            onFail={() => {
              setRichFailed(true);
              setView("markdown");
            }}
            onChange={() => rich.current && setFormats(rich.current.formats())}
            onDone={() => void done()}
          />
        </>
      ) : (
        <textarea
          ref={box}
          defaultValue={source}
          readOnly={saving}
          autoFocus
          aria-label="Notes"
          placeholder="Longer documentation, in markdown"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
              e.preventDefault();
              void done();
            }
          }}
        />
      )}
      {richFailed && view === "markdown" && (
        <p className="muted small">
          The formatted view couldn't be loaded, so the notes are shown as markdown. If a new version of open-arch came out since you opened it, save the notes, then close open-arch and open it again to get the formatted view back.
        </p>
      )}
      {saved === undefined ? (
        <p className="error small" role="alert">
          {name} was changed or deleted elsewhere, so these notes can't be saved. Copy them to keep them.
        </p>
      ) : failed ? (
        <p className="error small" role="alert">
          These notes weren't saved. They're still here: try again, or copy them to keep them.
        </p>
      ) : (
        changed && <p className="error small">These notes were changed elsewhere since you opened them. Done saves yours in their place.</p>
      )}
      <div className="modal-actions">
        <span className="muted small grow">Saved as markdown. Done, Esc or {mod}Enter saves them, and Undo takes them back.</span>
        <span className="buttons">
          <button onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={() => void done()} disabled={saving || !ready}>
            Done
          </button>
        </span>
      </div>
    </dialog>
  );
}

/**
 * Asks before deleting elements from the model: one, or several selected together, with the
 * sticky notes selected with them, which go too. `inView` offers to only hide the boxes from the
 * open view instead, which leaves the notes as they are.
 */
export function DeleteElementDialog({
  ws,
  ids,
  stickies = 0,
  inView,
  onHide,
  onDelete,
  onClose,
}: {
  ws: Workspace;
  ids: readonly string[];
  stickies?: number;
  inView: boolean;
  onHide(): void;
  onDelete(): void;
  onClose(): void;
}) {
  const elements = ids.flatMap((id) => ws.elements.get(id) ?? []);
  if (elements.length === 0) return null;
  const one = elements.length === 1;
  const plan = deletePlan(ws, ids);
  const inside = plan.inside;
  const names = elements.map((e) => e.name);
  const list = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    <Modal
      title={one ? `Delete ${elements[0]!.name}?` : `Delete ${elements.length} elements?`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          {inView && <button onClick={onHide}>{one ? "Only hide it from this view" : "Only hide them from this view"}</button>}
          <button className="danger primary" onClick={onDelete}>
            Delete from model
          </button>
        </>
      }
    >
      <p>{one ? "Deleting removes it from every view and deletes its file." : `Deleting removes ${list} from every view and deletes their files.`}</p>
      <ul>
        {inside.length > 0 && <li>Also deletes what's inside {one ? "it" : "them"}: {inside.map((e) => e.name).join(", ")}.</li>}
        {plan.views.length > 0 && <li>Also deletes these views: {plan.views.map((v) => v.title).join(", ")}.</li>}
        {plan.affected.length > 0 && <li>Removes relationships to {one ? "it" : "them"} from: {plan.affected.map((e) => e.name).join(", ")}.</li>}
        {plan.builtWith.length > 0 && <li>Takes {one ? "it" : "the libraries"} out of the containers built with {one ? "it" : "them"}: {plan.builtWith.map((e) => e.name).join(", ")}.</li>}
        {stickies > 0 && <li>Also deletes the {stickies === 1 ? "sticky note" : `${stickies} sticky notes`} selected with {one ? "it" : "them"}.</li>}
      </ul>
    </Modal>
  );
}

export function ConfirmDialog({ title, text, confirm, onConfirm, onClose }: { title: string; text: string; confirm: string; onConfirm(): void; onClose(): void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="danger primary" onClick={onConfirm}>
            {confirm}
          </button>
        </>
      }
    >
      <p>{text}</p>
    </Modal>
  );
}

/** When a change was made, as the History list shows it: the time of day, to the minute, after the day when that isn't today. */
export function changeTime(at: number, now = Date.now()): string {
  const time: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const today = new Date(at).toDateString() === new Date(now).toDateString();
  return today ? new Date(at).toLocaleTimeString([], time) : new Date(at).toLocaleString([], { month: "short", day: "numeric", ...time });
}

/**
 * The History list: the changes made here, newest first, to go back to the workspace as it was
 * just after any of them, or forward again to one that was undone. It opens on the one showing
 * now, and stays open after a pick, to try another. `onGo` resolves to what went wrong when the
 * version picked couldn't be saved. The dialog says so itself, as the designer's own message is
 * under it, until a pick goes through: only the last pick's problem, not another message that
 * happens to be up.
 */
export function HistoryDialog({ versions, current, onGo, onClose }: { versions: Version[]; current: number; onGo(version: number): Promise<string | null>; onClose(): void }) {
  const now = versions.findIndex((v) => v.number === current);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = useRef<HTMLButtonElement>(null);
  // After the dialog has opened, which puts the focus on its first button.
  useEffect(() => {
    shown.current?.focus();
  }, []);
  return (
    <Modal title="History" onClose={onClose} actions={<button onClick={onClose}>Close</button>}>
      <p>
        The changes made here, newest first, with when each was made. Pick one to go back to the workspace as it was just after it, or one that was undone to make it again. Undo and Redo carry on from
        there.
      </p>
      <p className="muted small">This list is kept only while the workspace is open here. It isn't saved in the file, exported or shared.</p>
      {versions.length === 1 ? (
        <p className="muted">No changes since the workspace was opened, or reloaded.</p>
      ) : (
        <ol className="history">
          {versions
            .map((v, i) => (
              <li key={v.number}>
                <button ref={i === now ? shown : undefined} className={i > now ? "row undone" : i === now ? "row active" : "row"} aria-current={i === now} onClick={() => void onGo(v.number).then(setProblem)}>
                  <span className="grow">{v.change ?? "Before these changes"}</span>
                  {i >= now && <span className="small">{i === now ? "Now" : "Undone"}</span>}
                  {v.at !== null && (
                    <time className="muted small" dateTime={new Date(v.at).toISOString()}>
                      {changeTime(v.at)}
                    </time>
                  )}
                </button>
              </li>
            ))
            .reverse()}
        </ol>
      )}
      {problem !== null && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </Modal>
  );
}

const LEVEL_TEXT: Record<ViewLevel, string> = {
  landscape: "Landscape: every person and system",
  context: "Context: one system and what it connects to",
  container: "Container: the parts of one system",
  component: "Component: the parts of one container",
  class: "Class: the code inside one component or library",
  sequence: "Sequence: steps between elements, in order",
  state: "State: the states something can be in, and how it moves between them",
  deployment: "Deployment: where containers run, like Production",
  event: "Event: commands and events in order, in swimlanes, as in event storming",
  wireframe: "Wireframe: an app's screens, and how one leads to another",
  whiteboard: "Whiteboard: a freehand sketch of an idea, to share it",
  flowchart: "Flowchart: the steps and decisions of a process",
  entity: "Entity: an entity-relationship diagram (ERD) of the data something keeps",
};

export function NewViewDialog({ ws, onCreate, onClose }: { ws: Workspace; onCreate(op: Operation, id: string): void; onClose(): void }) {
  const [level, setLevel] = useState<ViewLevel>("container");
  const scopeKinds = SCOPE_KINDS[level];
  // A state view's scope is optional, and can be any element: the one whose states it shows. A
  // wireframe view's is optional too: the system or container whose screens it shows. So is a
  // flowchart's: any element, whose process it shows. And an entity view's: the system, container,
  // component or library whose data it shows.
  const optional = level === "state" || level === "wireframe" || level === "flowchart" || level === "entity";
  const scopeKind = scopeKinds.length && !optional ? kindList(scopeKinds) : undefined;
  const scopes = [...ws.elements.values()].filter((e) => scopeKinds.includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name));
  const [scope, setScope] = useState<string>("");
  const scopeId = optional ? scopes.find((s) => s.id === scope)?.id : scopeKind ? (scopes.some((s) => s.id === scope) ? scope : scopes[0]?.id) : undefined;
  const scopeName = scopeId ? ws.elements.get(scopeId)?.name : undefined;
  // A sequence, a deployment, event or whiteboard view, and a state, wireframe, flowchart or entity view of nothing in particular, have no scope to name them after, so they need a title.
  const defaultTitle = level === "sequence" || level === "deployment" || level === "event" || level === "whiteboard" || (optional && !scopeName) ? undefined : scopeName ? `${scopeName} ${LEVEL_TITLE[level]}` : "System landscape";
  const [title, setTitle] = useState("");
  const finalTitle = title.trim() || defaultTitle;
  const canCreate = !!finalTitle && (!scopeKind || !!scopeId);

  const create = () => {
    if (!finalTitle || !canCreate) return;
    const op = addViewOp(ws, level, scopeId, finalTitle);
    onCreate(op, op.id);
  };

  return (
    <Modal
      title="New view"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} disabled={!canCreate}>
            Create view
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Level</span>
        <select value={level} onChange={(e) => setLevel(e.target.value as ViewLevel)}>
          {VIEW_LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_TEXT[l]}
            </option>
          ))}
        </select>
      </label>
      {scopeKind && (
        <label className="field">
          <span className="field-label">Of which {scopeKind}</span>
          {scopes.length ? (
            <select value={scopeId} onChange={(e) => setScope(e.target.value)}>
              {scopes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="muted small">There are no {kindList(scopeKinds.map((k) => (k === "library" ? "libraries" : `${k}s`)))} yet. Add one to another view first.</span>
          )}
        </label>
      )}
      {optional && (
        <label className="field">
          <span className="field-label">{SCOPE_LABELS[level]}</span>
          <select value={scopeId ?? ""} onChange={(e) => setScope(e.target.value)}>
            <option value="">Nothing in particular</option>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} [{kindLabel(s)}]
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span className="field-label">Title</span>
        <input value={title} placeholder={defaultTitle ?? (level === "deployment" ? "e.g. Production" : level === "wireframe" ? "e.g. Checkout" : level === "whiteboard" ? "e.g. Ideas for faster checkout" : level === "flowchart" ? "e.g. Handling a return" : level === "entity" ? "e.g. Orders data" : "e.g. Placing an order")} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      {level === "class" && <p className="muted small">A class view draws the component's or library's classes as a UML class diagram, with their attributes and methods, and how they relate.</p>}
      {level === "state" && <p className="muted small">A state view shows the states something can be in, like an order that's placed, paid or delivered, and the transitions between them.</p>}
      {level === "wireframe" && (
        <p className="muted small">
          A wireframe view sketches an app's screens: the headings, buttons and boxes to type in on each, and which screen a button or link leads to. Choose the system or container whose screens they are, if you like.
        </p>
      )}
      {level === "whiteboard" && (
        <p className="muted small">
          Give it a title, such as the idea it's about. A whiteboard is a freehand sketch, to share an idea: boxes, text, arrows and lines drawn with a pen, each where you put it. None of it is part of the model.
        </p>
      )}
      {level === "flowchart" && (
        <p className="muted small">
          A flowchart shows the steps of a process: where it starts and ends, what's done, the decisions on the way, and the arrows from one to the next. Choose the element whose process it is, if you like.
        </p>
      )}
      {level === "entity" && (
        <p className="muted small">
          An entity view is an entity-relationship diagram (ERD): the things whose data is kept, like a database's tables, each with its attributes, and the links between them, with how many of each there can be. Choose the element whose data it is, like a database, if you like.
        </p>
      )}
      {level === "deployment" && (
        <p className="muted small">Give it a title, such as the environment it shows. A deployment view shows the servers, clusters and cloud services things run on, nested, and the containers running in each.</p>
      )}
      {level === "event" && (
        <p className="muted small">
          Give it a title, such as the process it shows. An event view shows what happens in a business process, as event storming does: commands, events and the other notes, in order along a timeline, in a swimlane for each actor, team or system.
        </p>
      )}
      {level === "sequence" && <p className="muted small">Give it a title. A sequence shows what happens, step by step: who calls whom, and who answers. Each step goes along a relationship in the model.</p>}
    </Modal>
  );
}
