/**
 * "Ask AI" (desktop app): send a request to the app's agent, follow its
 * progress, approve or deny what it asks to do, and undo what it changed. The
 * agent changes the file on disk, and the designer reloads it from there.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentBridge, AgentContext, AgentEvent } from "../bridge.js";

type Answer = "approved" | "denied" | "answered";

type Entry =
  | { kind: "prompt"; text: string }
  | { kind: "progress"; text: string }
  | { kind: "permission"; id: string; text: string; answer?: Answer }
  | { kind: "done"; text: string }
  | { kind: "error"; text: string };

interface AskAIProps {
  agent: AgentBridge;
  /** The open file, as the bridge knows it. */
  path: string;
  context: AgentContext;
  /** Where the user is, in words. */
  contextLabel: string;
  /** The file's text now. */
  text: string;
  restore(text: string): Promise<boolean>;
  open: boolean;
  onClose(): void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Errors from the main process arrive as "Error invoking remote method 'x': Error: message". */
function errorText(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']*': (\w*Error: )?/, "");
}

/** Show the agent's `code` and **bold** markdown. */
function formatted(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (/^`.+`$/s.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*.+\*\*$/s.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

export function AskAI({ agent, path, context, contextLabel, text, restore, open, onClose }: AskAIProps) {
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState<Entry[]>([]);
  const [running, setRunning] = useState(false);
  /** The file before the last request, for "Undo AI change". */
  const [before, setBefore] = useState<string | null>(null);
  const busy = useRef(false);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log]);
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
    else if (event.type === "permission") add({ kind: "permission", id: event.id, text: event.description });
    else if (event.type === "permission-replied") setAnswer(event.id, "answered", true);
    else if (event.type === "error") add({ kind: "error", text: event.message });
    else {
      // The summary is usually the agent's last message: show it once.
      setLog((l) => {
        const last = l[l.length - 1];
        return [...(last?.kind === "progress" && last.text === event.summary ? l.slice(0, -1) : l), { kind: "done", text: event.summary }];
      });
    }
  };

  const send = async () => {
    const request = prompt.trim();
    if (!request || busy.current) return;
    busy.current = true;
    setRunning(true);
    setPrompt("");
    setBefore(text);
    add({ kind: "prompt", text: request });
    try {
      await agent.run(path, request, context, onEvent);
    } catch (error) {
      add({ kind: "error", text: errorText(error) });
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const answer = async (id: string, allow: boolean) => {
    setAnswer(id, allow ? "approved" : "denied");
    try {
      await agent.reply(id, allow);
    } catch (error) {
      setAnswer(id, undefined);
      add({ kind: "error", text: errorText(error) });
    }
  };

  const undo = async () => {
    if (before !== null && (await restore(before))) {
      setBefore(null);
      add({ kind: "progress", text: "Undid the AI's change." });
    }
  };

  return (
    <section className="ask-ai" aria-label="Ask AI" hidden={!open}>
      <header className="ask-ai-header">
        <h2>Ask AI</h2>
        <span className="muted small grow">{contextLabel}</span>
        <button className="icon" onClick={onClose} aria-label="Close Ask AI">
          ×
        </button>
      </header>
      {log.length > 0 && (
        <div className="ask-ai-log" aria-live="polite">
          {log.map((entry, i) => (
            <LogEntry key={i} entry={entry} onAnswer={(id, allow) => void answer(id, allow)} />
          ))}
          <div ref={logEnd} />
        </div>
      )}
      {!running && before !== null && text !== before && (
        <div className="ask-ai-undo">
          <span className="small muted grow">The AI changed the model.</span>
          <button onClick={() => void undo()} title="Put the file back as it was before this request. Undo takes this back.">
            Undo AI change
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={prompt}
          rows={3}
          disabled={running}
          aria-label="What should the AI change?"
          placeholder="Describe a change, like “Add a Redis cache that the Checkout API uses”"
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
      return entry.text.startsWith("$ ") ? <p className="ask-ai-progress command">{entry.text}</p> : <p className="ask-ai-progress">{formatted(entry.text)}</p>;
    case "done":
      return <p className="ask-ai-done">{formatted(entry.text)}</p>;
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
