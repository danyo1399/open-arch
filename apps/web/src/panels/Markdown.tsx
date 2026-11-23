/**
 * Markdown as Ask AI shows it: an answer drawn with its headings, lists, tables, code, links and
 * the rest. It's drawn from the parsed tree as React elements, never as HTML, so what a model
 * writes can't run anything or style the page: HTML in it shows as the text it is, a link opens
 * only to a web or mail address, and an image is a link to it, not loaded.
 */
import type { Nodes, Parents, Root, RootContent, Table } from "mdast";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadOnce } from "../canvas/autoLayout.js";

type Parse = (text: string) => Root;

/** The parser, once it's loaded: until then, and if it can't be, the text is shown as it's written. */
let parser: Parse | null = null;
export const loadParser = loadOnce(() =>
  import("./markdownParse.js").then(({ parseMarkdown }) => {
    parser = parseMarkdown;
    return parseMarkdown;
  }),
);

/** The parser, from the first render after it's loaded. */
function useParser(): Parse | null {
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
  return parse;
}

/** Shows `code` and **bold** in text that isn't read as markdown: a request for approval, and an answer until the parser has loaded. */
export function formatted(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    if (/^`.+`$/s.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*\*.+\*\*$/s.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

/** A link's address, if it's one to open: on the web or to write an email. Anything else, such as a script or a file on this computer, isn't a link. */
export function linkTo(url: string): string | null {
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

/** Markdown text, drawn in a block with `className`. */
export function Markdown({ text, className }: { text: string; className: string }) {
  const parse = useParser();
  const tree = useMemo(() => parse?.(text), [parse, text]);
  return <div className={`${className} markdown`}>{tree ? drawAll(tree) : <p>{formatted(text)}</p>}</div>;
}

const drawAll = (parent: Parents): ReactNode[] => parent.children.map((child, i) => draw(child, i));

function draw(node: Nodes | RootContent, key: number): ReactNode {
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
    case "listItem":
      return (
        <li key={key} className={node.checked === null || node.checked === undefined ? undefined : "task"}>
          {node.checked === null || node.checked === undefined ? null : <input type="checkbox" checked={node.checked} disabled aria-label={node.checked ? "Done" : "Not done"} />}
          {drawAll(node)}
        </li>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "link": {
      const href = linkTo(node.url);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={node.title ?? undefined}>
          {drawAll(node)}
        </a>
      ) : (
        <span key={key}>{drawAll(node)}</span>
      );
    }
    case "image": {
      // Not loaded: a picture from anywhere would tell its server that the answer was read.
      const href = linkTo(node.url);
      const label = node.alt || node.url;
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        label
      );
    }
    case "table":
      return drawTable(node, key);
    case "html":
      return node.value;
    case "definition":
    case "footnoteDefinition":
      return null;
    case "footnoteReference":
      return `[^${node.identifier}]`;
    default:
      // Link and image references, and anything else with text inside: what it says.
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
