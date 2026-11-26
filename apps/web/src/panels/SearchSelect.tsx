/**
 * A field that picks one of a list, as a select does, with a box to search the list: for the ends
 * of a flow, a transition, a link, a step or a connection, where a long list is hard to find a name in. The
 * list is in alphabetical order.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

/** One thing the field can pick: what's kept, and the name it's listed by. */
export interface Choice {
  value: string;
  label: string;
}

/** The choices in alphabetical order, as people read them: case aside, and "Step 2" before "Step 10". */
export function sortedChoices(choices: readonly Choice[]): Choice[] {
  return [...choices].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }) || a.value.localeCompare(b.value));
}

/** The choices whose name has every word of `query` in it, in any order, case aside. All of them for an empty query. */
export function matchingChoices(choices: readonly Choice[], query: string): Choice[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return choices.filter((c) => {
    const label = c.label.toLocaleLowerCase();
    return words.every((w) => label.includes(w));
  });
}

interface SearchSelectProps {
  label: string;
  value: string;
  choices: readonly Choice[];
  /** Called with the value picked, only when it's another one. */
  onChange(value: string): void;
  /** What the field shows when `value` isn't one of the choices, such as "gone (not a block)". */
  missing?: string;
  /** True when there's nothing else it can be. */
  disabled?: boolean;
}

/**
 * A button showing what's picked. Pressing it, or the down arrow on it, opens the list under it,
 * with a search box to type in, which filters the list as you type. The up and down arrows move
 * through the list, Enter picks, and Esc or a click away closes it as it was.
 */
export function SearchSelect({ label, value, choices, onChange, missing, disabled }: SearchSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const sorted = useMemo(() => sortedChoices(choices), [choices]);
  const shown = useMemo(() => matchingChoices(sorted, query), [sorted, query]);
  const current = choices.find((c) => c.value === value);

  const openList = () => {
    setQuery("");
    setActive(Math.max(0, sorted.findIndex((c) => c.value === value)));
    setOpen(true);
  };
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  const pick = (choice: Choice | undefined) => {
    if (!choice) return;
    close(true);
    if (choice.value !== value) onChange(choice.value);
  };

  // The active choice stays in sight as the arrows move through a long list.
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) setActive((a) => (e.key === "ArrowDown" ? Math.min(shown.length - 1, a + 1) : Math.max(0, a - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      // Closes the list, not the panel or the dialog it's in.
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  const listId = `${id}-list`;
  const optionId = (k: number) => `${id}-option-${k}`;
  return (
    <div
      className="field search-select"
      ref={field}
      // A click or Tab away closes the list, as it was.
      onBlur={(e) => {
        if (open && !field.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={button}
        type="button"
        className="search-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            openList();
          }
          // Delete and Backspace here don't delete what's selected on the diagram, as on a select.
          if (e.key === "Delete" || e.key === "Backspace") e.stopPropagation();
        }}
      >
        <span id={`${id}-value`}>{current?.label ?? missing ?? value}</span>
      </button>
      {open && (
        <div className="search-select-popup">
          <input
            type="search"
            role="combobox"
            aria-label={`Search ${label}`}
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={shown.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            placeholder="Search"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
          />
          <ul role="listbox" id={listId} aria-label={label} ref={list}>
            {shown.map((c, k) => (
              <li
                key={c.value}
                id={optionId(k)}
                role="option"
                data-value={c.value}
                aria-selected={c.value === value}
                className={k === active ? "active" : undefined}
                // Keeps the focus in the search box, so the list doesn't close before the click.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(k)}
                onClick={() => pick(c)}
              >
                {c.label}
              </li>
            ))}
            {shown.length === 0 && <li className="search-select-none">Nothing matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
