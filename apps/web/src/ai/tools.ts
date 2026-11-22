/**
 * The tools Ask AI's model can call, in the page: read the workspace, search it, check it, change
 * it through the operations every edit goes through, and, for a workspace opened from a folder
 * whose files the person lets it read, find, read and search those.
 */
import { checkWorkspace, computeView, errorCount, formatDiagnostic, parseOperations, scopeProblems, showElement, showView, showWorkspace, suggest, OpError, type Operation, type Workspace } from "@open-arch/core";
import type { FolderHandle } from "../folders.js";
import { problemText } from "../problems.js";
import type { Change } from "../state.js";
import type { ToolSpec } from "./client.js";
import { FileProblem, findFiles, LINES_LIMIT, readFile, searchFiles } from "./files.js";
import { operationsGuide, recipesGuide } from "./guide.js";

/** What the tools work on: the open workspace, and the folder it's in, when there is one to read. */
export interface ToolHost {
  /** The workspace's file name, to call it by. */
  fileName: string;
  /** The workspace as it is once the edits made so far have landed, or null when none is open. */
  workspace(): Promise<Workspace | null>;
  /** Applies operations, all or none, and saves. */
  change(ops: Operation[]): Promise<Change>;
  /** The folder the workspace was opened from, when the person lets the model read its files. */
  folder?: FolderHandle;
}

/** What a tool call came to: what the model is told, and what the person is, in a line. */
export interface ToolResult {
  /** The tool's answer, for the model. */
  answer: string;
  /** What was done, for the log the person reads. */
  did: string;
}

/** The most of a tool's answer the model is given: a longer one is cut, and says so. */
export const ANSWER_LIMIT = 40_000;

/** The most matches a search of the model answers with. */
const MATCH_LIMIT = 100;

const text = { type: "string" } as const;

const MODEL_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "show_model",
      description:
        "Read the workspace. Without an ID: the model as a tree of elements, and the list of views. With an element's ID: its fields, notes, what it uses and what uses it, and the views showing it. With a view's ID: what that diagram draws.",
      parameters: { type: "object", properties: { id: { ...text, description: "An element's or a view's ID. Leave out for the whole model." } } },
    },
  },
  {
    type: "function",
    function: {
      name: "search_model",
      description: "Find text anywhere in the workspace: in IDs, names, descriptions, technologies, tags, notes and what's on the views. Capitals don't matter. Answers with where each match is.",
      parameters: { type: "object", properties: { text: { ...text, description: "The text to find, as it's written." } }, required: ["text"] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_model",
      description: "List the problems in the workspace: errors and warnings, each with where it is and how to fix it.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "change_model",
      description:
        "Change the workspace with a list of operations, applied in order, all or none. Refused if any operation is wrong or the result would have errors: then nothing changed, and the answer says why. Answers with what changed, and any warnings the change brought.",
      parameters: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            description: 'The operations, each an object with "op" and its fields, like { "op": "add-element", "id": "cache", "kind": "container", "parent": "shop", "name": "Cache" }.',
            items: { type: "object", properties: { op: text }, required: ["op"], additionalProperties: true },
          },
        },
        required: ["operations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_guide",
      description: 'Read how to change the workspace. "operations": every operation and its fields. "recipes": how each kind of thing is added or changed, such as the steps of a sequence view or the screens of a wireframe, and the rules to follow.',
      parameters: { type: "object", properties: { topic: { type: "string", enum: ["operations", "recipes"] } }, required: ["topic"] },
    },
  },
];

const FILE_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "find_files",
      description:
        "List the files in the folder the workspace was opened from, by path. Hidden files and folders, and node_modules, are left out. With a pattern, only the files whose path matches: * is any run of characters in a name, ** any run of folders, ? one character; a pattern without those is text the path has to contain.",
      parameters: {
        type: "object",
        properties: { pattern: { ...text, description: "Like *.ts, src/**/*.test.ts or checkout." }, folder: { ...text, description: "A folder to look in, like src/api. Leave out for the whole folder." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: `Read a text file in the folder the workspace was opened from, with its lines numbered. A long file is read ${LINES_LIMIT} lines at a time.`,
      parameters: {
        type: "object",
        properties: {
          path: { ...text, description: "The file's path in the folder, like src/main.ts." },
          from: { type: "integer", description: "The first line to read: 1 is the file's first. Default: 1." },
          lines: { type: "integer", description: `How many lines to read. Default: ${LINES_LIMIT}, the most.` },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Find the lines with some text in them, in the files of the folder the workspace was opened from. Capitals don't matter. Answers with each line's file and number.",
      parameters: {
        type: "object",
        properties: {
          text: { ...text, description: "The text to find, as it's written." },
          pattern: { ...text, description: "Only search files whose path matches, like *.ts." },
          folder: { ...text, description: "A folder to search in, like src/api. Leave out for the whole folder." },
        },
        required: ["text"],
      },
    },
  },
];

/** The tools the model is offered: the file tools only when there's a folder it may read. */
export const toolSpecs = (host: Pick<ToolHost, "folder">): ToolSpec[] => (host.folder ? [...MODEL_TOOLS, ...FILE_TOOLS] : MODEL_TOOLS);

/** Something wrong with how a tool was called, said so the model can call it again. */
class BadCall extends Error {}

type Args = Record<string, unknown>;

/** A text argument: undefined when it's left out, or empty. */
function textArg(args: Args, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new BadCall(`"${name}" must be text.`);
  return value;
}

function needed(args: Args, name: string): string {
  const value = textArg(args, name);
  if (value === undefined) throw new BadCall(`Give "${name}".`);
  return value;
}

/** A whole-number argument: undefined when it's left out. */
function numberArg(args: Args, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new BadCall(`"${name}" must be a whole number, 1 or more.`);
  return value;
}

const quote = (value: string) => `“${brief(value, 80)}”`;

/** Text short enough for a line of the log: the model is told all of it, the person the start. */
function brief(text: string, most = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > most ? `${flat.slice(0, most)}…` : flat;
}

/** A value with the text in it, on one line: a long one cut down to the part round the text. */
function excerpt(value: string, find: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= 160) return flat;
  const start = Math.max(0, Math.min(flat.toLowerCase().indexOf(find) - 60, flat.length - 160));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + 160)}${start + 160 < flat.length ? "…" : ""}`;
}

/** The parts of the file whose keys are names someone gave: a tag's name, or the ID of a sticky note, a state or a node. */
const NAMED = new Set(["tags", "stickies", "states", "nodes"]);

/**
 * Everywhere some text is in the workspace's file: in an element's or view's ID, or in any text
 * kept on one, whatever kind of view it is. Each match says where it is, as the path in the file.
 */
export function searchModel(ws: Workspace, wanted: string): string {
  const find = wanted.toLowerCase();
  const matches: string[] = [];
  let more = false;
  const add = (line: string) => {
    if (matches.length < MATCH_LIMIT) matches.push(line);
    else more = true;
  };
  const walk = (value: unknown, path: string, key: string) => {
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`, key));
    else if (value && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) {
        // Where boxes were dragged to: numbers, by element, which a search for the element finds anyway.
        if (name === "layout") continue;
        const at = path ? `${path}.${name}` : name;
        // Text is found by what it says, and anything with a name someone gave by the name too.
        const named = NAMED.has(key) && name.toLowerCase().includes(find);
        if (typeof item === "string") {
          if (named || item.toLowerCase().includes(find)) add(`  ${at}: ${excerpt(item, find)}`);
          continue;
        }
        if (named) add(`  ${at}`);
        walk(item, at, name);
      }
    } else if (typeof value === "string" && value.toLowerCase().includes(find)) add(`  ${path}: ${excerpt(value, find)}`);
  };
  const lines: string[] = [];
  const section = (heading: string, look: () => void) => {
    const before = matches.length;
    look();
    if (matches.length > before) lines.push(heading, ...matches.slice(before));
  };
  const { elements, views, ...rest } = ws.doc;
  section("Workspace:", () => walk(rest, "", ""));
  for (const [id, element] of Object.entries(elements)) {
    section(`Element ${id} (${element.kind}, ${element.name}):`, () => {
      if (id.toLowerCase().includes(find)) add("  its ID");
      walk(element, "", "");
    });
  }
  for (const [id, view] of Object.entries(views)) {
    section(`View ${id} (${view.level} view, ${view.title}):`, () => {
      if (id.toLowerCase().includes(find)) add("  its ID");
      walk(view, "", "");
    });
  }
  if (lines.length === 0) return `Nothing in the workspace has ${JSON.stringify(wanted)} in it.`;
  return lines.join("\n") + (more ? `\n(There are more: these are the first ${MATCH_LIMIT}. Search for something longer.)` : "") + "\n\nCall show_model with an element's or a view's ID for all of it.";
}

function showModel(ws: Workspace, fileName: string, id: string | undefined): ToolResult {
  if (!id) return { answer: `${showWorkspace(ws, fileName).text}\nCall show_model with an ID for details of one element or view.`, did: "Looked at the model" };
  const element = ws.elements.get(id);
  if (element) return { answer: showElement(ws, element).text, did: `Looked at \`${id}\`` };
  const view = ws.views.get(id);
  if (view) {
    const problems = scopeProblems(ws, view);
    if (problems.length) return { answer: `The view "${id}" can't be shown: ${problems[0]!.message} Call check_model for the problems.`, did: `Looked at \`${id}\`` };
    return { answer: showView(ws, computeView(ws, view)).text, did: `Looked at \`${id}\`` };
  }
  const near = suggest(id, [...ws.elements.keys(), ...ws.views.keys()]);
  throw new BadCall(`No element or view has the ID "${id}".${near ? ` Did you mean "${near}"?` : ""} Call show_model without an ID to list them.`);
}

function checkModel(ws: Workspace): string {
  const diagnostics = checkWorkspace(ws);
  if (diagnostics.length === 0) return "No problems.";
  const errors = errorCount(diagnostics);
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return [...diagnostics.map(formatDiagnostic), "", `${count(errors, "error")}, ${count(diagnostics.length - errors, "warning")}.`].join("\n");
}

async function changeModel(host: ToolHost, args: Args): Promise<ToolResult> {
  let ops: Operation[];
  try {
    ops = parseOperations(args.operations);
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    throw new BadCall(`${error.message} Nothing changed. Call read_guide with "operations" for every operation's fields.`);
  }
  const done = await host.change(ops);
  if (!done.ok) return { answer: `Refused, so nothing changed: ${done.error}`, did: `Tried a change that was refused: ${brief(done.error)}` };
  const warnings = done.warnings.length ? ["", "Warnings from this change:", ...done.warnings.map(formatDiagnostic)] : [];
  return { answer: ["Changed:", ...done.summary.map((line) => `- ${line}`), ...warnings].join("\n"), did: `Changed the model: ${brief(done.summary.join("; "))}` };
}

/**
 * Runs one tool call. Never throws for something the model can put right: a tool it doesn't have,
 * arguments that aren't JSON or don't fit, or a file that isn't there come back as the answer. It
 * throws when the request was stopped.
 */
export async function runTool(host: ToolHost, name: string, argumentsText: string, signal?: AbortSignal): Promise<ToolResult> {
  const failed = (why: string): ToolResult => ({ answer: why, did: `Couldn't ${name.replace(/_/g, " ")}: ${brief(why)}` });
  let args: Args;
  try {
    const parsed: unknown = argumentsText.trim() ? JSON.parse(argumentsText) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failed('The arguments must be a JSON object, like { "id": "shop" }.');
    args = parsed as Args;
  } catch (error) {
    return failed(`The arguments weren't JSON that could be read (${problemText(error)}). Call it again with a JSON object.`);
  }
  try {
    if (name === "read_guide") {
      const topic = needed(args, "topic");
      if (topic !== "operations" && topic !== "recipes") throw new BadCall('"topic" must be "operations" or "recipes".');
      return { answer: topic === "operations" ? operationsGuide() : recipesGuide(), did: `Read the guide to ${topic}` };
    }
    if (name === "find_files" || name === "read_file" || name === "search_files") {
      const folder = host.folder;
      if (!folder) return failed("There are no files to read: the workspace wasn't opened from a folder, or the person hasn't let its files be read.");
      if (name === "find_files") {
        const pattern = textArg(args, "pattern");
        return { answer: await findFiles(folder, { pattern, folder: textArg(args, "folder") }, signal), did: pattern ? `Looked for files matching ${quote(pattern)}` : "Listed the files" };
      }
      if (name === "read_file") {
        const path = needed(args, "path");
        return { answer: await readFile(folder, { path, from: numberArg(args, "from"), lines: numberArg(args, "lines") }), did: `Read \`${brief(path, 120)}\`` };
      }
      const wanted = needed(args, "text");
      return { answer: await searchFiles(folder, { text: wanted, pattern: textArg(args, "pattern"), folder: textArg(args, "folder") }, signal), did: `Searched the files for ${quote(wanted)}` };
    }
    if (name === "change_model") return await changeModel(host, args);
    if (name === "show_model" || name === "search_model" || name === "check_model") {
      const ws = await host.workspace();
      if (!ws) return failed("No workspace is open.");
      if (name === "show_model") return showModel(ws, host.fileName, textArg(args, "id"));
      if (name === "check_model") return { answer: checkModel(ws), did: "Checked the model for problems" };
      const wanted = needed(args, "text");
      return { answer: searchModel(ws, wanted), did: `Searched the model for ${quote(wanted)}` };
    }
    return failed(`There's no tool called "${name}". The tools are: ${toolSpecs(host).map((t) => t.function.name).join(", ")}.`);
  } catch (error) {
    if (error instanceof BadCall || error instanceof FileProblem) return failed(error.message);
    signal?.throwIfAborted();
    // Anything else, such as the browser no longer being allowed the folder: the model is told, and can carry on without it.
    return failed(problemText(error));
  }
}
