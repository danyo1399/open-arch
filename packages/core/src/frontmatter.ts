/**
 * Reading and writing YAML frontmatter through the `yaml` Document API, so
 * edits keep the author's comments, quoting and key order.
 */
import { Document, LineCounter, isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from "yaml";
import type { Diagnostic } from "./types.js";

export const ELEMENT_KEY_ORDER = ["kind", "name", "parent", "description", "technology", "external", "tags", "uses"];
export const RELATIONSHIP_KEY_ORDER = ["to", "description", "technology", "tags"];
export const VIEW_KEY_ORDER = ["kind", "title", "description", "level", "scope", "include", "exclude"];

export const STRINGIFY_OPTIONS = { lineWidth: 0, indent: 2, indentSeq: true, flowCollectionPadding: false } as const;

export interface ParsedFrontmatter {
  doc: Document;
  /** Converts a YAML-text offset to a 1-based file line. */
  lineAt(offset: number | undefined): number | undefined;
}

export function parseFrontmatter(yaml: string, firstLine: number): ParsedFrontmatter {
  const lineCounter = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter, prettyErrors: false, keepSourceTokens: false });
  return {
    doc,
    lineAt(offset) {
      if (offset === undefined) return undefined;
      return lineCounter.linePos(offset).line + firstLine - 1;
    },
  };
}

export function nodeLine(fm: ParsedFrontmatter, node: unknown): number | undefined {
  const range = (node as Node | undefined)?.range;
  return fm.lineAt(range?.[0]);
}

export function findPair(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair | undefined;
}

/**
 * Reads typed fields out of a YAML map and records a diagnostic for each
 * field with the wrong type.
 */
export class FieldReader {
  constructor(
    private readonly fm: ParsedFrontmatter,
    private readonly map: YAMLMap,
    private readonly path: string,
    private readonly diagnostics: Diagnostic[],
    private readonly where = "",
  ) {}

  line(key: string): number | undefined {
    const pair = findPair(this.map, key);
    return pair ? nodeLine(this.fm, pair.key) : nodeLine(this.fm, this.map);
  }

  has(key: string): boolean {
    return findPair(this.map, key) !== undefined;
  }

  string(key: string): string | undefined {
    const pair = findPair(this.map, key);
    if (!pair || pair.value === null || (isScalar(pair.value) && pair.value.value === null)) return undefined;
    if (isScalar(pair.value) && (typeof pair.value.value === "string" || typeof pair.value.value === "number")) {
      return String(pair.value.value);
    }
    this.typeError(key, "a string");
    return undefined;
  }

  boolean(key: string): boolean | undefined {
    const pair = findPair(this.map, key);
    if (!pair || pair.value === null) return undefined;
    if (isScalar(pair.value) && typeof pair.value.value === "boolean") return pair.value.value;
    this.typeError(key, "true or false");
    return undefined;
  }

  /** A list of strings. Returns the values and the line of each entry. */
  stringList(key: string): { values: string[]; lines: (number | undefined)[] } | undefined {
    const pair = findPair(this.map, key);
    if (!pair || pair.value === null || (isScalar(pair.value) && pair.value.value === null)) return undefined;
    if (!isSeq(pair.value)) {
      this.typeError(key, "a list");
      return undefined;
    }
    const values: string[] = [];
    const lines: (number | undefined)[] = [];
    for (const item of pair.value.items) {
      if (isScalar(item) && (typeof item.value === "string" || typeof item.value === "number")) {
        values.push(String(item.value));
        lines.push(nodeLine(this.fm, item));
      } else {
        this.diagnostics.push({
          severity: "error",
          rule: "field-type",
          message: `Every entry in \`${this.where}${key}\` must be a string.`,
          path: this.path,
          line: nodeLine(this.fm, item) ?? this.line(key),
        });
      }
    }
    return { values, lines };
  }

  private typeError(key: string, expected: string): void {
    this.diagnostics.push({
      severity: "error",
      rule: "field-type",
      message: `\`${this.where}${key}\` must be ${expected}.`,
      path: this.path,
      line: this.line(key),
    });
  }
}

/**
 * Puts known keys in canonical order and leaves unknown keys after them in
 * their original order. Comments travel with their keys.
 */
export function orderKeys(map: YAMLMap, order: string[]): void {
  const rank = (p: Pair): number => {
    const key = isScalar(p.key) ? String(p.key.value) : "";
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  const items = map.items.map((p, i) => ({ p: p as Pair, i }));
  items.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i);
  map.items = items.map((x) => x.p) as typeof map.items;
}

export function stringifyDoc(doc: Document): string {
  const text = doc.toString(STRINGIFY_OPTIONS);
  return text.endsWith("\n") ? text : text + "\n";
}

/** Build frontmatter text for a new file from plain values, in key order. */
export function stringifyFields(fields: Record<string, unknown>, order: string[]): string {
  const doc = new Document(fields);
  if (isMap(doc.contents)) orderKeys(doc.contents, order);
  return stringifyDoc(doc);
}

export { isMap, isScalar, isSeq };
