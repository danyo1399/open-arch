import { computeView, diagnosticTarget, renderMermaid, scopeProblems, viewMarkdown, type ComputedView, type Diagnostic, type Operation, type ViewDef, type Workspace } from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type Selection } from "./canvas/Canvas.js";
import { SequenceDiagram } from "./canvas/SequenceDiagram.js";
import { BrowserHost, copyText, desktopBridge, DesktopHost, docsZip, download, type WorkspaceHost } from "./hosts.js";
import { browserLibrary } from "./library.js";
import { useMediaQuery } from "./mediaQuery.js";
import { arrowDeleteOps, arrowRemovals, findArrow, followRenames, renamedId, renamedSelection, renamesIn, selectShapes, shownInProperties, viewAction, viewList, type Rename } from "./model.js";
import { AskAI } from "./panels/AskAI.js";
import { ContextMenu, MenuButton, type MenuItem } from "./panels/ContextMenu.js";
import { ConfirmDialog, DeleteElementDialog, NewViewDialog } from "./panels/dialogs.js";
import { Properties, shapesLabel } from "./panels/Properties.js";
import { MARKDOWN_FILE, PDF_FILE, PNG_FILE, providers, saveFile, SVG_FILE, type FileProvider, type FileType } from "./providers.js";
import { diagramImage, nextPaint, type ImageFormat } from "./image.js";
import { Sidebar } from "./panels/Sidebar.js";
import { Usages } from "./panels/Usages.js";
import { userSettings, useViewSettings } from "./settings.js";
import { useWorkspace, type Edit } from "./state.js";

type Dialog = { kind: "delete"; id: string } | { kind: "deleteView"; id: string } | { kind: "newView" } | null;

/** What a right-click menu is for, and where it opened on the screen. */
type Menu = ({ kind: "element"; id: string } | { kind: "arrow"; from: string; to: string }) & { x: number; y: number };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Phones, upright or on their side, and windows as small: too small for panels side by side. */
const NARROW = "(max-width: 640px), (max-height: 500px) and (max-width: 1000px)";

/** On a narrow screen, the one panel that fills it. */
type Pane = "diagram" | "browse" | "details";

/** What the details panel shows, in a few words. */
function detailsName(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, selection: Selection): string {
  const shown = shownInProperties(ws, view, selection);
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  if (shown.kind === "element") return shown.element.name;
  if (shown.kind === "arrow") return `${name(shown.from)} ${findArrow(computed, shown.from, shown.to)?.bidirectional ? "↔" : "→"} ${name(shown.to)}`;
  if (shown.kind === "sticky") return "Sticky note";
  if (shown.kind === "step") return `Step ${shown.step.number}`;
  if (shown.kind === "several") return shapesLabel(shown.elements.length, shown.stickies.length);
  return shown.kind === "view" ? "This view" : "Workspace";
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
  /** After saving an example, or a workspace deleted in another tab: carry on with the saved copy. */
  onHostChange(host: WorkspaceHost): void;
}

export function Designer({ host, onClose, onHostChange }: DesignerProps) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [isNew, setIsNew] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [usagesOf, setUsagesOf] = useState<string | null>(null);
  /** Every rename applied, in order. */
  const renames = useRef<Rename[]>([]);
  const mainRef = useRef<HTMLElement>(null);
  /** How many of them this render's IDs reflect. */
  const [renamesSeen, setRenamesSeen] = useState(0);
  /** How the Views list is sorted, and the views pinned to its top: this person's, not the file's. */
  const viewSettings = useViewSettings(host.key);
  // What's open follows a rename in the same render as the rename lands. A render in between
  // would show something else in its place (the view's details for a renamed element), and a
  // button being pressed there would go with it.
  const state = useWorkspace(host, (ops) => {
    const applied = renamesIn(ops);
    if (applied.length === 0) return;
    renames.current.push(...applied);
    setRenamesSeen(renames.current.length);
    const to = (id: string) => renamedId(applied, id);
    setSelection((s) => renamedSelection(s, to));
    setViewId((v) => v && to(v));
    setUsagesOf((u) => u && to(u));
    setDialog((d) => (d && "id" in d && to(d.id) !== d.id ? { ...d, id: to(d.id) } : d));
    setMenu((m) => m && renamedSelection(m, to));
    attempt(() => viewSettings.followRenames(applied));
  });
  const { ws, diagnostics } = state;
  /** An ID this render shows, after any rename applied since: a press can land after one. */
  const current = useCallback((id: string) => renamedId(renames.current.slice(renamesSeen), id), [renamesSeen]);
  /** The renames this render's IDs reflect, so the diagram's boxes can keep their nodes through them. */
  const shownRenames = useMemo(() => renames.current.slice(0, renamesSeen), [renamesSeen]);
  // An edit made with this render's IDs follows any rename applied before it runs: pressed just
  // after typing a new name, it queues behind the edit that saves the name, or lands before the
  // render that shows it. One worked out from the workspace as it is when it runs needs nothing.
  const workspaceEdit = state.edit;
  const edit = useCallback(
    (change: Edit) => (typeof change === "function" ? workspaceEdit(change) : workspaceEdit(() => followRenames(change, renames.current.slice(renamesSeen)))),
    [workspaceEdit, renamesSeen],
  );
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
  const desktop = desktopBridge();
  const agent = host instanceof DesktopHost ? desktop?.agent : undefined;

  // Keep a valid view open: the current one if it still exists, else the first in the Views list.
  const { loaded: settingsLoaded, order: viewOrder, pins } = viewSettings;
  useEffect(() => {
    if (!ws || !settingsLoaded || (viewId && ws.views.has(viewId))) return;
    const { pinned, others } = viewList(ws.views.values(), viewOrder, pins);
    setViewId((pinned[0] ?? others[0])?.id ?? null);
  }, [ws, viewId, settingsLoaded, viewOrder, pins]);

  useEffect(() => {
    if (selection?.kind === "element" && ws && !ws.elements.has(selection.id)) setSelection(null);
    if (selection?.kind === "sticky" && ws && !ws.views.get(viewId ?? "")?.stickies.some((s) => s.id === selection.id)) setSelection(null);
    if (selection?.kind === "step" && ws && selection.number > (ws.views.get(viewId ?? "")?.steps.length ?? 0)) setSelection(null);
  }, [ws, selection, viewId]);

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

  // Boxes and notes that leave the view, or the model, leave a selection of several.
  useEffect(() => {
    if (selection?.kind !== "several" || !view) return;
    const boxes = new Set(computed?.nodes.map((n) => n.id));
    const elements = selection.elements.filter((id) => boxes.has(id));
    const stickies = selection.stickies.filter((id) => view.stickies.some((s) => s.id === id));
    if (elements.length < selection.elements.length || stickies.length < selection.stickies.length) setSelection(selectShapes({ elements, stickies }));
  }, [selection, view, computed]);

  const select = useCallback(
    (next: Selection, options?: { isNew?: boolean }) => {
      setSelection(renamedSelection(next, current));
      setIsNew(!!options?.isNew);
    },
    [current],
  );

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
  /** The usages panel is drawn over the diagram. */
  const findUsages = (id: string) => {
    setUsagesOf(current(id));
    setPane("diagram");
  };

  // Right-clicking an element or an arrow selects it too, so it's clear which one the menu is for.
  const openElementMenu = (id: string, at: { x: number; y: number }) => {
    if (selection?.kind !== "element" || selection.id !== id) select({ kind: "element", id });
    setMenu({ kind: "element", id: current(id), ...at });
  };
  const openArrowMenu = (from: string, to: string, at: { x: number; y: number }) => {
    if (selection?.kind !== "arrow" || selection.from !== from || selection.to !== to) select({ kind: "arrow", from, to });
    setMenu(renamedSelection({ kind: "arrow", from, to, ...at }, current));
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const showInView = (id: string) => view && void edit([{ op: "show-in-view", view: view.id, id }]);
  const hideFromView = (id: string) => view && void edit([{ op: "hide-in-view", view: view.id, id }]).then(() => select(null));

  /** A usage can be in another view: open that one, then select it there. */
  const goToUsage = (target: string | null, next: Selection) => {
    if (target && target !== viewId) setViewId(target);
    select(next);
  };

  useEffect(() => {
    if (usagesOf && ws && !ws.elements.has(usagesOf)) setUsagesOf(null);
  }, [ws, usagesOf]);

  const removeSelection = useCallback(() => {
    if (selection?.kind === "element") setDialog({ kind: "delete", id: current(selection.id) });
    // A note is only text on one view, and Undo brings it back, so it goes without asking.
    if (selection?.kind === "sticky" && view) void edit([{ op: "remove-sticky", view: view.id, id: selection.id }]).then(() => select(null));
    // A step is one line of a sequence, and Undo brings it back, so it goes without asking too.
    if (selection?.kind === "step" && view) void edit([{ op: "remove-step", view: view.id, step: selection.number }]).then(() => select(null));
    if (selection?.kind === "arrow" && ws) {
      const ops = arrowDeleteOps(ws, computed, selection.from, selection.to);
      if (ops.length) void edit(ops).then(() => select(null));
    }
  }, [selection, computed, edit, select, current, ws, view]);

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

  const attempt = (task: () => Promise<void>) => void task().catch((e: Error) => state.notify({ kind: "error", text: e.message }));

  /**
   * An example, or a workspace deleted in another tab, only lives in this tab until it's saved:
   * as a file on desktop, in the browser's storage on the web.
   */
  const save = () =>
    attempt(async () => {
      if (state.text === null) return;
      // Saved, it's kept under another key, and keeps the views pinned here.
      const carryOn = async (next: WorkspaceHost) => {
        await userSettings.setPins(next.key, viewSettings.pins).catch(() => undefined);
        onHostChange(next);
      };
      if (desktop) {
        const file = await desktop.saveAs(state.text);
        if (file) await carryOn(new DesktopHost(desktop, file.path, file.name));
        return;
      }
      const record = await browserLibrary.add(host.name, state.text);
      await carryOn(new BrowserHost(browserLibrary, record.id, record.fileName));
    });

  const exportTo = (provider: FileProvider) =>
    attempt(async () => {
      if (state.text !== null && (await provider.save(host.name, state.text)) && state.storage === "memory") state.markSaved();
    });

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
  const selected = selection?.kind === "element" ? [selection.id] : selection?.kind === "several" ? selection.elements : selection?.kind === "arrow" ? [selection.from, selection.to] : [];
  // While Ask AI is open, the agent's edits reload the file again and again, and the panel already says what it changed.
  const message = state.message?.kind === "info" && askOpen ? null : state.message;
  const status =
    state.storage === "file"
      ? host.syncsDocs && ws.doc.export?.docs
        ? `Saved · docs in ${ws.doc.export.docs}/`
        : "Saved"
      : state.storage === "browser"
        ? "Saved in this browser"
        : state.unsaved
          ? "Not saved"
          : "Only in this tab";
  const exportDocs = () => download(`${host.name.replace(/\.openarch$/, "")}-docs.zip`, docsZip(ws, host.name) as BlobPart, "application/zip");
  const toggleAsk = () => {
    setAskOpen((o) => !o);
    // The panel is drawn over the diagram; hiding it leaves the pane as it is.
    if (!askOpen) setPane("diagram");
  };
  // The open diagram as a picture of the whole of it, drawn with nothing selected, so the
  // picture has no highlights or grips. What was selected is selected again after.
  const saveImage = (cv: ComputedView, format: ImageFormat, type: FileType) =>
    attempt(async () => {
      const was = selection;
      await saveFile(
        `${cv.view.id}${type.extension}`,
        async () => {
          setPane("diagram");
          setSelection(null);
          await nextPaint();
          try {
            return await diagramImage(mainRef.current!, format, cv.view.title);
          } finally {
            setSelection(was);
          }
        },
        type,
      );
    });
  // The open diagram, as Mermaid to paste elsewhere or as a markdown file of its own.
  const exportItems = (cv: ComputedView): MenuItem[] => [
    {
      label: "Copy as Mermaid",
      onSelect: () =>
        attempt(async () => {
          await copyText(renderMermaid(cv));
          state.notify({ kind: "info", text: `Copied “${cv.view.title}” as Mermaid. Paste it into a mermaid code block in markdown, or a Mermaid editor.` });
        }),
    },
    { label: "Save as Markdown…", onSelect: () => attempt(async () => void (await saveFile(`${cv.view.id}.md`, viewMarkdown(cv), MARKDOWN_FILE))) },
    { label: "Save as PNG…", divider: true, onSelect: () => saveImage(cv, "png", PNG_FILE) },
    { label: "Save as SVG…", onSelect: () => saveImage(cv, "svg", SVG_FILE) },
    { label: "Save as PDF…", onSelect: () => saveImage(cv, "pdf", PDF_FILE) },
  ];
  // A narrow top bar keeps saving, Undo and Redo, and puts the rest in a menu. The diagram's
  // toolbar has no room for its Export menu there either, so that's in this menu too.
  const moreItems: MenuItem[] = [
    ...(desktop ? [] : providers.map((provider) => ({ label: provider.exportLabel, onSelect: () => exportTo(provider) }))),
    ...(host.syncsDocs ? [] : [{ label: "Export docs", onSelect: exportDocs }]),
    ...(computed ? [{ label: "Export this view", items: exportItems(computed) }] : []),
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
      { label: "Delete from model…", danger: true, onSelect: () => setDialog({ kind: "delete", id: current(id) }) },
    ];
  };
  // What the details panel can do with an arrow. One that stands for several relationships
  // lists them, to pick the one to remove. An implied arrow's one relationship is on something
  // inside a box, so its item names it; a direct arrow's one relationship is the arrow.
  const arrowMenu = (from: string, to: string): MenuItem[] => {
    const name = (id: string) => ws.elements.get(id)?.name ?? id;
    const removals = arrowRemovals(ws, computed, from, to);
    const remove = (ops: Operation[]) => () => void edit(ops).then(() => select(null));
    const implied = !!findArrow(computed, from, to)?.implied;
    return [
      { label: `Select ${name(from)}`, onSelect: () => select({ kind: "element", id: from }) },
      { label: `Select ${name(to)}`, onSelect: () => select({ kind: "element", id: to }) },
      ...(removals.length === 1
        ? [{ label: implied ? `Remove ${removals[0]!.ends}` : "Remove relationship", danger: true, divider: true, onSelect: remove(removals[0]!.ops) }]
        : []),
      ...(removals.length > 1 ? [{ label: "Remove relationship", divider: true, items: removals.map((r) => ({ label: r.label, danger: true, onSelect: remove(r.ops) })) }] : []),
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
    { pane: "details", label: "Details", detail: detailsName(ws, view, computed, selection) },
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
            <span className={`storage storage-${state.storage}${state.unsaved ? " unsaved" : ""}`}>{status}</span>
          </>
        )}
        <span className="spacer" />
        {state.storage === "memory" && (
          <button className={state.unsaved ? "primary" : ""} onClick={save} title={desktop ? undefined : "Keep it in this browser, with your other workspaces"}>
            {desktop ? "Save as…" : "Save"}
          </button>
        )}
        {!narrow &&
          !desktop &&
          providers.map((provider) => (
            <button key={provider.id} onClick={() => exportTo(provider)} title="Save a copy of the .openarch file">
              {provider.exportLabel}
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
          <MenuButton items={moreItems} note={`${host.name} · ${status}`} from="right" className="square" title="More" label="More">
            <Icon d={MORE_ICON} stroke={3} />
          </MenuButton>
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
        viewOrder={viewOrder}
        onViewOrder={(order) => attempt(() => viewSettings.setOrder(order))}
        pinnedViews={pins}
        onPinView={(id, pinned) => attempt(() => viewSettings.setPinned(current(id), pinned))}
      />

      {/* Under another pane, the diagram keeps its size, so it keeps its zoom too. */}
      <main ref={mainRef} className="main" inert={narrow && pane !== "diagram"}>
        {view?.level === "sequence" ? (
          computed ? (
            <SequenceDiagram
              key={view.id}
              ws={ws}
              computed={computed}
              selection={selection}
              onSelect={select}
              edit={edit}
              onElementMenu={openElementMenu}
              onError={(text) => state.notify({ kind: "error", text })}
              exportItems={exportItems(computed)}
            />
          ) : (
            <div className="canvas-message">This view can't be drawn: {view && scopeProblems(ws, view)[0]?.message}</div>
          )
        ) : view ? (
          <ReactFlowProvider key={view.id}>
            <Canvas
              ws={ws}
              view={view}
              diagnostics={diagnostics}
              selection={selection}
              onSelect={selectOnCanvas}
              edit={edit}
              onElementMenu={openElementMenu}
              onArrowMenu={openArrowMenu}
              onError={(text) => state.notify({ kind: "error", text })}
              renames={shownRenames}
              exportItems={computed ? exportItems(computed) : []}
            />
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
        onHide={hideFromView}
        onDelete={(id) => setDialog({ kind: "delete", id: current(id) })}
        onFindUsages={findUsages}
        onDeleteView={(id) => setDialog({ kind: "deleteView", id: current(id) })}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.kind === "element" ? elementMenu(menu.id) : arrowMenu(menu.from, menu.to)} onClose={closeMenu} />}
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
