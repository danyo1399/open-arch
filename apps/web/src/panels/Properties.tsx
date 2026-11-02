import { describeElement, ELEMENT_SHAPES, kindLabel, PARENT_KIND, SHAPE_LABELS, STICKY_COLORS, type ArchElement, type ComputedView, type NewElements, type Operation, type Step, type Sticky, type ViewDef, type Workspace } from "@open-arch/core";
import type { DocsSummary } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import { byName, findArrow, followsName, idFromName, relationshipRef, shownInProperties, uniqueId, viewAction } from "../model.js";
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
  else if (shown.kind === "arrow") body = <ArrowProperties {...props} from={shown.from} to={shown.to} />;
  else if (shown.kind === "sticky") body = <StickyProperties {...props} view={shown.view} sticky={shown.sticky} />;
  else if (shown.kind === "step") body = <StepProperties {...props} view={shown.view} step={shown.step} />;
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
  const parentKind = PARENT_KIND[element.kind];
  const parents = parentKind ? [...ws.elements.values()].filter((e) => e.kind === parentKind).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const canHide = viewAction(ws, view, computed, element.id) === "hide";

  return (
    <>
      <header className="props-header">
        <span className={`badge badge-${element.external ? "external" : element.kind}`}>{kindLabel(element)}</span>
      </header>
      <Field label="Name" value={element.name} onCommit={rename} autoFocus={isNew} />
      <Field label="ID" value={element.id} onCommit={changeId} hint={idHint(followsName(element.id, element.name))} />
      <Field label="Description" value={element.description ?? ""} onCommit={(description) => set({ description: description || null })} multiline placeholder="One sentence, shown in the box" />
      {element.kind !== "person" && <Field label="Technology" value={element.technology ?? ""} onCommit={(technology) => set({ technology: technology || null })} placeholder="e.g. Node.js, PostgreSQL" />}
      {element.kind !== "person" && (
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
      {parentKind && (
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
      {!parentKind && (
        <label className="check">
          <input type="checkbox" checked={element.external} onChange={(e) => set({ external: e.target.checked })} />
          Outside our organisation (external)
        </label>
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
              <BothWays checked={rel.bidirectional} onChange={(bidirectional) => void edit([{ op: "update-relationship", ...ref, bidirectional }])} />
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

/** Whether a relationship goes both ways. */
function BothWays({ checked, onChange }: { checked: boolean; onChange(bidirectional: boolean): void }) {
  return (
    <label className="check" title="The other element uses this one too. Drawn with an arrowhead at each end.">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Goes both ways
    </label>
  );
}

function ArrowProperties({ ws, computed, from, to, edit, onSelect }: PropertiesProps & { from: string; to: string }) {
  const edge = findArrow(computed, from, to);
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
              <BothWays checked={rel.bidirectional} onChange={(bidirectional) => void edit([{ op: "update-relationship", ...ref, bidirectional }])} />
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
      {view.level !== "sequence" && <NewElementsField view={view} edit={edit} />}
      {view.level === "sequence" ? (
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
