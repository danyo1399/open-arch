/**
 * A sequence view's diagram: a lifeline for each element in its steps, and the steps as
 * numbered arrows, top to bottom. Drag from one lifeline to another to add a step, or use
 * + Add step. Nothing is placed by hand, so nothing here saves positions.
 */
import { isInside, kindLabel, type ComputedView, type Operation, type Workspace } from "@open-arch/core";
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { byName } from "../model.js";
import { ContextMenu, MenuButton, menuPoint, type MenuItem } from "../panels/ContextMenu.js";
import type { Edit } from "../state.js";
import type { Selection } from "./Canvas.js";
import { dropNumber, lifelineAt, SEQ, sequenceLayout, stepChoices, stepTargets, type StepChoice } from "./sequenceLayout.js";

interface SequenceProps {
  ws: Workspace;
  computed: ComputedView;
  selection: Selection;
  onSelect(selection: Selection): void;
  edit(edit: Edit): Promise<boolean>;
  /** A right-click on an element's heading, at that point on the screen. */
  onElementMenu(id: string, at: { x: number; y: number }): void;
  /** A step that can't be drawn, to tell the person about. */
  onError(text: string): void;
  /** The toolbar's Export menu: ways to take the diagram elsewhere. */
  exportItems: MenuItem[];
}

/** A press that moves less than this is a click, not a drag. */
const DRAG_DISTANCE = 4;

/** "note", or "note-2", "note-3", ... whichever the view doesn't have yet. */
function newStickyId(ids: string[]): string {
  if (!ids.includes("note")) return "note";
  for (let i = 2; ; i++) if (!ids.includes(`note-${i}`)) return `note-${i}`;
}

export function SequenceDiagram({ ws, computed: cv, selection, onSelect, edit, onElementMenu, onError, exportItems }: SequenceProps) {
  const view = cv.view;
  const layout = useMemo(() => sequenceLayout(cv), [cv]);
  const surface = useRef<HTMLDivElement>(null);
  /** A step being drawn from a lifeline: where it started, and where the pointer is. */
  const [drawing, setDrawing] = useState<{ from: string; start: { x: number; y: number }; at: { x: number; y: number }; moved: boolean } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  /** The ways to add a step drawn where the model has no relationship for a call: where it was dropped on the screen, and its number. */
  const [choosing, setChoosing] = useState<{ x: number; y: number; choices: StepChoice[]; number: number } | null>(null);
  const name = (id: string) => ws.elements.get(id)?.name ?? id;

  const point = (e: { clientX: number; clientY: number }) => {
    const r = surface.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Adds a step, numbered `number` or after the last, with any change to the model it needs, in one edit. */
  const addStep = (ops: Operation[], number?: number) =>
    void edit(ops).then((ok) => {
      if (ok) onSelect({ kind: "step", number: number ?? cv.steps.length + 1 });
    });

  const startDrawing = (from: string, e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = point(e);
    setDrawing({ from, start: at, at, moved: false });
  };
  const moveDrawing = (e: PointerEvent) => {
    if (!drawing) return;
    const at = point(e);
    const moved = drawing.moved || Math.hypot(at.x - drawing.start.x, at.y - drawing.start.y) > DRAG_DISTANCE;
    setDrawing({ ...drawing, at, moved });
  };
  const endDrawing = (e: PointerEvent, click: () => void) => {
    if (!drawing) return;
    setDrawing(null);
    if (!drawing.moved) return click();
    const at = point(e);
    const to = lifelineAt(layout, at.x);
    if (!to || to === drawing.from) return;
    const number = dropNumber(layout, at.y);
    const choices = stepChoices(ws, view.id, drawing.from, to, number);
    if (choices.length === 0) {
      onError(`${name(drawing.from)} and ${name(to)} contain one another, so no relationship can join them, and no step either.`);
      return;
    }
    // A call the model already has goes straight in. Otherwise, say what adding it would do.
    if (choices.length === 1 && !choices[0]!.changesModel) addStep(choices[0]!.ops, number);
    else setChoosing({ x: e.clientX, y: e.clientY, choices, number });
  };

  const addNote = () => {
    const id = newStickyId(view.stickies.map((s) => s.id));
    void edit([{ op: "add-sticky", view: view.id, id, text: "New note" }]).then((ok) => ok && onSelect({ kind: "sticky", id }));
  };

  const clickBackground = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onSelect(null);
  };

  const target = drawing?.moved ? lifelineAt(layout, drawing.at.x) : undefined;
  const headTop = SEQ.pad;
  const lineTop = headTop + SEQ.headHeight;
  const selectedElement = selection?.kind === "element" ? selection.id : undefined;
  const selectedStep = selection?.kind === "step" ? selection.number : undefined;

  return (
    <div className="canvas sequence">
      <div className="toolbar sequence-toolbar">
        <div className="toolbar-title">
          <strong>{view.title}</strong>
          <span>sequence view</span>
          {view.description && (
            <span className="toolbar-description" title={view.description}>
              {view.description}
            </span>
          )}
        </div>
        <div className="menu">
          <button className="primary" onClick={() => setFormOpen((o) => !o)} aria-expanded={formOpen}>
            + Add step
          </button>
          {formOpen && (
            <StepForm
              ws={ws}
              view={view.id}
              onAdd={(ops) => {
                setFormOpen(false);
                addStep(ops);
              }}
              onClose={() => setFormOpen(false)}
            />
          )}
        </div>
        <button onClick={addNote}>Add note</button>
        <MenuButton items={exportItems} className="export-button" title="Take this diagram elsewhere, as Mermaid or a picture">
          Export
        </MenuButton>
      </div>

      <div className="sequence-scroll" onClick={clickBackground}>
        <div
          ref={surface}
          className={drawing?.moved ? "sequence-surface drawing" : "sequence-surface"}
          style={{ width: layout.width + (view.stickies.length ? 260 : 0), height: layout.height }}
          onClick={clickBackground}
        >
          <svg className="sequence-lines" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <marker id="seq-call" viewBox="-10 -10 20 20" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
                <polyline points="-6,-4 0,0 -6,4 -6,-4" />
              </marker>
              <marker id="seq-reply" viewBox="-10 -10 20 20" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
                <polyline points="-6,-4 0,0 -6,4" fill="none" />
              </marker>
            </defs>
            {cv.nodes.map((n) => (
              <line key={n.id} className={n.id === target ? "lifeline target" : "lifeline"} x1={layout.x.get(n.id)} x2={layout.x.get(n.id)} y1={lineTop} y2={layout.bottom} />
            ))}
            {cv.steps.map((s) => {
              const x1 = layout.x.get(s.from);
              const x2 = layout.x.get(s.to);
              const y = layout.y.get(s.number)!;
              if (x1 === undefined || x2 === undefined || x1 === x2) return null;
              const classes = ["step-arrow", s.reply ? "reply" : "call", s.number === selectedStep ? "selected" : "", s.sources.length ? "" : "unbacked"];
              const end = x2 > x1 ? x2 - 2 : x2 + 2;
              return (
                <g key={s.number} className={classes.join(" ")} onClick={() => onSelect({ kind: "step", number: s.number })}>
                  <line className="step-hit" x1={x1} x2={x2} y1={y} y2={y} />
                  <line className="step-line" x1={x1} x2={end} y1={y} y2={y} markerEnd={`url(#seq-${s.reply ? "reply" : "call"})`} />
                </g>
              );
            })}
            {drawing?.moved && <line className="step-drawing" x1={layout.x.get(drawing.from)} x2={drawing.at.x} y1={drawing.at.y} y2={drawing.at.y} />}
          </svg>

          {cv.steps.map((s) => {
            const x1 = layout.x.get(s.from);
            const x2 = layout.x.get(s.to);
            if (x1 === undefined || x2 === undefined) return null;
            const left = Math.min(x1, x2);
            const width = Math.max(Math.abs(x2 - x1), SEQ.column - 20);
            const text = `${s.label ?? "(no description)"}${s.labelTechnology ? ` [${s.labelTechnology}]` : ""}`;
            return (
              <button
                key={s.number}
                className={s.number === selectedStep ? "step-label selected" : "step-label"}
                style={{ left: left + Math.abs(x2 - x1) / 2 - width / 2, width, top: layout.y.get(s.number)! - 24 }}
                title={`${s.number}. ${text}${s.sources.length ? "" : "\nThe model has no relationship for this step."}`}
                onClick={() => onSelect({ kind: "step", number: s.number })}
              >
                <span className="step-number">{s.number}</span> {text}
              </button>
            );
          })}

          {cv.nodes.map((n) => {
            const x = layout.x.get(n.id)!;
            const classes = ["c4", `c4-${n.external ? "external" : n.kind}`, "sequence-head", n.id === selectedElement ? "selected" : "", n.id === target ? "target" : ""];
            return (
              <div
                key={n.id}
                className={classes.join(" ")}
                style={{ left: x - SEQ.headWidth / 2, top: headTop, width: SEQ.headWidth, height: SEQ.headHeight }}
                title="Drag to another lifeline to add a step"
                onPointerDown={(e) => startDrawing(n.id, e)}
                onPointerMove={moveDrawing}
                onPointerUp={(e) => endDrawing(e, () => onSelect({ kind: "element", id: n.id }))}
                onPointerCancel={() => setDrawing(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect({ kind: "element", id: n.id });
                  onElementMenu(n.id, menuPoint(e));
                }}
              >
                <div className="c4-name">{n.name}</div>
                <div className="c4-kind">
                  [{kindLabel(n)}
                  {n.technology ? `: ${n.technology}` : ""}]
                </div>
              </div>
            );
          })}
          {/* Each lifeline is a wide target to drag a new step from, under the arrows and their labels. */}
          {cv.nodes.map((n) => (
            <div
              key={n.id}
              className="lifeline-grip"
              style={{ left: layout.x.get(n.id)! - 14, top: lineTop, height: layout.bottom - lineTop }}
              title={`Drag to another lifeline to add a step from ${n.name}`}
              onPointerDown={(e) => startDrawing(n.id, e)}
              onPointerMove={moveDrawing}
              onPointerUp={(e) => endDrawing(e, () => onSelect({ kind: "element", id: n.id }))}
              onPointerCancel={() => setDrawing(null)}
            />
          ))}

          {view.stickies.length > 0 && (
            <div className="sequence-notes" style={{ left: layout.width + 8, top: SEQ.pad }}>
              {view.stickies.map((s) => (
                <div
                  key={s.id}
                  className={`sticky sticky-${s.color}${selection?.kind === "sticky" && selection.id === s.id ? " selected" : ""}`}
                  onClick={() => onSelect({ kind: "sticky", id: s.id })}
                >
                  <div className="sticky-text">{s.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        {choosing && (
          <ContextMenu
            x={choosing.x}
            y={choosing.y}
            note={choosing.choices[0]!.changesModel ? "The model has no relationship for this call yet." : undefined}
            items={choosing.choices.map((c) => ({ label: c.label, onSelect: () => addStep(c.ops, choosing.number) }))}
            onClose={() => setChoosing(null)}
          />
        )}
        {cv.steps.length === 0 && (
          <div className="empty-hint">
            This view has no steps yet. Use <strong>+ Add step</strong> to add the first one.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * + Add step's form: who acts, and which element it calls or answers. The elements the model
 * connects it to come first; calling another adds a relationship to it, one way or both.
 */
function StepForm({ ws, view, onAdd, onClose }: { ws: Workspace; view: string; onAdd(ops: Operation[]): void; onClose(): void }) {
  const elements = useMemo(() => [...ws.elements.values()].sort(byName), [ws]);
  const [from, setFrom] = useState(elements[0]?.id ?? "");
  const [reply, setReply] = useState(false);
  const [bothWays, setBothWays] = useState(false);
  const targets = useMemo(() => (from ? stepTargets(ws, from, reply) : []), [ws, from, reply]);
  // A call can go to an element it isn't connected to yet, by adding a relationship; a reply can't.
  const others = useMemo(
    () => (from && !reply ? elements.filter((e) => e.id !== from && !targets.includes(e) && !isInside(ws, from, e.id) && !isInside(ws, e.id, from)) : []),
    [ws, elements, from, reply, targets],
  );
  const [to, setTo] = useState("");
  const toId = [...targets, ...others].some((t) => t.id === to) ? to : (targets[0] ?? others[0])?.id;
  const adds = !!toId && !targets.some((t) => t.id === toId);
  const option = (e: { id: string; name: string } & Parameters<typeof kindLabel>[0]) => (
    <option key={e.id} value={e.id}>
      {e.name} [{kindLabel(e)}]
    </option>
  );
  const add = () => {
    if (!toId) return;
    const step: Operation = { op: "add-step", view, from, to: toId, reply: reply || undefined };
    onAdd(adds ? [{ op: "add-relationship", from, to: toId, bidirectional: bothWays || undefined }, step] : [step]);
  };
  return (
    <div className="menu-items step-form" role="dialog" aria-label="Add a step" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <label className="field">
        <span className="field-label">From</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)} autoFocus>
          {elements.map(option)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={reply} onChange={(e) => setReply(e.target.checked)} />
        It's a reply to an earlier call
      </label>
      <label className="field">
        <span className="field-label">{reply ? "Replies to" : "Calls"}</span>
        {toId ? (
          <select value={toId} onChange={(e) => setTo(e.target.value)}>
            {others.length > 0 ? (
              <>
                {targets.length > 0 && <optgroup label="Connected in the model">{targets.map(option)}</optgroup>}
                <optgroup label="Not connected yet: adds a relationship">{others.map(option)}</optgroup>
              </>
            ) : (
              targets.map(option)
            )}
          </select>
        ) : reply ? (
          <span className="muted small">Nothing uses this element, so it has nothing to reply to. Add a relationship to it first.</span>
        ) : elements.length > 1 ? (
          <span className="muted small">Every other element is inside this one, or contains it, so no relationship can join them.</span>
        ) : (
          <span className="muted small">The model has no other element to call. Add one first.</span>
        )}
      </label>
      {adds && (
        <label className="check">
          <input type="checkbox" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} />
          The new relationship goes both ways
        </label>
      )}
      <div className="step-form-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!from || !toId} onClick={add}>
          {adds ? "Add relationship and step" : "Add step"}
        </button>
      </div>
    </div>
  );
}
