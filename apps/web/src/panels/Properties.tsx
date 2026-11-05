import {
  describeElement,
  ELEMENT_SHAPES,
  kindLabel,
  PARENT_KINDS,
  RELATIONSHIP_KIND_LABELS,
  RELATIONSHIP_KINDS,
  SHAPE_LABELS,
  STICKY_COLORS,
  transitionLabel,
  type ArchElement,
  type ComputedView,
  type NewElements,
  type Operation,
  type Relationship,
  type RelationshipKind,
  type State,
  type Transition,
  type Step,
  type Sticky,
  type ViewDef,
  type Workspace,
} from "@open-arch/core";
import type { DocsSummary } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import { byName, findArrow, followsName, idFromName, relationshipRef, shownInProperties, uniqueId, uniqueStateId, viewAction } from "../model.js";
import type { Edit } from "../state.js";
import { Field, TagsEditor } from "./fields.js";

interface PropertiesProps {
  ws: Workspace;
  view: ViewDef | null;
  computed: ComputedView | null;
  selection: Selection;
  /** The element was just created: focus its name. */
  isNew: boolean;
  /** The desktop app keeps a docs folder up to date. */
  syncsDocs: boolean;
  docs: DocsSummary | null;
  fileName: string;
  edit(edit: Edit): Promise<boolean>;
  onSelect(selection: Selection): void;
  /** These three are on an element's right-click menu too, which touch screens may have no way to open. */
  onHide(id: string): void;
  onDelete(id: string): void;
  onFindUsages(id: string): void;
  onDeleteView(id: string): void;
}

/**
 * The operations that give an element or view a new name (`update`), plus a rename of its ID
 * when the ID follows the name. The designer keeps whatever has the old ID open under the new one.
 */
function renameOps(ws: Workspace, id: string, oldName: string, newName: string, update: Operation): Operation[] {
  const base = idFromName(newName);
  const next = base && followsName(id, oldName) ? uniqueId(ws, base, id) : id;
  return next === id ? [update] : [update, { op: "rename", id, to: next }];
}

/** "3 boxes", "2 sticky notes", or "2 boxes and 1 sticky note". */
export function shapesLabel(boxes: number, notes: number): string {
  const parts = [boxes > 0 && `${boxes} ${boxes === 1 ? "box" : "boxes"}`, notes > 0 && `${notes} sticky ${notes === 1 ? "note" : "notes"}`];
  return parts.filter(Boolean).join(" and ");
}

function idHint(follows: boolean): string {
  return follows ? "Changes with the name." : "Doesn't match the name, so it stays put when you rename. Edit it to match and it follows the name again.";
}

export function Properties(props: PropertiesProps) {
  const shown = shownInProperties(props.ws, props.view, props.selection);
  let body;
  if (shown.kind === "element") body = <ElementProperties {...props} element={shown.element} />;
  else if (shown.kind === "arrow") body = <ArrowProperties {...props} from={shown.from} to={shown.to} relation={shown.relation} />;
  else if (shown.kind === "sticky") body = <StickyProperties {...props} view={shown.view} sticky={shown.sticky} />;
  else if (shown.kind === "step") body = <StepProperties {...props} view={shown.view} step={shown.step} />;
  else if (shown.kind === "state") body = <StateProperties {...props} view={shown.view} state={shown.state} />;
  else if (shown.kind === "transition") body = <TransitionProperties {...props} view={shown.view} transition={shown.transition} />;
  else if (shown.kind === "several") body = <SeveralProperties {...props} elements={shown.elements} stickies={shown.stickies} />;
  else if (shown.kind === "view") body = <ViewProperties {...props} view={shown.view} />;
  else body = <WorkspaceProperties {...props} />;
  return (
    <aside className="properties" aria-label="Properties">
      {body}
    </aside>
  );
}

function ElementProperties({ ws, view, element, computed, isNew, edit, onSelect, onHide, onDelete, onFindUsages }: PropertiesProps & { element: ArchElement }) {
  const d = describeElement(ws, element.id)!;
  const set = (fields: Record<string, unknown>) => void edit([{ op: "update-element", id: element.id, ...fields }]);
  // An ID made from the name ("checkout-api") keeps following it, so the two don't drift apart.
  const rename = (name: string) => {
    void edit(renameOps(ws, element.id, element.name, name, { op: "update-element", id: element.id, name }));
  };
  const changeId = (text: string) => {
    const to = idFromName(text);
    if (!to || to === element.id) return;
    void edit([{ op: "rename", id: element.id, to }]);
  };
  const parentKinds = PARENT_KINDS[element.kind];
  const parents = [...ws.elements.values()].filter((e) => parentKinds.includes(e.kind)).sort((a, b) => a.name.localeCompare(b.name));
  const libraries = [...ws.elements.values()].filter((e) => e.kind === "library").sort(byName);
  const containers = [...ws.elements.values()].filter((e) => e.kind === "container").sort(byName);
  /** Builds a container with a library, or takes it out. */
  const build = (container: ArchElement, library: string, built: boolean) =>
    void edit([{ op: "update-element", id: container.id, libraries: built ? [...container.libraries, library] : container.libraries.filter((l) => l !== library) }]);
  const canHide = viewAction(ws, view, computed, element.id) === "hide";

  return (
    <>
      <header className="props-header">
        <span className={`badge badge-${element.external ? "external" : element.kind}`}>{kindLabel(element)}</span>
      </header>
      <Field label="Name" value={element.name} onCommit={rename} autoFocus={isNew} />
      <Field label="ID" value={element.id} onCommit={changeId} hint={idHint(followsName(element.id, element.name))} />
      <Field label="Description" value={element.description ?? ""} onCommit={(description) => set({ description: description || null })} multiline placeholder="One sentence, shown in the box" />
      {element.kind === "class" && (
        <>
          <Field label="Stereotype" value={element.stereotype ?? ""} onCommit={(stereotype) => set({ stereotype: stereotype || null })} placeholder="e.g. interface, abstract or enum" />
          <Field
            label="Members"
            value={element.members.join("\n")}
            onCommit={(text) => set({ members: text.trim() ? text.split("\n") : null })}
            multiline
            rows={6}
            placeholder={"One per line, e.g.\n+id: OrderId\n+total(): Money"}
            hint="Attributes and methods, in UML's notation: + public, - private, # protected. A line with brackets is a method."
          />
        </>
      )}
      {element.kind !== "person" && <Field label="Technology" value={element.technology ?? ""} onCommit={(technology) => set({ technology: technology || null })} placeholder="e.g. Node.js, PostgreSQL" />}
      {element.kind !== "person" && element.kind !== "class" && (
        <label className="field">
          <span className="field-label">Shape</span>
          <select value={element.shape} onChange={(e) => set({ shape: e.target.value === "box" ? null : e.target.value })}>
            {ELEMENT_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {SHAPE_LABELS[shape]}
              </option>
            ))}
          </select>
        </label>
      )}
      {parentKinds.length > 0 && (
        <label className="field">
          <span className="field-label">Inside</span>
          <select value={element.parent ?? ""} onChange={(e) => set({ parent: e.target.value })}>
            {!element.parent && <option value="">(none)</option>}
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {(element.kind === "person" || element.kind === "system") && (
        <label className="check">
          <input type="checkbox" checked={element.external} onChange={(e) => set({ external: e.target.checked })} />
          Outside our organisation (external)
        </label>
      )}
      {element.kind === "container" && libraries.length > 0 && (
        <fieldset className="field">
          <legend className="field-label">Libraries</legend>
          {libraries.map((l) => (
            <label key={l.id} className="check">
              <input type="checkbox" checked={element.libraries.includes(l.id)} onChange={(e) => build(element, l.id, e.target.checked)} />
              {l.name}
            </label>
          ))}
          <span className="field-hint">The shared libraries built into it. Its component views draw each one inside the frame.</span>
        </fieldset>
      )}
      {element.kind === "library" && (
        <fieldset className="field">
          <legend className="field-label">Built into</legend>
          {containers.length === 0 && <span className="muted small">There are no containers yet.</span>}
          {containers.map((c) => (
            <label key={c.id} className="check">
              <input type="checkbox" checked={c.libraries.includes(element.id)} onChange={(e) => build(c, element.id, e.target.checked)} />
              {c.name}
            </label>
          ))}
          <span className="field-hint">Each container built with it has its own copy, drawn inside that container's component views. Its classes are kept here, once.</span>
        </fieldset>
      )}
      <Field label="Notes" value={element.notes ?? ""} onCommit={(notes) => set({ notes: notes || null })} multiline rows={6} placeholder="Longer documentation, in markdown" />

      <h3>Tags</h3>
      <TagsEditor tags={element.tags} onChange={(tags) => set({ tags })} />
      <p className="muted small">Facts like owner or repository, as names with values. Leave the value empty for a plain label.</p>

      <h3>Uses</h3>
      {d.uses.length === 0 && <p className="muted small">Nothing. Drag from the dot under a box to another box to add a relationship.</p>}
      <ul className="rels">
        {d.uses.map(({ rel, target }, i) => {
          const ref = relationshipRef(element, i);
          return (
            <li key={`${rel.to}-${i}`}>
              <button className="link" onClick={() => onSelect({ kind: "element", id: rel.to })}>
                {rel.bidirectional ? "↔" : "→"} {target?.name ?? rel.to}
              </button>
              <Field label="Description" value={rel.description ?? ""} placeholder="e.g. Reads and writes orders" onCommit={(description) => void edit([{ op: "update-relationship", ...ref, description: description || null }])} />
              <Field label="Technology" value={rel.technology ?? ""} placeholder="e.g. HTTPS/JSON" onCommit={(technology) => void edit([{ op: "update-relationship", ...ref, technology: technology || null }])} />
              {hasKind(ws, element.id, rel) && <KindField kind={rel.kind} onChange={(kind) => void edit([kindOp(ref, rel, kind)])} />}
              {rel.kind === "association" && <BothWays checked={rel.bidirectional} onChange={(bidirectional) => void edit([{ op: "update-relationship", ...ref, bidirectional }])} />}
              <button className="link danger" onClick={() => void edit([{ op: "remove-relationship", ...ref }])}>
                Remove relationship
              </button>
            </li>
          );
        })}
      </ul>

      {(d.usedBy.length > 0 || d.contentsUsedBy.length > 0) && (
        <>
          <h3>Used by</h3>
          <ul className="plain">
            {[...d.usedBy, ...d.contentsUsedBy].map(({ from, rel }, i) => (
              <li key={i}>
                <button className="link" onClick={() => onSelect({ kind: "element", id: from.id })}>
                  {from.name}
                </button>{" "}
                <span className="muted small">
                  {rel.description ?? ""}
                  {rel.bidirectional ? " (both ways)" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        <button onClick={() => onFindUsages(element.id)}>Find usages</button>
        {canHide && <button onClick={() => onHide(element.id)}>Hide from this view</button>}
        <button className="danger" onClick={() => onDelete(element.id)}>
          Delete from model…
        </button>
      </div>
    </>
  );
}

/** Whether a relationship can have a kind other than association: when it joins two classes, or already has one. */
function hasKind(ws: Workspace, from: string, rel: Relationship): boolean {
  return rel.kind !== "association" || (ws.elements.get(from)?.kind === "class" && ws.elements.get(rel.to)?.kind === "class");
}

/** The edit that gives a relationship another kind. Only an association goes both ways, so another kind makes it one way. */
function kindOp(ref: ReturnType<typeof relationshipRef>, rel: Relationship, kind: RelationshipKind): Operation {
  return { op: "update-relationship", ...ref, kind, ...(kind !== "association" && rel.bidirectional && { bidirectional: false }) };
}

/** What a relationship between two classes means, in UML's terms. */
function KindField({ kind, onChange }: { kind: RelationshipKind; onChange(kind: RelationshipKind): void }) {
  return (
    <label className="field">
      <span className="field-label">Kind</span>
      <select value={kind} onChange={(e) => onChange(e.target.value as RelationshipKind)}>
        {RELATIONSHIP_KINDS.map((k) => (
          <option key={k} value={k}>
            {RELATIONSHIP_KIND_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Whether a relationship goes both ways. */
function BothWays({ checked, onChange }: { checked: boolean; onChange(bidirectional: boolean): void }) {
  return (
    <label className="check" title="The other element uses this one too. Drawn with an arrowhead at each end.">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Goes both ways
    </label>
  );
}

function ArrowProperties({ ws, computed, from, to, relation, edit, onSelect }: PropertiesProps & { from: string; to: string; relation?: RelationshipKind }) {
  const edge = findArrow(computed, from, to, relation);
  if (!edge) return <p className="muted">This arrow is no longer in the view.</p>;
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  return (
    <>
      <header className="props-header">
        <span className="badge">Relationship</span>
      </header>
      <p>
        <button className="link" onClick={() => onSelect({ kind: "element", id: from })}>
          {name(from)}
        </button>{" "}
        {edge.bidirectional ? "↔" : "→"}{" "}
        <button className="link" onClick={() => onSelect({ kind: "element", id: to })}>
          {name(to)}
        </button>
      </p>
      {edge.kind !== "association" && <p className="small">{RELATIONSHIP_KIND_LABELS[edge.kind]}</p>}
      {edge.implied && <p className="muted small">This arrow stands for relationships between elements inside these boxes. Edit them here or on those elements.</p>}
      <p className="muted small">
        Drag the dot at either end of the arrow to another box to move that end there.{edge.sources.length > 1 && " Every relationship the arrow stands for moves with it."}
      </p>
      <ul className="rels">
        {edge.sources.map(({ element, index }) => {
          const source = ws.elements.get(element);
          const rel = source?.uses[index];
          if (!source || !rel) return null;
          const ref = relationshipRef(source, index);
          return (
            <li key={`${element}-${index}`}>
              {(edge.implied || edge.bidirectional) && (
                <span className="small">
                  {name(element)} {rel.bidirectional ? "↔" : "→"} {name(rel.to)}
                </span>
              )}
              <Field
                label="Description"
                value={rel.description ?? ""}
                placeholder="e.g. Reads and writes orders"
                autoFocus={!rel.description && edge.sources.length === 1}
                onCommit={(description) => void edit([{ op: "update-relationship", ...ref, description: description || null }])}
              />
              <Field label="Technology" value={rel.technology ?? ""} placeholder="e.g. HTTPS/JSON" onCommit={(technology) => void edit([{ op: "update-relationship", ...ref, technology: technology || null }])} />
              <Field
                label="Notes"
                value={rel.notes ?? ""}
                multiline
                rows={4}
                placeholder="Longer documentation, in markdown"
                onCommit={(notes) => void edit([{ op: "update-relationship", ...ref, notes: notes || null }])}
              />
              {hasKind(ws, element, rel) && (
                <KindField
                  kind={rel.kind}
                  // On a class view, a relationship of another kind is another arrow: keep it selected.
                  onChange={(kind) => void edit([kindOp(ref, rel, kind)]).then((ok) => ok && onSelect({ kind: "arrow", from: element, to: rel.to, ...(kind !== "association" && { relation: kind }) }))}
                />
              )}
              {rel.kind === "association" && <BothWays checked={rel.bidirectional} onChange={(bidirectional) => void edit([{ op: "update-relationship", ...ref, bidirectional }])} />}
              <div className="field">
                <span className="field-label">Tags</span>
                <TagsEditor tags={rel.tags} onChange={(tags) => void edit([{ op: "update-relationship", ...ref, tags }])} />
              </div>
              <button className="link danger" onClick={() => void edit([{ op: "remove-relationship", ...ref }]).then(() => onSelect(null))}>
                Remove relationship
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function StickyProperties({ view, sticky, edit, onSelect }: PropertiesProps & { view: ViewDef; sticky: Sticky }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-sticky" }>, "op" | "view" | "id">) => void edit([{ op: "update-sticky", view: view.id, id: sticky.id, ...fields }]);
  return (
    <>
      <header className="props-header">
        <span className="badge badge-sticky">Sticky note</span>
      </header>
      <Field
        label="Text"
        value={sticky.text}
        multiline
        rows={6}
        onCommit={(text) => text.trim() && set({ text })}
        hint={view.level === "sequence" ? "A sequence's notes are shown beside it." : "Double-click the note to edit it in place."}
      />
      <fieldset className="field swatches">
        <legend className="field-label">Colour</legend>
        {STICKY_COLORS.map((color) => (
          <label key={color} className={`swatch sticky-${color}`} title={color[0]!.toUpperCase() + color.slice(1)}>
            <input type="radio" name="sticky-color" value={color} checked={sticky.color === color} onChange={() => set({ color })} aria-label={color} />
          </label>
        ))}
      </fieldset>
      <p className="muted small">Sticky notes explain this diagram to the people reading it: what to look at, or why it's drawn this way. They belong to this view and aren't part of the model, so other views don't show them. The docs show them under the diagram.</p>
      <div className="actions">
        {sticky.at && view.level !== "sequence" && <button onClick={() => set({ at: null })}>Move beside the diagram</button>}
        <button className="danger" onClick={() => void edit([{ op: "remove-sticky", view: view.id, id: sticky.id }]).then(() => onSelect(null))}>
          Delete note
        </button>
      </div>
    </>
  );
}

function StepProperties({ ws, view, computed, step, edit, onSelect }: PropertiesProps & { view: ViewDef; step: Step }) {
  const computedStep = computed?.steps.find((s) => s.number === step.number);
  const set = (fields: Omit<Extract<Operation, { op: "update-step" }>, "op" | "view" | "step">) => void edit([{ op: "update-step", view: view.id, step: step.number, ...fields }]);
  const elements = [...ws.elements.values()].sort(byName);
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  const count = view.steps.length;
  const move = (to: number) => void edit([{ op: "update-step", view: view.id, step: step.number, newStep: to }]).then((ok) => ok && onSelect({ kind: "step", number: to }));
  const end = (field: "from" | "to", label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={step[field]} onChange={(e) => set({ [field]: e.target.value })}>
        {!ws.elements.has(step[field]) && <option value={step[field]}>{step[field]} (not an element)</option>}
        {elements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} [{kindLabel(e)}]
          </option>
        ))}
      </select>
    </label>
  );
  // A call without a description is labelled with its relationship's.
  const fallback = !step.reply && !step.description ? computedStep?.label : undefined;
  return (
    <>
      <header className="props-header">
        <span className="badge">Step {step.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      {end("from", "From")}
      {end("to", step.reply ? "Replies to" : "Calls")}
      <label className="check">
        <input type="checkbox" checked={step.reply} onChange={(e) => set({ reply: e.target.checked })} />
        A reply to an earlier call, drawn dashed
      </label>
      <Field
        label="Description"
        value={step.description ?? ""}
        autoFocus={!step.description && !fallback}
        placeholder={fallback ? `${fallback} (from the relationship)` : "e.g. Submits the order"}
        onCommit={(description) => set({ description: description || null })}
      />
      <Field
        label="Technology"
        value={step.technology ?? ""}
        placeholder={!step.reply && computedStep?.labelTechnology && !step.technology ? `${computedStep.labelTechnology} (from the relationship)` : "e.g. JSON/HTTPS"}
        onCommit={(technology) => set({ technology: technology || null })}
      />
      <h3>Goes along</h3>
      {computedStep && computedStep.sources.length > 0 ? (
        <ul className="plain">
          {computedStep.sources.map(({ element, index }) => {
            const rel = ws.elements.get(element)?.uses[index];
            if (!rel) return null;
            return (
              <li key={`${element}-${index}`}>
                <button className="link" onClick={() => onSelect({ kind: "element", id: element })}>
                  {name(element)}
                </button>{" "}
                {rel.bidirectional ? "↔" : "→"} {name(rel.to)} <span className="muted small">{rel.description ?? ""}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          <p className="error small">The model has no relationship for this step to go along.</p>
          {ws.elements.has(step.from) && ws.elements.has(step.to) && (
            <div className="actions">
              {/* A reply goes back along a relationship from the element it answers. */}
              {[false, true].map((both) => {
                const [from, to] = step.reply ? [step.to, step.from] : [step.from, step.to];
                return (
                  <button key={String(both)} onClick={() => void edit([{ op: "add-relationship", from, to, bidirectional: both || undefined }])}>
                    {both ? `Add ${name(from)} ↔ ${name(to)}` : `Add ${name(from)} → ${name(to)}`}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className="actions">
        <button disabled={step.number === 1} onClick={() => move(step.number - 1)}>
          Move up
        </button>
        <button disabled={step.number === count} onClick={() => move(step.number + 1)}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-step", view: view.id, step: step.number }]).then(() => onSelect(null))}>
          Delete step
        </button>
      </div>
    </>
  );
}

function StateProperties({ view, state, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; state: State }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-state" }>, "op" | "view" | "id">) => void edit([{ op: "update-state", view: view.id, id: state.id, ...fields }]);
  // An ID made from the name keeps following it, as an element's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(state.id, state.name) ? uniqueStateId(view, base, state.id) : state.id;
    void edit([{ op: "update-state", view: view.id, id: state.id, name, ...(newId !== state.id && { newId }) }]).then((ok) => ok && newId !== state.id && onSelect({ kind: "state", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === state.id) return;
    void edit([{ op: "update-state", view: view.id, id: state.id, newId }]).then((ok) => ok && onSelect({ kind: "state", id: newId }));
  };
  const name = (id: string) => view.states.find((s) => s.id === id)?.name ?? id;
  const out = view.transitions.filter((t) => t.from === state.id);
  const into = view.transitions.filter((t) => t.to === state.id && t.from !== state.id);
  const transitionLink = (t: Transition, other: string, arrow: string) => (
    <li key={t.number}>
      <button className="link" onClick={() => onSelect({ kind: "transition", number: t.number })}>
        {arrow} {name(other)}
      </button>{" "}
      <span className="muted small">{transitionLabel(t)}</span>
    </li>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge badge-state">State</span>
      </header>
      <Field label="Name" value={state.name} onCommit={(n) => n.trim() && rename(n)} autoFocus={isNew} />
      <Field label="ID" value={state.id} onCommit={changeId} hint={idHint(followsName(state.id, state.name))} />
      <Field label="Description" value={state.description ?? ""} multiline placeholder="One sentence, shown in the state" onCommit={(description) => set({ description: description || null })} />
      <label className="check">
        <input type="checkbox" checked={view.initial === state.id} onChange={(e) => set({ initial: e.target.checked })} />
        It starts here (the initial state)
      </label>
      <label className="check">
        <input type="checkbox" checked={state.final} onChange={(e) => set({ final: e.target.checked })} />
        It can end here (a final state)
      </label>
      <h3>Transitions</h3>
      {out.length + into.length === 0 && <p className="muted small">None yet. Drag from the dot under this state to another state to add one.</p>}
      <ul className="plain">
        {out.map((t) => transitionLink(t, t.to, t.to === state.id ? "↻" : "→"))}
        {into.map((t) => transitionLink(t, t.from, "←"))}
      </ul>
      <label className="field">
        <span className="field-label">Add a transition to</span>
        <select
          value=""
          onChange={(e) => {
            const to = e.target.value;
            if (!to) return;
            const number = view.transitions.length + 1;
            void edit([{ op: "add-transition", view: view.id, from: state.id, to }]).then((ok) => ok && onSelect({ kind: "transition", number }));
          }}
        >
          <option value="">Choose a state…</option>
          {view.states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id === state.id ? `${s.name} (itself)` : s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        {state.at && <button onClick={() => set({ at: null })}>Lay out again</button>}
        <button className="danger" onClick={() => void edit([{ op: "remove-state", view: view.id, id: state.id }]).then(() => onSelect(null))}>
          Delete state
        </button>
      </div>
    </>
  );
}

function TransitionProperties({ view, transition, edit, onSelect }: PropertiesProps & { view: ViewDef; transition: Transition }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-transition" }>, "op" | "view" | "transition">) =>
    void edit([{ op: "update-transition", view: view.id, transition: transition.number, ...fields }]);
  const count = view.transitions.length;
  const move = (to: number) => void edit([{ op: "update-transition", view: view.id, transition: transition.number, newTransition: to }]).then((ok) => ok && onSelect({ kind: "transition", number: to }));
  const end = (field: "from" | "to", label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={transition[field]} onChange={(e) => set({ [field]: e.target.value })}>
        {!view.states.some((s) => s.id === transition[field]) && <option value={transition[field]}>{transition[field]} (not a state)</option>}
        {view.states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Transition {transition.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      {end("from", "From")}
      {end("to", "To")}
      <Field label="Event" value={transition.event ?? ""} autoFocus={!transition.event} placeholder="What makes it happen, e.g. Payment taken" onCommit={(event) => set({ event: event || null })} />
      <Field label="Guard" value={transition.guard ?? ""} placeholder="What has to be true, e.g. paid in full" onCommit={(guard) => set({ guard: guard || null })} />
      <Field label="Action" value={transition.action ?? ""} placeholder="What's done as it happens, e.g. Send a receipt" onCommit={(action) => set({ action: action || null })} />
      <p className="muted small">The arrow is labelled as UML writes it: event [guard] / action.</p>
      <div className="actions">
        <button disabled={transition.number === 1} onClick={() => move(transition.number - 1)}>
          Move up
        </button>
        <button disabled={transition.number === count} onClick={() => move(transition.number + 1)}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-transition", view: view.id, transition: transition.number }]).then(() => onSelect(null))}>
          Delete transition
        </button>
      </div>
    </>
  );
}

function SeveralProperties({ elements, stickies, onSelect }: PropertiesProps & { elements: ArchElement[]; stickies: Sticky[] }) {
  return (
    <>
      <header className="props-header">
        <span className="badge">{shapesLabel(elements.length, stickies.length)}</span>
      </header>
      <p className="muted small">Drag any of them to move them all together. Ctrl-click (⌘-click on a Mac) or Shift-click a box or note to add it or take it out.</p>
      {elements.length > 0 && (
        <>
          <h3>Boxes</h3>
          <ul className="plain">
            {[...elements]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <li key={e.id}>
                  <button className="link" onClick={() => onSelect({ kind: "element", id: e.id })}>
                    {e.name}
                  </button>{" "}
                  <span className="muted small">[{kindLabel(e)}]</span>
                </li>
              ))}
          </ul>
        </>
      )}
      {stickies.length > 0 && (
        <>
          <h3>Sticky notes</h3>
          <ul className="plain">
            {stickies.map((s) => (
              <li key={s.id}>
                <button className="link one-line" onClick={() => onSelect({ kind: "sticky", id: s.id })} title={s.text}>
                  {s.text.trim().split("\n")[0]}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ViewProperties({ ws, view, computed, edit, onDeleteView, onSelect }: PropertiesProps & { view: ViewDef }) {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const retitle = (title: string) => {
    void edit(renameOps(ws, view.id, view.title, title, { op: "update-view", id: view.id, title }));
  };
  const changeId = (text: string) => {
    const to = idFromName(text);
    if (!to || to === view.id) return;
    void edit([{ op: "rename", id: view.id, to }]);
  };
  return (
    <>
      <header className="props-header">
        <span className="badge">View</span>
      </header>
      <Field label="Title" value={view.title} onCommit={retitle} />
      <Field label="ID" value={view.id} onCommit={changeId} hint={idHint(followsName(view.id, view.title))} />
      <Field
        label="Description"
        value={view.description ?? ""}
        multiline
        placeholder="One sentence, shown under the title"
        onCommit={(description) => void edit([{ op: "update-view", id: view.id, description: description || null }])}
      />
      <Field
        label="Notes"
        value={view.notes ?? ""}
        multiline
        rows={6}
        placeholder="Longer documentation, in markdown"
        onCommit={(notes) => void edit([{ op: "update-view", id: view.id, notes: notes || null }])}
      />
      {view.level !== "sequence" && view.level !== "state" && <NewElementsField view={view} edit={edit} />}
      {view.level === "state" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>state</dd>
            {scope && (
              <>
                <dt>The states of</dt>
                <dd>{scope.name}</dd>
              </>
            )}
            <dt>States</dt>
            <dd>{view.states.length}</dd>
            <dt>Transitions</dt>
            <dd>{view.transitions.length}</dd>
          </dl>
          <p className="muted small">
            A state view shows the states something can be in, and the transitions between them. Use + Add to add a state, and drag from the dot under a state to another to add a transition. Select a state or a transition to change it.
          </p>
        </>
      ) : view.level === "sequence" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>sequence</dd>
            <dt>Elements</dt>
            <dd>{computed?.nodes.length ?? 0}</dd>
            <dt>Steps</dt>
            <dd>{view.steps.length}</dd>
          </dl>
          <p className="muted small">
            A sequence shows what happens, in order. Each step goes along a relationship in the model. Drag from one lifeline to another to add a step there, or use + Add step. Select a step to change it, or move it up or down.
          </p>
        </>
      ) : (
        <BoxViewFacts {...{ ws, view, computed, scope }} />
      )}
      <div className="actions">
        <button onClick={() => onSelect({ kind: "workspace" })}>Workspace settings</button>
        <button className="danger" onClick={() => onDeleteView(view.id)}>
          Delete view…
        </button>
      </div>
    </>
  );
}

/** Whether elements added to the model later appear in this view. */
function NewElementsField({ view, edit }: { view: ViewDef; edit: PropertiesProps["edit"] }) {
  const mode = view.include.includes("*") ? "show" : "hide";
  return (
    <>
      <label className="field">
        <span className="field-label">New elements</span>
        <select value={mode} onChange={(e) => void edit([{ op: "update-view", id: view.id, newElements: e.target.value as NewElements }])}>
          <option value="show">Show here automatically</option>
          <option value="hide">Show only when added here</option>
        </select>
      </label>
      <p className="muted small">
        {mode === "show"
          ? "Elements added to the model later appear in this view on their own. Hide the ones you don't want."
          : "This view shows only the boxes it has now. Elements added to the model later stay out of it, unless you add them on this diagram or choose Show in this view."}
      </p>
    </>
  );
}

/** What a diagram of boxes shows, and how to arrange it. */
function BoxViewFacts({ ws, view, computed, scope }: { ws: Workspace; view: ViewDef; computed: ComputedView | null; scope?: ArchElement }) {
  return (
    <>
      <dl className="facts">
        <dt>Level</dt>
        <dd>{view.level}</dd>
        {scope && (
          <>
            <dt>Scope</dt>
            <dd>{scope.name}</dd>
          </>
        )}
        <dt>Shows</dt>
        <dd>{view.include.map((id) => ws.elements.get(id)?.name ?? id).join(", ") || "nothing"}</dd>
        {view.exclude.length > 0 && (
          <>
            <dt>Hides</dt>
            <dd>{view.exclude.map((id) => ws.elements.get(id)?.name ?? id).join(", ")}</dd>
          </>
        )}
        <dt>Boxes</dt>
        <dd>{computed?.nodes.length ?? 0}</dd>
      </dl>
      <p className="muted small">Select a box, arrow or sticky note to edit it. Drag boxes and notes to arrange them; their positions are saved with the view.</p>
      <p className="muted small">With a mouse, drag across the background to select several and move them together, or Ctrl-click (⌘-click on a Mac) each one. Scroll to move round the diagram, and Ctrl-scroll (⌘-scroll on a Mac) to zoom.</p>
    </>
  );
}

function WorkspaceProperties({ ws, edit, syncsDocs, docs, fileName }: PropertiesProps) {
  const suggestedDocs = `${fileName.replace(/\.openarch$/, "")}-docs`;
  const docsFolder = ws.doc.export?.docs;
  return (
    <>
      <header className="props-header">
        <span className="badge">Workspace</span>
        <code className="muted small">{fileName}</code>
      </header>
      <Field label="Name" value={ws.doc.name} onCommit={(name) => void edit([{ op: "update-workspace", name }])} />
      <Field label="Description" value={ws.doc.description ?? ""} multiline onCommit={(description) => void edit([{ op: "update-workspace", description: description || null }])} />
      <Field
        label="Docs folder"
        value={docsFolder ?? ""}
        placeholder={suggestedDocs}
        onCommit={(folder) => void edit([{ op: "update-workspace", docs: folder || null }])}
        hint={
          syncsDocs
            ? docsFolder
              ? "Relative to the workspace file. Every save rewrites the markdown docs there."
              : "Set a folder, relative to the workspace file, to keep markdown docs there."
            : "Used by the desktop app and the open-arch CLI. Here, use Export docs to download them."
        }
      />
      {syncsDocs && !docsFolder && <button onClick={() => void edit([{ op: "update-workspace", docs: suggestedDocs }])}>Keep docs in {suggestedDocs}/</button>}
      {syncsDocs && docs && (
        <p className="muted small">
          Last save {docs.written || docs.deleted ? `updated ${docs.written + docs.deleted} page${docs.written + docs.deleted === 1 ? "" : "s"}` : "left the docs unchanged"} in {docs.dir}.
          {docs.skipped.length > 0 && ` Left alone (not generated by open-arch): ${docs.skipped.join(", ")}.`}
        </p>
      )}
      <dl className="facts">
        <dt>Elements</dt>
        <dd>{ws.elements.size}</dd>
        <dt>Views</dt>
        <dd>{ws.views.size}</dd>
      </dl>
    </>
  );
}
