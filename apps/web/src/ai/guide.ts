/**
 * What Ask AI's model is told about changing a workspace. It's taken from the agent skill's own
 * pages (packages/skill), which agents with a command line read, so the two can't say different
 * things: each operation's fields, and the recipes for each kind of change.
 */
import { OPERATION_NAMES } from "@open-arch/core";
import { skillFiles } from "../skill.js";

const page = (path: string) => skillFiles.find((f) => f.path === path)?.content ?? "";

/** The part of a markdown page under a `## ` heading, up to the next one. */
function section(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

const operations = section(page("references/commands.md"), "Operations for `apply`");

/** Each operation's fields, as the skill's table lists them, the ones it needs in bold. */
export const OPERATION_FIELDS: ReadonlyMap<string, string> = new Map(
  operations.split("\n").flatMap((line): [string, string][] => {
    const row = /^\| `([a-z-]+)` \| (.*) \|$/.exec(line.trim());
    // The table's heading is a row too, and isn't an operation.
    return row && (OPERATION_NAMES as string[]).includes(row[1]!) ? [[row[1]!, row[2]!]] : [];
  }),
);

/** The skill's example of a list of operations, as JSON. */
const EXAMPLE = /```json\n([\s\S]*?)```/.exec(operations)?.[1]?.trim() ?? "";

/** Operations and their fields, one to a line: all of them, or the ones named. */
export function operationLines(names: Iterable<string> = OPERATION_FIELDS.keys()): string {
  return [...names].map((name) => `- ${name}: ${OPERATION_FIELDS.get(name) ?? "(unknown)"}`).join("\n");
}

/** Every operation and its fields, with an example. */
export function operationsGuide(): string {
  return [
    'Each operation is an object with "op" and the fields below, the ones it needs in **bold**. In update-* operations, only the fields given change, and null removes one.',
    "",
    operationLines(),
    "",
    "Example:",
    EXAMPLE,
  ].join("\n");
}

const skill = page("SKILL.md");

/** The rules of the model, as the skill puts them. */
export const RULES = section(skill, "Rules");

/** How each kind of change is made, and the rules of the model. */
export function recipesGuide(): string {
  return [
    "These recipes are written for agents with a command line, as `open-arch` commands. Here there's none: make each command an operation for change_model. The command's name is the operation's \"op\", and what it's given are that operation's fields, as the operations guide lists them: `open-arch add-element cache --kind container --parent shop` is { \"op\": \"add-element\", \"id\": \"cache\", \"kind\": \"container\", \"parent\": \"shop\" }. An option given several times, such as --member, --library, --run or --key, is one field holding a list. Where a recipe says `show`, use show_model, and for `check`, check_model. There's no --dry-run, and nothing to apply from a file.",
    "",
    section(skill, "Recipes"),
    "",
    "Rules:",
    RULES,
  ].join("\n");
}
