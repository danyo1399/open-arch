import { SCOPE_KIND, VIEW_LEVELS, type Operation, type ViewLevel, type Workspace } from "@open-arch/core";
import { deletePlan, uniqueId } from "../model.js";
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
};

export function NewViewDialog({ ws, onCreate, onClose }: { ws: Workspace; onCreate(op: Operation, id: string): void; onClose(): void }) {
  const [level, setLevel] = useState<ViewLevel>("container");
  const scopeKind = SCOPE_KIND[level];
  const scopes = scopeKind ? [...ws.elements.values()].filter((e) => e.kind === scopeKind).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const [scope, setScope] = useState<string>("");
  const scopeId = scopeKind ? (scopes.some((s) => s.id === scope) ? scope : scopes[0]?.id) : undefined;
  const scopeName = scopeId ? ws.elements.get(scopeId)?.name : undefined;
  const defaultTitle = scopeName ? `${scopeName} ${level === "context" ? "context" : level === "container" ? "containers" : "components"}` : "System landscape";
  const [title, setTitle] = useState("");

  const create = () => {
    const finalTitle = title.trim() || defaultTitle;
    const id = uniqueId(ws, finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "view");
    onCreate({ op: "add-view", id, level, scope: scopeId, title: finalTitle }, id);
  };

  return (
    <Modal
      title="New view"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} disabled={!!scopeKind && !scopeId}>
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
            <span className="muted small">There are no {scopeKind}s yet. Add one to another view first.</span>
          )}
        </label>
      )}
      <label className="field">
        <span className="field-label">Title</span>
        <input value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
    </Modal>
  );
}
