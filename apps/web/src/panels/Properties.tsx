import {
  allWidgets,
  ARROW_HEADS,
  ARROW_SIDES,
  arrowName,
  ATTRIBUTE_KEY_LABELS,
  ATTRIBUTE_KEYS,
  BLOCK_KIND_LABELS,
  BLOCK_KINDS,
  CARD_KIND_LABELS,
  CARD_KINDS,
  CARDINALITIES,
  CARDINALITY_LABELS,
  describeElement,
  ELEMENT_SHAPES,
  endShape,
  endSide,
  kindLabel,
  nodeKindLabel,
  PARENT_KINDS,
  RELATIONSHIP_KIND_LABELS,
  RELATIONSHIP_KINDS,
  RUNNABLE_KINDS,
  SCREEN_DEVICE_LABELS,
  SCREEN_DEVICES,
  SHAPE_COLORS,
  SHAPE_FILLS,
  SHAPE_KIND_LABELS,
  SHAPE_LABELS,
  shapeName,
  STICKY_COLORS,
  stickyAnchor,
  STICKY_TARGET_LEVELS,
  TEXT_SIZES,
  transitionLabel,
  WIDGET_HOLDERS,
  WIDGET_KIND_LABELS,
  WIDGET_KINDS,
  type ArchElement,
  type Arrow,
  type ArrowHeads,
  type ArrowSide,
  type Attribute,
  type AttributeKey,
  type Block,
  type BlockKind,
  type Card,
  type CardKind,
  type Cardinality,
  type ComputedView,
  type Connection,
  type DeploymentNode,
  type Entity,
  type EntityLink,
  type Flow,
  type Lane,
  type NewElements,
  type Operation,
  type Relationship,
  type RelationshipKind,
  type Screen,
  type ScreenDevice,
  type Shape,
  type ShapeColor,
  type ShapeFill,
  type ShapeKind,
  type State,
  type Transition,
  type Step,
  type Sticky,
  type StickyTargetData,
  type TextSize,
  type ViewDef,
  type ViewLevel,
  type Widget,
  type WidgetKind,
  type Workspace,
} from "@open-arch/core";
import { useState } from "react";
import type { DocsSummary } from "../bridge.js";
import type { Selection } from "../canvas/Canvas.js";
import {
  byName,
  cardArrowDeleteOps,
  findArrow,
  followsName,
  idFromName,
  LEVEL_NAMES,
  relationshipRef,
  shownInProperties,
  stickyChoices,
  stickyKey,
  stickyTargetFor,
  type NotesOwner,
  uniqueAmong,
  uniqueId,
  uniqueNodeId,
  uniqueStateId,
  viewAction,
  viewLevelsOf,
  whiteboardDeleteOps,
} from "../model.js";
import { SKILL_TARGETS } from "../skill.js";
import { docsProblem, type Edit } from "../state.js";
import { MenuButton } from "./ContextMenu.js";
import { Field, NotesField, TagsEditor } from "./fields.js";

interface PropertiesProps {
  ws: Workspace;
  view: ViewDef | null;
  computed: ComputedView | null;
  selection: Selection;
  /**
   * What's selected was just created: focus its name. As a number, 0 when it wasn't, and a number
   * of its own for each thing created, so the name of one made straight after another gets the
   * focus too.
   */
  isNew: boolean | number;
  /** Saving keeps a docs folder up to date: on desktop, and for a workspace in a folder. */
  syncsDocs: boolean;
  /** Saving also keeps the agent skill and AGENTS.md section up to date beside the workspace: on desktop, and for a workspace in a folder. */
  syncsSkill: boolean;
  docs: DocsSummary | null;
  /** The workspace's file, for display: for one in a folder, with the folder and the path in it. */
  fileName: string;
  edit(edit: Edit): Promise<boolean>;
  /** `isNew`: it was just created, so its name gets the focus. */
  onSelect(selection: Selection, options?: { isNew?: boolean }): void;
  /** These four are on an element's right-click menu too, which touch screens may have no way to open. */
  onHide(id: string): void;
  onDelete(id: string): void;
  onFindUsages(id: string): void;
  /** Makes a view of this level of the element, such as a component view of a container, and opens it. */
  onNewView(id: string, level: ViewLevel): void;
  /** Adds a note on a box, the frame or an arrow, beside it on the diagram. */
  onAddSticky(on: StickyTargetData): void;
  onDeleteView(id: string): void;
  /** Opens notes in the bigger editor, starting from this text. */
  onEditNotes(owner: NotesOwner, text: string): void;
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

/** `what` it follows: its name, or for a flowchart's block, its text. */
function idHint(follows: boolean, what = "name"): string {
  const change = what === "name" ? "rename" : `change the ${what}`;
  return follows ? `Changes with the ${what}.` : `Doesn't match the ${what}, so it stays put when you ${change}. Edit it to match and it follows the ${what} again.`;
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
  else if (shown.kind === "block") body = <BlockProperties {...props} view={shown.view} block={shown.block} />;
  else if (shown.kind === "flow") body = <FlowProperties {...props} view={shown.view} flow={shown.flow} />;
  else if (shown.kind === "entity") body = <EntityProperties {...props} view={shown.view} entity={shown.entity} />;
  else if (shown.kind === "attribute") body = <AttributeProperties {...props} view={shown.view} entity={shown.entity} attribute={shown.attribute} />;
  else if (shown.kind === "link") body = <LinkProperties {...props} view={shown.view} link={shown.link} />;
  else if (shown.kind === "node") body = <NodeProperties {...props} view={shown.view} node={shown.node} />;
  else if (shown.kind === "connection") body = <ConnectionProperties {...props} view={shown.view} connection={shown.connection} />;
  else if (shown.kind === "instance") body = <InstanceProperties {...props} view={shown.view} node={shown.node} element={shown.element} />;
  else if (shown.kind === "lane") body = <LaneProperties {...props} view={shown.view} lane={shown.lane} />;
  else if (shown.kind === "card") body = <CardProperties {...props} view={shown.view} card={shown.card} />;
  else if (shown.kind === "cardArrow") body = <CardArrowProperties {...props} view={shown.view} from={shown.from} to={shown.to} />;
  else if (shown.kind === "screen") body = <ScreenProperties {...props} view={shown.view} screen={shown.screen} />;
  else if (shown.kind === "widget") body = <WidgetProperties {...props} view={shown.view} widget={shown.widget} />;
  else if (shown.kind === "shape") body = <ShapeProperties {...props} view={shown.view} shape={shown.shape} />;
  else if (shown.kind === "boardArrow") body = <BoardArrowProperties {...props} view={shown.view} arrow={shown.arrow} />;
  else if (shown.kind === "board") body = <BoardProperties {...props} view={shown.view} shapes={shown.shapes} arrows={shown.arrows} stickies={shown.stickies} />;
  else if (shown.kind === "several") body = <SeveralProperties {...props} elements={shown.elements} stickies={shown.stickies} />;
  else if (shown.kind === "view") body = <ViewProperties {...props} view={shown.view} />;
  else body = <WorkspaceProperties {...props} />;
  return (
    <aside className="properties" aria-label="Properties">
      {body}
    </aside>
  );
}

function ElementProperties({ ws, view, element, computed, isNew, edit, onSelect, onHide, onDelete, onFindUsages, onNewView, onAddSticky, onEditNotes }: PropertiesProps & { element: ArchElement }) {
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
  const [addingLibrary, setAddingLibrary] = useState(false);
  /**
   * Adds a library built into this container, and opens its details, to name it and tick the other
   * containers built with it. Its ID and the container's libraries are worked out from the
   * workspace as it is when the edit runs, which can be after a tick made just before the press.
   * The button is off until then, so a double-click adds one library.
   */
  const newLibrary = () => {
    let id = "";
    setAddingLibrary(true);
    void edit((now) => {
      const container = now.elements.get(element.id);
      if (container?.kind !== "container") return [];
      id = uniqueId(now, "new-library");
      return [
        { op: "add-element", id, kind: "library", name: "New library" },
        { op: "update-element", id: container.id, libraries: [...container.libraries, id] },
      ];
    })
      .then((ok) => ok && id && onSelect({ kind: "element", id }, { isNew: true }))
      .finally(() => setAddingLibrary(false));
  };
  const canHide = viewAction(ws, view, computed, element.id) === "hide";
  const noteOn = stickyTargetFor(ws, computed, { kind: "element", id: element.id });

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
      {element.kind === "container" && (
        <fieldset className="field">
          <legend className="field-label">Libraries</legend>
          {libraries.map((l) => (
            <label key={l.id} className="check">
              <input type="checkbox" checked={element.libraries.includes(l.id)} onChange={(e) => build(element, l.id, e.target.checked)} />
              {l.name}
            </label>
          ))}
          <button className="link" onClick={newLibrary} disabled={addingLibrary}>
            + New library
          </button>
          <span className="field-hint">The shared libraries built into it: code several containers are built with, like a logging library. Its component views draw each one inside the frame.</span>
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
      <NotesField value={element.notes ?? ""} onCommit={(notes) => set({ notes: notes || null })} rows={6} onExpand={(text) => onEditNotes({ kind: "element", id: element.id }, text)} />

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
        {noteOn && <button onClick={() => onAddSticky(noteOn)}>Add sticky note</button>}
        <MenuButton items={viewLevelsOf(element).map((level) => ({ label: LEVEL_NAMES[level], onSelect: () => onNewView(element.id, level) }))} title={`Make a view of ${element.name}, and open it`}>
          New view
        </MenuButton>
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

function ArrowProperties({ ws, computed, from, to, relation, edit, onSelect, onAddSticky, onEditNotes }: PropertiesProps & { from: string; to: string; relation?: RelationshipKind }) {
  const edge = findArrow(computed, from, to, relation);
  if (!edge) return <p className="muted">This arrow is no longer in the view.</p>;
  const name = (id: string) => ws.elements.get(id)?.name ?? id;
  const noteOn = stickyTargetFor(ws, computed, { kind: "arrow", from, to, relation });
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
      {computed?.deployment ? (
        <p className="muted small">This view joins each copy of {name(from)} to the copies of {name(to)} that run nearest it.</p>
      ) : (
        <p className="muted small">
          Drag the dot at either end of the arrow to another box to move that end there.{edge.sources.length > 1 && " Every relationship the arrow stands for moves with it."}
        </p>
      )}
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
              <NotesField
                value={rel.notes ?? ""}
                rows={4}
                onCommit={(notes) => void edit([{ op: "update-relationship", ...ref, notes: notes || null }])}
                onExpand={(text) => onEditNotes({ kind: "relationship", ...ref }, text)}
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
      {noteOn && (
        <div className="actions">
          <button onClick={() => onAddSticky(noteOn)}>Add sticky note</button>
        </div>
      )}
    </>
  );
}

function StickyProperties({ ws, view, computed, sticky, edit, onSelect, onEditNotes }: PropertiesProps & { view: ViewDef; sticky: Sticky }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-sticky" }>, "op" | "view" | "id">) => void edit([{ op: "update-sticky", view: view.id, id: sticky.id, ...fields }]);
  // Views of boxes draw a line from a note to the box or arrow it's on.
  const choices = computed && STICKY_TARGET_LEVELS.includes(view.level) ? stickyChoices(ws, computed, sticky) : null;
  const drawn = !!(computed && sticky.on && stickyAnchor(ws, computed, sticky.on));
  const group = (name: "Boxes" | "Arrows") => {
    const items = choices!.filter((c) => c.group === name);
    return (
      items.length > 0 && (
        <optgroup label={name}>
          {items.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </optgroup>
      )
    );
  };
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
      {choices && (
        <label className="field">
          <span className="field-label">On</span>
          <select value={sticky.on ? stickyKey(sticky.on) : ""} onChange={(e) => set({ on: choices.find((c) => c.key === e.target.value)?.on ?? null })}>
            <option value="">Nothing: the whole diagram</option>
            {choices
              .filter((c) => !c.group)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            {group("Boxes")}
            {group("Arrows")}
          </select>
          <span className="field-hint">
            {!sticky.on ? "Pick a box or an arrow, or drag from the dot under the note to one, and a line joins them." : drawn ? "A line joins the note to the box or arrow it's on." : "This view doesn't draw it, so no line joins them."}
          </span>
        </label>
      )}
      <fieldset className="field swatches">
        <legend className="field-label">Colour</legend>
        {STICKY_COLORS.map((color) => (
          <label key={color} className={`swatch sticky-${color}`} title={color[0]!.toUpperCase() + color.slice(1)}>
            <input type="radio" name="sticky-color" value={color} checked={sticky.color === color} onChange={() => set({ color })} aria-label={color} />
          </label>
        ))}
      </fieldset>
      <NotesField value={sticky.notes ?? ""} onCommit={(notes) => set({ notes: notes || null })} rows={4} onExpand={(text) => onEditNotes({ kind: "sticky", view: view.id, id: sticky.id }, text)} />
      <p className="muted small">Sticky notes explain this diagram to the people reading it: what to look at, or why it's drawn this way. They belong to this view and aren't part of the model, so other views don't show them. The docs show them under the diagram, with their notes.</p>
      <div className="actions">
        {sticky.at && view.level !== "sequence" && <button onClick={() => set({ at: null })}>{drawn ? "Move next to what it's on" : "Move beside the diagram"}</button>}
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

/** What each kind of block is for, under the list to pick one from. */
const BLOCK_KIND_HINTS: Record<BlockKind, string> = {
  start: "Where the process starts. Drawn as a pill.",
  end: "Where the process ends. Drawn as a pill.",
  process: "A step: something that's done, like Pack the order.",
  decision: "A question with more than one way on, like In stock? Give each flow out of it the answer it's for.",
  "input-output": "Something that comes in or goes out, like Read the card details.",
  subprocess: "A process drawn in full somewhere else, like another flowchart.",
  document: "A document or report that's made or read.",
  database: "Data that's kept, like a database.",
};

/** A block's text on one line, as lists name it. */
const blockText = (b: Pick<Block, "id" | "text">) => b.text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? b.id;

function BlockProperties({ view, block, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; block: Block }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-block" }>, "op" | "view" | "id">) => void edit([{ op: "update-block", view: view.id, id: block.id, ...fields }]);
  const ids = view.blocks.map((b) => b.id);
  // An ID made from the text keeps following it, as a state's does; the selection follows the ID.
  const retext = (text: string) => {
    const base = idFromName(text);
    const newId = base && followsName(block.id, block.text) ? uniqueAmong(ids, base, block.id) : block.id;
    void edit([{ op: "update-block", view: view.id, id: block.id, text, ...(newId !== block.id && { newId }) }]).then((ok) => ok && newId !== block.id && onSelect({ kind: "block", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === block.id) return;
    void edit([{ op: "update-block", view: view.id, id: block.id, newId }]).then((ok) => ok && onSelect({ kind: "block", id: newId }));
  };
  const name = (id: string) => {
    const b = view.blocks.find((x) => x.id === id);
    return b ? blockText(b) : id;
  };
  const out = view.flows.filter((f) => f.from === block.id);
  const into = view.flows.filter((f) => f.to === block.id && f.from !== block.id);
  const flowLink = (f: Flow, other: string, arrow: string) => (
    <li key={f.number}>
      <button className="link" onClick={() => onSelect({ kind: "flow", number: f.number })}>
        {arrow} {name(other)}
      </button>{" "}
      {f.text && <span className="muted small">{f.text}</span>}
    </li>
  );
  return (
    <>
      <header className="props-header">
        <span className={`badge badge-block flow-badge-${block.kind}`}>{BLOCK_KIND_LABELS[block.kind]}</span>
      </header>
      <Field label="Text" value={block.text} multiline rows={2} onCommit={(t) => (t.trim() ? retext(t) : false)} autoFocus={isNew} placeholder={block.kind === "decision" ? "The question, e.g. In stock?" : "What's done, e.g. Pack the order"} />
      <Field label="ID" value={block.id} onCommit={changeId} hint={idHint(followsName(block.id, block.text), "text")} />
      <label className="field">
        <span className="field-label">Kind</span>
        <select value={block.kind} onChange={(e) => set({ kind: e.target.value as BlockKind })}>
          {BLOCK_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {BLOCK_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <span className="field-hint">{BLOCK_KIND_HINTS[block.kind]}</span>
      </label>
      <Field label="Description" value={block.description ?? ""} multiline placeholder="One sentence, shown under its text" onCommit={(description) => set({ description: description || null })} />
      {(view.lanes.length > 0 || block.lane !== undefined) && (
        <label className="field">
          <span className="field-label">Lane</span>
          {/* Its place was in its old lane, where it could land on a block in the new one: it's laid out again. */}
          <select value={block.lane ?? ""} onChange={(e) => set({ lane: e.target.value || null, at: null })}>
            <option value="">(no lane)</option>
            {block.lane !== undefined && !view.lanes.some((l) => l.id === block.lane) && <option value={block.lane}>{block.lane} (not a lane of this view)</option>}
            {view.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <h3>Flows</h3>
      {out.length + into.length === 0 && <p className="muted small">None yet. Drag from the dot under this block to another block to add one.</p>}
      <ul className="plain">
        {out.map((f) => flowLink(f, f.to, "→"))}
        {into.map((f) => flowLink(f, f.from, "←"))}
      </ul>
      <label className="field">
        <span className="field-label">Add a flow to</span>
        <select
          value=""
          onChange={(e) => {
            const to = e.target.value;
            if (!to) return;
            const number = view.flows.length + 1;
            void edit([{ op: "add-flow", view: view.id, from: block.id, to }]).then((ok) => ok && onSelect({ kind: "flow", number }));
          }}
        >
          <option value="">Choose a block…</option>
          {view.blocks
            .filter((b) => b.id !== block.id)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {blockText(b)}
              </option>
            ))}
        </select>
      </label>
      <div className="actions">
        {block.at && <button onClick={() => set({ at: null })}>Lay out again</button>}
        <button className="danger" onClick={() => void edit([{ op: "remove-block", view: view.id, id: block.id }]).then(() => onSelect(null))}>
          Delete block
        </button>
      </div>
    </>
  );
}

function FlowProperties({ view, flow, edit, onSelect }: PropertiesProps & { view: ViewDef; flow: Flow }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-flow" }>, "op" | "view" | "flow">) => void edit([{ op: "update-flow", view: view.id, flow: flow.number, ...fields }]);
  const count = view.flows.length;
  const move = (to: number) => void edit([{ op: "update-flow", view: view.id, flow: flow.number, newFlow: to }]).then((ok) => ok && onSelect({ kind: "flow", number: to }));
  const fromDecision = view.blocks.find((b) => b.id === flow.from)?.kind === "decision";
  const end = (field: "from" | "to", label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={flow[field]} onChange={(e) => set({ [field]: e.target.value })}>
        {!view.blocks.some((b) => b.id === flow[field]) && <option value={flow[field]}>{flow[field]} (not a block)</option>}
        {view.blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {blockText(b)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Flow {flow.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      {end("from", "From")}
      {end("to", "To")}
      <Field
        label="Text"
        value={flow.text ?? ""}
        autoFocus={!flow.text}
        placeholder={fromDecision ? "The answer it's for, e.g. Yes or No" : "What it says, if anything"}
        hint={fromDecision ? "It's a way out of a decision, so say which answer it's for." : undefined}
        onCommit={(text) => set({ text: text || null })}
      />
      <div className="actions">
        <button disabled={flow.number === 1} onClick={() => move(flow.number - 1)}>
          Move up
        </button>
        <button disabled={flow.number === count} onClick={() => move(flow.number + 1)}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-flow", view: view.id, flow: flow.number }]).then(() => onSelect(null))}>
          Delete flow
        </button>
      </div>
    </>
  );
}

/** An attribute as lists name it: its keys, its name and its type. */
function attributeLabel(a: Attribute): string {
  return `${a.keys.length ? `${a.keys.map((k) => k.toUpperCase()).join(", ")} ` : ""}${a.name}${a.type ? `: ${a.type}` : ""}`;
}

/** An entity's name, by its ID, or the ID when the view has no such entity. */
function entityName(view: ViewDef, id: string): string {
  return view.entities.find((e) => e.id === id)?.name ?? id;
}

function EntityProperties({ view, entity, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; entity: Entity }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-entity" }>, "op" | "view" | "id">) => void edit([{ op: "update-entity", view: view.id, id: entity.id, ...fields }]);
  const others = view.entities.map((e) => e.id);
  // An ID made from the name keeps following it, as a screen's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(entity.id, entity.name) ? uniqueAmong(others, base, entity.id) : entity.id;
    void edit([{ op: "update-entity", view: view.id, id: entity.id, name, ...(newId !== entity.id && { newId }) }]).then((ok) => ok && newId !== entity.id && onSelect({ kind: "entity", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === entity.id) return;
    void edit([{ op: "update-entity", view: view.id, id: entity.id, newId }]).then((ok) => ok && onSelect({ kind: "entity", id: newId }));
  };
  // The box empties once the attribute is added, ready for the next.
  const addAttribute = (text: string) => {
    const name = text.trim();
    if (name) void edit([{ op: "add-attribute", view: view.id, entity: entity.id, name }]);
    return false;
  };
  const out = view.links.filter((l) => l.from === entity.id);
  const into = view.links.filter((l) => l.to === entity.id && l.from !== entity.id);
  const linkItem = (l: EntityLink, other: string, arrow: string) => (
    <li key={l.number}>
      <button className="link" onClick={() => onSelect({ kind: "link", number: l.number })}>
        {arrow} {other === entity.id ? "itself" : entityName(view, other)}
      </button>{" "}
      {l.text && <span className="muted small">{l.text}</span>}
    </li>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Entity</span>
      </header>
      <Field label="Name" value={entity.name} onCommit={(n) => (n.trim() ? rename(n) : false)} autoFocus={isNew} placeholder="What's kept, e.g. Order" />
      <Field label="ID" value={entity.id} onCommit={changeId} hint={idHint(followsName(entity.id, entity.name))} />
      <Field label="Description" value={entity.description ?? ""} multiline placeholder="One sentence, shown under its name" onCommit={(description) => set({ description: description || null })} />
      <h3>Attributes</h3>
      {entity.attributes.length === 0 && <p className="muted small">None yet. Name one below, or use + Add with the entity selected.</p>}
      <ul className="plain">
        {entity.attributes.map((a) => (
          <li key={a.name}>
            <button className="link" onClick={() => onSelect({ kind: "attribute", entity: entity.id, name: a.name })}>
              {attributeLabel(a)}
            </button>
          </li>
        ))}
      </ul>
      <Field label="Add an attribute" value="" placeholder="Its name, e.g. email" onCommit={addAttribute} hint="Press Enter to add it, then name the next." />
      <h3>Links</h3>
      {out.length + into.length === 0 && <p className="muted small">None yet. Drag from the dot under this entity to another to add one.</p>}
      <ul className="plain">
        {out.map((l) => linkItem(l, l.to, "→"))}
        {into.map((l) => linkItem(l, l.from, "←"))}
      </ul>
      <label className="field">
        <span className="field-label">Add a link to</span>
        <select
          value=""
          onChange={(e) => {
            const to = e.target.value;
            if (!to) return;
            const number = view.links.length + 1;
            void edit([{ op: "add-link", view: view.id, from: entity.id, to }]).then((ok) => ok && onSelect({ kind: "link", number }));
          }}
        >
          <option value="">Choose an entity…</option>
          {view.entities.map((e) => (
            <option key={e.id} value={e.id}>
              {e.id === entity.id ? `${e.name} (itself)` : e.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        {entity.at && <button onClick={() => set({ at: null })}>Lay out again</button>}
        <button className="danger" onClick={() => void edit([{ op: "remove-entity", view: view.id, id: entity.id }]).then(() => onSelect(null))}>
          Delete entity
        </button>
      </div>
      {out.length + into.length > 0 && <p className="muted small">Deleting the entity deletes its links too.</p>}
    </>
  );
}

/** What each kind of key means, beside its box to tick. */
const KEY_HINTS: Record<AttributeKey, string> = {
  pk: "It tells one from another, alone or with the other primary key attributes.",
  fk: "It names one of another entity, like an order's customer.",
  uk: "No two have the same.",
};

function AttributeProperties({ view, entity, attribute, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; entity: Entity; attribute: Attribute }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-attribute" }>, "op" | "view" | "entity" | "name">) =>
    void edit([{ op: "update-attribute", view: view.id, entity: entity.id, name: attribute.name, ...fields }]);
  // The selection follows the new name.
  const rename = (text: string) => {
    const name = text.trim();
    if (!name) return false;
    if (name === attribute.name) return;
    void edit([{ op: "update-attribute", view: view.id, entity: entity.id, name: attribute.name, newName: name }]).then((ok) => ok && onSelect({ kind: "attribute", entity: entity.id, name }));
  };
  const toggle = (key: AttributeKey, on: boolean) => set({ keys: ATTRIBUTE_KEYS.filter((k) => (k === key ? on : attribute.keys.includes(k))) });
  const count = entity.attributes.length;
  return (
    <>
      <header className="props-header">
        <span className="badge">Attribute {attribute.number}</span>
        <span className="muted small">
          of {count}, in{" "}
          <button className="link" onClick={() => onSelect({ kind: "entity", id: entity.id })}>
            {entity.name}
          </button>
        </span>
      </header>
      <Field label="Name" value={attribute.name} onCommit={rename} autoFocus={isNew} placeholder="What's kept, e.g. email" />
      <Field label="Type" value={attribute.type ?? ""} placeholder="What it holds, e.g. text or uuid" onCommit={(type) => set({ type: type.trim() || null })} />
      <fieldset className="field">
        <legend className="field-label">Keys</legend>
        {ATTRIBUTE_KEYS.map((key) => (
          <label key={key} className="check" title={KEY_HINTS[key]}>
            <input type="checkbox" checked={attribute.keys.includes(key)} onChange={(e) => toggle(key, e.target.checked)} /> {ATTRIBUTE_KEY_LABELS[key]} ({key.toUpperCase()})
          </label>
        ))}
      </fieldset>
      <Field label="Description" value={attribute.description ?? ""} multiline placeholder="What it means, if its name doesn't say" onCommit={(description) => set({ description: description || null })} />
      <div className="actions">
        <button disabled={attribute.number === 1} onClick={() => set({ position: attribute.number - 1 })}>
          Move up
        </button>
        <button disabled={attribute.number === count} onClick={() => set({ position: attribute.number + 1 })}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-attribute", view: view.id, entity: entity.id, name: attribute.name }]).then(() => onSelect({ kind: "entity", id: entity.id }))}>
          Delete attribute
        </button>
      </div>
    </>
  );
}

function LinkProperties({ view, link, edit, onSelect }: PropertiesProps & { view: ViewDef; link: EntityLink }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-link" }>, "op" | "view" | "link">) => void edit([{ op: "update-link", view: view.id, link: link.number, ...fields }]);
  const count = view.links.length;
  const move = (to: number) => void edit([{ op: "update-link", view: view.id, link: link.number, newLink: to }]).then((ok) => ok && onSelect({ kind: "link", number: to }));
  const [fromName, toName] = [entityName(view, link.from), entityName(view, link.to)];
  const end = (field: "from" | "to", label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={link[field]} onChange={(e) => set({ [field]: e.target.value })}>
        {!view.entities.some((e) => e.id === link[field]) && <option value={link[field]}>{link[field]} (not an entity)</option>}
        {view.entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
  // How many of one end there can be, for each one of the other.
  const howMany = (i: 0 | 1, label: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        value={link.cardinality[i]}
        onChange={(e) => {
          const next: [Cardinality, Cardinality] = [...link.cardinality];
          next[i] = e.target.value as Cardinality;
          set({ cardinality: next });
        }}
      >
        {CARDINALITIES.map((c) => (
          <option key={c} value={c}>
            {CARDINALITY_LABELS[c]}
          </option>
        ))}
      </select>
      <span className="field-hint">{hint}</span>
    </label>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Link {link.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      {end("from", "From")}
      {howMany(0, `How many ${fromName}`, `For each ${toName}. Drawn at the ${fromName} end.`)}
      {end("to", "To")}
      {howMany(1, `How many ${toName}`, `For each ${fromName}. Drawn at the ${toName} end.`)}
      <Field label="Text" value={link.text ?? ""} autoFocus={!link.text} placeholder="What it says, e.g. places" onCommit={(text) => set({ text: text || null })} />
      <div className="actions">
        <button disabled={link.number === 1} onClick={() => move(link.number - 1)}>
          Move up
        </button>
        <button disabled={link.number === count} onClick={() => move(link.number + 1)}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-link", view: view.id, link: link.number }]).then(() => onSelect(null))}>
          Delete link
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

/** The nodes of a deployment view, and the containers and systems they run, for picking a connection's end. */
function connectionEnds(ws: Workspace, view: ViewDef): { id: string; label: string }[] {
  const run = [...new Set(view.nodes.flatMap((n) => n.runs))].flatMap((id) => ws.elements.get(id) ?? []).sort(byName);
  return [...view.nodes.map((n) => ({ id: n.id, label: `${n.name} [${nodeKindLabel(n)}]` })), ...run.map((e) => ({ id: e.id, label: `${e.name} [${kindLabel(e)}]` }))];
}

/** A connection's end, by name: a node's, or an element's. */
function endName(ws: Workspace, view: ViewDef, id: string): string {
  return view.nodes.find((n) => n.id === id)?.name ?? ws.elements.get(id)?.name ?? id;
}

function NodeProperties({ ws, view, node, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; node: DeploymentNode }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-node" }>, "op" | "view" | "id">) => void edit([{ op: "update-node", view: view.id, id: node.id, ...fields }]);
  // An ID made from the name keeps following it, as an element's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(node.id, node.name) ? uniqueNodeId(ws, view, base, node.id) : node.id;
    void edit([{ op: "update-node", view: view.id, id: node.id, name, ...(newId !== node.id && { newId }) }]).then((ok) => ok && newId !== node.id && onSelect({ kind: "node", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === node.id) return;
    void edit([{ op: "update-node", view: view.id, id: node.id, newId }]).then((ok) => ok && onSelect({ kind: "node", id: newId }));
  };
  /** Whether a node is this one, or inside it, so this one can't go inside it. */
  const within = (id: string | undefined): boolean => id !== undefined && (id === node.id || within(view.nodes.find((n) => n.id === id)?.parent));
  const parents = view.nodes.filter((n) => !n.infrastructure && !within(n.id));
  const holdsNodes = view.nodes.some((n) => n.parent === node.id);
  const runnable = [...ws.elements.values()].filter((e) => RUNNABLE_KINDS.includes(e.kind) && !node.runs.includes(e.id)).sort(byName);
  const connections = view.connections.filter((c) => c.from === node.id || c.to === node.id);
  const ends = connectionEnds(ws, view).filter((e) => e.id !== node.id);
  return (
    <>
      <header className="props-header">
        <span className={`badge badge-${node.infrastructure ? "infrastructure" : "node"}`}>{nodeKindLabel(node)}</span>
      </header>
      <Field label="Name" value={node.name} onCommit={(n) => n.trim() && rename(n)} autoFocus={isNew} />
      <Field label="ID" value={node.id} onCommit={changeId} hint={idHint(followsName(node.id, node.name))} />
      <Field label="Description" value={node.description ?? ""} multiline placeholder="One sentence, shown when you point at it" onCommit={(description) => set({ description: description || null })} />
      <Field label="Technology" value={node.technology ?? ""} placeholder="e.g. Ubuntu 24.04, Amazon ECS" onCommit={(technology) => set({ technology: technology || null })} />
      <Field
        label="Copies"
        value={String(node.instances)}
        hint="How many copies of it run, with everything inside."
        onCommit={(text) => {
          const n = Number(text.trim() || "1");
          if (!Number.isInteger(n) || n < 1) return false;
          set({ instances: n === 1 ? null : n });
        }}
      />
      <label className="field">
        <span className="field-label">Shape</span>
        <select value={node.shape} onChange={(e) => set({ shape: e.target.value === "box" ? null : (e.target.value as DeploymentNode["shape"]) })}>
          {ELEMENT_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {SHAPE_LABELS[shape]}
            </option>
          ))}
        </select>
        <span className="field-hint">Drawn when it holds nothing, as infrastructure doesn't.</span>
      </label>
      <label className="field">
        <span className="field-label">Inside</span>
        <select value={node.parent ?? ""} onChange={(e) => set({ parent: e.target.value || null })}>
          <option value="">(nothing: at the top)</option>
          {parents.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={node.infrastructure} disabled={!node.infrastructure && (node.runs.length > 0 || holdsNodes)} onChange={(e) => set({ infrastructure: e.target.checked })} />
        Infrastructure, like a load balancer, DNS or a firewall
      </label>
      {!node.infrastructure && (node.runs.length > 0 || holdsNodes) && <span className="field-hint">Infrastructure runs nothing and holds no nodes, so take those out of it first.</span>}
      {!node.infrastructure && (
        <>
          <h3>Runs</h3>
          {node.runs.length === 0 && <p className="muted small">Nothing yet. Choose a container or system to run in it.</p>}
          <ul className="plain">
            {node.runs.map((id) => (
              <li key={id}>
                <button className="link" onClick={() => onSelect({ kind: "instance", node: node.id, element: id })}>
                  {ws.elements.get(id)?.name ?? id}
                </button>{" "}
                <button className="link danger" onClick={() => set({ runs: node.runs.filter((r) => r !== id) })}>
                  Stop running it here
                </button>
              </li>
            ))}
          </ul>
          <label className="field">
            <span className="field-label">Run here</span>
            <select value="" onChange={(e) => e.target.value && set({ runs: [...node.runs, e.target.value] })}>
              <option value="">Choose a container or system…</option>
              {runnable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} [{kindLabel(e)}]
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <h3>Connections</h3>
      {connections.length === 0 && <p className="muted small">None yet. Drag from the dot under it to a box or node to add one.</p>}
      <ul className="plain">
        {connections.map((c) => (
          <li key={c.number}>
            <button className="link" onClick={() => onSelect({ kind: "connection", number: c.number })}>
              {c.from === node.id ? `→ ${endName(ws, view, c.to)}` : `← ${endName(ws, view, c.from)}`}
            </button>{" "}
            <span className="muted small">{c.description}</span>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="field-label">Add a connection to</span>
        <select
          value=""
          onChange={(e) => {
            const to = e.target.value;
            if (!to) return;
            const number = view.connections.length + 1;
            void edit([{ op: "add-connection", view: view.id, from: node.id, to }]).then((ok) => ok && onSelect({ kind: "connection", number }));
          }}
        >
          <option value="">Choose a node, container or system…</option>
          {ends.map((end) => (
            <option key={end.id} value={end.id}>
              {end.label}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="danger" onClick={() => void edit([{ op: "remove-node", view: view.id, id: node.id }]).then(() => onSelect(null))}>
          {holdsNodes ? "Delete node and what's inside" : "Delete node"}
        </button>
      </div>
    </>
  );
}

function ConnectionProperties({ ws, view, connection, edit, onSelect }: PropertiesProps & { view: ViewDef; connection: Connection }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-connection" }>, "op" | "view" | "connection">) =>
    void edit([{ op: "update-connection", view: view.id, connection: connection.number, ...fields }]);
  const count = view.connections.length;
  const move = (to: number) => void edit([{ op: "update-connection", view: view.id, connection: connection.number, newConnection: to }]).then((ok) => ok && onSelect({ kind: "connection", number: to }));
  const ends = connectionEnds(ws, view);
  const end = (field: "from" | "to", label: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={connection[field]} onChange={(e) => set({ [field]: e.target.value })}>
        {!ends.some((e) => e.id === connection[field]) && <option value={connection[field]}>{connection[field]} (not in this view)</option>}
        {ends.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Connection {connection.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      {end("from", "From")}
      {end("to", "To")}
      <Field label="Description" value={connection.description ?? ""} autoFocus={!connection.description} placeholder="e.g. Forwards requests to" onCommit={(description) => set({ description: description || null })} />
      <Field label="Technology" value={connection.technology ?? ""} placeholder="e.g. HTTPS" onCommit={(technology) => set({ technology: technology || null })} />
      <p className="muted small">A connection is an arrow to or from a node of this view. Arrows between two containers come from the model's relationships.</p>
      <div className="actions">
        <button disabled={connection.number === 1} onClick={() => move(connection.number - 1)}>
          Move up
        </button>
        <button disabled={connection.number === count} onClick={() => move(connection.number + 1)}>
          Move down
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-connection", view: view.id, connection: connection.number }]).then(() => onSelect(null))}>
          Delete connection
        </button>
      </div>
    </>
  );
}

/** A container or system running in a node: where it runs, then the element itself. */
function InstanceProperties(props: PropertiesProps & { view: ViewDef; node: DeploymentNode; element: ArchElement }) {
  const { view, node, element, edit, onSelect } = props;
  return (
    <>
      <div className="instance-of">
        <p className="small">
          Runs in{" "}
          <button className="link" onClick={() => onSelect({ kind: "node", id: node.id })}>
            {node.name}
          </button>
          {node.instances > 1 ? `, ${node.instances} copies` : ""}.
        </p>
        <button onClick={() => void edit([{ op: "update-node", view: view.id, id: node.id, runs: node.runs.filter((id) => id !== element.id) }]).then(() => onSelect({ kind: "node", id: node.id }))}>
          Stop running it here
        </button>
      </div>
      <ElementProperties {...props} element={element} />
    </>
  );
}

function LaneProperties({ view, lane, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; lane: Lane }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-lane" }>, "op" | "view" | "id">) => void edit([{ op: "update-lane", view: view.id, id: lane.id, ...fields }]);
  const others = view.lanes.map((l) => l.id);
  // An ID made from the name keeps following it, as an element's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(lane.id, lane.name) ? uniqueAmong(others, base, lane.id) : lane.id;
    void edit([{ op: "update-lane", view: view.id, id: lane.id, name, ...(newId !== lane.id && { newId }) }]).then((ok) => ok && newId !== lane.id && onSelect({ kind: "lane", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === lane.id) return;
    void edit([{ op: "update-lane", view: view.id, id: lane.id, newId }]).then((ok) => ok && onSelect({ kind: "lane", id: newId }));
  };
  const cards = view.cards.filter((c) => c.lane === lane.id);
  // A flowchart's lanes are columns, left to right, and hold blocks.
  const flowchart = view.level === "flowchart";
  const blocks = view.blocks.filter((b) => b.lane === lane.id);
  return (
    <>
      <header className="props-header">
        <span className="badge">Lane {lane.number}</span>
        <span className="muted small">of {view.lanes.length}</span>
      </header>
      <Field label="Name" value={lane.name} onCommit={(n) => n.trim() && rename(n)} autoFocus={isNew} />
      <Field label="ID" value={lane.id} onCommit={changeId} hint={idHint(followsName(lane.id, lane.name))} />
      <Field label="Description" value={lane.description ?? ""} multiline placeholder="One sentence, shown when you point at the lane" onCommit={(description) => set({ description: description || null })} />
      <h3>{flowchart ? "Blocks" : "Cards"}</h3>
      {(flowchart ? blocks : cards).length === 0 && <p className="muted small">None yet. Drag a {flowchart ? "block" : "card"} into this lane, or select the lane and use + Add.</p>}
      <ul className="plain">
        {flowchart
          ? blocks.map((b) => (
              <li key={b.id}>
                <button className="link" onClick={() => onSelect({ kind: "block", id: b.id })}>
                  {blockText(b)}
                </button>{" "}
                <span className="muted small">{BLOCK_KIND_LABELS[b.kind]}</span>
              </li>
            ))
          : cards.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => onSelect({ kind: "card", id: c.id })}>
                  {c.name}
                </button>{" "}
                <span className="muted small">{CARD_KIND_LABELS[c.kind]}</span>
              </li>
            ))}
      </ul>
      <div className="actions">
        <button disabled={lane.number === 1} onClick={() => set({ position: lane.number - 1 })}>
          {flowchart ? "Move left" : "Move up"}
        </button>
        <button disabled={lane.number === view.lanes.length} onClick={() => set({ position: lane.number + 1 })}>
          {flowchart ? "Move right" : "Move down"}
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-lane", view: view.id, id: lane.id }]).then(() => onSelect(null))}>
          Delete lane
        </button>
      </div>
      {cards.length > 0 && <p className="muted small">Deleting the lane keeps its cards, in no lane.</p>}
    </>
  );
}

function CardProperties({ view, card, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; card: Card }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-card" }>, "op" | "view" | "id">) => void edit([{ op: "update-card", view: view.id, id: card.id, ...fields }]);
  const others = view.cards.map((c) => c.id);
  // An ID made from the name keeps following it, as an element's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(card.id, card.name) ? uniqueAmong(others, base, card.id) : card.id;
    void edit([{ op: "update-card", view: view.id, id: card.id, name, ...(newId !== card.id && { newId }) }]).then((ok) => ok && newId !== card.id && onSelect({ kind: "card", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === card.id) return;
    void edit([{ op: "update-card", view: view.id, id: card.id, newId }]).then((ok) => ok && onSelect({ kind: "card", id: newId }));
  };
  const named = (id: string) => view.cards.find((c) => c.id === id);
  const leadsTo = view.cards.filter((c) => c.id !== card.id && c.from.includes(card.id));
  // The cards an arrow can still be drawn from: not itself, and not one it comes from already.
  const sources = view.cards.filter((c) => c.id !== card.id && !card.from.includes(c.id));
  const count = view.cards.length;
  return (
    <>
      <header className="props-header">
        <span className={`badge badge-card event-card-${card.kind}`}>{CARD_KIND_LABELS[card.kind]}</span>
        <span className="muted small">
          card {card.number} of {count}
        </span>
      </header>
      <Field label="Name" value={card.name} onCommit={(n) => n.trim() && rename(n)} autoFocus={isNew} />
      <Field label="ID" value={card.id} onCommit={changeId} hint={idHint(followsName(card.id, card.name))} />
      <label className="field">
        <span className="field-label">Kind</span>
        <select value={card.kind} onChange={(e) => set({ kind: e.target.value as CardKind })}>
          {CARD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CARD_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <span className="field-hint">{CARD_KIND_HINTS[card.kind]}</span>
      </label>
      <Field label="Description" value={card.description ?? ""} multiline placeholder="One sentence, shown on the card" onCommit={(description) => set({ description: description || null })} />
      <label className="field">
        <span className="field-label">Lane</span>
        <select value={card.lane ?? ""} onChange={(e) => set({ lane: e.target.value || null })}>
          <option value="">(no lane)</option>
          {card.lane !== undefined && !view.lanes.some((l) => l.id === card.lane) && <option value={card.lane}>{card.lane} (not a lane of this view)</option>}
          {view.lanes.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <h3>Comes from</h3>
      {card.from.length === 0 && <p className="muted small">Nothing yet. Drag from the dot beside another card to this one, or choose a card here.</p>}
      <ul className="plain">
        {card.from.map((id) => (
          <li key={id}>
            <button className="link" onClick={() => onSelect(named(id) ? { kind: "card", id } : null)}>
              ← {named(id)?.name ?? `${id} (not a card of this view)`}
            </button>{" "}
            <button className="link danger" onClick={() => set({ from: card.from.filter((f) => f !== id) })}>
              Remove arrow
            </button>
          </li>
        ))}
      </ul>
      <label className="field">
        <span className="field-label">Add an arrow from</span>
        <select value="" onChange={(e) => e.target.value && set({ from: [...card.from, e.target.value] })}>
          <option value="">Choose a card…</option>
          {sources.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} [{CARD_KIND_LABELS[c.kind]}]
            </option>
          ))}
        </select>
      </label>
      {leadsTo.length > 0 && (
        <>
          <h3>Leads to</h3>
          <ul className="plain">
            {leadsTo.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => onSelect({ kind: "card", id: c.id })}>
                  → {c.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button disabled={card.number === 1} onClick={() => set({ position: card.number - 1 })}>
          Move earlier
        </button>
        <button disabled={card.number === count} onClick={() => set({ position: card.number + 1 })}>
          Move later
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-card", view: view.id, id: card.id }]).then(() => onSelect(null))}>
          Delete card
        </button>
      </div>
    </>
  );
}

/** What each kind of card is for, under the list that picks one. */
const CARD_KIND_HINTS: Record<CardKind, string> = {
  event: "Something that happened, in the past tense, like “Order placed”.",
  command: "A decision or request to do something, like “Place order”.",
  actor: "The person who gives a command.",
  policy: "A rule that reacts to an event: whenever this happens, do that.",
  "read-model": "What someone looks at to decide, like a list of orders.",
  "external-system": "A system outside, that sends events or takes commands.",
  aggregate: "The thing a command changes, which keeps its rules, like an order.",
  hotspot: "A question, problem or disagreement to come back to.",
};

/** The arrow from one card of an event view to another. */
function CardArrowProperties({ view, from, to, edit, onSelect }: PropertiesProps & { view: ViewDef; from: Card; to: Card }) {
  const card = (c: Card) => (
    <button className="link" onClick={() => onSelect({ kind: "card", id: c.id })}>
      {c.name}
    </button>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Arrow</span>
      </header>
      <p>
        {card(from)} → {card(to)}
      </p>
      <p className="muted small">
        {to.name} comes from {from.name}. The arrow belongs to this view, not the model.
      </p>
      <div className="actions">
        <button className="danger" onClick={() => void edit(cardArrowDeleteOps(view, from.id, to.id)).then(() => onSelect(null))}>
          Delete arrow
        </button>
      </div>
    </>
  );
}

function ScreenProperties({ view, screen, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; screen: Screen }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-screen" }>, "op" | "view" | "id">) => void edit([{ op: "update-screen", view: view.id, id: screen.id, ...fields }]);
  const others = view.screens.map((s) => s.id);
  // An ID made from the name keeps following it, as an element's does; the selection follows the ID.
  const rename = (name: string) => {
    const base = idFromName(name);
    const newId = base && followsName(screen.id, screen.name) ? uniqueAmong(others, base, screen.id) : screen.id;
    void edit([{ op: "update-screen", view: view.id, id: screen.id, name, ...(newId !== screen.id && { newId }) }]).then((ok) => ok && newId !== screen.id && onSelect({ kind: "screen", id: newId }));
  };
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === screen.id) return;
    void edit([{ op: "update-screen", view: view.id, id: screen.id, newId }]).then((ok) => ok && onSelect({ kind: "screen", id: newId }));
  };
  const ledFrom = allWidgets(view).filter((w) => w.to === screen.id && w.screen !== screen.id);
  const count = view.screens.length;
  const widgetLink = (w: Widget, prefix = "") => (
    <li key={w.id}>
      <button className="link" onClick={() => onSelect({ kind: "widget", id: w.id })}>
        {prefix}
        {widgetName(w)}
      </button>
    </li>
  );
  return (
    <>
      <header className="props-header">
        <span className="badge">Screen {screen.number}</span>
        <span className="muted small">of {count}</span>
      </header>
      <Field label="Name" value={screen.name} onCommit={(n) => n.trim() && rename(n)} autoFocus={isNew} />
      <Field label="ID" value={screen.id} onCommit={changeId} hint={idHint(followsName(screen.id, screen.name))} />
      <label className="field">
        <span className="field-label">Device</span>
        <select value={screen.device} onChange={(e) => set({ device: e.target.value as ScreenDevice })}>
          {SCREEN_DEVICES.map((d) => (
            <option key={d} value={d}>
              {SCREEN_DEVICE_LABELS[d]}
            </option>
          ))}
        </select>
        <span className="field-hint">How wide the screen is drawn.</span>
      </label>
      <Field label="Description" value={screen.description ?? ""} multiline placeholder="One sentence, shown when you point at the screen" onCommit={(description) => set({ description: description || null })} />
      <h3>On it</h3>
      {screen.widgets.length === 0 && <p className="muted small">Nothing yet. Select the screen and use + Add, or drag a widget onto it.</p>}
      <ul className="plain">{screen.widgets.map((w) => widgetLink(w))}</ul>
      {ledFrom.length > 0 && (
        <>
          <h3>Led to from</h3>
          <ul className="plain">{ledFrom.map((w) => widgetLink(w, `${view.screens.find((s) => s.id === w.screen)?.name ?? w.screen}: `))}</ul>
        </>
      )}
      <div className="actions">
        <button disabled={screen.number === 1} onClick={() => set({ position: screen.number - 1 })}>
          Move left
        </button>
        <button disabled={screen.number === count} onClick={() => set({ position: screen.number + 1 })}>
          Move right
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-screen", view: view.id, id: screen.id }]).then(() => onSelect(null))}>
          Delete screen
        </button>
      </div>
      {screen.widgets.length > 0 && <p className="muted small">Deleting the screen deletes what's on it.</p>}
    </>
  );
}

/** A widget as a list names it: its kind, and its text's first line. */
function widgetName(w: Widget): string {
  const first = (w.text ?? "").split(/\r?\n/).find((l) => l.trim())?.trim();
  return first ? `${WIDGET_KIND_LABELS[w.kind]}: ${first}` : WIDGET_KIND_LABELS[w.kind];
}

/** A row or panel as the details name what's in it: by its text's first line, or else its ID. */
function holderName(w: Widget): string {
  const first = (w.text ?? "").split(/\r?\n/).find((l) => l.trim())?.trim();
  return first ? `“${first}”` : w.id;
}

/** What a widget's text is, under the box to type it in. */
const WIDGET_TEXT_HINTS: Record<WidgetKind, string> = {
  heading: "The title, in large type.",
  text: "What the paragraph says. Without any, grey lines stand in for it.",
  button: "What the button says.",
  link: "What the link says.",
  input: "Its label, like “Email”.",
  checkbox: "What's beside the box.",
  select: "Its label, like “Country”.",
  image: "What the picture shows.",
  list: "One item to a line.",
  table: "One row to a line, with the cells split by |. The first row is the headings.",
  tabs: "One tab to a line. The first is the one that's open.",
  divider: "Text in the middle of the line, if any.",
  panel: "Its title.",
  row: "Text above the row, if any.",
};

/** Kinds whose text runs to several lines. */
const MULTILINE_WIDGETS: readonly WidgetKind[] = ["text", "list", "table", "tabs"];

function WidgetProperties({ view, widget, isNew, edit, onSelect }: PropertiesProps & { view: ViewDef; widget: Widget }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-widget" }>, "op" | "view" | "id">) => void edit([{ op: "update-widget", view: view.id, id: widget.id, ...fields }]);
  const all = allWidgets(view);
  const changeId = (text: string) => {
    const newId = idFromName(text);
    if (!newId || newId === widget.id) return;
    void edit([{ op: "update-widget", view: view.id, id: widget.id, newId }]).then((ok) => ok && onSelect({ kind: "widget", id: newId }));
  };
  const screen = view.screens.find((s) => s.id === widget.screen)!;
  const parent = widget.parent ? all.find((w) => w.id === widget.parent) : undefined;
  const siblings = parent ? parent.widgets : screen.widgets;
  // The rows and panels it can go in: those on its screen, but not itself or anything inside it.
  const inside = new Set(allWidgets(widget).map((w) => w.id));
  const holders = allWidgets(screen).filter((w) => WIDGET_HOLDERS.includes(w.kind) && w.id !== widget.id && !inside.has(w.id));
  const across = parent?.kind === "row";
  const leadsTo = view.screens.filter((s) => s.id !== widget.screen);
  const unknownTo = widget.to !== undefined && !leadsTo.some((s) => s.id === widget.to);
  return (
    <>
      <header className="props-header">
        <span className="badge">{WIDGET_KIND_LABELS[widget.kind]}</span>
        <span className="muted small">
          {widget.number} of {siblings.length} {parent ? `in ${parent.kind} ${holderName(parent)}` : `on ${screen.name}`}
        </span>
      </header>
      <Field
        label="Text"
        value={widget.text ?? ""}
        multiline={MULTILINE_WIDGETS.includes(widget.kind)}
        rows={4}
        placeholder={WIDGET_KIND_LABELS[widget.kind]}
        hint={WIDGET_TEXT_HINTS[widget.kind]}
        onCommit={(text) => set({ text: text || null })}
        autoFocus={isNew}
      />
      <label className="field">
        <span className="field-label">Kind</span>
        <select value={widget.kind} onChange={(e) => set({ kind: e.target.value as WidgetKind })}>
          {WIDGET_KINDS.map((kind) => (
            <option key={kind} value={kind} disabled={widget.widgets.length > 0 && !WIDGET_HOLDERS.includes(kind)}>
              {WIDGET_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        {widget.widgets.length > 0 && <span className="field-hint">It holds widgets, so it can only be a row or a panel.</span>}
      </label>
      <Field label="ID" value={widget.id} onCommit={changeId} />
      <Field label="Description" value={widget.description ?? ""} multiline placeholder="What it does, shown when you point at it" onCommit={(description) => set({ description: description || null })} />
      <label className="field">
        <span className="field-label">Leads to</span>
        <select value={widget.to ?? ""} onChange={(e) => set({ to: e.target.value || null })}>
          <option value="">(nowhere)</option>
          {unknownTo && <option value={widget.to}>{widget.to === widget.screen ? `${screen.name} (the screen it's on)` : `${widget.to} (not a screen of this view)`}</option>}
          {leadsTo.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="field-hint">The screen it opens, drawn as an arrow. You can also drag from the dot beside it to a screen.</span>
      </label>
      <label className="field">
        <span className="field-label">Screen</span>
        <select value={widget.screen} onChange={(e) => set({ screen: e.target.value })}>
          {view.screens.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">In</span>
        <select value={widget.parent ?? ""} onChange={(e) => set({ in: e.target.value || null })}>
          <option value="">(the screen itself)</option>
          {holders.map((h) => (
            <option key={h.id} value={h.id}>
              {widgetName(h)} [{h.id}]
            </option>
          ))}
        </select>
        <span className="field-hint">A row puts its widgets side by side, and a panel puts them in a box, top to bottom.</span>
      </label>
      {WIDGET_HOLDERS.includes(widget.kind) && (
        <>
          <h3>Inside it</h3>
          {widget.widgets.length === 0 && <p className="muted small">Nothing yet. Select it and use + Add, or drag a widget into it.</p>}
          <ul className="plain">
            {widget.widgets.map((w) => (
              <li key={w.id}>
                <button className="link" onClick={() => onSelect({ kind: "widget", id: w.id })}>
                  {widgetName(w)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button disabled={widget.number === 1} onClick={() => set({ position: widget.number - 1 })}>
          {across ? "Move left" : "Move up"}
        </button>
        <button disabled={widget.number === siblings.length} onClick={() => set({ position: widget.number + 1 })}>
          {across ? "Move right" : "Move down"}
        </button>
        <button className="danger" onClick={() => void edit([{ op: "remove-widget", view: view.id, id: widget.id }]).then(() => onSelect(null))}>
          Delete {WIDGET_KIND_LABELS[widget.kind].toLowerCase()}
        </button>
      </div>
      {widget.widgets.length > 0 && <p className="muted small">Deleting it deletes what's inside it.</p>}
    </>
  );
}

const capitalised = (text: string) => text[0]!.toUpperCase() + text.slice(1);

/** A row of colours to pick one from, and maybe none. `look` is the class each swatch is drawn with: an ink's or a fill's. */
function Swatches<T extends string>({ label, value, options, look, none, onChange }: { label: string; value: T | undefined; options: readonly T[]; look: "ink" | "fill"; none?: string; onChange(value: T | undefined): void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="swatches" role="group" aria-label={label}>
        {none && <button className={`swatch swatch-none${value === undefined ? " active" : ""}`} aria-pressed={value === undefined} aria-label={none} title={none} onClick={() => onChange(undefined)} />}
        {options.map((o) => (
          <button key={o} className={`swatch swatch-${look}-${o}${value === o ? " active" : ""}`} aria-pressed={value === o} aria-label={capitalised(o)} title={capitalised(o)} onClick={() => onChange(o)} />
        ))}
      </div>
    </div>
  );
}

/** Each way an arrow can have heads, as the panel lists them. */
const HEADS_TEXT: Record<ArrowHeads, string> = { end: "Arrow: one way", both: "Arrow: both ways", none: "Line: no heads" };

/** A shape's ID, or an arrow's, as the panel changes it: a new one that's free among both. */
function boardIdFor(view: ViewDef, id: string) {
  const others = [...view.shapes.map((s) => s.id), ...view.arrows.map((a) => a.id)];
  return (text: string) => {
    const base = idFromName(text);
    return !base || base === id ? undefined : uniqueAmong(others, base, id);
  };
}

function ShapeProperties({ view, shape, edit, onSelect }: PropertiesProps & { view: ViewDef; shape: Shape }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-shape" }>, "op" | "view" | "id">) => void edit([{ op: "update-shape", view: view.id, id: shape.id, ...fields }]);
  const pen = shape.kind === "pen";
  const freeId = boardIdFor(view, shape.id);
  const changeId = (text: string) => {
    const newId = freeId(text);
    if (newId) void edit([{ op: "update-shape", view: view.id, id: shape.id, newId }]).then((ok) => ok && onSelect({ kind: "shape", id: newId }));
  };
  const remove = () => void edit([{ op: "remove-shape", view: view.id, id: shape.id }]).then((ok) => ok && onSelect(null));
  // Text with nothing to say would be nothing on the board, so it goes, as it does when it's emptied on the board.
  const changeText = (text: string) => (shape.kind === "text" && !text.trim() ? remove() : set({ text: text || null }));
  const count = view.shapes.length;
  const arrows = view.arrows.filter((a) => endShape(a.from) === shape.id || endShape(a.to) === shape.id);
  return (
    <>
      <header className="props-header">
        <span className="badge">{pen ? "Pen line" : SHAPE_KIND_LABELS[shape.kind]}</span>
        <span className="muted small">
          {shape.number} of {count} from the back
        </span>
      </header>
      {!pen && <Field label="Text" value={shape.text ?? ""} multiline placeholder="What it says. Or double-click the shape to write in it" onCommit={changeText} />}
      {!pen && (
        <label className="field">
          <span className="field-label">Shape</span>
          <select value={shape.kind} onChange={(e) => set({ kind: e.target.value as ShapeKind })}>
            {(["rectangle", "ellipse", "diamond", "text"] as const).map((k) => (
              // Text with nothing to say would be nothing on the board.
              <option key={k} value={k} disabled={k === "text" && shape.kind !== "text" && !shape.text?.trim()}>
                {SHAPE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
          {shape.kind !== "text" && !shape.text?.trim() && <span className="field-hint">Give it text to make it text alone.</span>}
        </label>
      )}
      <Swatches label={pen ? "Colour" : "Colour of its outline and text"} value={shape.color} options={SHAPE_COLORS} look="ink" onChange={(color) => set({ color: color ?? null })} />
      {!pen && <Swatches label="Fill" value={shape.fill} options={SHAPE_FILLS} look="fill" none="None: see-through" onChange={(fill: ShapeFill | undefined) => set({ fill: fill ?? null })} />}
      {!pen && (
        <label className="field">
          <span className="field-label">Text size</span>
          <select value={shape.size} onChange={(e) => set({ size: e.target.value as TextSize })}>
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {capitalised(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      {shape.kind !== "text" && (
        <label className="check">
          <input type="checkbox" checked={shape.dashed} onChange={(e) => set({ dashed: e.target.checked })} />
          Dashed
        </label>
      )}
      <Field label="ID" value={shape.id} onCommit={changeId} hint="Arrows to and from it follow it." />
      {arrows.length > 0 && (
        <>
          <h3>Arrows</h3>
          <ul className="plain">
            {arrows.map((a) => (
              <li key={a.id}>
                <button className="link one-line" onClick={() => onSelect({ kind: "boardArrow", id: a.id })}>
                  {arrowName(a)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        <button disabled={shape.number === count} onClick={() => set({ position: count })}>
          Bring to front
        </button>
        <button disabled={shape.number === 1} onClick={() => set({ position: 1 })}>
          Send to back
        </button>
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
      {arrows.length > 0 && <p className="muted small">Deleting it deletes the arrows to and from it.</p>}
      {shape.kind === "text" && <p className="muted small">Text with nothing in it is deleted.</p>}
    </>
  );
}

function BoardArrowProperties({ view, arrow, edit, onSelect }: PropertiesProps & { view: ViewDef; arrow: Arrow }) {
  const set = (fields: Omit<Extract<Operation, { op: "update-arrow" }>, "op" | "view" | "id">) => void edit([{ op: "update-arrow", view: view.id, id: arrow.id, ...fields }]);
  const freeId = boardIdFor(view, arrow.id);
  const changeId = (text: string) => {
    const newId = freeId(text);
    if (newId) void edit([{ op: "update-arrow", view: view.id, id: arrow.id, newId }]).then((ok) => ok && onSelect({ kind: "boardArrow", id: newId }));
  };
  /** An end: the shape it's on, and the side of it it stays on, which can be changed, or its point. */
  const end = (e: Arrow["from"], which: "from" | "to") => {
    const id = endShape(e);
    const shape = id === undefined ? undefined : view.shapes.find((s) => s.id === id);
    if (!shape) return <span className="muted">a point on the board</span>;
    const label = `Side of ${shapeName(shape)} the arrow's ${which === "from" ? "start" : "end"} is on`;
    return (
      <>
        <button className="link one-line" onClick={() => onSelect({ kind: "shape", id: shape.id })}>
          {shapeName(shape)}
        </button>
        <select className="side-select" aria-label={label} title={label} value={endSide(e) ?? ""} onChange={(ev) => set({ [which === "from" ? "fromSide" : "toSide"]: (ev.target.value || null) as ArrowSide | null })}>
          <option value="">Any side, facing the other end</option>
          {ARROW_SIDES.map((side) => (
            <option key={side} value={side}>
              {capitalised(side)}
            </option>
          ))}
        </select>
      </>
    );
  };
  return (
    <>
      <header className="props-header">
        <span className="badge">{arrow.heads === "none" ? "Line" : "Arrow"}</span>
      </header>
      <Field label="Text" value={arrow.text ?? ""} multiline placeholder="What it says, in the middle of it. Or double-click it to write" onCommit={(text) => set({ text: text || null })} />
      <label className="field">
        <span className="field-label">Heads</span>
        <select value={arrow.heads} onChange={(e) => set({ heads: e.target.value as ArrowHeads })}>
          {ARROW_HEADS.map((h) => (
            <option key={h} value={h}>
              {HEADS_TEXT[h]}
            </option>
          ))}
        </select>
      </label>
      <Swatches label="Colour" value={arrow.color} options={SHAPE_COLORS} look="ink" onChange={(color: ShapeColor | undefined) => set({ color: color ?? null })} />
      <label className="check">
        <input type="checkbox" checked={arrow.dashed} onChange={(e) => set({ dashed: e.target.checked })} />
        Dashed
      </label>
      <dl className="facts">
        <dt>From</dt>
        <dd>{end(arrow.from, "from")}</dd>
        <dt>To</dt>
        <dd>{end(arrow.to, "to")}</dd>
      </dl>
      <p className="muted small">Drag either end onto a shape, which it then follows, or off it onto the board. Let it go on one of the dots at a shape's sides, like a diamond's tips, and it stays on that side, wherever the other end is.</p>
      <Field label="ID" value={arrow.id} onCommit={changeId} />
      <div className="actions">
        <button className="danger" onClick={() => void edit([{ op: "remove-arrow", view: view.id, id: arrow.id }]).then(() => onSelect(null))}>
          Delete
        </button>
      </div>
    </>
  );
}

function BoardProperties({ view, shapes, arrows, stickies, edit, onSelect }: PropertiesProps & { view: ViewDef; shapes: Shape[]; arrows: Arrow[]; stickies: Sticky[] }) {
  const count = (n: number, one: string, many: string) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
  const label = [...count(shapes.length, "shape", "shapes"), ...count(arrows.length, "arrow", "arrows"), ...count(stickies.length, "note", "notes")].join(", ");
  const selection: Selection = { kind: "board", shapes: shapes.map((s) => s.id), arrows: arrows.map((a) => a.id), stickies: stickies.map((s) => s.id) };
  return (
    <>
      <header className="props-header">
        <span className="badge">{label}</span>
      </header>
      <p className="muted small">Drag any of them to move them all together. Ctrl-click (⌘-click on a Mac) or Shift-click one to add it or take it out.</p>
      {shapes.length > 0 && (
        <>
          <h3>Shapes</h3>
          <ul className="plain">
            {shapes.map((s) => (
              <li key={s.id}>
                <button className="link one-line" onClick={() => onSelect({ kind: "shape", id: s.id })}>
                  {shapeName(s)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {arrows.length > 0 && (
        <>
          <h3>Arrows</h3>
          <ul className="plain">
            {arrows.map((a) => (
              <li key={a.id}>
                <button className="link one-line" onClick={() => onSelect({ kind: "boardArrow", id: a.id })}>
                  {arrowName(a)}
                </button>
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
      <div className="actions">
        <button className="danger" onClick={() => void edit(whiteboardDeleteOps(view, selection)).then((ok) => ok && onSelect(null))}>
          Delete them
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

function ViewProperties({ ws, view, computed, edit, onDeleteView, onSelect, onEditNotes }: PropertiesProps & { view: ViewDef }) {
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
      <NotesField
        value={view.notes ?? ""}
        rows={6}
        onCommit={(notes) => void edit([{ op: "update-view", id: view.id, notes: notes || null }])}
        onExpand={(text) => onEditNotes({ kind: "view", id: view.id }, text)}
      />
      {view.level !== "sequence" &&
        view.level !== "state" &&
        view.level !== "deployment" &&
        view.level !== "event" &&
        view.level !== "wireframe" &&
        view.level !== "whiteboard" &&
        view.level !== "flowchart" &&
        view.level !== "entity" && <NewElementsField view={view} edit={edit} />}
      {view.level === "entity" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>entity</dd>
            {scope && (
              <>
                <dt>The data of</dt>
                <dd>{scope.name}</dd>
              </>
            )}
            <dt>Entities</dt>
            <dd>{view.entities.length}</dd>
            <dt>Links</dt>
            <dd>{view.links.length}</dd>
          </dl>
          <p className="muted small">
            An entity view is an entity-relationship diagram: the things whose data is kept, with their attributes, and how they're linked. Use + Add to add an entity, and with one selected, its attributes. Drag from the dot under an entity to another to link them, then select the link to say how many of each there can be. Select an entity, an attribute or a link to change it.
          </p>
        </>
      ) : view.level === "flowchart" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>flowchart</dd>
            {scope && (
              <>
                <dt>The process of</dt>
                <dd>{scope.name}</dd>
              </>
            )}
            <dt>Lanes</dt>
            <dd>{view.lanes.length}</dd>
            <dt>Blocks</dt>
            <dd>{view.blocks.length}</dd>
            <dt>Flows</dt>
            <dd>{view.flows.length}</dd>
          </dl>
          <p className="muted small">
            A flowchart shows the steps of a process, and the decisions on the way. Use + Add to add a block: with a block selected, the new one goes under it, with a flow to it. Drag from the dot under a block to another to add a flow. Select a block or a flow to change it. + Add adds a lane too, a column for the blocks of one actor, team or system: drag a block into a lane to put it there.
          </p>
        </>
      ) : view.level === "whiteboard" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>whiteboard</dd>
            <dt>Shapes</dt>
            <dd>{view.shapes.length}</dd>
            <dt>Arrows</dt>
            <dd>{view.arrows.length}</dd>
          </dl>
          <p className="muted small">
            A whiteboard is a freehand sketch, to share an idea. Pick a tool at the bottom of the diagram, or press its key, and drag to draw a rectangle, an ellipse, a diamond, an arrow, a line or with the pen; click to type text. Double-click a shape or an arrow to write in it, or the board to type there. None of it is part of the model.
          </p>
        </>
      ) : view.level === "wireframe" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>wireframe</dd>
            {scope && (
              <>
                <dt>The screens of</dt>
                <dd>{scope.name}</dd>
              </>
            )}
            <dt>Screens</dt>
            <dd>{view.screens.length}</dd>
            <dt>Widgets</dt>
            <dd>{allWidgets(view).length}</dd>
          </dl>
          <p className="muted small">
            A wireframe view sketches an app's screens: what's on each, top to bottom, and which screen a button or link leads to. Use + Add to add a screen, or a widget to the screen, row or panel selected. Drag a widget to move it, or drag from the dot beside it to another screen to make it lead there. Select a screen or a widget to change it.
          </p>
        </>
      ) : view.level === "event" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>event</dd>
            <dt>Lanes</dt>
            <dd>{view.lanes.length}</dd>
            <dt>Cards</dt>
            <dd>{view.cards.length}</dd>
          </dl>
          <p className="muted small">
            An event view shows what happens in a business process, as event storming does: commands, events and the other notes, in order along a timeline. Use + Add to add a card, after the one selected, or a lane. Drag a card to move it along the timeline or to another lane, and drag from the dot beside a card to another to add an arrow. Select a card, a lane or an arrow to change it.
          </p>
        </>
      ) : view.level === "deployment" ? (
        <>
          <dl className="facts">
            <dt>Level</dt>
            <dd>deployment</dd>
            <dt>Nodes</dt>
            <dd>{view.nodes.length}</dd>
            <dt>Runs</dt>
            <dd>{computed?.nodes.map((e) => e.name).join(", ") || "nothing yet"}</dd>
            <dt>Connections</dt>
            <dd>{view.connections.length}</dd>
          </dl>
          <p className="muted small">
            A deployment view shows where containers run: the servers, clusters and cloud services, nested. Use + Add to add a node, inside the one selected, and choose what runs in it in its details. Arrows between containers come from the model's relationships; drag from the dot under a node to add a connection to it. It's laid out automatically.
          </p>
        </>
      ) : view.level === "state" ? (
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
      <p className="muted small">Select a box, arrow or sticky note to edit it. Drag boxes and notes to arrange them, or use <strong>Auto layout</strong> to lay them all out again. Their positions are saved with the view.</p>
      <p className="muted small">With a mouse, drag across the background to select several and move them together, or Ctrl-click (⌘-click on a Mac) each one. Scroll to move round the diagram, and Ctrl-scroll (⌘-scroll on a Mac) to zoom.</p>
    </>
  );
}

function WorkspaceProperties({ ws, edit, syncsDocs, syncsSkill, docs, fileName }: PropertiesProps) {
  const docsFolder = ws.doc.export?.docs;
  return (
    <>
      <header className="props-header">
        <span className="badge">Workspace</span>
        <code className="muted small file-path">{fileName}</code>
      </header>
      <Field label="Name" value={ws.doc.name} onCommit={(name) => void edit([{ op: "update-workspace", name }])} />
      <Field label="Description" value={ws.doc.description ?? ""} multiline onCommit={(description) => void edit([{ op: "update-workspace", description: description || null }])} />
      <Field
        label="Docs folder"
        value={docsFolder ?? ""}
        placeholder="."
        onCommit={(folder) => void edit([{ op: "update-workspace", docs: folder || null }])}
        hint={
          syncsDocs
            ? docsFolder
              ? "Relative to the workspace file; . is the file's own folder. Every save rewrites the markdown docs there."
              : "Set a folder, relative to the workspace file, to keep markdown docs there; . is the file's own folder."
            : "Used by the desktop app and the open-arch CLI. Here, Export zip puts the docs where a save would. With none, or one the zip has no place for, it puts them beside the file. In Chrome and Edge, Export to folder keeps them beside the file when none is set, and won't export a docs folder outside the folder chosen."
        }
      />
      {syncsDocs && !docsFolder && <button onClick={() => void edit([{ op: "update-workspace", docs: "." }])}>Keep docs beside the file</button>}
      {syncsDocs && docs?.error && (
        <p className="error small" role="alert">
          {docsProblem(docs)}
        </p>
      )}
      {syncsDocs && docs && !docs.error && (
        <p className="muted small">
          Last save {docs.written || docs.deleted ? `updated ${docs.written + docs.deleted} page${docs.written + docs.deleted === 1 ? "" : "s"}` : "left the docs unchanged"} in {docs.dir}.
          {docs.skipped.length > 0 && ` Left alone (not generated by open-arch, or generated for another workspace beside this one): ${docs.skipped.join(", ")}.`}
        </p>
      )}
      {syncsSkill && (
        <p className="muted small">
          The first save after opening the workspace also brings the open-arch agent skill up to date in {SKILL_TARGETS.map((t) => `${t}/`).join(" and ")} at the top of the project: the folder you opened, or, on desktop, the Git repository the file is in. On desktop, outside a repository, or in your home folder, nothing is written. AI agents working there then know how to read and change the model. If that save can't write it, each save after tries again. Anything else in those folders is left alone. Saves also keep the open-arch section in the project's AGENTS.md, which tells agents where the model and its docs are, and leave the rest of that file alone.
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
