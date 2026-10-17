import { computeView, deleteElement, formatWorkspace, deleteView, hideInView, removeRelationship, scopeProblems, showInView, type ArchElement, type Diagnostic, type ViewDef, type Workspace } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, type Selection } from "./canvas/Canvas.js";
import { downloadZip, MemoryHost, type WorkspaceHost } from "./hosts.js";
import { ConfirmDialog, DeleteElementDialog, NewViewDialog } from "./panels/dialogs.js";
import { Properties } from "./panels/Properties.js";
import { Sidebar } from "./panels/Sidebar.js";
import { chain, useWorkspace } from "./state.js";

type Dialog = { kind: "delete"; id: string } | { kind: "deleteView"; id: string } | { kind: "newView" } | null;

/** Whether a view can draw this element as its own box (rather than as the system or container around it). */
function canShowAsBox(ws: Workspace, view: ViewDef, element: ArchElement): boolean {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  if (element.kind === "person" || element.kind === "system") {
    // The frame's own system has no box of its own.
    const frameSystem = view.level === "container" ? scope?.id : view.level === "component" ? scope?.parent : undefined;
    return element.id !== frameSystem;
  }
  if (view.level === "container") return element.parent === scope?.id;
  if (view.level === "component") return element.parent === scope?.id || (element.kind === "container" && element.parent === scope?.parent && element.id !== scope?.id);
  return false;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Designer({ host, onClose }: { host: WorkspaceHost; onClose(): void }) {
  const state = useWorkspace(host);
  const { ws, diagnostics, edit } = state;
  const [viewId, setViewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [isNew, setIsNew] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Keep a valid view open: the current one if it still exists, else the first by title.
  useEffect(() => {
    if (!ws || (viewId && ws.views.has(viewId))) return;
    const first = [...ws.views.values()].sort((a, b) => a.title.localeCompare(b.title))[0];
    setViewId(first?.id ?? null);
  }, [ws, viewId]);

  useEffect(() => {
    if (selection?.kind === "element" && ws && !ws.elements.has(selection.id)) setSelection(null);
  }, [ws, selection]);

  const view = ws && viewId ? (ws.views.get(viewId) ?? null) : null;
  const computed = useMemo(() => (ws && view && scopeProblems(ws, view).length === 0 ? computeView(ws, view) : null), [ws, view]);
  const inView = useMemo(() => new Set([...(computed?.nodes.map((n) => n.id) ?? []), ...(computed?.boundary ? [computed.boundary.id] : [])]), [computed]);

  const showable = useMemo(() => new Set(ws && view ? [...ws.elements.values()].filter((e) => canShowAsBox(ws, view, e)).map((e) => e.id) : []), [ws, view]);

  const select = useCallback((next: Selection, options?: { isNew?: boolean }) => {
    setSelection(next);
    setIsNew(!!options?.isNew);
  }, []);

  const selectView = (id: string) => {
    setViewId(id);
    select(null);
  };

  const removeSelection = useCallback(() => {
    if (selection?.kind === "element") setDialog({ kind: "delete", id: selection.id });
    if (selection?.kind === "arrow" && computed) {
      const edge = computed.edges.find((e) => e.from === selection.from && e.to === selection.to);
      if (!edge || edge.implied) return;
      // Remove the direct relationships drawn by this arrow, last first so earlier positions stay valid.
      const direct = edge.sources.filter((s) => s.element === selection.from && ws?.elements.get(s.element)?.uses[s.index]?.to === selection.to);
      const steps = direct.sort((a, b) => b.index - a.index).map((s) => (w: Workspace) => removeRelationship(w, s.element, s.index));
      void edit((w) => chain(w, ...steps)).then(() => select(null));
    }
  }, [selection, computed, edit, select, ws]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, dialog")) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        state.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
      } else if (e.key === "Escape") {
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, removeSelection, select]);

  const openProblem = (d: Diagnostic) => {
    const file = ws?.files.get(d.path);
    if (!file) return;
    if (file.role === "view" && ws!.views.has(file.id)) selectView(file.id);
    else if (ws!.elements.has(file.id)) select({ kind: "element", id: file.id });
  };

  if (state.loadError) {
    return (
      <div className="center">
        <p>Couldn't open the workspace: {state.loadError}</p>
        <button onClick={onClose}>Back</button>
      </div>
    );
  }
  if (!ws) return <div className="center muted">Loading…</div>;

  const mod = isMac ? "⌘" : "Ctrl+";
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">open-arch</span>
        <span className="ws-name" title={host.name}>
          {host.name}
        </span>
        <span className={`storage storage-${host.storage}`}>{host.storage === "disk" ? "Saves to the folder" : "Changes stay in this tab"}</span>
        <span className="spacer" />
        {host instanceof MemoryHost && <button onClick={() => downloadZip(host)}>Download .zip</button>}
        <button onClick={state.undo} disabled={!state.canUndo} title={`Undo (${mod}Z)`}>
          Undo
        </button>
        <button onClick={state.redo} disabled={!state.canRedo} title={`Redo (${mod}⇧Z)`}>
          Redo
        </button>
        <button onClick={onClose}>Close</button>
      </header>

      <Sidebar
        ws={ws}
        diagnostics={diagnostics}
        viewId={viewId}
        inView={inView}
        showable={showable}
        selection={selection}
        onSelectView={selectView}
        onSelect={select}
        onShowInView={(id) => view && void edit((w) => showInView(w, view.id, id))}
        onNewView={() => setDialog({ kind: "newView" })}
        onOpenProblem={openProblem}
        onFormat={() => void edit((w) => formatWorkspace(w).changes)}
      />

      <main className="main">
        {view ? (
          <ReactFlowProvider key={view.id}>
            <Canvas ws={ws} view={view} diagnostics={diagnostics} selection={selection} onSelect={select} edit={edit} />
          </ReactFlowProvider>
        ) : (
          <div className="canvas-message">
            <p>There are no views yet.</p>
            <button className="primary" onClick={() => setDialog({ kind: "newView" })}>
              Create a view
            </button>
          </div>
        )}
      </main>

      <Properties
        ws={ws}
        view={view}
        computed={computed}
        selection={selection}
        isNew={isNew}
        edit={edit}
        onSelect={select}
        onHide={(id) => view && void edit((w) => hideInView(w, view.id, id)).then(() => select(null))}
        onDelete={(id) => setDialog({ kind: "delete", id })}
        onDeleteView={(id) => setDialog({ kind: "deleteView", id })}
      />

      {state.message && (
        <div className={`toast toast-${state.message.kind}`} role={state.message.kind === "error" ? "alert" : "status"}>
          <span>{state.message.text}</span>
          <button className="icon" onClick={state.dismissMessage} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {dialog?.kind === "delete" && (
        <DeleteElementDialog
          ws={ws}
          id={dialog.id}
          inView={!!view && inView.has(dialog.id) && computed?.boundary?.id !== dialog.id}
          onClose={() => setDialog(null)}
          onHide={() => {
            setDialog(null);
            if (view) void edit((w) => hideInView(w, view.id, dialog.id)).then(() => select(null));
          }}
          onDelete={() => {
            setDialog(null);
            void edit((w) => deleteElement(w, dialog.id)).then(() => select(null));
          }}
        />
      )}
      {dialog?.kind === "deleteView" && (
        <ConfirmDialog
          title={`Delete the view "${ws.views.get(dialog.id)?.title}"?`}
          text="This deletes the view file and its saved positions. The elements stay in the model."
          confirm="Delete view"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void edit((w) => deleteView(w, dialog.id)).then(() => setViewId(null));
          }}
        />
      )}
      {dialog?.kind === "newView" && (
        <NewViewDialog
          ws={ws}
          onClose={() => setDialog(null)}
          onCreate={(changes, id) => {
            setDialog(null);
            void edit(() => changes).then((ok) => ok && selectView(id));
          }}
        />
      )}
    </div>
  );
}
