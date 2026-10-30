import { computeView, diagnosticTarget, scopeProblems, type Diagnostic, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type Selection } from "./canvas/Canvas.js";
import { canSaveFiles, desktopBridge, DesktopHost, docsZip, download, FileHandleHost, pickFileToSave, type WorkspaceHost } from "./hosts.js";
import { relationshipRef, viewAction } from "./model.js";
import { AskAI } from "./panels/AskAI.js";
import { ContextMenu, type MenuItem } from "./panels/ContextMenu.js";
import { ConfirmDialog, DeleteElementDialog, NewViewDialog } from "./panels/dialogs.js";
import { Properties, shownInProperties } from "./panels/Properties.js";
import { Sidebar } from "./panels/Sidebar.js";
import { Usages } from "./panels/Usages.js";
import { useWorkspace, type Edit } from "./state.js";

type Dialog = { kind: "delete"; id: string } | { kind: "deleteView"; id: string } | { kind: "newView" } | null;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Phones, upright or on their side, and windows as small: too small for panels side by side. */
const NARROW = "(max-width: 640px), (max-height: 500px) and (max-width: 1000px)";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** On a narrow screen, the one panel that fills it. */
type Pane = "diagram" | "browse" | "details";

/** What the details panel shows, in a few words. */
function detailsName(ws: Workspace, view: ViewDef | null, selection: Selection): string {
  const shown = shownInProperties(ws, view, selection);
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  if (shown.kind === "element") return shown.element.name;
  if (shown.kind === "arrow") return `${name(shown.from)} → ${name(shown.to)}`;
  if (shown.kind === "sticky") return "Sticky note";
  return shown.kind === "view" ? "This view" : "Workspace";
}

/** Where a missing ID went, following renames (old to new) for as long as they lead somewhere. */
function followRenames(ws: Workspace, renamed: Map<string, string>, id: string): string {
  let current = id;
  for (let steps = 0; !ws.elements.has(current) && renamed.has(current) && steps < renamed.size; steps++) current = renamed.get(current)!;
  return current;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** A line icon on a 24 × 24 grid, in the text colour. */
function Icon({ d, stroke = 2 }: { d: string; stroke?: number }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const UNDO_ICON = "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11";
const REDO_ICON = "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13";
const MORE_ICON = "M5 12h.01M12 12h.01M19 12h.01";

interface DesignerProps {
  host: WorkspaceHost;
  onClose(): void;
  /** After "Save as": carry on with the new file. */
  onHostChange(host: WorkspaceHost): void;
}

export function Designer({ host, onClose, onHostChange }: DesignerProps) {
  const state = useWorkspace(host);
  const { ws, diagnostics } = state;
  /** Old IDs, and what edits made here renamed them to, so the selection and usages follow a rename. */
  const renamed = useRef(new Map<string, string>());
  const workspaceEdit = state.edit;
  const edit = useCallback(
    (e: Edit) => {
      if (Array.isArray(e)) for (const op of e) if (op.op === "rename") renamed.current.set(op.id, op.to);
      return workspaceEdit(e);
    },
    [workspaceEdit],
  );
  const [viewId, setViewId] = useState<string | null>(null);
  const [chosen, setSelection] = useState<Selection>(null);
  // An element renamed here stays selected under its new ID from the moment the rename lands.
  // Until then the details panel would show the view, taking away any button being pressed.
  const selection = useMemo<Selection>(
    () => (chosen?.kind === "element" && ws && !ws.elements.has(chosen.id) ? { kind: "element", id: followRenames(ws, renamed.current, chosen.id) } : chosen),
    [chosen, ws],
  );
  const [isNew, setIsNew] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [usagesOf, setUsagesOf] = useState<string | null>(null);
  const narrow = useMediaQuery(NARROW);
  const [pane, setPane] = useState<Pane>("diagram");
  // Becoming narrow shows the details while one is being typed in, as an on-screen keyboard can
  // be what made the window short, else the diagram: not whichever pane was last picked while
  // it was wide. Set while rendering, so the old pane is never painted.
  const [wasNarrow, setWasNarrow] = useState(narrow);
  if (narrow !== wasNarrow) {
    setWasNarrow(narrow);
    const focused = document.activeElement;
    setPane(focused?.matches("input, textarea, select") && focused.closest(".properties") ? "details" : "diagram");
  }
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
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
    else if (selection !== chosen) setSelection(selection);
    if (selection?.kind === "sticky" && ws && !ws.views.get(viewId ?? "")?.stickies.some((s) => s.id === selection.id)) setSelection(null);
  }, [ws, selection, chosen, viewId]);

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
  const showable = useMemo(() => new Set(ws ? [...ws.elements.keys()].filter((id) => viewAction(ws, view, computed, id) === "show") : []), [ws, view, computed]);

  const select = useCallback((next: Selection, options?: { isNew?: boolean }) => {
    setSelection(next);
    setIsNew(!!options?.isNew);
  }, []);

  const selectView = (id: string) => {
    setViewId(id);
    select(null);
  };

  // On a narrow screen, picking something shows it: a view's diagram, or an element's details.
  // (Elsewhere the pane isn't used, and every panel is on screen.)
  const showView = (id: string) => {
    selectView(id);
    setPane("diagram");
  };
  const showDetails = (next: Selection) => {
    select(next);
    setPane("details");
  };
  /** A box just added gets its name typed in its details. */
  const selectOnCanvas = useCallback(
    (next: Selection, options?: { isNew?: boolean }) => {
      select(next, options);
      if (options?.isNew) setPane("details");
    },
    [select],
  );
  const closeMore = useCallback(() => setMore(null), []);
  /** The usages panel is drawn over the diagram. */
  const findUsages = (id: string) => {
    setUsagesOf(id);
    setPane("diagram");
  };

  // Right-clicking an element selects it too, so it's clear which one the menu is for.
  const openElementMenu = (id: string, at: { x: number; y: number }) => {
    if (selection?.kind !== "element" || selection.id !== id) select({ kind: "element", id });
    setMenu({ id, ...at });
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const showInView = (id: string) => view && void edit([{ op: "show-in-view", view: view.id, id }]);
  const hideFromView = (id: string) => view && void edit([{ op: "hide-in-view", view: view.id, id }]).then(() => select(null));

  /** A usage can be in another view: open that one, then select it there. */
  const goToUsage = (target: string | null, next: Selection) => {
    if (target && target !== viewId) setViewId(target);
    select(next);
  };

  // The usages panel follows its element to a new ID, and closes when the element is gone. A
  // rename can land just after the panel opens: a name saves when its text box loses focus, as
  // it does to the Find usages button.
  useEffect(() => {
    if (!usagesOf || !ws || ws.elements.has(usagesOf)) return;
    const id = followRenames(ws, renamed.current, usagesOf);
    setUsagesOf(ws.elements.has(id) ? id : null);
  }, [ws, usagesOf]);

  const removeSelection = useCallback(() => {
    if (selection?.kind === "element") setDialog({ kind: "delete", id: selection.id });
    // A note is only text on one view, and Undo brings it back, so it goes without asking.
    if (selection?.kind === "sticky" && view) void edit([{ op: "remove-sticky", view: view.id, id: selection.id }]).then(() => select(null));
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
  }, [selection, computed, edit, select, ws, view]);

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
    if (target?.kind === "view" && ws?.views.has(target.id)) showView(target.id);
    else if (target?.kind === "element" && ws?.elements.has(target.id)) showDetails({ kind: "element", id: target.id });
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
  const exportDocs = () => download(`${host.name.replace(/\.openarch$/, "")}-docs.zip`, docsZip(ws, host.name) as BlobPart, "application/zip");
  const toggleAsk = () => {
    setAskOpen((o) => !o);
    // The panel is drawn over the diagram; hiding it leaves the pane as it is.
    if (!askOpen) setPane("diagram");
  };
  // A narrow top bar keeps saving, Undo and Redo, and puts the rest in a menu.
  const moreItems: MenuItem[] = [
    ...(host.syncsDocs ? [] : [{ label: "Export docs", onSelect: exportDocs }]),
    ...(agent ? [{ label: askOpen ? "Hide Ask AI" : "Ask AI", onSelect: toggleAsk }] : []),
    { label: "Workspace settings", onSelect: () => showDetails({ kind: "workspace" }) },
    { label: "Close", onSelect: onClose },
  ];
  // What the details panel and the model tree can do with an element, in one place.
  const elementMenu = (id: string): MenuItem[] => {
    const action = viewAction(ws, view, computed, id);
    return [
      { label: "Find usages", onSelect: () => findUsages(id) },
      ...(action === "show" ? [{ label: "Show in this view", onSelect: () => showInView(id) }] : []),
      ...(action === "hide" ? [{ label: "Hide from this view", onSelect: () => hideFromView(id) }] : []),
      { label: "Delete from model…", danger: true, onSelect: () => setDialog({ kind: "delete", id }) },
    ];
  };
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const panes: { pane: Pane; label: string; detail: string; bad?: boolean }[] = [
    { pane: "diagram", label: "Diagram", detail: view?.title ?? "No views yet" },
    {
      pane: "browse",
      label: "Views & model",
      detail: errors ? plural(errors, "error") : diagnostics.length ? plural(diagnostics.length, "warning") : plural(ws.elements.size, "element"),
      bad: errors > 0,
    },
    { pane: "details", label: "Details", detail: detailsName(ws, view, selection) },
  ];

  return (
    <div className={narrow ? `app narrow pane-${pane}` : "app"}>
      <header className="topbar">
        {!narrow && <span className="brand">open-arch</span>}
        <button className="ws-name link" onClick={() => showDetails({ kind: "workspace" })} title="Workspace settings">
          {ws.doc.name}
        </button>
        {!narrow && (
          <>
            <span className="muted small file-name">{host.name}</span>
            <span className={`storage storage-${host.storage}${state.unsaved ? " unsaved" : ""}`}>{status}</span>
          </>
        )}
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
        {!narrow && !host.syncsDocs && (
          <button onClick={exportDocs} title="Markdown pages with Mermaid diagrams">
            Export docs
          </button>
        )}
        {!narrow && agent && (
          <button className={askOpen ? "active" : ""} aria-pressed={askOpen} onClick={toggleAsk} title="Ask an AI agent to change the model">
            Ask AI
          </button>
        )}
        <button className={narrow ? "square" : ""} onClick={state.undo} disabled={!state.canUndo} title={`Undo (${mod}Z)`} aria-label="Undo">
          {narrow ? <Icon d={UNDO_ICON} /> : "Undo"}
        </button>
        <button className={narrow ? "square" : ""} onClick={state.redo} disabled={!state.canRedo} title={`Redo (${mod}⇧Z)`} aria-label="Redo">
          {narrow ? <Icon d={REDO_ICON} /> : "Redo"}
        </button>
        {narrow ? (
          <button
            ref={moreButton}
            className="square"
            title="More"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={!!more}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMore((m) => (m ? null : { x: r.right, y: r.bottom + 4 }));
            }}
          >
            <Icon d={MORE_ICON} stroke={3} />
          </button>
        ) : (
          <button onClick={onClose}>Close</button>
        )}
      </header>

      <Sidebar
        ws={ws}
        diagnostics={diagnostics}
        viewId={viewId}
        inView={inView}
        showable={showable}
        selection={selection}
        onSelectView={showView}
        onSelect={showDetails}
        onShowInView={showInView}
        onElementMenu={openElementMenu}
        onNewView={() => setDialog({ kind: "newView" })}
        onOpenProblem={openProblem}
      />

      {/* Under another pane, the diagram keeps its size, so it keeps its zoom too. */}
      <main className="main" inert={narrow && pane !== "diagram"}>
        {view ? (
          <ReactFlowProvider key={view.id}>
            <Canvas ws={ws} view={view} diagnostics={diagnostics} selection={selection} onSelect={selectOnCanvas} edit={edit} onElementMenu={openElementMenu} />
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
        onHide={hideFromView}
        onDelete={(id) => setDialog({ kind: "delete", id })}
        onFindUsages={findUsages}
        onDeleteView={(id) => setDialog({ kind: "deleteView", id })}
      />

      {narrow && (
        <nav className="panes" aria-label="Panels">
          {panes.map((p) => (
            <button key={p.pane} className={p.pane === pane ? "pane-tab active" : "pane-tab"} aria-current={p.pane === pane} onClick={() => setPane(p.pane)}>
              <span className="pane-tab-label">{p.label}</span>
              <span className={p.bad ? "pane-tab-detail error" : "pane-tab-detail"}>{p.detail}</span>
            </button>
          ))}
        </nav>
      )}

      {message && (
        <div className={`toast toast-${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          <span>{message.text}</span>
          <button className="icon" onClick={state.dismissMessage} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={elementMenu(menu.id)} onClose={closeMenu} />}
      {more && <ContextMenu x={more.x} y={more.y} items={moreItems} note={`${host.name} · ${status}`} anchor={moreButton} onClose={closeMore} />}
      {dialog?.kind === "delete" && (
        <DeleteElementDialog
          ws={ws}
          id={dialog.id}
          inView={viewAction(ws, view, computed, dialog.id) === "hide"}
          onClose={() => setDialog(null)}
          onHide={() => {
            setDialog(null);
            hideFromView(dialog.id);
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
            void edit([op]).then((ok) => ok && showView(id));
          }}
        />
      )}
    </div>
  );
}
