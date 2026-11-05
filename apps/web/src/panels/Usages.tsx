import type { Workspace } from "@open-arch/core";
import { useMemo } from "react";
import type { Selection } from "../canvas/Canvas.js";
import { findUsages } from "../model.js";

interface UsagesProps {
  ws: Workspace;
  id: string;
  /** The open view. Arrows are looked for here first, so a jump stays in it when it can. */
  viewId: string | null;
  /** Select something, in another view when `viewId` names one. */
  onGo(viewId: string | null, selection: Selection): void;
  onClose(): void;
}

/** "Find usages": what refers to an element, each a click away. */
export function Usages({ ws, id, viewId, onGo, onClose }: UsagesProps) {
  const usages = useMemo(() => findUsages(ws, id, viewId ?? undefined), [ws, id, viewId]);
  const element = ws.elements.get(id);
  if (!element || !usages) return null;
  const name = (other: string) => ws.elements.get(other)?.name ?? other;
  const count = usages.relationships.length + usages.views.length;

  return (
    <section className="usages" aria-label={`Usages of ${element.name}`}>
      <header className="usages-header">
        <h2>Usages of {element.name}</h2>
        <span className="muted small">{count}</span>
        <span className="spacer" />
        <button className="icon" onClick={onClose} aria-label="Close usages" title="Close">
          ×
        </button>
      </header>
      {count === 0 && <p className="muted small">Nothing uses {element.name}, and no view shows it.</p>}
      {usages.relationships.length > 0 && (
        <>
          <h3>Used by</h3>
          <ul className="list">
            {usages.relationships.map(({ from, rel, arrow }) => {
              const where = !arrow ? "not in any view" : arrow.view !== viewId ? `in ${ws.views.get(arrow.view)?.title ?? arrow.view}` : undefined;
              return (
                <li key={`${from.id}-${rel.index}`}>
                  <button
                    className="row usage"
                    onClick={() => (arrow ? onGo(arrow.view, { kind: "arrow", from: arrow.from, to: arrow.to, ...(arrow.relation && { relation: arrow.relation }) }) : onGo(null, { kind: "element", id: from.id }))}
                  >
                    <span className={`dot dot-${from.external ? "external" : from.kind}`} />
                    <span className="grow">
                      {from.name} → {name(rel.to)}
                      {(rel.description || where) && <span className="muted small block">{[rel.description, where].filter(Boolean).join(" · ")}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {usages.views.length > 0 && (
        <>
          <h3>In views</h3>
          <ul className="list">
            {usages.views.map(({ view, as }) => (
              <li key={view.id}>
                <button className="row" onClick={() => onGo(view.id, { kind: "element", id })}>
                  <span className="dot dot-view" />
                  <span className="grow">{view.title}</span>
                  <span className="muted small">{as === "frame" ? `${view.level} · frame` : as === "states" ? `${view.level} · its states` : view.level}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
