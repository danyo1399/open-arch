/** Inputs that save when you leave them (or press Enter), not on every keystroke. */
import type { TagChanges, Tags } from "@open-arch/core";
import { useEffect, useRef, type ReactNode } from "react";

interface FieldProps {
  label: string;
  value: string;
  onCommit(value: string): void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  hint?: ReactNode;
}

export function Field({ label, value, onCommit, multiline, rows = 3, placeholder, autoFocus, hint }: FieldProps) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [autoFocus]);
  const commit = () => {
    const next = ref.current?.value ?? "";
    if (next !== value) onCommit(next);
  };
  const common = {
    ref,
    defaultValue: value,
    placeholder,
    onBlur: commit,
    "aria-label": label,
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? (
        // key: re-create the input when the saved value changes underneath it, e.g. after an agent's edit.
        <textarea key={value} {...common} rows={rows} />
      ) : (
        <input
          key={value}
          {...common}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape" && ref.current) ref.current.value = value;
          }}
        />
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface TagsEditorProps {
  tags: Tags;
  /** A value sets a tag (an empty one makes it a plain label) and null removes it. */
  onChange(changes: TagChanges): void;
}

/** Name/value pairs, each editable in place, and a row at the end for a new one. */
export function TagsEditor({ tags, onChange }: TagsEditorProps) {
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  // Renaming onto another tag's name would overwrite it, so that's refused.
  const rename = (name: string, to: string) => {
    const next = to.trim();
    if (!next || (next !== name && next in tags)) return false;
    if (next !== name) onChange({ [name]: null, [next]: tags[name]! });
  };
  return (
    <div className="tags">
      {entries.map(([name, value]) => (
        <div className="tag-row" key={name}>
          <InlineInput label="Tag name" value={name} onCommit={(to) => rename(name, to)} />
          <InlineInput label={`Value of ${name}`} value={value} placeholder="(no value)" onCommit={(v) => onChange({ [name]: v })} />
          <button className="icon" aria-label={`Remove tag ${name}`} title="Remove" onClick={() => onChange({ [name]: null })}>
            ×
          </button>
        </div>
      ))}
      <NewTag onAdd={(name, value) => onChange({ [name]: value })} />
    </div>
  );
}

/** A bare input that saves like Field. Returning false from `onCommit` refuses the text and puts the old text back. */
function InlineInput({ label, value, placeholder, onCommit }: { label: string; value: string; placeholder?: string; onCommit(value: string): boolean | void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => {
    const input = ref.current;
    if (!input || input.value === value) return;
    if (onCommit(input.value) === false) input.value = value;
  };
  return (
    <input
      key={value}
      ref={ref}
      defaultValue={value}
      placeholder={placeholder}
      aria-label={label}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape" && ref.current) ref.current.value = value;
      }}
    />
  );
}

/** Adds the tag on Enter, on +, or when focus leaves the row with a name typed. */
function NewTag({ onAdd }: { onAdd(name: string, value: string): void }) {
  const name = useRef<HTMLInputElement>(null);
  const value = useRef<HTMLInputElement>(null);
  const add = (refocus: boolean) => {
    const n = name.current!.value.trim();
    if (n) {
      onAdd(n, value.current!.value);
      name.current!.value = "";
      value.current!.value = "";
    }
    if (refocus) name.current!.focus();
  };
  return (
    <div
      className="tag-row"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && add(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") add(true);
        if (e.key === "Escape") name.current!.value = value.current!.value = "";
      }}
    >
      <input ref={name} placeholder="New tag" aria-label="New tag name" />
      <input ref={value} placeholder="Value (optional)" aria-label="New tag value" />
      <button className="icon" aria-label="Add tag" title="Add" onClick={() => add(true)}>
        +
      </button>
    </div>
  );
}
