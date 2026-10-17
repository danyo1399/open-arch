/**
 * Splitting a workspace markdown file into its parts: YAML frontmatter, the
 * markdown body, and the two blocks open-arch manages inside the body (the
 * generated Mermaid preview and the layout comment).
 */

export type Eol = "\n" | "\r\n";

export interface SplitFile {
  eol: Eol;
  /** False when the file doesn't start with a `---` line. */
  hasFrontmatter: boolean;
  /** Set when the frontmatter is opened but never closed. */
  unclosed: boolean;
  /** YAML text between the `---` lines (LF line endings). */
  frontmatter: string;
  /** 1-based line number of the first YAML line. */
  frontmatterLine: number;
  /** Everything after the closing `---` line (LF line endings). */
  body: string;
  /** 1-based line number of the first body line. */
  bodyLine: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;

export function splitFile(raw: string): SplitFile {
  const text = raw.replace(/^﻿/, "");
  const eol: Eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lf = text.replace(/\r\n/g, "\n");
  const lines = lf.split("\n");

  if (lines[0]?.trimEnd() !== "---") {
    return { eol, hasFrontmatter: false, unclosed: false, frontmatter: "", frontmatterLine: 1, body: lf, bodyLine: 1 };
  }
  const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (close === -1) {
    return { eol, hasFrontmatter: true, unclosed: true, frontmatter: lines.slice(1).join("\n"), frontmatterLine: 2, body: "", bodyLine: lines.length + 1 };
  }
  const yamlLines = lines.slice(1, close);
  return {
    eol,
    hasFrontmatter: true,
    unclosed: false,
    frontmatter: yamlLines.length ? yamlLines.join("\n") + "\n" : "",
    frontmatterLine: 2,
    body: lines.slice(close + 1).join("\n"),
    bodyLine: close + 2,
  };
}

/** Reassemble a file. `frontmatter` must end with a newline. */
export function joinFile(frontmatter: string, body: string, eol: Eol): string {
  let text = `---\n${frontmatter}---\n${body}`;
  text = text.replace(/\n*$/, "\n");
  return eol === "\n" ? text : text.replace(/\n/g, "\r\n");
}

export interface PreviewBlock {
  /** Body line indexes (0-based, inclusive) of the start and end markers. */
  start: number;
  end: number;
  hash?: string;
  /** The Mermaid source between the fences. */
  content?: string;
  /** Why the block couldn't be read, if it couldn't. */
  malformed?: string;
}

export interface LayoutBlock {
  start: number;
  end: number;
  /** The text between the markers (expected to be JSON). */
  json: string;
}

export interface BodyBlocks {
  lines: string[];
  preview?: PreviewBlock;
  layout?: LayoutBlock;
  /** Problems with the blocks themselves, as body line index + message. */
  problems: { index: number; rule: string; message: string }[];
}

export const PREVIEW_START = /^<!--\s*open-arch:preview\b(.*?)-->\s*$/;
export const PREVIEW_END = /^<!--\s*\/open-arch:preview\s*-->\s*$/;
const LAYOUT_START = /^<!--\s*open-arch:layout\b(.*)$/;

export function findBlocks(body: string): BodyBlocks {
  const lines = body.split("\n");
  const result: BodyBlocks = { lines, problems: [] };
  let fence: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1]!.startsWith(fence[0]!) && fenceMatch[1]!.length >= fence.length) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }

    const preview = PREVIEW_START.exec(line);
    if (preview) {
      const block = readPreview(lines, i, preview[1] ?? "");
      if (result.preview) {
        result.problems.push({ index: i, rule: "preview-duplicate", message: "There is more than one generated preview block." });
      } else {
        result.preview = block;
      }
      i = block.end;
      continue;
    }

    const layout = LAYOUT_START.exec(line);
    if (layout) {
      const rest = layout[1] ?? "";
      let end = i;
      let json: string;
      const inline = rest.indexOf("-->");
      if (inline !== -1) {
        json = rest.slice(0, inline);
      } else {
        end = lines.findIndex((l, j) => j > i && l.includes("-->"));
        if (end === -1) {
          result.problems.push({ index: i, rule: "layout-invalid", message: "The layout comment is never closed with `-->`." });
          break;
        }
        const closing = lines[end]!;
        json = [rest, ...lines.slice(i + 1, end), closing.slice(0, closing.indexOf("-->"))].join("\n");
      }
      if (result.layout) {
        result.problems.push({ index: i, rule: "layout-duplicate", message: "There is more than one layout comment." });
      } else {
        result.layout = { start: i, end, json };
      }
      i = end;
    }
  }
  return result;
}

function readPreview(lines: string[], start: number, attrs: string): PreviewBlock {
  const hash = /\bhash=([0-9a-f]+)\b/.exec(attrs)?.[1];
  const end = lines.findIndex((l, j) => j > start && PREVIEW_END.test(l));
  if (end === -1) {
    return { start, end: lines.length - 1, hash, malformed: "The preview block has no closing `<!-- /open-arch:preview -->` marker." };
  }
  const inner = lines.slice(start + 1, end);
  const open = inner.findIndex((l) => /^```mermaid\s*$/.test(l));
  const close = inner.findIndex((l, j) => j > open && /^```\s*$/.test(l));
  if (open === -1 || close === -1) {
    return { start, end, hash, malformed: "The preview block must contain one ```mermaid fenced block." };
  }
  return { start, end, hash, content: inner.slice(open + 1, close).join("\n") };
}

/** Replace body lines `start..end` (inclusive) with `replacement`. */
export function spliceLines(lines: string[], start: number, end: number, replacement: string[]): string[] {
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)];
}
