import { kindLabel, kindList, LEVEL_TITLE, SCOPE_KINDS, VIEW_LEVELS, type Operation, type ViewLevel, type Workspace } from "@open-arch/core";
import { deletePlan, idFromName, uniqueId } from "../model.js";
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
};

export function NewViewDialog({ ws, onCreate, onClose }: { ws: Workspace; onCreate(op: Operation, id: string): void; onClose(): void }) {
  const [level, setLevel] = useState<ViewLevel>("container");
  const scopeKinds = SCOPE_KINDS[level];
  // A state view's scope is optional, and can be any element: the one whose states it shows.
  const optional = level === "state";
  const scopeKind = scopeKinds.length && !optional ? kindList(scopeKinds) : undefined;
  const scopes = [...ws.elements.values()].filter((e) => scopeKinds.includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name));
  const [scope, setScope] = useState<string>("");
  const scopeId = optional ? scopes.find((s) => s.id === scope)?.id : scopeKind ? (scopes.some((s) => s.id === scope) ? scope : scopes[0]?.id) : undefined;
  const scopeName = scopeId ? ws.elements.get(scopeId)?.name : undefined;
  // A sequence, and a state view of nothing in particular, have no scope to name them after, so they need a title.
  const defaultTitle = level === "sequence" || (optional && !scopeName) ? undefined : scopeName ? `${scopeName} ${LEVEL_TITLE[level]}` : "System landscape";
  const [title, setTitle] = useState("");
  const finalTitle = title.trim() || defaultTitle;
  const canCreate = !!finalTitle && (!scopeKind || !!scopeId);

  const create = () => {
    if (!finalTitle || !canCreate) return;
    const id = uniqueId(ws, idFromName(finalTitle) || "view");
    onCreate({ op: "add-view", id, level, scope: scopeId, title: finalTitle }, id);
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
          <span className="field-label">The states of</span>
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
        <input value={title} placeholder={defaultTitle ?? "e.g. Placing an order"} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </label>
      {level === "class" && <p className="muted small">A class view draws the component's or library's classes as a UML class diagram, with their attributes and methods, and how they relate.</p>}
      {level === "state" && <p className="muted small">A state view shows the states something can be in, like an order that's placed, paid or delivered, and the transitions between them.</p>}
      {level === "sequence" && <p className="muted small">Give it a title. A sequence shows what happens, step by step: who calls whom, and who answers. Each step goes along a relationship in the model.</p>}
    </Modal>
  );
}
