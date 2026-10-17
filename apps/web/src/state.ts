/** The open workspace: its files, the parsed model, problems, edits and undo. */
import { applyChanges, checkWorkspace, loadWorkspace, OpError, parseConfig, type Diagnostic, type FileChange, type InputFile, type Workspace } from "@open-arch/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceHost, WorkspaceSnapshot } from "./hosts.js";

export type Edit = (ws: Workspace) => FileChange[] | undefined;

export interface WorkspaceState {
  ws: Workspace | null;
  diagnostics: Diagnostic[];
  loadError: string | null;
  /** Apply an edit and save it. Resolves to false when the edit was refused. */
  edit(fn: Edit): Promise<boolean>;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  message: { kind: "error" | "info"; text: string } | null;
  dismissMessage(): void;
}

const HISTORY_LIMIT = 100;

export function parseSnapshot(snapshot: WorkspaceSnapshot): Workspace {
  const { config, diagnostics } = parseConfig(snapshot.configText);
  return loadWorkspace(snapshot.files, config, diagnostics);
}

/** The file changes that turn `from` into `to`. */
export function diffFiles(from: InputFile[], to: InputFile[]): FileChange[] {
  const before = new Map(from.map((f) => [f.path, f.text]));
  const after = new Map(to.map((f) => [f.path, f.text]));
  const changes: FileChange[] = [];
  for (const [path, text] of after) if (before.get(path) !== text) changes.push({ path, content: text });
  for (const path of before.keys()) if (!after.has(path)) changes.push({ path, content: null });
  return changes;
}

/** Run several edits in a row, each seeing the result of the last, as one set of changes. */
export function chain(ws: Workspace, ...steps: Edit[]): FileChange[] {
  let current = ws;
  for (const step of steps) {
    const changes = step(current);
    if (changes?.length) current = loadWorkspace(applyChanges(current.inputs, changes), current.config);
  }
  return diffFiles(ws.inputs, current.inputs);
}

function sameSnapshot(a: WorkspaceSnapshot, b: WorkspaceSnapshot): boolean {
  if (a.configText !== b.configText || a.files.length !== b.files.length) return false;
  const map = new Map(a.files.map((f) => [f.path, f.text]));
  return b.files.every((f) => map.get(f.path) === f.text);
}

export function useWorkspace(host: WorkspaceHost): WorkspaceState {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ undo: InputFile[][]; redo: InputFile[][] }>({ undo: [], redo: [] });
  const [message, setMessage] = useState<WorkspaceState["message"]>(null);
  const current = useRef<WorkspaceSnapshot | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const commit = (next: WorkspaceSnapshot) => {
    current.current = next;
    setSnapshot(next);
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
      .then((s) => !cancelled && commit(s))
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    const stop = host.watch?.(() => {
      void enqueue(async () => {
        const next = await host.load();
        if (cancelled || (current.current && sameSnapshot(current.current, next))) return;
        commit(next);
        setHistory({ undo: [], redo: [] });
        setMessage({ kind: "info", text: "Files changed outside the designer, so the workspace was reloaded." });
      });
    });
    return () => {
      cancelled = true;
      stop?.();
      host.close?.();
    };
  }, [host, enqueue]);

  const ws = useMemo(() => (snapshot ? parseSnapshot(snapshot) : null), [snapshot]);
  const diagnostics = useMemo(() => (ws ? checkWorkspace(ws) : []), [ws]);

  const write = useCallback(
    async (files: InputFile[], changes: FileChange[]) => {
      await host.write(changes);
      commit({ configText: current.current!.configText, files });
    },
    [host],
  );

  const edit = useCallback(
    (fn: Edit) =>
      enqueue(async () => {
        const snap = current.current;
        if (!snap) return false;
        let changes: FileChange[] | undefined;
        try {
          changes = fn(parseSnapshot(snap));
        } catch (error) {
          if (!(error instanceof OpError)) throw error;
          setMessage({ kind: "error", text: error.message });
          return false;
        }
        if (!changes?.length) return true;
        try {
          await write(applyChanges(snap.files, changes), changes);
        } catch (error) {
          setMessage({ kind: "error", text: `Couldn't save: ${(error as Error).message}` });
          return false;
        }
        setHistory((h) => ({ undo: [...h.undo, snap.files].slice(-HISTORY_LIMIT), redo: [] }));
        return true;
      }),
    [enqueue, write],
  );

  const step = useCallback(
    (direction: "undo" | "redo") =>
      void enqueue(async () => {
        const snap = current.current;
        const stack = history[direction];
        const target = stack[stack.length - 1];
        if (!snap || !target) return;
        await write(target, diffFiles(snap.files, target));
        setHistory((h) =>
          direction === "undo"
            ? { undo: h.undo.slice(0, -1), redo: [...h.redo, snap.files] }
            : { redo: h.redo.slice(0, -1), undo: [...h.undo, snap.files] },
        );
      }),
    [enqueue, history, write],
  );

  return {
    ws,
    diagnostics,
    loadError,
    edit,
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    message,
    dismissMessage: () => setMessage(null),
  };
}
