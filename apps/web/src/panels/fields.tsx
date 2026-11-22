/** Inputs that save when you leave them (or press Enter), not on every keystroke. */
import { tagEntries, type TagChanges, type Tags } from "@open-arch/core";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * A text box that saves when you leave it, and puts the saved text back on Escape. It follows
 * the saved value when that changes underneath it (an agent's edit, Undo) without being
 * re-created, so it keeps focus: a re-created box would drop focus to the page, where
 * Backspace deletes the selection. `onCommit` returning false refuses the text and puts the
 * saved text back.
 */
function useSavedText<T extends HTMLInputElement | HTMLTextAreaElement>(value: string, onCommit: (value: string) => boolean | void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = value;
  }, [value]);
  const commit = () => {
    const box = ref.current;
    if (!box || box.value === value) return;
    if (onCommit(box.value) === false) box.value = value;
  };
  /** Enter saves, for one-line boxes. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape" && ref.current) ref.current.value = value;
  };
  return { box: { ref, defaultValue: value, onBlur: commit }, onKeyDown };
}

interface FieldProps {
  label: string;
  value: string;
  onCommit(value: string): void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  /**
   * Takes the focus, with its text selected, when this becomes true, or changes to another number
   * that isn't 0: the box stays as what it shows changes, so a number says it shows something new.
   */
  autoFocus?: boolean | number;
  hint?: ReactNode;
}

export function Field({ label, value, onCommit, multiline, rows = 3, placeholder, autoFocus, hint }: FieldProps) {
  const { box, onKeyDown } = useSavedText<HTMLInputElement & HTMLTextAreaElement>(value, onCommit);
  useEffect(() => {
    if (autoFocus && box.ref.current) {
      box.ref.current.focus();
      box.ref.current.select();
    }
  }, [autoFocus]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? <textarea {...box} placeholder={placeholder} aria-label={label} rows={rows} /> : <input {...box} placeholder={placeholder} aria-label={label} onKeyDown={onKeyDown} />}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface NotesFieldProps {
  value: string;
  onCommit(value: string): void;
  rows: number;
  /** Opens the notes in a bigger editor, starting from the text in the box. */
  onExpand(text: string): void;
}

/** Markdown notes: a box that saves like Field, and Expand, which opens them in an editor as big as the window. */
export function NotesField({ value, onCommit, rows, onExpand }: NotesFieldProps) {
  const { box } = useSavedText<HTMLTextAreaElement>(value, onCommit);
  const id = useId();
  return (
    <div className="field">
      <div className="field-head">
        <label className="field-label" htmlFor={id}>
          Notes
        </label>
        <button className="link small" title="Write the notes in an editor as big as the window" onClick={() => onExpand(box.ref.current!.value)}>
          Expand
        </button>
      </div>
      <textarea {...box} id={id} aria-label="Notes" rows={rows} placeholder="Longer documentation, in markdown" />
    </div>
  );
}

interface TagsEditorProps {
  tags: Tags;
  /** A value sets a tag (an empty one makes it a plain label) and null removes it. */
  onChange(changes: TagChanges): void;
}

/** Name/value pairs, each editable in place, and a row at the end for a new one. */
export function TagsEditor({ tags, onChange }: TagsEditorProps) {
  // Each row keeps its key when its tag is renamed, so the row, and the focus in it, survive.
  const keys = useRef(new Map<string, number>());
  const nextKey = useRef(0);
  const keyOf = (name: string) => {
    if (!keys.current.has(name)) keys.current.set(name, nextKey.current++);
    return keys.current.get(name)!;
  };
  const has = (name: string) => Object.hasOwn(tags, name);
  // Renaming onto another tag's name would overwrite it, so that's refused.
  const rename = (name: string, to: string) => {
    const next = to.trim();
    if (!next || (next !== name && has(next))) return false;
    if (next === name) return;
    keys.current.set(next, keyOf(name));
    keys.current.delete(name);
    onChange({ [name]: null, [next]: tags[name]! });
  };
  return (
    <div className="tags">
      {tagEntries(tags).map(([name, value]) => (
        <div className="tag-row" key={keyOf(name)}>
          <InlineInput label="Tag name" value={name} onCommit={(to) => rename(name, to)} />
          <InlineInput label={`Value of ${name}`} value={value} placeholder="(no value)" onCommit={(v) => onChange({ [name]: v })} />
          <button className="icon" aria-label={`Remove tag ${name}`} title="Remove" onClick={() => onChange({ [name]: null })}>
            ×
          </button>
        </div>
      ))}
      <NewTag has={has} onAdd={(name, value) => onChange({ [name]: value })} />
    </div>
  );
}

/** A bare one-line box that saves like Field. */
function InlineInput({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit(value: string): boolean | void }) {
  const { box, onKeyDown } = useSavedText<HTMLInputElement>(value, onCommit);
  return <input {...box} placeholder={placeholder} aria-label={label} onKeyDown={onKeyDown} />;
}

/**
 * Adds the tag on Enter, on +, or when focus leaves the row with a name typed. A name that's
 * taken would overwrite that tag, so it's refused with a note, keeping what was typed.
 */
function NewTag({ has, onAdd }: { has(name: string): boolean; onAdd(name: string, value: string): void }) {
  const name = useRef<HTMLInputElement>(null);
  const value = useRef<HTMLInputElement>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const add = (refocus: boolean) => {
    const n = name.current!.value.trim();
    if (n && has(n)) {
      setTaken(n);
      if (refocus) name.current!.select();
      return;
    }
    if (n) {
      onAdd(n, value.current!.value);
      name.current!.value = "";
      value.current!.value = "";
    }
    if (refocus) name.current!.focus();
  };
  return (
    <>
      <div
        className="tag-row"
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && add(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add(true);
          if (e.key === "Escape") {
            name.current!.value = value.current!.value = "";
            setTaken(null);
          }
        }}
      >
        <input ref={name} placeholder="New tag" aria-label="New tag name" onInput={() => setTaken(null)} />
        <input ref={value} placeholder="Value (optional)" aria-label="New tag value" />
        <button className="icon" aria-label="Add tag" title="Add" onClick={() => add(true)}>
          +
        </button>
      </div>
      {taken && <p className="field-hint">There's already a tag called "{taken}". Change its value above instead.</p>}
    </>
  );
}
