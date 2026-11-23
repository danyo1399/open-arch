/**
 * "Ask AI": send a request to an agent, follow its progress, approve or deny what it asks to do,
 * and undo what it changed. In the desktop app the agent changes the file on disk, and the
 * designer reloads it from there. In the web app the agent is the page's own (ai/agent.ts), which
 * talks to a model itself and changes the workspace as the designer does.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentContext, AgentEvent } from "../bridge.js";
import { problemText, UNKNOWN_PROBLEM } from "../problems.js";
import { formatted, Markdown, useMarkdownParser } from "./Markdown.js";

type Answer = "approved" | "denied" | "answered";

type Entry =
  | { kind: "prompt"; text: string }
  /** `writing`: a message still being written, which the next piece of it goes on the end of. */
  | { kind: "progress"; text: string; writing?: boolean }
  | { kind: "permission"; id: string; text: string; answer?: Answer }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

/** What the panel sends requests to: the desktop app's agent, for the open file, or the web app's own. */
export interface Asker {
  /** Run one request. Calls `onEvent` with progress, then once with "done" or "error", and resolves after that. */
  run(prompt: string, context: AgentContext, onEvent: (event: AgentEvent) => void): Promise<void>;
  /** Approve or deny a permission request from the running request, for an agent that makes them. */
  reply?(permissionId: string, allow: boolean): Promise<void>;
  /** Stop the running request. */
  cancel(): Promise<void> | void;
  /** Forget the conversation so far, for an agent that keeps one: the next request starts another. */
  reset?(): void;
  /**
   * Whether it says when it changes the workspace, with a "changed" event. Then only its own
   * changes are offered to undo. One that doesn't, such as the desktop app's, which changes the
   * file on disk, is taken to have made any change there is after a request.
   */
  reportsChanges?: boolean;
}

/**
 * What Undo AI change puts back. From an agent that says when it changes the workspace: the
 * file's text just before its first change in the last request, and the text its last change
 * left. From one that doesn't: the file's text when the request was sent.
 */
type Undoable = { before: string; after?: string };

/**
 * What there is to undo once the agent has made another change, given what there was: null
 * before its first change in the request, and "mixed" once someone else's change came between
 * two of its own. Its changes follow on from one another: each starts from what the last left.
 * One that doesn't was made on top of a change by someone else, such as the person, by hand,
 * while the request ran. Then there's no text to go back to that takes back the agent's changes
 * and keeps theirs, so nothing is offered for that request.
 */
export function afterChange(undoable: Undoable | "mixed" | null, change: { before: string; after: string }): Undoable | "mixed" {
  if (undoable === null) return change;
  if (undoable === "mixed" || undoable.after !== change.before) return "mixed";
  return { before: undoable.before, after: change.after };
}

/**
 * Whether the workspace is as the agent's change left it, so Undo AI change takes back the
 * agent's work and nobody else's. With an agent that says what it changed, that's while the text
 * is still what its last change left: once the person changes something too, Undo and History
 * are the way back. With one that doesn't say, it's any difference since the request was sent.
 */
export function canUndo(undoable: Undoable | null, text: string): boolean {
  if (!undoable || text === undoable.before) return false;
  return undoable.after === undefined || text === undoable.after;
}

/**
 * What's going on while the panel is hidden, for the Ask AI button to show: a request is still
 * being worked on, the agent asks for approval and is waiting for it, or the request finished,
 * with an answer or an error.
 */
export type AskNews = "working" | "waiting" | "finished";

/** What the Ask AI button says of the news, for its tooltip and for screen readers. */
export const NEWS_TEXT: Record<AskNews, string> = {
  working: "Ask AI is working on your request. Open it to follow along.",
  waiting: "Ask AI is waiting for you to approve something.",
  finished: "Ask AI has finished. Open it to read the answer.",
};

interface AskAIProps {
  /** The same one for as long as the panel is there: a new one stops the request the last was running. */
  agent: Asker;
  context: AgentContext;
  /** Where the user is, in words. */
  contextLabel: string;
  /** The file's text now. */
  text: string;
  /**
   * Puts the file back as `text`. With `from`, only if the file is still that when it's done,
   * so a change made meanwhile isn't written over. Resolves to false if it wasn't put back.
   */
  restore(text: string, from?: string): Promise<boolean>;
  /** Hears when a request starts running, and when it ends. */
  onRunning?(running: boolean): void;
  /** Why a request can't be sent just now, such as the workspace being saved somewhere else, or null when it can. */
  hold?(): string | null;
  open: boolean;
  /** Hides the panel. A request that's running carries on. */
  onHide(): void;
  /** Hears what happened while the panel was hidden, and null once it's shown again. */
  onNews?(news: AskNews | null): void;
  /** What the box is for, where it isn't only for changes. */
  asks?: { label: string; placeholder: string };
  /** Shown in place of the log and the box while no request is running, such as settings to fill in first. */
  setup?: ReactNode;
  /** More buttons for the header, while no request is running. */
  actions?: ReactNode;
  /** A line above the box. */
  note?: ReactNode;
}

const CHANGES = { label: "What should the AI change?", placeholder: "Describe a change, like “Add a Redis cache that the Checkout API uses”" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: message". What's left once that's taken off may be nothing. */
function errorText(error: unknown): string {
  return problemText(error).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, "").trim() || UNKNOWN_PROBLEM;
}

export function AskAI({ agent, context, contextLabel, text, restore, onRunning, hold, open, onHide, onNews, asks = CHANGES, setup: wanted, actions, note }: AskAIProps) {
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  /** What "Undo AI change" puts back, once the last request changed something. */
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  /** The changes the agent has said it made in the running request, as one to undo. */
  const changes = useRef<Undoable | "mixed" | null>(null);
  const busy = useRef(false);
  // A request that's running keeps its log and its Stop button, whatever else there is to show.
  const setup = running ? undefined : wanted;
  const logEnd = useRef<HTMLDivElement>(null);
  /** Whether a request finished while the panel was hidden, and it hasn't been shown since. A request ends long after it was sent, so it reads whether it's shown then. */
  const [finishedUnseen, setFinishedUnseen] = useState(false);
  const shown = useRef(open);
  shown.current = open;
  // Showing the panel shows how it finished.
  useEffect(() => {
    if (open) setFinishedUnseen(false);
  }, [open]);
  // What to show on the Ask AI button while the panel is hidden. It waits for as long as an approval it asked for has no answer, here or elsewhere, so hiding the panel again without answering still says so.
  // Only the running request's: one an earlier request asked for and was stopped before an answer isn't waited for.
  const waiting = running && log.slice(log.findLastIndex((e) => e.kind === "prompt")).some((e) => e.kind === "permission" && !e.answer);
  const news: AskNews | null = open ? null : finishedUnseen ? "finished" : waiting ? "waiting" : running ? "working" : null;
  const onNewsNow = useRef(onNews);
  onNewsNow.current = onNews;
  useEffect(() => onNewsNow.current?.(news), [news]);
  // Without the panel, there's nothing to show on the button.
  useEffect(() => () => onNewsNow.current?.(null), []);

  // Loaded once the panel is opened, so an answer is drawn from its markdown from the start, as a rule.
  const parse = useMarkdownParser(open || log.length > 0);
  // Drawing an answer from its markdown, once the parser is there, can make it taller: its end is scrolled to then too.
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log, parse]);
  // Closing the file stops a request that's still running.
  useEffect(
    () => () => {
      if (busy.current) void agent.cancel();
    },
    [agent],
  );

  const add = (entry: Entry) => setLog((l) => [...l, entry]);
  /** Record the answer to a permission request. With `ifOpen`, leave it alone if it already has one. */
  const setAnswer = (id: string, answer: Answer | undefined, ifOpen = false) =>
    setLog((l) => l.map((e) => (e.kind === "permission" && e.id === id && !(ifOpen && e.answer) ? { ...e, answer } : e)));

  const onEvent = (event: AgentEvent) => {
    if (event.type === "progress") add({ kind: "progress", text: event.text });
    // A piece of a message goes on the end of the one being written, or starts one.
    else if (event.type === "delta")
      setLog((l) => {
        const last = l[l.length - 1];
        return last?.kind === "progress" && last.writing ? [...l.slice(0, -1), { ...last, text: last.text + event.text }] : [...l, { kind: "progress", text: event.text, writing: true }];
      });
    // What the agent says it changed is what there is to undo: back to just before its first change.
    else if (event.type === "changed") {
      changes.current = afterChange(changes.current, event);
      setUndoable(changes.current === "mixed" ? null : changes.current);
    }
    else if (event.type === "permission") add({ kind: "permission", id: event.id, text: event.description });
    else if (event.type === "permission-replied") setAnswer(event.id, "answered", true);
    else if (event.type === "error") add({ kind: "error", text: problemText(event.message) });
    else {
      // The summary is usually the agent's last message: show it once.
      setLog((l) => {
        const last = l[l.length - 1];
        return [...(last?.kind === "progress" && last.text.trim() === event.summary.trim() ? l.slice(0, -1) : l), { kind: "done", text: event.summary }];
      });
    }
  };

  const send = async () => {
    const request = prompt.trim();
    if (!request || busy.current) return;
    // Held: it's said, and what was typed stays in the box to send after.
    const held = hold?.();
    if (held) return add({ kind: "error", text: held });
    busy.current = true;
    setRunning(true);
    onRunning?.(true);
    setPrompt("");
    changes.current = null;
    // An agent that says what it changes has changed nothing yet. Any other is taken to have made whatever changes from here.
    setUndoable(agent.reportsChanges ? null : { before: text });
    add({ kind: "prompt", text: request });
    try {
      await agent.run(request, context, onEvent);
    } catch (error) {
      add({ kind: "error", text: errorText(error) });
    } finally {
      busy.current = false;
      setRunning(false);
      onRunning?.(false);
      // An answer or an error: either way it's finished, and there's something to read.
      if (!shown.current) setFinishedUnseen(true);
    }
  };

  const answer = async (id: string, allow: boolean) => {
    setAnswer(id, allow ? "approved" : "denied");
    try {
      await agent.reply?.(id, allow);
    } catch (error) {
      setAnswer(id, undefined);
      add({ kind: "error", text: errorText(error) });
    }
  };

  // Where the agent said what its change left, only that is replaced: a change by hand that's
  // still being saved as the button is pressed isn't written over, and the offer goes with it.
  const undo = async () => {
    if (undoable && (await restore(undoable.before, undoable.after))) {
      setUndoable(null);
      add({ kind: "progress", text: "Undid the AI's change." });
    }
  };

  /** Starts a new conversation, with nothing in the log. What the AI changed stays changed. */
  const startAgain = () => {
    agent.reset?.();
    setLog([]);
    setUndoable(null);
  };

  return (
    <section className="ask-ai" aria-label="Ask AI" hidden={!open}>
      <header className="ask-ai-header">
        <h2>Ask AI</h2>
        <span className="muted small grow">{contextLabel}</span>
        {agent.reset && !setup && !running && log.length > 0 && (
          <button className="link small" onClick={startAgain} title="Start a new conversation: the AI forgets this one. What it changed stays changed.">
            New chat
          </button>
        )}
        {!running && actions}
        <button className="icon" onClick={onHide} aria-label="Hide Ask AI" title="Hide Ask AI. A request carries on while it's hidden, and the Ask AI button shows when it's finished.">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </header>
      {setup}
      {!setup && log.length > 0 && (
        <div className="ask-ai-log" aria-live="polite">
          {log.map((entry, i) => (
            <LogEntry key={i} entry={entry} onAnswer={(id, allow) => void answer(id, allow)} />
          ))}
          <div ref={logEnd} />
        </div>
      )}
      {!setup && !running && canUndo(undoable, text) && (
        <div className="ask-ai-undo">
          <span className="small muted grow">The AI changed the model.</span>
          <button onClick={() => void undo()} title="Put the file back as it was before the AI changed it. Undo takes this back.">
            Undo AI change
          </button>
        </div>
      )}
      <form
        hidden={!!setup}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {note}
        <textarea
          value={prompt}
          rows={3}
          disabled={running}
          aria-label={asks.label}
          placeholder={asks.placeholder}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="ask-ai-actions">
          <span className="muted small grow">{running ? "Working…" : `${isMac ? "⌘" : "Ctrl+"}Enter to send`}</span>
          {running ? (
            <button type="button" onClick={() => void agent.cancel()}>
              Stop
            </button>
          ) : (
            <button className="primary" type="submit" disabled={!prompt.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function LogEntry({ entry, onAnswer }: { entry: Entry; onAnswer(id: string, allow: boolean): void }) {
  switch (entry.kind) {
    case "prompt":
      return <p className="ask-ai-prompt">{entry.text}</p>;
    case "progress":
      // Commands the agent runs are shown as they are.
      return entry.text.startsWith("$ ") ? <p className="ask-ai-progress command">{entry.text}</p> : <Markdown className="ask-ai-progress" text={entry.text} />;
    case "done":
      return <Markdown className="ask-ai-done" text={entry.text} />;
    case "error":
      return <p className="ask-ai-error error">{entry.text}</p>;
    case "permission":
      return (
        <div className="ask-ai-permission">
          <p>
            <strong>The AI asks to:</strong> {formatted(entry.text)}
          </p>
          {entry.answer ? (
            <span className="small muted">{entry.answer === "approved" ? "Approved" : entry.answer === "denied" ? "Denied" : "Answered"}</span>
          ) : (
            <div className="actions">
              <button className="primary" onClick={() => onAnswer(entry.id, true)}>
                Approve
              </button>
              <button onClick={() => onAnswer(entry.id, false)}>Deny</button>
            </div>
          )}
        </div>
      );
  }
}
