import {
  describeElement,
  kindLabel,
  PARENT_KIND,
  removeRelationship,
  renameId,
  suggestId,
  updateElement,
  updateRelationship,
  updateView,
  type ArchElement,
  type ComputedView,
  type ViewDef,
  type Workspace,
} from "@open-arch/core";
import type { Selection } from "../canvas/Canvas.js";
import { PLACEHOLDER_ID, uniqueId } from "../ids.js";
import { chain, type Edit } from "../state.js";
import { Field } from "./fields.js";

interface PropertiesProps {
  ws: Workspace;
  view: ViewDef | null;
  computed: ComputedView | null;
  selection: Selection;
  /** The element was just created: focus its name. */
  isNew: boolean;
  edit(fn: Edit): Promise<boolean>;
  onSelect(selection: Selection): void;
  onHide(id: string): void;
  onDelete(id: string): void;
  onDeleteView(id: string): void;
}

export function Properties(props: PropertiesProps) {
  const { ws, selection } = props;
  let body;
  if (selection?.kind === "element" && ws.elements.has(selection.id)) body = <ElementProperties {...props} element={ws.elements.get(selection.id)!} />;
  else if (selection?.kind === "arrow") body = <ArrowProperties {...props} from={selection.from} to={selection.to} />;
  else if (props.view) body = <ViewProperties {...props} view={props.view} />;
  else body = <p className="muted">Pick a view on the left.</p>;
  return (
    <aside className="properties" aria-label="Properties">
      {body}
    </aside>
  );
}

function ElementProperties({ ws, element, computed, isNew, edit, onSelect, onHide, onDelete }: PropertiesProps & { element: ArchElement }) {
  const d = describeElement(ws, element.id)!;
  const set = (fields: Parameters<typeof updateElement>[2]) => void edit((w) => updateElement(w, element.id, fields));
  // A new element's placeholder ID ("new-container") follows its first real name, so its file gets a meaningful name.
  const rename = (name: string) => {
    const id = suggestId(name);
    if (!PLACEHOLDER_ID.test(element.id) || PLACEHOLDER_ID.test(id) || !name.trim()) return set({ name });
    const next = uniqueId(ws, id);
    void edit((w) => chain(w, (x) => updateElement(x, element.id, { name }), (x) => renameId(x, element.id, next).changes)).then((ok) => ok && onSelect({ kind: "element", id: next }));
  };
  const parentKind = PARENT_KIND[element.kind];
  const parents = parentKind ? [...ws.elements.values()].filter((e) => e.kind === parentKind).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const inView = computed?.nodes.some((n) => n.id === element.id) ?? false;

  return (
    <>
      <header className="props-header">
        <span className={`badge badge-${element.external ? "external" : element.kind}`}>{kindLabel(element)}</span>
        <code className="muted small" title={element.path}>
          {element.id}
        </code>
      </header>
      <Field label="Name" value={element.name} onCommit={rename} autoFocus={isNew} />
      <Field label="Description" value={element.description ?? ""} onCommit={(description) => set({ description })} multiline placeholder="One sentence, shown in the box" />
      {element.kind !== "person" && <Field label="Technology" value={element.technology ?? ""} onCommit={(technology) => set({ technology })} placeholder="e.g. Node.js, PostgreSQL" />}
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
      <Field
        label="Tags"
        value={element.tags.join(", ")}
        onCommit={(text) => set({ tags: text.split(",").map((t) => t.trim()).filter(Boolean) })}
        placeholder="comma-separated"
        hint={<>The tag <code>database</code> draws a cylinder.</>}
      />

      <h3>Uses</h3>
      {d.uses.length === 0 && <p className="muted small">Nothing. Drag from the dot under a box to another box to add a relationship.</p>}
      <ul className="rels">
        {d.uses.map(({ rel, target }, i) => (
          <li key={`${rel.to}-${i}`}>
            <button className="link" onClick={() => onSelect({ kind: "element", id: rel.to })}>
              → {target?.name ?? rel.to}
            </button>
            <Field label="Description" value={rel.description ?? ""} placeholder="e.g. Reads and writes orders" onCommit={(description) => void edit((w) => updateRelationship(w, element.id, i, { description }))} />
            <Field label="Technology" value={rel.technology ?? ""} placeholder="e.g. HTTPS/JSON" onCommit={(technology) => void edit((w) => updateRelationship(w, element.id, i, { technology }))} />
            <button className="link danger" onClick={() => void edit((w) => removeRelationship(w, element.id, i))}>
              Remove relationship
            </button>
          </li>
        ))}
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
                <span className="muted small">{rel.description ?? ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="actions">
        {inView && computed?.boundary?.id !== element.id && <button onClick={() => onHide(element.id)}>Hide from this view</button>}
        <button className="danger" onClick={() => onDelete(element.id)}>
          Delete from model…
        </button>
      </div>
      <p className="muted small path">{element.path}</p>
    </>
  );
}

function ArrowProperties({ ws, computed, from, to, edit, onSelect }: PropertiesProps & { from: string; to: string }) {
  const edge = computed?.edges.find((e) => e.from === from && e.to === to);
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
        →{" "}
        <button className="link" onClick={() => onSelect({ kind: "element", id: to })}>
          {name(to)}
        </button>
      </p>
      {edge.implied && <p className="muted small">This arrow stands for relationships between elements inside these boxes. Edit them here or on those elements.</p>}
      <ul className="rels">
        {edge.sources.map(({ element, index }) => {
          const rel = ws.elements.get(element)?.uses[index];
          if (!rel) return null;
          return (
            <li key={`${element}-${index}`}>
              {edge.implied && (
                <span className="small">
                  {name(element)} → {name(rel.to)}
                </span>
              )}
              <Field label="Description" value={rel.description ?? ""} placeholder="e.g. Reads and writes orders" autoFocus={!rel.description && edge.sources.length === 1} onCommit={(description) => void edit((w) => updateRelationship(w, element, index, { description }))} />
              <Field label="Technology" value={rel.technology ?? ""} placeholder="e.g. HTTPS/JSON" onCommit={(technology) => void edit((w) => updateRelationship(w, element, index, { technology }))} />
              <button className="link danger" onClick={() => void edit((w) => removeRelationship(w, element, index)).then(() => onSelect(null))}>
                Remove relationship
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ViewProperties({ ws, view, computed, edit, onDeleteView }: PropertiesProps & { view: ViewDef }) {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  return (
    <>
      <header className="props-header">
        <span className="badge">View</span>
        <code className="muted small">{view.id}</code>
      </header>
      <Field label="Title" value={view.title} onCommit={(title) => void edit((w) => updateView(w, view.id, { title }))} />
      <Field label="Description" value={view.description ?? ""} multiline onCommit={(description) => void edit((w) => updateView(w, view.id, { description }))} />
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
        <dd>{view.include.join(", ") || "nothing"}</dd>
        {view.exclude.length > 0 && (
          <>
            <dt>Hides</dt>
            <dd>{view.exclude.map((id) => ws.elements.get(id)?.name ?? id).join(", ")}</dd>
          </>
        )}
        <dt>Boxes</dt>
        <dd>{computed?.nodes.length ?? 0}</dd>
      </dl>
      <p className="muted small">Select a box or arrow to edit it. Drag boxes to arrange them; positions are saved in the view file.</p>
      <div className="actions">
        <button className="danger" onClick={() => onDeleteView(view.id)}>
          Delete view…
        </button>
      </div>
      <p className="muted small path">{view.path}</p>
    </>
  );
}
