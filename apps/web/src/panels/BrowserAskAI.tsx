/**
 * "Ask AI" in the web app: the panel, with the page's own agent behind it (ai/agent.ts), and the
 * settings that say which model it talks to. The settings are this person's, kept in this
 * browser and nowhere else (ai/settings.ts).
 */
import type { Workspace } from "@open-arch/core";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { BrowserAgent, type AgentSetup } from "../ai/agent.js";
import { settingsProblem, useAiSettings, type AiSettings } from "../ai/settings.js";
import type { AgentContext } from "../bridge.js";
import { FolderHost } from "../folders.js";
import type { WorkspaceHost } from "../hosts.js";
import { problemText } from "../problems.js";
import type { WorkspaceState } from "../state.js";
import { AskAI } from "./AskAI.js";

interface BrowserAskAIProps {
  host: WorkspaceHost;
  /** Where edits go now: a folder's files are only read while its workspace is still saved there. */
  storage: WorkspaceHost["storage"];
  change: WorkspaceState["change"];
  afterEdits: WorkspaceState["afterEdits"];
  context: AgentContext;
  contextLabel: string;
  text: string;
  restore(text: string): Promise<boolean>;
  open: boolean;
  onClose(): void;
  /** The page's `fetch`, unless a test gives its own. */
  fetch?: typeof fetch;
}

const ASKS = { label: "What do you want to ask, or change?", placeholder: "Ask about the model, or describe a change, like “Add a Redis cache that the Checkout API uses”" };

export function BrowserAskAI({ host, storage, change, afterEdits, fetch: send, ...panel }: BrowserAskAIProps) {
  const ai = useAiSettings(host.key);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const folder = host instanceof FolderHost && storage === "file" ? host.root : undefined;
  // The agent reads these as it works, so it's the same one whatever changes. The workspace's
  // edits are the ones there are when a tool runs: after Save, they go to where it's kept now.
  const edits = useRef({ change, afterEdits });
  edits.current = { change, afterEdits };
  const setup = useRef<AgentSetup | null>(null);
  setup.current = {
    settings: ai.settings,
    fetch: send,
    host: {
      fileName: host.name,
      workspace: () => new Promise<Workspace | null>((resolve) => void edits.current.afterEdits(resolve)),
      change: (ops) => edits.current.change(ops),
      folder: ai.readsFiles ? folder : undefined,
    },
  };
  const agent = useMemo(() => new BrowserAgent(() => setup.current!), []);

  /** Keeps a choice in the browser, saying so if it won't. The settings close once they're kept. */
  const keep = (task: () => void, close = false) => {
    try {
      task();
      setProblem(null);
      if (close) setEditing(false);
    } catch (error) {
      setProblem(problemText(error));
    }
  };

  return (
    <AskAI
      {...panel}
      agent={agent}
      asks={ASKS}
      setup={
        !ai.settings || editing ? (
          <SettingsForm
            // A new form once they're forgotten, so the key that was typed isn't left in its box.
            key={ai.settings ? "kept" : "none"}
            settings={ai.settings}
            problem={problem}
            onSave={(next) => keep(() => ai.save(next), true)}
            onForget={() => keep(() => ai.save(null), true)}
            onCancel={() => {
              setProblem(null);
              setEditing(false);
            }}
          />
        ) : undefined
      }
      actions={
        ai.settings &&
        !editing && (
          <button
            className="link small"
            onClick={() => {
              setProblem(null);
              setEditing(true);
            }}
            title="The server, the key and the model Ask AI uses"
          >
            Settings
          </button>
        )
      }
      note={
        folder && (
          <>
            <label className="check small" title="It can find, read and search the files in this folder, but not change them. Hidden files and folders, such as .env and .git, node_modules, and files named as keys and secrets usually are, such as id_rsa and secrets.yaml, are left out. What it reads is sent to the model's server.">
              <input type="checkbox" checked={ai.readsFiles} onChange={(e) => keep(() => ai.setReadsFiles(e.target.checked))} />
              Let the AI read the files in {folder.name}
            </label>
            {problem && !editing && ai.settings && (
              <p className="error small" role="alert">
                {problem}
              </p>
            )}
          </>
        )
      }
    />
  );
}

interface SettingsFormProps {
  /** The settings kept now, or null before any are. */
  settings: AiSettings | null;
  /** Why the last save didn't go through. */
  problem: string | null;
  onSave(settings: AiSettings): void;
  onForget(): void;
  onCancel(): void;
}

/** The server, the key and the model, to fill in before the first request, or to change. */
function SettingsForm({ settings, problem, onSave, onForget, onCancel }: SettingsFormProps) {
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? "");
  const [model, setModel] = useState(settings?.model ?? "");
  const [wrong, setWrong] = useState<string | null>(null);
  const save = (e: FormEvent) => {
    e.preventDefault();
    const next = { baseUrl, apiKey, model };
    const why = settingsProblem(next);
    setWrong(why);
    if (!why) onSave(next);
  };
  return (
    <form className="ask-ai-settings" onSubmit={save}>
      <p className="small muted">
        Ask AI talks to a model straight from this page, through any server that speaks OpenAI's chat API, such as OpenAI, OpenRouter or a model running on this computer. What you ask, and what the AI reads to answer, is sent to that server.
      </p>
      <label className="field">
        <span className="field-label">Server address</span>
        <input type="url" value={baseUrl} placeholder="https://api.openai.com/v1" aria-label="Server address" autoComplete="off" spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">API key</span>
        <input type="password" value={apiKey} aria-label="API key" autoComplete="off" spellCheck={false} onChange={(e) => setApiKey(e.target.value)} />
        <span className="field-hint">Leave it empty for a server that needs none.</span>
      </label>
      <label className="field">
        <span className="field-label">Model</span>
        <input value={model} placeholder="gpt-5" aria-label="Model" autoComplete="off" spellCheck={false} onChange={(e) => setModel(e.target.value)} />
      </label>
      <p className="small muted">These are kept in this browser, in its local storage, until you forget them. They're never saved in the workspace, an export or a shared link.</p>
      {(wrong ?? problem) && (
        <p className="error small" role="alert">
          {wrong ?? problem}
        </p>
      )}
      <div className="ask-ai-actions">
        <span className="grow" />
        {settings && (
          <button type="button" className="danger" onClick={onForget} title="Take the address, the key and the model out of this browser">
            Forget
          </button>
        )}
        {settings && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary" type="submit">
          Save
        </button>
      </div>
    </form>
  );
}
