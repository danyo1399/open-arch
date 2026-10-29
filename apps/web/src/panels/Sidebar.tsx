import { modelTree, type Diagnostic, type TreeNode, type ViewDef, type Workspace } from "@open-arch/core";
import { useEffect, useState } from "react";
import type { Selection } from "../canvas/Canvas.js";

interface SidebarProps {
  ws: Workspace;
  diagnostics: Diagnostic[];
  viewId: string | null;
  inView: Set<string>;
  /** Elements the current view could draw as their own box. */
  showable: Set<string>;
  selection: Selection;
  onSelectView(id: string): void;
  onSelect(selection: Selection): void;
  onShowInView(id: string): void;
  onNewView(): void;
  onOpenProblem(d: Diagnostic): void;
}

export function Sidebar(props: SidebarProps) {
  const { ws, diagnostics, viewId } = props;
  const views = [...ws.views.values()].sort((a, b) => a.title.localeCompare(b.title));
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
          <button className="link" onClick={props.onNewView}>
            + New view
          </button>
        </header>
        {views.length === 0 && <p className="muted">No views yet.</p>}
        <ul className="list">
          {views.map((v: ViewDef) => (
            <li key={v.id}>
              <button className={v.id === viewId ? "row active" : "row"} onClick={() => props.onSelectView(v.id)} title={v.id}>
                <span className="dot dot-view" />
                <span className="grow">{v.title}</span>
                <span className="muted small">{v.level}</span>
              </button>
            </li>
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
          {modelTree(ws).map((n) => (
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

function TreeRow({ node, depth, ...props }: { node: TreeNode; depth: number } & SidebarProps) {
  const e = node.element;
  const selected = props.selection?.kind === "element" && props.selection.id === e.id;
  const canShow = props.viewId && !props.inView.has(e.id) && props.showable.has(e.id);
  return (
    <>
      <li>
        <div className={selected ? "row active" : "row"} style={{ paddingLeft: 8 + depth * 14 }}>
          <button className="row-main" onClick={() => props.onSelect({ kind: "element", id: e.id })} title={e.id}>
            <span className={`dot dot-${e.external ? "external" : e.kind}`} />
            <span className={props.inView.has(e.id) ? "grow" : "grow muted"}>{e.name}</span>
          </button>
          {canShow && (
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
