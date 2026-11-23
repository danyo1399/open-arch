/**
 * Markdown as Ask AI shows it: an answer drawn with its headings, lists, tables, code, links,
 * footnotes and the rest. It's drawn from the parsed tree as React elements, never as HTML, so
 * what a model writes can't run anything or style the page: HTML in it shows as the text it is,
 * a link opens only to an address of a kind the notes link to, and an image is a link to it, not
 * loaded.
 */
import type { Definition, Nodes, Parents, Root, Table } from "mdast";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadOnce } from "../canvas/autoLayout.js";
import { LINK_SCHEMES, schemeOf } from "./dialogs.js";

type Parse = (text: string) => Root;

/** The parser, once it's loaded: until then, and if it can't be, the text is shown as it's written. */
let parser: Parse | null = null;
export const loadParser = loadOnce(() =>
  import("./markdownParse.js").then(({ parseMarkdown }) => {
    parser = parseMarkdown;
    return parseMarkdown;
  }),
);

/**
 * The parser, loading it the first time it's needed: null until it's loaded, and if it can't be.
 * Whatever asks for it is drawn again once it's there.
 */
export function useMarkdownParser(): Parse | null {
  const [parse, setParse] = useState<Parse | null>(() => parser);
  useEffect(() => {
    if (parse) return;
    let live = true;
    loadParser().then(
      (loaded) => live && setParse(() => loaded),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [parse]);
  // Loaded for another part of the page since this was last drawn.
  return parse ?? parser;
}

/** Shows `code` and **bold** in text that isn't read as markdown: a request for approval, and an answer until the parser has loaded. */
export function formatted(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (/^`.+`$/s.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*.+\*\*$/s.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

/**
 * A link's address, if it's one to open: of a kind the notes link to, such as a web or mail
 * address. Unlike in notes, an address with no scheme isn't one: an answer is on no page it
 * could be relative to, and in the desktop app it would be a file on the computer.
 */
export function linkTo(url: string): string | null {
  const scheme = schemeOf(url);
  return scheme && LINK_SCHEMES.includes(scheme) ? url : null;
}

/** Markdown text, drawn in a block with `className`. */
export function Markdown({ text, className }: { text: string; className: string }) {
  const parse = useMarkdownParser();
  const tree = useMemo(() => parse?.(text), [parse, text]);
  return (
    <div className={`${className} markdown`}>
      {tree ? (
        drawTree(tree)
      ) : (
        // As it's written, its spaces and lines kept.
        <p className="markdown-plain">{formatted(text)}</p>
      )}
    </div>
  );
}

/** What a reference's label stands for, by its identifier: the address a `[text][label]` link or `![alt][label]` image goes to. */
function definitions(root: Root): Map<string, Definition> {
  const found = new Map<string, Definition>();
  const visit = (node: Nodes) => {
    // The first definition of a label is the one that counts.
    if (node.type === "definition" && !found.has(node.identifier)) found.set(node.identifier, node);
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(root);
  return found;
}

function drawTree(root: Root): ReactNode[] {
  const defined = definitions(root);
  const drawAll = (parent: Parents): ReactNode[] => parent.children.map((child, i) => draw(child, i));

  /** A link to `url` around `content`, or just the content when the address isn't one to open. */
  const link = (url: string | undefined, content: ReactNode, key: number, title?: string | null) => {
    const href = url === undefined ? null : linkTo(url);
    return href ? (
      <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={title ?? undefined}>
        {content}
      </a>
    ) : (
      <span key={key}>{content}</span>
    );
  };

  function draw(node: Nodes, key: number): ReactNode {
    switch (node.type) {
      case "paragraph":
        return <p key={key}>{drawAll(node)}</p>;
      case "heading": {
        // The panel is small, so even a top heading is a small one.
        const Tag = (["h3", "h4", "h5", "h6", "h6", "h6"] as const)[node.depth - 1]!;
        return <Tag key={key}>{drawAll(node)}</Tag>;
      }
      case "text":
        return node.value;
      case "emphasis":
        return <em key={key}>{drawAll(node)}</em>;
      case "strong":
        return <strong key={key}>{drawAll(node)}</strong>;
      case "delete":
        return <del key={key}>{drawAll(node)}</del>;
      case "inlineCode":
        return <code key={key}>{node.value}</code>;
      case "break":
        return <br key={key} />;
      case "code":
        return (
          <pre key={key}>
            <code>{node.value}</code>
          </pre>
        );
      case "blockquote":
        return <blockquote key={key}>{drawAll(node)}</blockquote>;
      case "list": {
        const items = drawAll(node);
        return node.ordered ? (
          <ol key={key} start={node.start ?? undefined}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        );
      }
      case "listItem": {
        const task = node.checked !== null && node.checked !== undefined;
        return (
          <li key={key} className={task ? "task" : undefined}>
            {task && <input type="checkbox" checked={!!node.checked} disabled aria-label={node.checked ? "Done" : "Not done"} />}
            {drawAll(node)}
          </li>
        );
      }
      case "thematicBreak":
        return <hr key={key} />;
      case "link":
        return link(node.url, drawAll(node), key, node.title);
      case "linkReference": {
        const definition = defined.get(node.identifier);
        return link(definition?.url, drawAll(node), key, definition?.title);
      }
      // Not loaded: a picture from anywhere would tell its server that the answer was read.
      case "image":
        return link(node.url, node.alt || node.url, key, node.title);
      case "imageReference": {
        const definition = defined.get(node.identifier);
        return link(definition?.url, node.alt || definition?.url || node.label || node.identifier, key, definition?.title);
      }
      case "definition":
        // What it stands for is where it's used.
        return null;
      case "footnoteReference":
        return <sup key={key}>[{node.label ?? node.identifier}]</sup>;
      case "footnoteDefinition":
        return (
          <div key={key} className="markdown-footnote">
            <sup>[{node.label ?? node.identifier}]</sup>
            <div>{drawAll(node)}</div>
          </div>
        );
      case "table":
        return drawTable(node, key);
      case "html":
        return node.value;
      default:
        // Anything else: what it says.
        return "children" in node ? <span key={key}>{drawAll(node)}</span> : "value" in node ? node.value : null;
    }
  }

  function drawTable(table: Table, key: number): ReactNode {
    const [head, ...body] = table.children;
    const align = (column: number) => table.align?.[column] ?? undefined;
    return (
      <div key={key} className="markdown-table">
        <table>
          {head && (
            <thead>
              <tr>
                {head.children.map((cell, i) => (
                  <th key={i} style={{ textAlign: align(i) }}>
                    {drawAll(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.children.map((cell, i) => (
                  <td key={i} style={{ textAlign: align(i) }}>
                    {drawAll(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return drawAll(root);
}
