import { describeElement, kindLabel, PARENT_KIND, STICKY_COLORS, type ArchElement, type ComputedView, type Operation, type Sticky, type ViewDef, type Workspace } from "@open-arch/core";
import type { DocsSummary } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import { followsName, idFromName, relationshipRef, uniqueId } from "../model.js";
import type { Edit } from "../state.js";
import { Field } from "./fields.js";

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
  onSelectView(id: string): void;
  onHide(id: string): void;
  onDelete(id: string): void;
  onDeleteView(id: string): void;
}

/**
 * The operations that give an element or view a new name (`update`), plus a rename
 * of its ID when the ID follows the name. Returns the ID it will have afterwards.
 */
function renameOps(ws: Workspace, id: string, oldName: string, newName: string, update: Operation): { ops: Operation[]; id: string } {
  const base = idFromName(newName);
  const next = base && followsName(id, oldName) ? uniqueId(ws, base, id) : id;
  return { ops: next === id ? [update] : [update, { op: "rename", id, to: next }], id: next };
}

function idHint(follows: boolean): string {
  return follows ? "Changes with the name." : "Doesn't match the name, so it stays put when you rename. Edit it to match and it follows the name again.";
}

export function Properties(props: PropertiesProps) {
  const { ws, selection } = props;
  let body;
  if (selection?.kind === "element" && ws.elements.has(selection.id)) body = <ElementProperties {...props} element={ws.elements.get(selection.id)!} />;
  else if (selection?.kind === "arrow") body = <ArrowProperties {...props} from={selection.from} to={selection.to} />;
  else if (selection?.kind === "sticky" && props.view?.stickies.some((s) => s.id === selection.id))
    body = <StickyProperties {...props} view={props.view} sticky={props.view.stickies.find((s) => s.id === selection.id)!} />;
  else if (selection?.kind === "workspace" || !props.view) body = <WorkspaceProperties {...props} />;
  else body = <ViewProperties {...props} view={props.view} />;
  return (
    <aside className="properties" aria-label="Properties">
      {body}
    </aside>
  );
}

function ElementProperties({ ws, element, computed, isNew, edit, onSelect, onHide, onDelete }: PropertiesProps & { element: ArchElement }) {
  const d = describeElement(ws, element.id)!;
  const set = (fields: Record<string, unknown>) => void edit([{ op: "update-element", id: element.id, ...fields }]);
  // An ID made from the name ("checkout-api") keeps following it, so the two don't drift apart.
  const rename = (name: string) => {
    const { ops, id } = renameOps(ws, element.id, element.name, name, { op: "update-element", id: element.id, name });
    void edit(ops).then((ok) => ok && id !== element.id && onSelect({ kind: "element", id }));
  };
  const changeId = (text: string) => {
    const to = idFromName(text);
    if (!to || to === element.id) return;
    void edit([{ op: "rename", id: element.id, to }]).then((ok) => ok && onSelect({ kind: "element", id: to }));
  };
  const parentKind = PARENT_KIND[element.kind];
  const parents = parentKind ? [...ws.elements.values()].filter((e) => e.kind === parentKind).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const inView = computed?.nodes.some((n) => n.id === element.id) ?? false;
  const props = Object.entries(element.properties).sort(([a], [b]) => a.localeCompare(b));

  return (
    <>
      <header className="props-header">
        <span className={`badge badge-${element.external ? "external" : element.kind}`}>{kindLabel(element)}</span>
      </header>
      <Field label="Name" value={element.name} onCommit={rename} autoFocus={isNew} />
      <Field label="ID" value={element.id} onCommit={changeId} hint={idHint(followsName(element.id, element.name))} />
      <Field label="Description" value={element.description ?? ""} onCommit={(description) => set({ description: description || null })} multiline placeholder="One sentence, shown in the box" />
      {element.kind !== "person" && <Field label="Technology" value={element.technology ?? ""} onCommit={(technology) => set({ technology: technology || null })} placeholder="e.g. Node.js, PostgreSQL" />}
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
        hint={
          <>
            The tag <code>database</code> draws a cylinder.
          </>
        }
      />
      <Field label="Notes" value={element.notes ?? ""} onCommit={(notes) => set({ notes: notes || null })} multiline rows={6} placeholder="Longer documentation, in markdown" />

      <h3>Properties</h3>
      {props.map(([key, value]) => (
        <div className="prop-row" key={key}>
          <Field label={key} value={value} onCommit={(v) => set({ properties: { [key]: v || null } })} />
          <button className="icon" aria-label={`Remove ${key}`} title="Remove" onClick={() => set({ properties: { [key]: null } })}>
            ×
          </button>
        </div>
      ))}
      <Field
        label="Add a property"
        value=""
        placeholder="key=value, e.g. owner=payments"
        onCommit={(text) => {
          const at = text.indexOf("=");
          if (at > 0 && text.slice(at + 1).trim()) set({ properties: { [text.slice(0, at).trim()]: text.slice(at + 1).trim() } });
        }}
      />

      <h3>Uses</h3>
      {d.uses.length === 0 && <p className="muted small">Nothing. Drag from the dot under a box to another box to add a relationship.</p>}
      <ul className="rels">
        {d.uses.map(({ rel, target }, i) => {
          const ref = relationshipRef(element, i);
          return (
            <li key={`${rel.to}-${i}`}>
              <button className="link" onClick={() => onSelect({ kind: "element", id: rel.to })}>
                → {target?.name ?? rel.to}
              </button>
              <Field label="Description" value={rel.description ?? ""} placeholder="e.g. Reads and writes orders" onCommit={(description) => void edit([{ op: "update-relationship", ...ref, description: description || null }])} />
              <Field label="Technology" value={rel.technology ?? ""} placeholder="e.g. HTTPS/JSON" onCommit={(technology) => void edit([{ op: "update-relationship", ...ref, technology: technology || null }])} />
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
          const source = ws.elements.get(element);
          const rel = source?.uses[index];
          if (!source || !rel) return null;
          const ref = relationshipRef(source, index);
          return (
            <li key={`${element}-${index}`}>
              {edge.implied && (
                <span className="small">
                  {name(element)} → {name(rel.to)}
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
      <Field label="Text" value={sticky.text} multiline rows={6} onCommit={(text) => text.trim() && set({ text })} hint="Double-click the note to edit it in place." />
      <fieldset className="field swatches">
        <legend className="field-label">Colour</legend>
        {STICKY_COLORS.map((color) => (
          <label key={color} className={`swatch sticky-${color}`} title={color[0]!.toUpperCase() + color.slice(1)}>
            <input type="radio" name="sticky-color" value={color} checked={sticky.color === color} onChange={() => set({ color })} aria-label={color} />
          </label>
        ))}
      </fieldset>
      <p className="muted small">Notes explain this diagram to the people reading it: what to look at, or why it's drawn this way. They belong to this view and aren't part of the model, so other views don't show them. The docs show them under the diagram.</p>
      <div className="actions">
        {sticky.at && <button onClick={() => set({ at: null })}>Move beside the diagram</button>}
        <button className="danger" onClick={() => void edit([{ op: "remove-sticky", view: view.id, id: sticky.id }]).then(() => onSelect(null))}>
          Delete note
        </button>
      </div>
    </>
  );
}

function ViewProperties({ ws, view, computed, edit, onDeleteView, onSelect, onSelectView }: PropertiesProps & { view: ViewDef }) {
  const scope = view.scope ? ws.elements.get(view.scope) : undefined;
  const retitle = (title: string) => {
    const { ops, id } = renameOps(ws, view.id, view.title, title, { op: "update-view", id: view.id, title });
    void edit(ops).then((ok) => ok && id !== view.id && onSelectView(id));
  };
  const changeId = (text: string) => {
    const to = idFromName(text);
    if (!to || to === view.id) return;
    void edit([{ op: "rename", id: view.id, to }]).then((ok) => ok && onSelectView(to));
  };
  return (
    <>
      <header className="props-header">
        <span className="badge">View</span>
      </header>
      <Field label="Title" value={view.title} onCommit={retitle} />
      <Field label="ID" value={view.id} onCommit={changeId} hint={idHint(followsName(view.id, view.title))} />
      <Field label="Description" value={view.description ?? ""} multiline onCommit={(description) => void edit([{ op: "update-view", id: view.id, description: description || null }])} />
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
      <p className="muted small">Select a box, arrow or sticky note to edit it. Drag boxes and notes to arrange them; their positions are saved with the view.</p>
      <div className="actions">
        <button onClick={() => onSelect({ kind: "workspace" })}>Workspace settings</button>
        <button className="danger" onClick={() => onDeleteView(view.id)}>
          Delete view…
        </button>
      </div>
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
