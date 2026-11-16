import { kindLabel, kindList, LEVEL_TITLE, SCOPE_KINDS, VIEW_LEVELS, type Operation, type ViewLevel, type Workspace } from "@open-arch/core";
import { addViewOp, deletePlan } from "../model.js";
import { useEffect, useRef, useState, type ReactNode } from "react";

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

interface NotesEditorProps {
  /** Whose notes they are: an element's name, a view's title, or a relationship's two ends. */
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

/**
 * Notes in an editor as big as the window, for writing at length. Done, Ctrl+Enter (⌘Enter on a
 * Mac) and Esc all save them, so a stray key doesn't lose what was written, and Undo takes them
 * back. Cancel leaves them as they were. A save that doesn't go through keeps the editor open,
 * with the text still in it, and so does what the notes are on going.
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
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  /** Keeps the editor open, with the text, as Esc pressed twice can close it whatever the page does. */
  const stayOpen = () => {
    if (!ref.current!.open) ref.current!.showModal();
  };
  const done = async () => {
    if (busy.current) return stayOpen();
    const next = box.current!.value;
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
      <h2>Notes on {name}</h2>
      <textarea
        ref={box}
        defaultValue={text}
        readOnly={saving}
        aria-label="Notes"
        placeholder="Longer documentation, in markdown"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault();
            void done();
          }
        }}
      />
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
        <span className="muted small grow">In markdown. Done, Esc or {isMac ? "⌘" : "Ctrl+"}Enter saves them, and Undo takes them back.</span>
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

export function DeleteElementDialog({ ws, id, inView, onHide, onDelete, onClose }: { ws: Workspace; id: string; inView: boolean; onHide(): void; onDelete(): void; onClose(): void }) {
  const element = ws.elements.get(id);
  if (!element) return null;
  const plan = deletePlan(ws, id);
  const inside = plan.inside;
  return (
    <Modal
      title={`Delete ${element.name}?`}
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          {inView && <button onClick={onHide}>Only hide it from this view</button>}
          <button className="danger primary" onClick={onDelete}>
            Delete from model
          </button>
        </>
      }
    >
      <p>Deleting removes it from every view and deletes its file.</p>
      <ul>
        {inside.length > 0 && <li>Also deletes what's inside it: {inside.map((e) => e.name).join(", ")}.</li>}
        {plan.views.length > 0 && <li>Also deletes these views: {plan.views.map((v) => v.title).join(", ")}.</li>}
        {plan.affected.length > 0 && <li>Removes relationships to it from: {plan.affected.map((e) => e.name).join(", ")}.</li>}
        {plan.builtWith.length > 0 && <li>Takes it out of the containers built with it: {plan.builtWith.map((e) => e.name).join(", ")}.</li>}
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
};

export function NewViewDialog({ ws, onCreate, onClose }: { ws: Workspace; onCreate(op: Operation, id: string): void; onClose(): void }) {
  const [level, setLevel] = useState<ViewLevel>("container");
  const scopeKinds = SCOPE_KINDS[level];
  // A state view's scope is optional, and can be any element: the one whose states it shows. A
  // wireframe view's is optional too: the system or container whose screens it shows.
  const optional = level === "state" || level === "wireframe";
  const scopeKind = scopeKinds.length && !optional ? kindList(scopeKinds) : undefined;
  const scopes = [...ws.elements.values()].filter((e) => scopeKinds.includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name));
  const [scope, setScope] = useState<string>("");
  const scopeId = optional ? scopes.find((s) => s.id === scope)?.id : scopeKind ? (scopes.some((s) => s.id === scope) ? scope : scopes[0]?.id) : undefined;
  const scopeName = scopeId ? ws.elements.get(scopeId)?.name : undefined;
  // A sequence, a deployment view, an event view, and a state or wireframe view of nothing in particular, have no scope to name them after, so they need a title.
  const defaultTitle = level === "sequence" || level === "deployment" || level === "event" || (optional && !scopeName) ? undefined : scopeName ? `${scopeName} ${LEVEL_TITLE[level]}` : "System landscape";
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
          <span className="field-label">{level === "wireframe" ? "The screens of" : "The states of"}</span>
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
        <input value={title} placeholder={defaultTitle ?? (level === "deployment" ? "e.g. Production" : level === "wireframe" ? "e.g. Checkout" : "e.g. Placing an order")} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      {level === "class" && <p className="muted small">A class view draws the component's or library's classes as a UML class diagram, with their attributes and methods, and how they relate.</p>}
      {level === "state" && <p className="muted small">A state view shows the states something can be in, like an order that's placed, paid or delivered, and the transitions between them.</p>}
      {level === "wireframe" && (
        <p className="muted small">
          A wireframe view sketches an app's screens: the headings, buttons and boxes to type in on each, and which screen a button or link leads to. Choose the system or container whose screens they are, if you like.
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
