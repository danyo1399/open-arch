/** Inputs that save when you leave them (or press Enter), not on every keystroke. */
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
