/** The open workspace: its file text, the model built from it, problems, edits, undo and the history. */
import { applyOperations, checkWorkspace, loadWorkspace, OpError, serializeDocument, type ApplyResult, type Diagnostic, type Operation, type Workspace } from "@open-arch/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocsSummary, SaveSummary } from "./bridge.js";
import type { WorkspaceHost } from "./hosts.js";
import { problemText } from "./problems.js";
import { SKILL_TARGETS } from "./skill.js";
import { renamesBetween, renamesIn, undoRenames, type Rename } from "./model.js";

/** Operations to apply, or a function that works them out from the current workspace. */
export type Edit = Operation[] | ((ws: Workspace) => Operation[]);

export interface WorkspaceState {
  ws: Workspace | null;
  text: string | null;
  diagnostics: Diagnostic[];
  loadError: string | null;
  /** Apply operations and save. Resolves to false when they were refused. */
  edit(edit: Edit): Promise<boolean>;
  /**
   * Apply operations and save, as `edit` does, and hand back what they did, or why they were
   * refused, without showing it: for Ask AI, whose model reads the answer and tries again. A save
   * that fails is still shown, as that's for the person to put right.
   */
  change(ops: Operation[]): Promise<Change>;
  /**
   * Save an earlier version of the file, as one step that Undo takes back, which the History list
   * calls `label`. With `from`, only if the file's text is still that when its turn comes: an
   * edit made first, such as one still being saved, isn't written over. Resolves to false if it
   * wasn't saved.
   */
  restore(text: string, label: string, from?: string): Promise<boolean>;
  /**
   * Calls `look` with the workspace once the edits queued before it have landed, or with null
   * when there's none. Unlike an edit, it gets a workspace whose file has errors too.
   */
  afterEdits(look: (ws: Workspace | null) => void): Promise<void>;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * The History list, oldest first: the workspace as it was before the changes made here, then
   * as each change left it, the ones undone too. It's kept in memory only, never in the file or
   * anywhere a save, an export or a shared link goes, and it starts again when the workspace is
   * opened, or reloaded after a change made outside this window.
   */
  versions: Version[];
  /** The number of the version showing now. */
  version: number;
  /**
   * Goes back, or forward, to a version in the list, as one save. Undo and Redo step on from
   * there. Resolves to what went wrong when it couldn't be saved, which is the message shown too,
   * or else to null.
   */
  goTo(version: number): Promise<string | null>;
  /** Where edits go: the host's storage, or "memory" once the workspace is deleted outside this window. */
  storage: WorkspaceHost["storage"];
  /** Changes since the workspace was last saved or exported (memory only). */
  unsaved: boolean;
  /** Marks the text as saved or exported (memory only): `text` when given, the text now otherwise. */
  markSaved(text?: string): void;
  /** What the last save did to the docs folder (desktop). */
  docs: DocsSummary | null;
  message: { kind: "error" | "info"; text: string } | null;
  /** Show a message, for things done outside `edit`, like exporting. */
  notify(message: { kind: "error" | "info"; text: string }): void;
  dismissMessage(): void;
}

/**
 * What a change did: each operation in a line, the warnings it brought, and the file's text just
 * before it and after it. Or why it was refused, with nothing changed.
 */
export type Change = { ok: true; summary: string[]; warnings: Diagnostic[]; before: string; after: string } | { ok: false; error: string };

/** A version of the workspace in the History list. */
export interface Version {
  /** Tells it from the others, and puts them in order: a later version has a higher number. */
  number: number;
  /** What the change that made it did, or null for the version the list starts from. */
  change: string | null;
  /** When that change was made, as `Date.now()` gives it, or null for the version the list starts from. */
  at: number | null;
}

const HISTORY_LIMIT = 100;

/** Why a file with errors can't be changed. */
const BROKEN_FILE = "This file has errors that stop it being changed safely. Fix it by hand (the Problems list says where), or restore it from version control.";

/** What an edit did, for the History list: its first change, as `applyOperations` puts it, and how many more came with it. */
export function changeLabel(summary: string[]): string {
  const [first = "changed the workspace", ...more] = summary;
  const rest = more.length === 0 ? "" : `, and ${more.length} more change${more.length === 1 ? "" : "s"}`;
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest}`;
}

/** What went wrong with the docs, when the file was saved but the docs folder couldn't all be written. */
export function docsProblem(docs: DocsSummary): string {
  const changed = docs.written + docs.deleted;
  return changed > 0
    ? `Saved, but updating the docs in ${docs.dir}/ stopped partway, after ${changed} page${changed === 1 ? "" : "s"}: ${docs.error}`
    : `Saved, but the docs in ${docs.dir}/ weren't updated: ${docs.error}`;
}

/** What went wrong beside saving the file, with the docs, the agent skill, AGENTS.md, or several, or null when nothing did. */
export function saveProblem(summary: SaveSummary | void): string | null {
  const others = [
    summary?.skillError && `the agent skill in ${SKILL_TARGETS.map((t) => `${t}/`).join(" and ")} wasn't updated: ${summary.skillError}`,
    summary?.agentsError && `the open-arch section in AGENTS.md wasn't updated: ${summary.agentsError}`,
  ].filter((text): text is string => !!text);
  const also = (texts: string[]) => texts.map((text) => ` Also, ${text}`).join("");
  if (summary?.docs?.error) return docsProblem(summary.docs) + also(others);
  const [first, ...more] = others;
  return first ? `Saved, but ${first}${also(more)}` : null;
}

/**
 * A change made here: the file before and after it, what it did and when, and the renames it
 * made, which going back over it takes back and going forward makes again. `version` numbers the
 * file after it.
 */
type Step = { version: number; label: string; at: number; before: string; after: string; renames: Rename[] };

/**
 * The changes made here, oldest first, for Undo, Redo and the History list. The first `done` of
 * them are made, and the rest were undone. `base` numbers the file before the first of them. It
 * lives in this hook's state and nowhere else, so it's gone when the workspace is closed.
 */
type History = { base: number; steps: Step[]; done: number };

/** A history with one more change made: the ones undone are dropped, and so is the oldest once there are too many. */
function withStep(h: History, step: Omit<Step, "version" | "at">): History {
  // Numbered after every version there's been, the ones undone too, so no number is used twice.
  const version = (h.steps[h.steps.length - 1]?.version ?? h.base) + 1;
  const steps = [...h.steps.slice(0, h.done), { ...step, at: Date.now(), version }];
  const dropped = steps.splice(0, Math.max(0, steps.length - HISTORY_LIMIT));
  return { base: dropped[dropped.length - 1]?.version ?? h.base, steps, done: steps.length };
}

/** How many changes are made at a version, or -1 when it isn't in the history. */
function placeOf(h: History, version: number): number {
  if (version === h.base) return 0;
  const at = h.steps.findIndex((s) => s.version === version);
  return at < 0 ? -1 : at + 1;
}

/** The renames between two versions of the file, worked out from them. */
const renamesFrom = (before: string, after: string) => renamesBetween(loadWorkspace(before), loadWorkspace(after));

/**
 * `onApplied` hears the operations of each edit as it's applied, in the same render as the
 * workspace they make, so what the designer has open can follow a rename without a render in
 * between where it points at an ID that's gone. It's given `before` too, the workspace they were
 * applied to, which says what an operation that goes by a place in a list changed. Undo, Redo, a
 * restore and a reload write a whole version of the file instead, and it hears the renames they
 * make, without the workspace before.
 */
export function useWorkspace(host: WorkspaceHost, onApplied?: (ops: Operation[], before?: Workspace) => void): WorkspaceState {
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>({ base: 0, steps: [], done: 0 });
  const [message, setMessage] = useState<WorkspaceState["message"]>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocsSummary | null>(null);
  // Once the workspace is deleted outside this window, edits stay in this tab, so none are lost.
  const [deleted, setDeleted] = useState(false);
  const isDeleted = useRef(false);
  const current = useRef<string | null>(null);
  /** The watcher's message that it can't see outside changes, while that's the one showing. */
  const watchProblem = useRef<WorkspaceState["message"]>(null);
  // The history as the queue's tasks leave it, as `current` is the text. Undo pressed twice
  // before the first one's save has finished queues two steps from the same render, so each
  // step reads the history when it runs, not when it was pressed.
  const historyRef = useRef(history);
  const applied = useRef(onApplied);
  applied.current = onApplied;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const commit = (next: string) => {
    current.current = next;
    setText(next);
  };

  const updateHistory = (change: (h: History) => History) => {
    historyRef.current = change(historyRef.current);
    setHistory(historyRef.current);
  };

  // Every write goes through one queue, so edits made quickly apply in order.
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(task, task);
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  useEffect(() => {
    let cancelled = false;
    host
      .load()
      .then((t) => {
        if (cancelled) return;
        commit(t);
        setSavedText(t);
        // A workspace just made shows what the save that made it did, as a save would.
        if (host.made) setDocs(host.made.docs);
        const went = saveProblem(host.made);
        if (went) showSaveProblem(went);
      })
      .catch((e: unknown) => !cancelled && setLoadError(problemText(e)));
    const stop = host.watch?.(
      () => {
        void enqueue(async () => {
          // Gone or unreadable since the watcher looked: its next check says which.
          const next = await host.load().catch(() => null);
          if (cancelled || next === null || next === current.current) return;
          // A workspace that couldn't be opened opens now, with nothing to say about it.
          const opening = current.current === null;
          const renames = opening ? [] : renamesFrom(current.current!, next);
          setLoadError(null);
          commit(next);
          applied.current?.(renames);
          setSavedText(next);
          // The changes made here were to a file that's been replaced, so there's nothing left to go back to.
          updateHistory((h) => ({ base: (h.steps[h.steps.length - 1]?.version ?? h.base) + 1, steps: [], done: 0 }));
          if (opening) return;
          // An error, such as a save refused because of this change, stays until it's dismissed.
          setMessage((shown) => (shown?.kind === "error" ? shown : { kind: "info", text: "The workspace changed outside this window, so it was reloaded." }));
        });
      },
      () => {
        void enqueue(async () => {
          if (cancelled) return;
          isDeleted.current = true;
          setDeleted(true);
          setSavedText(null);
          setMessage({
            kind: "error",
            text:
              host.storage === "file"
                ? "The workspace file was deleted or moved. It's still open here, but only in this tab: Save keeps it in this browser, or export the file."
                : "This workspace was deleted in another tab. It's still open here, but only in this tab: Save keeps it in this browser, or export the file.",
          });
        });
      },
      (problem) => {
        if (cancelled) return;
        if (problem === null) {
          // It can see outside changes again, so its message comes down, if it's still showing.
          setMessage((shown) => (shown === watchProblem.current ? null : shown));
          return;
        }
        watchProblem.current = { kind: "error", text: problem };
        setMessage(watchProblem.current);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [host, enqueue]);

  const ws = useMemo(() => (text === null ? null : loadWorkspace(text)), [text]);
  const diagnostics = useMemo(() => (ws ? checkWorkspace(ws) : []), [ws]);

  /** The message saying the last save went wrong, if that's still the one showing. */
  const problem = useRef<WorkspaceState["message"]>(null);
  const showSaveProblem = (text: string) => {
    problem.current = { kind: "error", text };
    setMessage(problem.current);
  };

  /** Saves, then shows the new text, and runs `then` in the same render. */
  const write = useCallback(
    async (next: string, then?: () => void) => {
      if (!isDeleted.current) {
        const summary = await host.save(next);
        // A save with no docs folder clears what an earlier one said about the docs.
        setDocs(summary?.docs ?? null);
        const went = saveProblem(summary);
        if (went) showSaveProblem(went);
        // A save that went through takes down what an earlier one said went wrong.
        else setMessage((shown) => (shown === problem.current ? null : shown));
        if (host.storage === "file") setSavedText(next);
      }
      commit(next);
      then?.();
    },
    [host],
  );

  /**
   * Applies an edit and saves it, as one step of the history, in its turn in the queue. `finish`
   * makes what it resolves to from what came of it, there in the queue's task, with nothing
   * waited for in between. So whatever follows an edit, such as clearing the selection, still
   * runs before the next thing queued, as callers count on. A save that fails is shown here.
   * Operations that are refused are for `finish` to show (`show`), or to hand on.
   */
  const apply = useCallback(
    <T,>(change: Edit, finish: (done: Change | { ok: false; error: string; show: boolean }) => T) =>
      enqueue(async (): Promise<T> => {
        const before = current.current;
        if (before === null) return finish({ ok: false, error: "The workspace isn't open.", show: false });
        const workspace = loadWorkspace(before);
        if (!workspace.valid) return finish({ ok: false, error: BROKEN_FILE, show: true });
        let next: string;
        let ops: Operation[];
        let result: ApplyResult;
        try {
          ops = typeof change === "function" ? change(workspace) : change;
          if (ops.length === 0) return finish({ ok: true, summary: [], warnings: [], before, after: before });
          result = applyOperations(workspace.doc, ops);
          next = serializeDocument(result.doc);
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
          return finish({ ok: false, error: problemText(error), show: true });
        }
        const done: Change = { ok: true, summary: result.summary, warnings: result.warnings, before, after: next };
        if (next === before) return finish(done);
        try {
          await write(next, () => applied.current?.(ops, workspace));
        } catch (error) {
          const problem = `Couldn't save: ${problemText(error)}`;
          showSaveProblem(problem);
          return finish({ ok: false, error: problem, show: false });
        }
        updateHistory((h) => withStep(h, { label: changeLabel(result.summary), before, after: next, renames: renamesIn(ops) }));
        return finish(done);
      }),
    [enqueue, write],
  );

  const edit = useCallback(
    (change: Edit) =>
      apply(change, (done) => {
        if (!done.ok && "show" in done && done.show) setMessage({ kind: "error", text: done.error });
        return done.ok;
      }),
    [apply],
  );

  const change = useCallback((ops: Operation[]) => apply(ops, (done): Change => (done.ok ? done : { ok: false, error: done.error })), [apply]);

  const restore = useCallback(
    (target: string, label: string, from?: string) =>
      enqueue(async () => {
        const before = current.current;
        if (before === null || (from !== undefined && before !== from)) return false;
        if (target === before) return true;
        const renames = renamesFrom(before, target);
        try {
          await write(target, () => applied.current?.(renames));
        } catch (error) {
          showSaveProblem(`Couldn't save: ${problemText(error)}`);
          return false;
        }
        updateHistory((h) => withStep(h, { label, before, after: target, renames }));
        return true;
      }),
    [enqueue, write],
  );

  /**
   * Goes to the version `pick` chooses from the history as it is when this runs: the file as it
   * was with the first so many changes made. A version that isn't in the history by then, such as
   * one dropped by an edit or a reload that landed first, isn't gone to. Resolves to what went
   * wrong when the version couldn't be saved, or else to null.
   */
  const go = useCallback(
    (pick: (h: History) => number) =>
      enqueue(async () => {
        const now = current.current;
        const { steps, done } = historyRef.current;
        const to = pick(historyRef.current);
        if (now === null || to === done || to < 0 || to > steps.length) return null;
        const back = to < done;
        const target = back ? steps[to]!.before : steps[to - 1]!.after;
        // Every change on the way is taken back or made again, so its renames are too, in that order.
        const renames = steps.slice(Math.min(to, done), Math.max(to, done)).flatMap((s) => s.renames);
        try {
          await write(target, () => applied.current?.(back ? undoRenames(renames) : renames));
        } catch (error) {
          const problem = `Couldn't save: ${problemText(error)}`;
          showSaveProblem(problem);
          return problem;
        }
        updateHistory((h) => ({ ...h, done: to }));
        return null;
      }),
    [enqueue, write],
  );

  const versions = useMemo<Version[]>(() => [{ number: history.base, change: null, at: null }, ...history.steps.map((s) => ({ number: s.version, change: s.label, at: s.at }))], [history]);

  const afterEdits = useCallback(
    (look: (ws: Workspace | null) => void) =>
      enqueue(async () => {
        const now = current.current;
        look(now === null ? null : loadWorkspace(now));
      }),
    [enqueue],
  );

  const storage = deleted ? "memory" : host.storage;

  return {
    ws,
    text,
    diagnostics,
    loadError,
    edit,
    change,
    restore,
    afterEdits,
    undo: () => void go((h) => h.done - 1),
    redo: () => void go((h) => h.done + 1),
    canUndo: history.done > 0,
    canRedo: history.done < history.steps.length,
    versions,
    version: versions[history.done]!.number,
    goTo: (version) => go((h) => placeOf(h, version)),
    storage,
    unsaved: storage === "memory" && text !== null && text !== savedText,
    markSaved: (text?: string) => setSavedText(text ?? current.current),
    docs,
    message,
    notify: setMessage,
    dismissMessage: () => setMessage(null),
  };
}
