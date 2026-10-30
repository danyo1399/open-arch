import { computeView, diagnosticTarget, scopeProblems, type ArchElement, type Diagnostic, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas, type Selection } from "./canvas/Canvas.js";
import { canSaveFiles, desktopBridge, DesktopHost, docsZip, download, FileHandleHost, pickFileToSave, type WorkspaceHost } from "./hosts.js";
import { relationshipRef } from "./model.js";
import { AskAI } from "./panels/AskAI.js";
import { ContextMenu } from "./panels/ContextMenu.js";
import { ConfirmDialog, DeleteElementDialog, NewViewDialog } from "./panels/dialogs.js";
import { Properties } from "./panels/Properties.js";
import { Sidebar } from "./panels/Sidebar.js";
import { Usages } from "./panels/Usages.js";
import { useWorkspace } from "./state.js";

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

interface DesignerProps {
  host: WorkspaceHost;
  onClose(): void;
  /** After "Save as": carry on with the new file. */
  onHostChange(host: WorkspaceHost): void;
}

export function Designer({ host, onClose, onHostChange }: DesignerProps) {
  const state = useWorkspace(host);
  const { ws, diagnostics, edit } = state;
  const [viewId, setViewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [isNew, setIsNew] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [usagesOf, setUsagesOf] = useState<string | null>(null);
  const desktop = desktopBridge();
  const agent = host instanceof DesktopHost ? desktop?.agent : undefined;

  // Keep a valid view open: the current one if it still exists, else the first by title.
  useEffect(() => {
    if (!ws || (viewId && ws.views.has(viewId))) return;
    const first = [...ws.views.values()].sort((a, b) => a.title.localeCompare(b.title))[0];
    setViewId(first?.id ?? null);
  }, [ws, viewId]);

  useEffect(() => {
    if (selection?.kind === "element" && ws && !ws.elements.has(selection.id)) setSelection(null);
  }, [ws, selection]);

  // Warn before closing the tab with changes that live only in memory.
  useEffect(() => {
    if (!state.unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.unsaved]);

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

  // Right-clicking an element selects it too, so it's clear which one the menu is for.
  const openElementMenu = (id: string, at: { x: number; y: number }) => {
    if (selection?.kind !== "element" || selection.id !== id) select({ kind: "element", id });
    setMenu({ id, ...at });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  /** A usage can be in another view: open that one, then select it there. */
  const goToUsage = (target: string | null, next: Selection) => {
    if (target && target !== viewId) setViewId(target);
    select(next);
  };

  useEffect(() => {
    if (usagesOf && ws && !ws.elements.has(usagesOf)) setUsagesOf(null);
  }, [ws, usagesOf]);

  const removeSelection = useCallback(() => {
    if (selection?.kind === "element") setDialog({ kind: "delete", id: selection.id });
    if (selection?.kind === "arrow" && computed && ws) {
      const edge = computed.edges.find((e) => e.from === selection.from && e.to === selection.to);
      if (!edge || edge.implied) return;
      // Remove the direct relationships this arrow draws, last first so earlier ones keep their place.
      const ops: Operation[] = edge.sources
        .filter((s) => s.element === selection.from && ws.elements.get(s.element)?.uses[s.index]?.to === selection.to)
        .sort((a, b) => b.index - a.index)
        .map((s) => ({ op: "remove-relationship", ...relationshipRef(ws.elements.get(s.element)!, s.index) }));
      void edit(ops).then(() => select(null));
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
    const target = diagnosticTarget(d);
    if (target?.kind === "view" && ws?.views.has(target.id)) selectView(target.id);
    else if (target?.kind === "element" && ws?.elements.has(target.id)) select({ kind: "element", id: target.id });
  };

  const saveAs = async () => {
    if (state.text === null) return;
    if (desktop) {
      const file = await desktop.saveAs(state.text);
      if (file) onHostChange(new DesktopHost(desktop, file.path, file.name));
      return;
    }
    const handle = await pickFileToSave(host.name);
    if (!handle) return;
    const next = new FileHandleHost(handle);
    await next.save(state.text);
    onHostChange(next);
  };

  if (state.loadError) {
    return (
      <div className="center">
        <p>Couldn't open the workspace: {state.loadError}</p>
        <button onClick={onClose}>Back</button>
      </div>
    );
  }
  if (!ws || state.text === null) return <div className="center muted">Loading…</div>;

  const mod = isMac ? "⌘" : "Ctrl+";
  const selected = selection?.kind === "element" ? [selection.id] : selection?.kind === "arrow" ? [selection.from, selection.to] : [];
  // While Ask AI is open, the agent's edits reload the file again and again, and the panel already says what it changed.
  const message = state.message?.kind === "info" && askOpen ? null : state.message;
  const canSaveAs = !!desktop || canSaveFiles();
  const status =
    host.storage === "file" ? (host.syncsDocs && ws.doc.export?.docs ? `Saved · docs in ${ws.doc.export.docs}/` : "Saved") : state.unsaved ? "Not saved" : "Only in this tab";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">open-arch</span>
        <button className="ws-name link" onClick={() => select({ kind: "workspace" })} title="Workspace settings">
          {ws.doc.name}
        </button>
        <span className="muted small file-name">{host.name}</span>
        <span className={`storage storage-${host.storage}${state.unsaved ? " unsaved" : ""}`}>{status}</span>
        <span className="spacer" />
        {host.storage === "memory" &&
          (canSaveAs ? (
            <button className={state.unsaved ? "primary" : ""} onClick={() => void saveAs()}>
              Save as…
            </button>
          ) : (
            <button
              className={state.unsaved ? "primary" : ""}
              onClick={() => {
                download(host.name, state.text!, "application/json");
                state.markSaved();
              }}
            >
              Download
            </button>
          ))}
        {!host.syncsDocs && (
          <button onClick={() => download(`${host.name.replace(/\.openarch$/, "")}-docs.zip`, docsZip(ws, host.name) as BlobPart, "application/zip")} title="Markdown pages with Mermaid diagrams">
            Export docs
          </button>
        )}
        {agent && (
          <button className={askOpen ? "active" : ""} aria-pressed={askOpen} onClick={() => setAskOpen((o) => !o)} title="Ask an AI agent to change the model">
            Ask AI
          </button>
        )}
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
        onShowInView={(id) => view && void edit([{ op: "show-in-view", view: view.id, id }])}
        onElementMenu={openElementMenu}
        onNewView={() => setDialog({ kind: "newView" })}
        onOpenProblem={openProblem}
      />

      <main className="main">
        {view ? (
          <ReactFlowProvider key={view.id}>
            <Canvas ws={ws} view={view} diagnostics={diagnostics} selection={selection} onSelect={select} edit={edit} onElementMenu={openElementMenu} />
          </ReactFlowProvider>
        ) : (
          <div className="canvas-message">
            <p>There are no views yet.</p>
            <button className="primary" onClick={() => setDialog({ kind: "newView" })}>
              Create a view
            </button>
          </div>
        )}
        {usagesOf && <Usages ws={ws} id={usagesOf} viewId={viewId} onGo={goToUsage} onClose={() => setUsagesOf(null)} />}
        {agent && host instanceof DesktopHost && (
          <AskAI
            agent={agent}
            path={host.path}
            context={{ viewId: view?.id, selection: selected }}
            contextLabel={[view ? `In “${view.title}”` : "No view open", selected.length > 0 && `${selected.join(", ")} selected`].filter(Boolean).join(" · ")}
            text={state.text}
            restore={state.restore}
            open={askOpen}
            onClose={() => setAskOpen(false)}
          />
        )}
      </main>

      <Properties
        ws={ws}
        view={view}
        computed={computed}
        selection={selection}
        isNew={isNew}
        syncsDocs={!!host.syncsDocs}
        docs={state.docs}
        fileName={host.name}
        edit={edit}
        onSelect={select}
        onSelectView={selectView}
        onHide={(id) => view && void edit([{ op: "hide-in-view", view: view.id, id }]).then(() => select(null))}
        onDelete={(id) => setDialog({ kind: "delete", id })}
        onDeleteView={(id) => setDialog({ kind: "deleteView", id })}
      />

      {message && (
        <div className={`toast toast-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          <span>{message.text}</span>
          <button className="icon" onClick={state.dismissMessage} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={[{ label: "Find usages", onSelect: () => setUsagesOf(menu.id) }]} onClose={closeMenu} />}
      {dialog?.kind === "delete" && (
        <DeleteElementDialog
          ws={ws}
          id={dialog.id}
          inView={!!view && inView.has(dialog.id) && computed?.boundary?.id !== dialog.id}
          onClose={() => setDialog(null)}
          onHide={() => {
            setDialog(null);
            if (view) void edit([{ op: "hide-in-view", view: view.id, id: dialog.id }]).then(() => select(null));
          }}
          onDelete={() => {
            setDialog(null);
            void edit([{ op: "remove-element", id: dialog.id }]).then(() => select(null));
          }}
        />
      )}
      {dialog?.kind === "deleteView" && (
        <ConfirmDialog
          title={`Delete the view "${ws.views.get(dialog.id)?.title}"?`}
          text="This deletes the view and its saved positions. The elements stay in the model."
          confirm="Delete view"
          onClose={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void edit([{ op: "remove-view", id: dialog.id }]).then(() => setViewId(null));
          }}
        />
      )}
      {dialog?.kind === "newView" && (
        <NewViewDialog
          ws={ws}
          onClose={() => setDialog(null)}
          onCreate={(op, id) => {
            setDialog(null);
            void edit([op]).then((ok) => ok && selectView(id));
          }}
        />
      )}
    </div>
  );
}
