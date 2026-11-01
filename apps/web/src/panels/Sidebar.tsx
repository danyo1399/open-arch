import { modelTree, type Diagnostic, type TreeNode, type ViewDef, type Workspace } from "@open-arch/core";
import { useEffect, useState } from "react";
import type { Selection } from "../canvas/Canvas.js";
import { byName, viewList, type ViewOrder } from "../model.js";
import { menuPoint } from "./ContextMenu.js";

interface SidebarProps {
  ws: Workspace;
  diagnostics: Diagnostic[];
  viewId: string | null;
  inView: Set<string>;
  /** Elements the open view could draw as their own box but doesn't. */
  showable: Set<string>;
  selection: Selection;
  onSelectView(id: string): void;
  onSelect(selection: Selection): void;
  onShowInView(id: string): void;
  /** A right-click on an element in the model tree, at that point on the screen. */
  onElementMenu(id: string, at: { x: number; y: number }): void;
  onNewView(): void;
  viewOrder: ViewOrder;
  onViewOrder(order: ViewOrder): void;
  /** The IDs of the views pinned to the top of the list. */
  pinnedViews: string[];
  onPinView(id: string, pinned: boolean): void;
  onOpenProblem(d: Diagnostic): void;
}

export function Sidebar(props: SidebarProps) {
  const { ws, diagnostics } = props;
  const views = viewList(ws.views.values(), props.viewOrder, props.pinnedViews);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const [problemsOpen, setProblemsOpen] = useState(errors > 0);
  // Open the list when problems appear, e.g. after an agent's edit.
  useEffect(() => {
    if (errors > 0) setProblemsOpen(true);
  }, [errors]);

  return (
    <nav className="sidebar" aria-label="Workspace">
      <section>
        <header>
          <h2>Views</h2>
          <span className="spacer" />
          <select className="view-order" value={props.viewOrder} onChange={(e) => props.onViewOrder(e.target.value as ViewOrder)} aria-label="Sort views" title="Sort views">
            <option value="name">By name</option>
            <option value="level">By level</option>
          </select>
          <button className="link" onClick={props.onNewView}>
            + New view
          </button>
        </header>
        {ws.views.size === 0 && <p className="muted">No views yet.</p>}
        <ul className="list">
          {views.pinned.map((v) => (
            <ViewRow key={v.id} view={v} pinned {...props} />
          ))}
          {views.pinned.length > 0 && views.others.length > 0 && <li className="list-divider" aria-hidden="true" />}
          {views.others.map((v) => (
            <ViewRow key={v.id} view={v} pinned={false} {...props} />
          ))}
        </ul>
      </section>

      <section className="grow-section">
        <header>
          <h2>Model</h2>
          <span className="muted small">{ws.elements.size} elements</span>
        </header>
        {ws.elements.size === 0 && <p className="muted">No elements yet. Open a view and use + Add.</p>}
        <ul className="list tree">
          {modelTree(ws, byName).map((n) => (
            <TreeRow key={n.element.id} node={n} depth={0} {...props} />
          ))}
        </ul>
      </section>

      <section className={problemsOpen ? "problems open" : "problems"}>
        <header>
          <button className="link heading" onClick={() => setProblemsOpen((o) => !o)} aria-expanded={problemsOpen}>
            <h2>Problems</h2>
          </button>
          <span className={errors ? "count bad" : diagnostics.length ? "count warn" : "count"}>{diagnostics.length}</span>
        </header>
        {problemsOpen && (
          <ul className="list">
            {diagnostics.length === 0 && <li className="muted">No problems.</li>}
            {diagnostics.slice(0, 200).map((d, i) => (
              <li key={i}>
                <button className="row problem" onClick={() => props.onOpenProblem(d)} title={d.fix ?? d.rule}>
                  <span className={`sev sev-${d.severity}`}>{d.severity === "error" ? "✕" : "!"}</span>
                  <span className="grow">
                    {d.message}
                    <span className="muted small block">
                      {d.path || "the file"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </nav>
  );
}

/** A pushpin on a 24 × 24 grid: filled in for a pinned view. */
const PIN_ICON = "M8 3h8M10 3v6l-3 4h10l-3-4V3M12 13v8";

function ViewRow({ view, pinned, ...props }: { view: ViewDef; pinned: boolean } & SidebarProps) {
  return (
    <li>
      <div className={view.id === props.viewId ? "row active" : "row"}>
        <button className="row-main" onClick={() => props.onSelectView(view.id)} title={view.id}>
          <span className="dot dot-view" />
          <span className="grow">{view.title}</span>
          <span className="muted small">{view.level}</span>
        </button>
        <button
          className={pinned ? "icon pin pinned" : "icon pin"}
          title={pinned ? "Unpin" : "Pin to the top"}
          aria-label={`Pin ${view.title}`}
          aria-pressed={pinned}
          onClick={() => props.onPinView(view.id, !pinned)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={PIN_ICON} />
          </svg>
        </button>
      </div>
    </li>
  );
}

function TreeRow({ node, depth, ...props }: { node: TreeNode; depth: number } & SidebarProps) {
  const e = node.element;
  const selected = props.selection?.kind === "element" ? props.selection.id === e.id : props.selection?.kind === "several" && props.selection.elements.includes(e.id);
  return (
    <>
      <li>
        <div
          className={selected ? "row active" : "row"}
          style={{ paddingLeft: 8 + depth * 14 }}
          onContextMenu={(event) => {
            event.preventDefault();
            props.onElementMenu(e.id, menuPoint(event));
          }}
        >
          <button className="row-main" onClick={() => props.onSelect({ kind: "element", id: e.id })} title={e.id}>
            <span className={`dot dot-${e.external ? "external" : e.kind}`} />
            <span className={props.inView.has(e.id) ? "grow" : "grow muted"}>{e.name}</span>
          </button>
          {props.showable.has(e.id) && (
            <button className="icon" title="Show in this view" aria-label={`Show ${e.name} in this view`} onClick={() => props.onShowInView(e.id)}>
              +
            </button>
          )}
        </div>
      </li>
      {node.children.map((c) => (
        <TreeRow key={c.element.id} node={c} depth={depth + 1} {...props} />
      ))}
    </>
  );
}
