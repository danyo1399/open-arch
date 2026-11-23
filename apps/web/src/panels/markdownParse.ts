/**
 * The markdown parser Ask AI's answers are read with: CommonMark, and GitHub's tables, task
 * lists, strikethrough and links. A file of its own, so it's loaded the first time it's needed.
 */
import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}
