/** The open workspace: its file text, the model built from it, problems, edits and undo. */
import { applyOperations, checkWorkspace, loadWorkspace, OpError, serializeDocument, type Diagnostic, type Operation, type Workspace } from "@open-arch/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocsSummary, SaveSummary } from "./bridge.js";
import type { WorkspaceHost } from "./hosts.js";
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
  /** Save an earlier version of the file, as one step that Undo takes back. Resolves to false if it couldn't be saved. */
  restore(text: string): Promise<boolean>;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** Where edits go: the host's storage, or "memory" once the workspace is deleted outside this window. */
  storage: WorkspaceHost["storage"];
  /** Changes since the workspace was last saved or exported (memory only). */
  unsaved: boolean;
  markSaved(): void;
  /** What the last save did to the docs folder (desktop). */
  docs: DocsSummary | null;
  message: { kind: "error" | "info"; text: string } | null;
  /** Show a message, for things done outside `edit`, like exporting. */
  notify(message: { kind: "error" | "info"; text: string }): void;
  dismissMessage(): void;
}

const HISTORY_LIMIT = 100;

/** What went wrong with the docs, when the file was saved but the docs folder couldn't all be written. */
export function docsProblem(docs: DocsSummary): string {
  const changed = docs.written + docs.deleted;
  return changed > 0
    ? `Saved, but updating the docs in ${docs.dir}/ stopped partway, after ${changed} page${changed === 1 ? "" : "s"}: ${docs.error}`
    : `Saved, but the docs in ${docs.dir}/ weren't updated: ${docs.error}`;
}

/** What went wrong beside saving the file, with the docs, the agent skill or both, or null when nothing did. */
export function saveProblem(summary: SaveSummary | void): string | null {
  const skill = summary?.skillError && `the agent skill in ${SKILL_TARGETS.map((t) => `${t}/`).join(" and ")} wasn't updated: ${summary.skillError}`;
  if (summary?.docs?.error) return skill ? `${docsProblem(summary.docs)} Also, ${skill}` : docsProblem(summary.docs);
  return skill ? `Saved, but ${skill}` : null;
}

/**
 * A version of the file to go back or forward to, with the renames that lead from the earlier of
 * the two versions to the later: the ones the edit made, which Undo takes back and Redo makes again.
 */
type Step = { text: string; renames: Rename[] };

/** Earlier versions of the file, for Undo, and ones undone, for Redo. Last is next. */
type History = { undo: Step[]; redo: Step[] };

/** The renames between two versions of the file, worked out from them. */
const renamesFrom = (before: string, after: string) => renamesBetween(loadWorkspace(before), loadWorkspace(after));

/**
 * `onApplied` hears the operations of each edit as it's applied, in the same render as the
 * workspace they make, so what the designer has open can follow a rename without a render in
 * between where it points at an ID that's gone. Undo, Redo, a restore and a reload write a whole
 * version of the file instead, and it hears the renames they make.
 */
export function useWorkspace(host: WorkspaceHost, onApplied?: (ops: Operation[]) => void): WorkspaceState {
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<History>({ undo: [], redo: [] });
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
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
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
          updateHistory(() => ({ undo: [], redo: [] }));
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

  const edit = useCallback(
    (change: Edit) =>
      enqueue(async () => {
        const before = current.current;
        if (before === null) return false;
        const workspace = loadWorkspace(before);
        if (!workspace.valid) {
          setMessage({ kind: "error", text: "This file has errors that stop it being changed safely. Fix it by hand (the Problems list says where), or restore it from version control." });
          return false;
        }
        let next: string;
        let ops: Operation[];
        try {
          ops = typeof change === "function" ? change(workspace) : change;
          if (ops.length === 0) return true;
          next = serializeDocument(applyOperations(workspace.doc, ops).doc);
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
          setMessage({ kind: "error", text: error.message });
          return false;
        }
        if (next === before) return true;
        try {
          await write(next, () => applied.current?.(ops));
        } catch (error) {
          showSaveProblem(`Couldn't save: ${(error as Error).message}`);
          return false;
        }
        updateHistory((h) => ({ undo: [...h.undo, { text: before, renames: renamesIn(ops) }].slice(-HISTORY_LIMIT), redo: [] }));
        return true;
      }),
    [enqueue, write],
  );

  const restore = useCallback(
    (target: string) =>
      enqueue(async () => {
        const before = current.current;
        if (before === null) return false;
        if (target === before) return true;
        const renames = renamesFrom(before, target);
        try {
          await write(target, () => applied.current?.(renames));
        } catch (error) {
          showSaveProblem(`Couldn't save: ${(error as Error).message}`);
          return false;
        }
        updateHistory((h) => ({ undo: [...h.undo, { text: before, renames }].slice(-HISTORY_LIMIT), redo: [] }));
        return true;
      }),
    [enqueue, write],
  );

  const step = useCallback(
    (direction: "undo" | "redo") =>
      void enqueue(async () => {
        const now = current.current;
        const stack = historyRef.current[direction];
        const target = stack[stack.length - 1];
        if (now === null || target === undefined) return;
        const { renames } = target;
        try {
          await write(target.text, () => applied.current?.(direction === "undo" ? undoRenames(renames) : renames));
        } catch (error) {
          showSaveProblem(`Couldn't save: ${(error as Error).message}`);
          return;
        }
        const back: Step = { text: now, renames };
        updateHistory((h) =>
          direction === "undo" ? { undo: h.undo.slice(0, -1), redo: [...h.redo, back] } : { redo: h.redo.slice(0, -1), undo: [...h.undo, back] },
        );
      }),
    [enqueue, write],
  );

  const storage = deleted ? "memory" : host.storage;

  return {
    ws,
    text,
    diagnostics,
    loadError,
    edit,
    restore,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    storage,
    unsaved: storage === "memory" && text !== null && text !== savedText,
    markSaved: () => setSavedText(current.current),
    docs,
    message,
    notify: setMessage,
    dismissMessage: () => setMessage(null),
  };
}
