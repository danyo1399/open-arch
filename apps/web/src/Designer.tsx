import {
  computeView,
  diagnosticTarget,
  OpError,
  renderMermaid,
  scopeProblems,
  STICKY_TARGET_LEVELS,
  viewMarkdown,
  WIDGET_KIND_LABELS,
  type ComputedView,
  type Diagnostic,
  type Operation,
  type RelationshipKind,
  type StickyTargetData,
  type ViewDef,
  type RelationshipSource,
  type ViewLevel,
  type Workspace,
} from "@open-arch/core";
import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { askContext } from "./ai/context.js";
import { Canvas, canAutoLayout, type AutoLayout, type CanvasClipboard, type Selection } from "./canvas/Canvas.js";
import { copySource, deleteOps } from "./copyPaste.js";
import { SequenceDiagram } from "./canvas/SequenceDiagram.js";
import { DeploymentDiagram } from "./canvas/DeploymentDiagram.js";
import { EventDiagram } from "./canvas/EventDiagram.js";
import { WhiteboardDiagram } from "./canvas/WhiteboardDiagram.js";
import { WireframeDiagram } from "./canvas/WireframeDiagram.js";
import { StateDiagram } from "./canvas/StateDiagram.js";
import { FlowchartDiagram } from "./canvas/FlowchartDiagram.js";
import type { MenuHost } from "./canvas/DiagramMenu.js";
import { followBlocks, followMenu, menuRenamesIn, menuThere, type MenuFor, type MenuRename } from "./canvas/diagramMenu.js";
import { NotesOpener } from "./canvas/nodes.js";
import { EntityDiagram } from "./canvas/EntityDiagram.js";
import type { SnapControl } from "./canvas/snap.js";
import { canOpenFolders, exportToFolder, FolderHost, folderList, pickFolder } from "./folders.js";
import { BrowserHost, canCopyImages, copyImage, copyText, desktopBridge, DesktopHost, download, savesDocs, savesSkill, workspaceZip, type WorkspaceHost } from "./hosts.js";
import { browserLibrary } from "./library.js";
import { useMediaQuery } from "./mediaQuery.js";
import {
  arrowDeleteOps,
  arrowRemovals,
  blockText,
  buildOps,
  eventDeleteOps,
  eventSelectionGone,
  wireframeDeleteOps,
  wireframeSelectionGone,
  whiteboardDeleteOps,
  whiteboardSelectionLeft,
  findArrow,
  followRenames,
  LEVEL_NAMES,
  newStickyId,
  newViewOf,
  notedRelationships,
  notesName,
  notesOf,
  notesOp,
  notesOwnerAsIs,
  relationshipsPlace,
  renamedId,
  renamedNotesOwner,
  renamedSelection,
  renamesIn,
  selectShapes,
  shownInProperties,
  stickyTargetFor,
  uniqueId,
  viewAction,
  viewLevelsOf,
  viewList,
  type NotesOwner,
  type Rename,
} from "./model.js";
import { AskAI, NEWS_TEXT, type AskNews, type Asker } from "./panels/AskAI.js";
import { BrowserAskAI } from "./panels/BrowserAskAI.js";
import { ContextMenu, MenuButton, type MenuItem } from "./panels/ContextMenu.js";
import { ConfirmDialog, DeleteElementDialog, HistoryDialog, NewViewDialog, NotesEditor } from "./panels/dialogs.js";
import { ShareDialog } from "./panels/ShareDialog.js";
import { Properties, shapesLabel } from "./panels/Properties.js";
import { problemText } from "./problems.js";
import { MARKDOWN_FILE, PDF_FILE, PNG_FILE, providers, saveFile, SVG_FILE, type FileProvider, type FileType } from "./providers.js";
import { diagramImage, nextPaint, type ImageFormat } from "./image.js";
import { Sidebar } from "./panels/Sidebar.js";
import { Usages } from "./panels/Usages.js";
import { PANEL_PROPERTY, PanelEdge, PanelRail } from "./panels/SidePanels.js";
import { userSettings, usePanelSettings, useSnapSettings, useViewSettings, type PanelSettings, type PanelSize } from "./settings.js";
import { PUBLIC_DESIGNER, shareClient } from "./share.js";
import { RELOADED, saveProblem, useWorkspace, type Edit } from "./state.js";

type Dialog =
  /** Elements to delete from the model, and the sticky notes selected with them, which go too. */
  | { kind: "delete"; ids: string[]; stickies: string[] }
  | { kind: "deleteView"; id: string }
  | { kind: "newView" }
  | { kind: "share" }
  | { kind: "history" }
  /**
   * `name` is whose notes they are, as they were called when the editor opened, and `text` what
   * it started from. `opened` tells one opening from the next, and `ready` says it knows which
   * relationship it's on, so it can save.
   */
  | { kind: "notes"; owner: NotesOwner; name: string; text: string; opened: number; ready: boolean }
  | null;

/** What a right-click menu is for, and where it opened on the screen. */
type Menu = ({ kind: "element"; id: string } | { kind: "arrow"; from: string; to: string; relation?: RelationshipKind } | { kind: "several"; elements: string[]; stickies: string[] }) & { x: number; y: number };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Phones, upright or on their side, and windows as small: too small for panels side by side. */
const NARROW = "(max-width: 640px), (max-height: 500px) and (max-width: 1000px)";

/** On a narrow screen, the one panel that fills it. */
type Pane = "diagram" | "browse" | "details";

/** Screens up to this wide, but not narrow, have the details under the diagram (see styles.css). */
const STACKED = "(max-width: 900px)";

/** What the details panel shows, in a few words. */
export function detailsName(ws: Workspace, view: ViewDef | null, computed: ComputedView | null, selection: Selection): string {
  const shown = shownInProperties(ws, view, selection);
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  if (shown.kind === "element") return shown.element.name;
  if (shown.kind === "arrow") return `${name(shown.from)} ${findArrow(computed, shown.from, shown.to, shown.relation)?.bidirectional ? "↔" : "→"} ${name(shown.to)}`;
  if (shown.kind === "sticky") return "Sticky note";
  if (shown.kind === "step") return `Step ${shown.step.number}`;
  if (shown.kind === "state") return shown.state.name;
  if (shown.kind === "transition") return `Transition ${shown.transition.number}`;
  if (shown.kind === "block") return blockText(shown.block);
  if (shown.kind === "flow") return `Flow ${shown.flow.number}`;
  if (shown.kind === "entity") return shown.entity.name;
  if (shown.kind === "attribute") return shown.attribute.name;
  if (shown.kind === "link") return `Link ${shown.link.number}`;
  if (shown.kind === "node") return shown.node.name;
  if (shown.kind === "connection") return `Connection ${shown.connection.number}`;
  if (shown.kind === "instance") return `${shown.element.name} in ${shown.node.name}`;
  if (shown.kind === "lane") return shown.lane.name;
  if (shown.kind === "card") return shown.card.name;
  if (shown.kind === "cardArrow") return `${shown.from.name} → ${shown.to.name}`;
  if (shown.kind === "screen") return shown.screen.name;
  if (shown.kind === "widget") return `${WIDGET_KIND_LABELS[shown.widget.kind]} on ${shown.view.screens.find((s) => s.id === shown.widget.screen)?.name ?? shown.widget.screen}`;
  if (shown.kind === "several") return shapesLabel(shown.elements.length, shown.stickies.length);
  return shown.kind === "view" ? "This view" : "Workspace";
}

/** How the phone's menu says what Ask AI is doing while it's hidden. */
const NEWS_LABELS: Record<AskNews, string> = { working: "working", waiting: "waiting for you", finished: "finished" };

/** On the Ask AI button, or More on a phone, while Ask AI is hidden: a spinner while it works, and a dot when it needs you or has finished. */
function AskNewsMark({ news }: { news: AskNews }) {
  return <span className={`ask-ai-news ask-ai-news-${news}`} aria-hidden="true" />;
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
const HISTORY_ICON = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2";
const MORE_ICON = "M5 12h.01M12 12h.01M19 12h.01";

interface DesignerProps {
  host: WorkspaceHost;
  onClose(): void;
  /** After saving an example, or a workspace deleted in another tab: carry on with the saved copy. */
  onHostChange(host: WorkspaceHost): void;
  /** What the web app's Ask AI reaches its model with: the page's `fetch`, unless a test gives its own. */
  askFetch?: typeof fetch;
}

export function Designer({ host, onClose, onHostChange, askFetch }: DesignerProps) {
  const [viewId, setViewId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  /** What's selected in the latest render, for a press's edit that lands after it. */
  const selectionNow = useRef(selection);
  selectionNow.current = selection;
  // Not 0 when what's selected was just created: a number of its own for each, so the details
  // give its name the focus even when what was selected before it was new too.
  const [isNew, setIsNew] = useState(0);
  const created = useRef(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  /** How many times the notes editor has opened. */
  const notesOpened = useRef(0);
  const [askOpen, setAskOpen] = useState(false);
  /** What Ask AI did while it was hidden, for its button to show. */
  const [askNews, setAskNews] = useState<AskNews | null>(null);
  /** Whether the desktop app's agent is working on a request. */
  const [agentRunning, setAgentRunning] = useState(false);
  /** Whether the web app's Ask AI is working on a request. */
  const asking = useRef(false);
  /** Whether a Save is under way that opens the copy it keeps, as a workspace of its own. */
  const saving = useRef(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [usagesOf, setUsagesOf] = useState<string | null>(null);
  /** Every rename applied, in order. */
  const renames = useRef<Rename[]>([]);
  const mainRef = useRef<HTMLElement>(null);
  /** The open diagram's Auto layout, which the More menu has on a narrow screen. */
  const autoLayout = useRef<AutoLayout | null>(null);
  /** The open diagram's Copy, on a view of boxes, for the menus and the details. */
  const clipboard = useRef<CanvasClipboard | null>(null);
  /** How many of them this render's IDs reflect. */
  const [renamesSeen, setRenamesSeen] = useState(0);
  /** Every change to the workspace that a diagram's right-click menu follows (see diagramMenu.ts), in order, and how many of them this render reflects. */
  const menuRenames = useRef<MenuRename[]>([]);
  const [menuRenamesSeen, setMenuRenamesSeen] = useState(0);
  /** How many of them the latest render reflects, for an edit made with its IDs. */
  const menuRenamesShown = useRef(menuRenamesSeen);
  menuRenamesShown.current = menuRenamesSeen;
  /**
   * Which opening of a view this is: a number that tells the diagram that's open from the next
   * view opened, and stays the same when its view is only given a new ID. So a rename doesn't
   * make the view's diagram again, which would lose a right-click menu waiting for that rename to
   * land. Set while rendering, so no render pairs a view with another's number.
   */
  const [opening, setOpening] = useState({ view: viewId, seen: renamesSeen, number: 0 });
  if (opening.view !== viewId || opening.seen !== renamesSeen) {
    const renamed = opening.view !== null && renamedId(renames.current.slice(opening.seen, renamesSeen), opening.view) === viewId;
    setOpening({ view: viewId, seen: renamesSeen, number: renamed ? opening.number : opening.number + 1 });
  }
  /** How the Views list is sorted, and the views pinned to its top: this person's, not the file's. */
  const viewSettings = useViewSettings(host.key);
  /** What boxes and notes snap to as they're dragged, on every view: this person's too. */
  const snapSettings = useSnapSettings();
  /** The side panels' sizes, and which are collapsed: this person's too. */
  const panelSettings = usePanelSettings();
  // What's open follows a rename in the same render as the rename lands. A render in between
  // would show something else in its place (the view's details for a renamed element), and a
  // button being pressed there would go with it.
  const state = useWorkspace(host, (ops, before) => {
    menuRenames.current.push(...menuRenamesIn(ops, before));
    setMenuRenamesSeen(menuRenames.current.length);
    const applied = renamesIn(ops);
    if (applied.length === 0) return;
    renames.current.push(...applied);
    setRenamesSeen(renames.current.length);
    const to = (id: string) => renamedId(applied, id);
    setSelection((s) => renamedSelection(s, to));
    setViewId((v) => v && to(v));
    setUsagesOf((u) => u && to(u));
    setDialog((d) =>
      d?.kind === "notes" ? { ...d, owner: renamedNotesOwner(d.owner, to) } : d?.kind === "delete" ? { ...d, ids: d.ids.map(to) } : d && "id" in d && to(d.id) !== d.id ? { ...d, id: to(d.id) } : d,
    );
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
  // render that shows it. A note put on a flowchart's block follows the block the same way, as a
  // new block's ID follows its text (see followBlocks). One worked out from the workspace as it
  // is when it runs needs nothing.
  const workspaceEdit = state.edit;
  const edit = useCallback(
    (change: Edit) => {
      if (typeof change === "function") return workspaceEdit(change);
      const shown = menuRenamesShown.current;
      return workspaceEdit(() => followRenames(followBlocks(change, menuRenames.current.slice(shown)), renames.current.slice(renamesSeen)));
    },
    [workspaceEdit, renamesSeen],
  );
  const narrow = useMediaQuery(NARROW);
  const stacked = useMediaQuery(STACKED);
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
  // The desktop app's agent, asked about the open file: the same one until the file or the agent changes, as a new one stops a request.
  const fileAgent = useMemo<Asker | undefined>(
    () =>
      agent && host instanceof DesktopHost
        ? { run: (prompt, context, onEvent) => agent.run(host.path, prompt, context, onEvent), reply: (id, allow) => agent.reply(id, allow), cancel: () => agent.cancel() }
        : undefined,
    [agent, host],
  );
  // The web app asks a model itself, whatever the workspace is kept in. The desktop app asks its agent, which works on a file.
  const canAsk = !!fileAgent || !desktop;

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
    if (selection?.kind === "state" && ws && !ws.views.get(viewId ?? "")?.states.some((s) => s.id === selection.id)) setSelection(null);
    if (selection?.kind === "transition" && ws && selection.number > (ws.views.get(viewId ?? "")?.transitions.length ?? 0)) setSelection(null);
    if (selection?.kind === "block" && ws && !ws.views.get(viewId ?? "")?.blocks.some((b) => b.id === selection.id)) setSelection(null);
    if (selection?.kind === "flow" && ws && selection.number > (ws.views.get(viewId ?? "")?.flows.length ?? 0)) setSelection(null);
    if (selection?.kind === "entity" && ws && !ws.views.get(viewId ?? "")?.entities.some((e) => e.id === selection.id)) setSelection(null);
    if (selection?.kind === "attribute" && ws && !ws.views.get(viewId ?? "")?.entities.some((e) => e.id === selection.entity && e.attributes.some((a) => a.name === selection.name))) setSelection(null);
    if (selection?.kind === "link" && ws && selection.number > (ws.views.get(viewId ?? "")?.links.length ?? 0)) setSelection(null);
    if (selection?.kind === "node" && ws && !ws.views.get(viewId ?? "")?.nodes.some((n) => n.id === selection.id)) setSelection(null);
    if (selection?.kind === "connection" && ws && selection.number > (ws.views.get(viewId ?? "")?.connections.length ?? 0)) setSelection(null);
    if (selection?.kind === "instance" && ws && !ws.views.get(viewId ?? "")?.nodes.some((n) => n.id === selection.node && n.runs.includes(selection.element))) setSelection(null);
    if (ws && eventSelectionGone(ws.views.get(viewId ?? ""), selection)) setSelection(null);
    if (ws && wireframeSelectionGone(ws.views.get(viewId ?? ""), selection)) setSelection(null);
    // Shapes, arrows and notes that leave a whiteboard leave the selection.
    const left = ws ? whiteboardSelectionLeft(ws.views.get(viewId ?? ""), selection) : selection;
    if (left !== selection) setSelection(left);
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
      setIsNew(options?.isNew ? ++created.current : 0);
    },
    [current],
  );

  const selectView = (id: string) => {
    setViewId(id);
    select(null);
  };

  const { setPanels } = panelSettings;
  const detailsCollapsed = panelSettings.panels.detailsCollapsed;
  const notify = state.notify;
  /** Collapses or expands the side panels, or sizes them, saying so if it can't be kept. */
  const changePanels = useCallback(
    (change: Partial<PanelSettings>) => void setPanels(change).catch((e: unknown) => notify({ kind: "error", text: problemText(e) })),
    [setPanels, notify],
  );
  /**
   * The panel whose collapse button or strip was just pressed. The strip or the button that takes
   * its place has the focus, as the one pressed is gone; once it has, it's forgotten.
   */
  const [toggled, setToggled] = useState<"browse" | "details" | null>(null);
  useEffect(() => {
    if (toggled) setToggled(null);
  }, [toggled]);
  const collapse = (panel: "browse" | "details", collapsed: boolean) => {
    setToggled(panel);
    changePanels(panel === "browse" ? { browseCollapsed: collapsed } : { detailsCollapsed: collapsed });
  };
  /** Shows the details: on a narrow screen, in their pane; elsewhere, expanding the Details panel if it's collapsed. */
  const openDetails = useCallback(() => {
    setPane("details");
    if (!narrow && detailsCollapsed) changePanels({ detailsCollapsed: false });
  }, [narrow, detailsCollapsed, changePanels]);

  // On a narrow screen, picking something shows it: a view's diagram, or an element's details.
  // (Elsewhere the pane isn't used, and every panel is on screen, or a strip for one that's
  // collapsed, which picking something to see in it expands.)
  const showView = (id: string) => {
    selectView(id);
    setPane("diagram");
  };
  const showDetails = (next: Selection) => {
    select(next);
    openDetails();
  };
  /** A box just added gets its name typed in its details. */
  const selectOnCanvas = useCallback(
    (next: Selection, options?: { isNew?: boolean }) => {
      select(next, options);
      if (options?.isNew) openDetails();
    },
    [select, openDetails],
  );
  /** The usages panel is drawn over the diagram. */
  const findUsages = (id: string) => {
    setUsagesOf(current(id));
    setPane("diagram");
  };

  // Right-clicking an element or an arrow selects it too, so it's clear which one the menu is for.
  const openElementMenu = (id: string, at: { x: number; y: number }) => {
    // A box selected with others has the menu for them all.
    if (selection?.kind === "several" && selection.elements.includes(id)) return setMenu({ kind: "several", elements: selection.elements.map(current), stickies: selection.stickies, ...at });
    if (selection?.kind !== "element" || selection.id !== id) select({ kind: "element", id });
    setMenu({ kind: "element", id: current(id), ...at });
  };
  const openArrowMenu = (from: string, to: string, relation: RelationshipKind | undefined, at: { x: number; y: number }) => {
    const kind = relation ? { relation } : {};
    if (selection?.kind !== "arrow" || selection.from !== from || selection.to !== to || selection.relation !== relation) select({ kind: "arrow", from, to, ...kind });
    setMenu(renamedSelection({ kind: "arrow", from, to, ...kind, ...at }, current));
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  const afterEdits = state.afterEdits;
  /**
   * Opens notes from the diagram's chip on a box, an arrow or a sticky note of the open view.
   * They're read once the edits made before have landed, such as the notes typed in the details
   * panel, saved as the chip was pressed. If what they're on is gone by then, the editor doesn't
   * open. Nor does it for a relationship when its element's relationships to the same target
   * have moved by then, as another may be in its place (see notesOwnerAsIs).
   */
  const openNotes = useCallback(
    (owner: NotesOwner) => {
      const opened = ++notesOpened.current;
      const place = ws ? relationshipsPlace(ws, owner) : undefined;
      void afterEdits((now) => {
        const renamed = renamedNotesOwner(owner, current);
        const at = now && place !== undefined ? notesOwnerAsIs(now, renamed, place) : renamed;
        const text = now ? notesOf(now, at) : undefined;
        if (!now || text === undefined) return;
        setDialog((d) => d ?? { kind: "notes", owner: at, name: notesName(now, at), text, opened, ready: true });
      });
    },
    [afterEdits, current, ws],
  );
  /**
   * For a diagram's right-click menu, which opens once the edits made before the click have
   * landed: tells `then` what the menu is for by then, the ID its view then has, and how many of
   * the changes a menu follows have been made by then, for it to follow the ones after. `on` is
   * what was clicked in this render's view, `viewId`. It's followed through what every change
   * this render doesn't show has done to it and to the view, the ones already on their way and
   * any that landed since the render. Null when it's gone by then, or was lost on the way.
   */
  const menuAfterEdits = useCallback(
    (viewId: string, on: MenuFor, then: (on: MenuFor | null, view: string, followed: number) => void) =>
      afterEdits((now) => {
        const landed = followMenu(on, viewId, menuRenames.current.slice(menuRenamesSeen));
        const view = now?.views.get(landed.view);
        then(view && landed.on && menuThere(view, landed.on) ? landed.on : null, landed.view, menuRenames.current.length);
      }),
    [afterEdits, menuRenamesSeen],
  );
  /** The changes a diagram's menu follows that this render reflects, for an open menu to follow. */
  const shownMenuRenames = useMemo(() => menuRenames.current.slice(0, menuRenamesSeen), [menuRenamesSeen]);
  const notesOpener = useMemo(
    () =>
      viewId
        ? {
            element: (id: string) => openNotes({ kind: "element", id }),
            sticky: (id: string) => openNotes({ kind: "sticky", view: viewId, id }),
            // An arrow or step with notes on more than one of its relationships shows its details, which list each one's.
            relationships: (sources: RelationshipSource[], whole: Selection) => {
              const owners = ws ? notedRelationships(ws, sources) : [];
              if (owners.length === 1) return openNotes(owners[0]!);
              if (owners.length === 0) return;
              select(whole);
              openDetails();
            },
          }
        : null,
    [openNotes, viewId, ws, select, openDetails],
  );

  /** A new note on a box, the frame or an arrow, or on a flowchart a block, beside it on the diagram, with its text being typed there. */
  const addStickyOn = (on: StickyTargetData) => {
    if (!view) return;
    const id = newStickyId(view);
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note", on }]).then((ok) => {
      if (!ok) return;
      select({ kind: "sticky", id }, { isNew: true });
      setPane("diagram");
    });
  };

  /** A new view of this level of an element, such as a component view of a container, opened. */
  const newViewFor = (id: string, level: ViewLevel) => {
    const element = ws?.elements.get(id);
    if (!ws || !element) return;
    const op = newViewOf(ws, element, level);
    void edit([op]).then((ok) => ok && showView(op.id));
  };

  /**
   * Builds a container with a library, or takes it out: a tick in either's details. The
   * container's libraries are saved whole, so they're read from the workspace as it is when the
   * edit runs, with both IDs as they are by then. Read from the render, they'd leave out a
   * library added or ticked since, such as a new one whose save is still under way.
   */
  const build = (container: string, library: string, built: boolean) => void edit((now) => buildOps(now, current(container), current(library), built));

  /**
   * Adds a library built into a container, and opens its details, to name it and tick the other
   * containers built with it. It's worked out from the workspace as it is when the edit runs: a
   * library ticked just before the press stays ticked, and a container whose name was typed just
   * before it is found under its new ID. The library is opened only if the container is still
   * what's selected, as something else can be picked while a slow save is under way.
   */
  const newLibraryIn = (id: string) => {
    let library = "";
    return edit((now) => {
      const container = now.elements.get(current(id));
      if (container?.kind !== "container") throw new OpError("The container is gone, so no library was added to it.");
      library = uniqueId(now, "new-library");
      return [
        { op: "add-element", id: library, kind: "library", name: "New library" },
        { op: "update-element", id: container.id, libraries: [...container.libraries, library] },
      ];
    }).then((ok) => {
      const selected = selectionNow.current;
      if (ok && selected?.kind === "element" && current(selected.id) === current(id)) select({ kind: "element", id: library }, { isNew: true });
    });
  };

  const showInView = (id: string) => view && void edit([{ op: "show-in-view", view: view.id, id }]);
  const hideFromView = (id: string) => view && void edit([{ op: "hide-in-view", view: view.id, id }]).then(() => select(null));
  /** Hides boxes selected together from the view, as one step for Undo. Notes selected with them stay. */
  const hideAll = (ids: string[]) => view && void edit(ids.map((id): Operation => ({ op: "hide-in-view", view: view.id, id: current(id) }))).then(() => select(null));

  /**
   * Whether the open diagram can copy this selection: boxes and notes on a view of boxes. Worked
   * out from the view, not the diagram, which only says what it can copy once it's drawn.
   */
  const copyable = (what: Selection) => {
    if (!view || !STICKY_TARGET_LEVELS.includes(view.level)) return false;
    const { elements, stickies } = copySource(what);
    return elements.some((id) => ws?.elements.has(id)) || stickies.some((id) => view.stickies.some((s) => s.id === id));
  };
  /** Copies what's selected, for the menus and the details, and says what it copied. Ctrl+C does it without a word. */
  const copySelected = () =>
    attempt(async () => {
      const copied = await clipboard.current?.copy();
      if (!copied) return;
      const what = shapesLabel(copied.elements.filter((e) => e.picked).length, copied.stickies.length);
      state.notify({ kind: "info", text: `Copied ${what}. Paste on this view or another with ${isMac ? "⌘V" : "Ctrl+V"}, or Paste in the diagram's right-click menu.` });
    });

  /** A usage can be in another view: open that one, then select it there. */
  const goToUsage = (target: string | null, next: Selection) => {
    if (target && target !== viewId) setViewId(target);
    select(next);
  };

  useEffect(() => {
    if (usagesOf && ws && !ws.elements.has(usagesOf)) setUsagesOf(null);
  }, [ws, usagesOf]);

  const removeSelection = useCallback(() => {
    if (selection?.kind === "element") setDialog({ kind: "delete", ids: [current(selection.id)], stickies: [] });
    // Boxes selected together are deleted from the model together, with the notes selected with them, once it's confirmed.
    if (selection?.kind === "several" && selection.elements.length > 0) setDialog({ kind: "delete", ids: selection.elements.map(current), stickies: selection.stickies });
    if (selection?.kind === "several" && selection.elements.length === 0 && view) void edit(deleteOps(ws!, view.id, [], selection.stickies)).then(() => select(null));
    // A note is only text on one view, and Undo brings it back, so it goes without asking.
    if (selection?.kind === "sticky" && view) void edit([{ op: "remove-sticky", view: view.id, id: selection.id }]).then(() => select(null));
    // A step is one line of a sequence, and Undo brings it back, so it goes without asking too.
    if (selection?.kind === "step" && view) void edit([{ op: "remove-step", view: view.id, step: selection.number }]).then(() => select(null));
    // So does a state, with its transitions, and a transition: Undo brings them back.
    if (selection?.kind === "state" && view) void edit([{ op: "remove-state", view: view.id, id: selection.id }]).then(() => select(null));
    if (selection?.kind === "transition" && view) void edit([{ op: "remove-transition", view: view.id, transition: selection.number }]).then(() => select(null));
    // And a flowchart's block, with its flows, and a flow.
    if (selection?.kind === "block" && view) void edit([{ op: "remove-block", view: view.id, id: selection.id }]).then(() => select(null));
    if (selection?.kind === "flow" && view) void edit([{ op: "remove-flow", view: view.id, flow: selection.number }]).then(() => select(null));
    // And an entity view's entity, with its attributes and links, an attribute, and a link.
    if (selection?.kind === "entity" && view) void edit([{ op: "remove-entity", view: view.id, id: selection.id }]).then(() => select(null));
    if (selection?.kind === "attribute" && view) void edit([{ op: "remove-attribute", view: view.id, entity: selection.entity, name: selection.name }]).then(() => select({ kind: "entity", id: selection.entity }));
    if (selection?.kind === "link" && view) void edit([{ op: "remove-link", view: view.id, link: selection.number }]).then(() => select(null));
    // A node, with what's inside it, and a connection are only this view's, and Undo brings them back.
    if (selection?.kind === "node" && view) void edit([{ op: "remove-node", view: view.id, id: selection.id }]).then(() => select(null));
    if (selection?.kind === "connection" && view) void edit([{ op: "remove-connection", view: view.id, connection: selection.number }]).then(() => select(null));
    // A container running in a node stops running there; it stays in the model.
    if (selection?.kind === "instance" && view) {
      const node = view.nodes.find((n) => n.id === selection.node);
      if (node) void edit([{ op: "update-node", view: view.id, id: node.id, runs: node.runs.filter((id) => id !== current(selection.element)) }]).then(() => select(null));
    }
    // A lane, a card and an arrow between two cards are only this view's too. A lane's cards stay, in no lane.
    if (view) {
      // So are a screen, with what's on it, and a widget, with what's inside it, and a whiteboard's shapes, with their arrows, and its arrows and notes.
      const ops = [...eventDeleteOps(view, selection), ...wireframeDeleteOps(view, selection), ...whiteboardDeleteOps(view, selection)];
      if (ops.length) void edit(ops).then(() => select(null));
    }
    if (selection?.kind === "arrow" && ws) {
      const ops = arrowDeleteOps(ws, computed, selection.from, selection.to, selection.relation);
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

  const attempt = (task: () => Promise<void>) => void task().catch((e: unknown) => state.notify({ kind: "error", text: problemText(e) }));
  const snap: SnapControl = { settings: snapSettings.snap, set: (change) => attempt(() => snapSettings.setSnap(change)) };

  /**
   * An example, or a workspace deleted in another tab, only lives in this tab until it's saved:
   * as a file on desktop, in the browser's storage on the web.
   */
  const save = () =>
    attempt(async () => {
      if (state.text === null) return;
      // Saved, it's opened as the copy that's kept, with Ask AI started afresh: a request still running would be cut off, and a change it was making lost.
      if (asking.current) throw new Error("Ask AI is still working on a request. Stop it, or wait for it to finish, then save: saving opens the copy that's kept, and ends the conversation.");
      // Saved, it's kept under another key, and keeps the views pinned here.
      const carryOn = async (next: WorkspaceHost) => {
        await userSettings.setPins(next.key, viewSettings.pins).catch(() => undefined);
        onHostChange(next);
      };
      // Until the copy opens, Ask AI takes no request: one sent now would be cut off as it does.
      saving.current = true;
      try {
        if (desktop) {
          const file = await desktop.saveAs(state.text);
          if (file) await carryOn(new DesktopHost(desktop, file.path, file.name, file.saved));
          return;
        }
        const record = await browserLibrary.add(host.name, state.text);
        await carryOn(new BrowserHost(browserLibrary, record.id, record.fileName));
      } finally {
        saving.current = false;
      }
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
  // The panels open as they were left, rather than at their usual size and then changing.
  if (!ws || state.text === null || !panelSettings.loaded) return <div className="center muted">Loading…</div>;

  const mod = isMac ? "⌘" : "Ctrl+";
  // What either Ask AI panel is given: where the person is, and the file's text, to undo what the AI changed.
  const where = askContext(ws, view, computed, selection);
  const ask = {
    context: where.context,
    contextLabel: where.label,
    text: state.text,
    restore: (text: string, from?: string) => state.restore(text, "Undid the AI's change", from),
    open: askOpen,
    onHide: () => setAskOpen(false),
    onNews: setAskNews,
  };
  // While the desktop app's Ask AI is open, its agent's edits reload the file again and again, and the panel already says what it changed.
  // With the panel hidden, only that the file was reloaded is held back: while the request runs, and until its answer is read there.
  const agentReload = state.message?.kind === "info" && state.message.text === RELOADED && (agentRunning || askNews === "finished");
  const message = state.message?.kind === "info" && fileAgent && (askOpen || agentReload) ? null : state.message;
  const syncsDocs = savesDocs(host, state.storage);
  const status =
    state.storage === "file"
      ? syncsDocs && ws.doc.export?.docs && !state.docs?.error
        ? `Saved · docs in ${ws.doc.export.docs}/`
        : "Saved"
      : state.storage === "browser"
        ? "Saved in this browser"
        : state.unsaved
          ? "Not saved"
          : "Only in this tab";
  // A workspace kept in the browser or a file can be shared. One that's only in this tab, like an example, is saved first.
  const canShare = !!shareClient && state.storage !== "memory";
  // Links made in the desktop app open in the web designer; the web designer's open in itself.
  const designer = desktop || !location.protocol.startsWith("http") ? PUBLIC_DESIGNER : location.origin + location.pathname;
  // A workspace from a folder whose file is gone is zipped as that folder, so the docs are where a save put them.
  const place = host instanceof FolderHost ? { folder: host.root.name, path: host.path } : undefined;
  // The file, as the top bar, the workspace's details and, on a narrow screen, the More menu name it: a workspace in a folder with the folder and the path in it.
  const fileName = host instanceof FolderHost ? host.location : host.name;
  // Chrome and Edge can write to a folder; the desktop app keeps its files where they are.
  const canExportToFolder = !desktop && canOpenFolders();
  /**
   * A copy of the workspace, exported to a folder the user chooses, such as a Git repository, as
   * the workspace it becomes there (exportToFolder). The folder is listed on the start page, to open
   * and keep working on it there. The message says what was written, and what wasn't.
   */
  const exportToFolderNow = () =>
    attempt(async () => {
      const text = state.text;
      if (text === null) return;
      const root = await pickFolder();
      if (!root) return;
      const result = await exportToFolder(root, ws, host.name);
      // What was exported is saved; anything changed since isn't.
      if (state.storage === "memory") state.markSaved(text);
      let listed = true;
      await folderList.add(root, host.name, ws.doc.name).catch(() => (listed = false));
      const notes = [
        saveProblem(result)?.replace(/^Saved, but /, ""),
        result.docs?.skipped.length ? `Left alone in the docs (not generated by open-arch, or generated for another workspace beside it): ${result.docs.skipped.join(", ")}.` : null,
        listed ? null : "It couldn't be listed under Folders on the start page: open it with Open folder… to keep working on it there.",
      ].filter((note): note is string => !!note);
      const done = `Exported ${host.name} to ${root.name}, as a workspace there, with its docs.`;
      state.notify(
        notes.length
          ? { kind: "error", text: [done, ...notes.map((note) => note.charAt(0).toUpperCase() + note.slice(1))].join(" ") }
          : { kind: "info", text: `${done} Open it from Folders on the start page to keep working on it there.` },
      );
    });
  const exportZip = () => download(`${place?.folder ?? host.name.replace(/\.openarch$/, "")}.zip`, workspaceZip(ws, host.name, state.text!, place) as BlobPart, "application/zip");
  const toggleAsk = () => {
    setAskOpen((o) => !o);
    // The panel is drawn over the diagram; hiding it leaves the pane as it is.
    if (!askOpen) setPane("diagram");
  };
  // The open diagram as a picture of the whole of it, drawn with nothing selected, so the
  // picture has no highlights or grips. On a phone it's drawn on the Diagram pane, as another
  // pane hides it. What was selected, and the pane that was showing, come back after.
  const drawImage = async (cv: ComputedView, format: ImageFormat) => {
    const was = { selection, pane };
    setPane("diagram");
    setSelection(null);
    await nextPaint();
    try {
      return await diagramImage(mainRef.current!, format, cv.view.title);
    } finally {
      setSelection(was.selection);
      setPane(was.pane);
    }
  };
  const saveImage = (cv: ComputedView, format: ImageFormat, type: FileType) =>
    attempt(async () => void (await saveFile(`${cv.view.id}${type.extension}`, () => drawImage(cv, format), type)));
  // The clipboard is asked for straight away, while the click still counts, and waits for the picture.
  const copyPicture = (cv: ComputedView) =>
    attempt(async () => {
      await copyImage(drawImage(cv, "png"));
      state.notify({ kind: "info", text: `Copied a picture of “${cv.view.title}”. Paste it into a document, a slide or a chat.` });
    });
  // The open diagram taken elsewhere: as Mermaid to paste, as a markdown file of its own, or as a picture to paste or save.
  const canCopy = canCopyImages();
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
    ...(canCopy ? [{ label: "Copy as PNG", divider: true, onSelect: () => copyPicture(cv) }] : []),
    { label: "Save as PNG…", divider: !canCopy, onSelect: () => saveImage(cv, "png", PNG_FILE) },
    { label: "Save as SVG…", onSelect: () => saveImage(cv, "svg", SVG_FILE) },
    { label: "Save as PDF…", onSelect: () => saveImage(cv, "pdf", PDF_FILE) },
  ];
  // A narrow top bar keeps saving, Undo and Redo, and puts the rest in a menu, History too. The
  // diagram's toolbar has no room for its Auto layout button or Export menu there either, so
  // they're in this menu too.
  const moreItems: MenuItem[] = [
    ...(desktop ? [] : providers.map((provider) => ({ label: provider.exportLabel, onSelect: () => exportTo(provider) }))),
    ...(syncsDocs ? [] : [{ label: "Export zip", onSelect: exportZip }]),
    ...(canExportToFolder ? [{ label: "Export to folder…", onSelect: exportToFolderNow }] : []),
    ...(canShare ? [{ label: "Share a link…", onSelect: () => setDialog({ kind: "share" }) }] : []),
    ...(computed && canAutoLayout(computed) ? [{ label: "Auto layout", onSelect: () => autoLayout.current?.run() }] : []),
    ...(computed ? [{ label: "Export this view", items: exportItems(computed) }] : []),
    ...(canAsk ? [{ label: askOpen ? "Hide Ask AI" : askNews ? `Ask AI · ${NEWS_LABELS[askNews]}` : "Ask AI", onSelect: toggleAsk }] : []),
    { label: "History", onSelect: () => setDialog({ kind: "history" }) },
    { label: "Workspace settings", onSelect: () => showDetails({ kind: "workspace" }) },
    { label: "Close", onSelect: onClose },
  ];
  // What the details panel and the model tree can do with an element, in one place.
  const elementMenu = (id: string): MenuItem[] => {
    const action = viewAction(ws, view, computed, id);
    const on = stickyTargetFor(ws, computed, { kind: "element", id });
    const element = ws.elements.get(id);
    return [
      { label: "Find usages", onSelect: () => findUsages(id) },
      ...(action === "show" ? [{ label: "Show in this view", onSelect: () => showInView(id) }] : []),
      ...(action === "hide" ? [{ label: "Hide from this view", onSelect: () => hideFromView(id) }] : []),
      ...(on ? [{ label: "Add sticky note", onSelect: () => addStickyOn(on) }] : []),
      ...(element ? [{ label: "New view", items: viewLevelsOf(element).map((level) => ({ label: LEVEL_NAMES[level], onSelect: () => newViewFor(id, level) })) }] : []),
      ...(copyable({ kind: "element", id }) ? [{ label: "Copy", onSelect: copySelected }] : []),
      { label: "Delete from model…", danger: true, onSelect: () => setDialog({ kind: "delete", ids: [current(id)], stickies: [] }) },
    ];
  };
  // What can be done with several boxes and notes selected together: right-click any of their boxes.
  const severalMenu = (elements: string[], stickies: string[]): MenuItem[] => {
    const hideable = elements.length > 0 && elements.every((id) => viewAction(ws, view, computed, id) === "hide");
    return [
      { label: "Copy", onSelect: copySelected },
      ...(hideable ? [{ label: "Hide from this view", onSelect: () => hideAll(elements) }] : []),
      { label: "Delete from model…", danger: true, divider: true, onSelect: () => setDialog({ kind: "delete", ids: elements.map(current), stickies }) },
    ];
  };
  // What the details panel can do with an arrow. One that stands for several relationships
  // lists them, to pick the one to remove. An implied arrow's one relationship is on something
  // inside a box, so its item names it; a direct arrow's one relationship is the arrow.
  const arrowMenu = (from: string, to: string, relation?: RelationshipKind): MenuItem[] => {
    const name = (id: string) => ws.elements.get(id)?.name ?? id;
    const removals = arrowRemovals(ws, computed, from, to, relation);
    const remove = (ops: Operation[]) => () => void edit(ops).then(() => select(null));
    const implied = !!findArrow(computed, from, to, relation)?.implied;
    const on = stickyTargetFor(ws, computed, { kind: "arrow", from, to, relation });
    return [
      { label: `Select ${name(from)}`, onSelect: () => select({ kind: "element", id: from }) },
      { label: `Select ${name(to)}`, onSelect: () => select({ kind: "element", id: to }) },
      ...(on ? [{ label: "Add sticky note", onSelect: () => addStickyOn(on) }] : []),
      ...(removals.length === 1
        ? [{ label: implied ? `Remove ${removals[0]!.ends}` : "Remove relationship", danger: true, divider: true, onSelect: remove(removals[0]!.ops) }]
        : []),
      ...(removals.length > 1 ? [{ label: "Remove relationship", divider: true, items: removals.map((r) => ({ label: r.label, danger: true, onSelect: remove(r.ops) })) }] : []),
    ];
  };
  /** What the open diagram's right-click menus need: see MenuHost. */
  const menus: MenuHost | null = view ? { afterEdits: (on, then) => menuAfterEdits(view.id, on, then), renames: shownMenuRenames } : null;
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
  // Beside the diagram, a panel can be collapsed to a strip, and dragged to a size. On a narrow
  // screen each fills it in turn, as it always does.
  const { panels } = panelSettings;
  const browsePanel = panes[1]!;
  const detailsPanel = panes[2]!;
  const detailsPlace = stacked ? "bottom" : "right";
  const detailsSize: PanelSize = stacked ? "detailsHeight" : "detailsWidth";
  const appClass = narrow
    ? `app narrow pane-${pane}`
    : ["app", panels.browseCollapsed && "browse-collapsed", panels.detailsCollapsed && "details-collapsed"].filter(Boolean).join(" ");
  // The sizes that were dragged; the others are the usual size for the screen.
  const appStyle = Object.fromEntries(
    (["browseWidth", "detailsWidth", "detailsHeight"] as const).flatMap((size) => (panels[size] === undefined ? [] : [[PANEL_PROPERTY[size], `${panels[size]}px`]])),
  ) as CSSProperties;
  // Whose notes the notes editor has open: renamed meanwhile, they're called by the new name; gone, by the name they had.
  const notesNamed = dialog?.kind === "notes" ? (notesOf(ws, dialog.owner) === undefined ? dialog.name : notesName(ws, dialog.owner)) : "";

  return (
    <div className={appClass} style={appStyle}>
      <header className="topbar">
        <button className="ws-name link" onClick={() => showDetails({ kind: "workspace" })} title="Workspace settings">
          {ws.doc.name}
        </button>
        {!narrow && (
          <>
            <span className="muted small file-name" title={fileName}>
              <span>{fileName}</span>
            </span>
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
        {!narrow && !syncsDocs && (
          <button onClick={exportZip} title="The .openarch file and its markdown docs, in a .zip">
            Export zip
          </button>
        )}
        {!narrow && canExportToFolder && (
          <button onClick={exportToFolderNow} title="The .openarch file and its markdown docs, into a folder you choose, such as a Git repository">
            Export to folder…
          </button>
        )}
        {!narrow && canShare && (
          <button onClick={() => setDialog({ kind: "share" })} title="Share a link that opens a copy of this workspace">
            Share
          </button>
        )}
        {!narrow && canAsk && (
          <button
            className={askOpen ? "active" : ""}
            aria-pressed={askOpen}
            onClick={toggleAsk}
            title={askNews ? NEWS_TEXT[askNews] : desktop ? "Ask an AI agent to change the model" : "Ask an AI model about the workspace, or to change it"}
            aria-description={askNews ? NEWS_TEXT[askNews] : undefined}
          >
            Ask AI
            {askNews && <AskNewsMark news={askNews} />}
          </button>
        )}
        <button className={narrow ? "square" : ""} onClick={state.undo} disabled={!state.canUndo} title={`Undo (${mod}Z)`} aria-label="Undo">
          {narrow ? <Icon d={UNDO_ICON} /> : "Undo"}
        </button>
        <button className={narrow ? "square" : ""} onClick={state.redo} disabled={!state.canRedo} title={`Redo (${mod}⇧Z)`} aria-label="Redo">
          {narrow ? <Icon d={REDO_ICON} /> : "Redo"}
        </button>
        {/* An icon, as the bar has little room to spare beside a workspace's export buttons. */}
        {!narrow && (
          <button className="square" onClick={() => setDialog({ kind: "history" })} title="History: the changes made here, to go back to any of them. The list isn't saved in the file." aria-label="History">
            <Icon d={HISTORY_ICON} />
          </button>
        )}
        {narrow ? (
          <MenuButton items={moreItems} note={`${fileName} · ${status}`} from="right" className="square" title={askNews ? `More. ${NEWS_TEXT[askNews]}` : "More"} label={askNews ? `More. ${NEWS_TEXT[askNews]}` : "More"}>
            <Icon d={MORE_ICON} stroke={3} />
            {askNews && <AskNewsMark news={askNews} />}
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
      {!narrow &&
        (panels.browseCollapsed ? (
          <PanelRail place="left" label={browsePanel.label} detail={browsePanel.detail} bad={browsePanel.bad} onExpand={() => collapse("browse", false)} focus={toggled === "browse"} />
        ) : (
          <PanelEdge
            place="left"
            label={browsePanel.label}
            size="browseWidth"
            stacked={stacked}
            onResize={(browseWidth) => changePanels({ browseWidth })}
            onCollapse={() => collapse("browse", true)}
            focus={toggled === "browse"}
          />
        ))}

      {/* Under another pane, the diagram keeps its size, so it keeps its zoom too. */}
      <main ref={mainRef} className="main" inert={narrow && pane !== "diagram"}>
        <NotesOpener.Provider value={notesOpener}>
          {view?.level === "sequence" ? (
            computed ? (
              <SequenceDiagram
                key={`${view.level}:${opening.number}`}
                ws={ws}
                computed={computed}
                selection={selection}
                onSelect={select}
                edit={edit}
                menus={menus!}
                onElementMenu={openElementMenu}
                onError={(text) => state.notify({ kind: "error", text })}
                exportItems={exportItems(computed)}
              />
            ) : (
              <div className="canvas-message">This view can't be drawn: {view && scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "state" ? (
            computed ? (
              // Not keyed by the view's ID, so it isn't made again when the view is given a new one. Its level is in the key, so one kind of diagram never gets what another's kept.
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <StateDiagram
                  computed={computed}
                  selection={selection}
                  onSelect={selectOnCanvas}
                  edit={edit}
                  menus={menus!}
                  onError={(text) => state.notify({ kind: "error", text })}
                  exportItems={exportItems(computed)}
                  snap={snap}
                  autoLayoutHandle={autoLayout}
                />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "flowchart" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <FlowchartDiagram
                  ws={ws}
                  computed={computed}
                  selection={selection}
                  onSelect={selectOnCanvas}
                  edit={edit}
                  menus={menus!}
                  onError={(text) => state.notify({ kind: "error", text })}
                  exportItems={exportItems(computed)}
                  editSticky={isNew && selection?.kind === "sticky" ? selection.id : null}
                  snap={snap}
                  autoLayoutHandle={autoLayout}
                />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "entity" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <EntityDiagram
                  computed={computed}
                  selection={selection}
                  onSelect={selectOnCanvas}
                  edit={edit}
                  menus={menus!}
                  onError={(text) => state.notify({ kind: "error", text })}
                  exportItems={exportItems(computed)}
                  snap={snap}
                  autoLayoutHandle={autoLayout}
                />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "deployment" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <DeploymentDiagram
                  ws={ws}
                  computed={computed}
                  selection={selection}
                  onSelect={selectOnCanvas}
                  edit={edit}
                  menus={menus!}
                  elementItems={elementMenu}
                  onArrowMenu={openArrowMenu}
                  onError={(text) => state.notify({ kind: "error", text })}
                  exportItems={exportItems(computed)}
                  snap={snap}
                />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "event" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <EventDiagram computed={computed} selection={selection} onSelect={selectOnCanvas} edit={edit} menus={menus!} exportItems={exportItems(computed)} snap={snap} />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "whiteboard" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <WhiteboardDiagram computed={computed} selection={selection} onSelect={selectOnCanvas} edit={edit} menus={menus!} exportItems={exportItems(computed)} snap={snap} />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view?.level === "wireframe" ? (
            computed ? (
              <ReactFlowProvider key={`${view.level}:${opening.number}`}>
                <WireframeDiagram computed={computed} selection={selection} onSelect={selectOnCanvas} edit={edit} menus={menus!} exportItems={exportItems(computed)} snap={snap} />
              </ReactFlowProvider>
            ) : (
              <div className="canvas-message">This view can't be drawn: {scopeProblems(ws, view)[0]?.message}</div>
            )
          ) : view ? (
            <ReactFlowProvider key={`${view.level}:${opening.number}`}>
              <Canvas
                ws={ws}
                view={view}
                diagnostics={diagnostics}
                selection={selection}
                onSelect={selectOnCanvas}
                edit={edit}
                menus={menus!}
                onElementMenu={openElementMenu}
                onArrowMenu={openArrowMenu}
                onError={(text) => state.notify({ kind: "error", text })}
                renames={shownRenames}
                exportItems={computed ? exportItems(computed) : []}
                editSticky={isNew && selection?.kind === "sticky" ? selection.id : null}
                snap={snap}
                autoLayoutHandle={autoLayout}
                clipboardHandle={clipboard}
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
        </NotesOpener.Provider>
        {usagesOf && <Usages ws={ws} id={usagesOf} viewId={viewId} onGo={goToUsage} onClose={() => setUsagesOf(null)} />}
        {fileAgent && <AskAI agent={fileAgent} onRunning={setAgentRunning} {...ask} />}
        {!desktop && <BrowserAskAI host={host} storage={state.storage} change={state.change} afterEdits={state.afterEdits} fetch={askFetch} onRunning={(running) => (asking.current = running)} hold={() => (saving.current ? "The workspace is being saved. Ask again once the copy it keeps has opened." : null)} {...ask} />}
      </main>

      <Properties
        ws={ws}
        view={view}
        computed={computed}
        selection={selection}
        isNew={isNew}
        syncsDocs={syncsDocs}
        syncsSkill={savesSkill(host, state.storage)}
        docs={state.docs}
        fileName={fileName}
        edit={edit}
        onSelect={select}
        onHide={hideFromView}
        onDelete={(id) => setDialog({ kind: "delete", ids: [current(id)], stickies: [] })}
        onDeleteSelected={removeSelection}
        onCopy={copyable(selection) ? copySelected : undefined}
        onFindUsages={findUsages}
        onAddSticky={addStickyOn}
        onNewView={newViewFor}
        onNewLibrary={newLibraryIn}
        onBuild={build}
        onDeleteView={(id) => setDialog({ kind: "deleteView", id: current(id) })}
        // The editor opens at once, over everything, so nothing else is edited while it's open. A
        // relationship's look is taken once the edits made before Expand have landed, such as its
        // description saved as its box was left; until then the editor can't save. If the
        // relationships between the two have moved by then, it's lost track of which it's on.
        // That's so for a file with errors too: its save is refused, as an element's is.
        onEditNotes={(owner, text) => {
          const opened = ++notesOpened.current;
          const place = relationshipsPlace(ws, owner);
          setDialog((d) => d ?? { kind: "notes", owner: renamedNotesOwner(owner, current), name: notesName(ws, owner), text, opened, ready: place === undefined });
          if (place === undefined) return;
          void state.afterEdits((now) =>
            // By now the owner has followed any rename that landed.
            setDialog((d) =>
              d?.kind === "notes" && d.opened === opened && d.owner.kind === "relationship"
                ? { ...d, owner: now ? notesOwnerAsIs(now, d.owner, place) : { ...d.owner, look: null }, ready: true }
                : d,
            ),
          );
        }}
      />
      {!narrow &&
        (panels.detailsCollapsed ? (
          <PanelRail place={detailsPlace} label={detailsPanel.label} detail={detailsPanel.detail} onExpand={() => collapse("details", false)} focus={toggled === "details"} />
        ) : (
          <PanelEdge
            // A new edge when the panel moves under the diagram, or back beside it.
            key={detailsPlace}
            place={detailsPlace}
            label={detailsPanel.label}
            size={detailsSize}
            stacked={stacked}
            onResize={(value) => changePanels({ [detailsSize]: value })}
            onCollapse={() => collapse("details", true)}
            focus={toggled === "details"}
          />
        ))}

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

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.kind === "element" ? elementMenu(menu.id) : menu.kind === "several" ? severalMenu(menu.elements, menu.stickies) : arrowMenu(menu.from, menu.to, menu.relation)}
          onClose={closeMenu}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteElementDialog
          ws={ws}
          ids={dialog.ids}
          stickies={dialog.stickies.filter((id) => view?.stickies.some((s) => s.id === id)).length}
          inView={dialog.ids.every((id) => viewAction(ws, view, computed, id) === "hide")}
          onClose={() => setDialog(null)}
          onHide={() => {
            setDialog(null);
            hideAll(dialog.ids);
          }}
          onDelete={() => {
            setDialog(null);
            void edit((now) => deleteOps(now, view?.id ?? null, dialog.ids.map(current), dialog.stickies)).then(() => select(null));
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
      {dialog?.kind === "notes" && (
        <NotesEditor
          name={notesNamed}
          text={dialog.text}
          saved={notesOf(ws, dialog.owner)}
          ready={dialog.ready}
          // Checked again as the save runs, in case an edit elsewhere lands first. A rename that
          // lands first is followed, as one while the editor shows is.
          onSave={(text) =>
            edit((now) => {
              const owner = renamedNotesOwner(dialog.owner, current);
              if (notesOf(now, owner) === undefined) throw new OpError(`${notesNamed} was changed or deleted elsewhere, so its notes weren't saved.`);
              return [notesOp(owner, text)];
            })
          }
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "history" && (
        <HistoryDialog versions={state.versions} current={state.version} onGo={state.goTo} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "share" && shareClient && (
        <ShareDialog client={shareClient} workspace={host.key} file={{ name: host.name, text: state.text }} designer={designer} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
