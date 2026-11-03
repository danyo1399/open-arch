/**
 * The open diagram as a picture: a PNG, an SVG or a PDF of the whole diagram, not just the part
 * on the screen. It's drawn from the page as it is, in light colours on white, whatever the
 * system's theme, so it suits a document or a slide.
 */
import { zlibSync } from "fflate";

export type ImageFormat = "png" | "svg" | "pdf";

/** Room left round the diagram, in the diagram's pixels. */
const PADDING = 24;
/** The most pixels a picture has: iPhones and iPads won't draw a bigger canvas. */
const MAX_PIXELS = 16_000_000;
/** Pixels drawn for each of the diagram's: twice, so the text is sharp on a high-resolution screen or in print. */
const SHARPNESS = 2;
/** Points (a PDF's unit, 1/72 inch) for each of the diagram's pixels (1/96 inch). */
const POINTS_PER_PIXEL = 0.75;
/** The longest side a PDF page can have, in points. */
const MAX_PAGE = 14_400;
const BACKGROUND = "#ffffff";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the diagram is in its own coordinates, from where its parts are on the screen: `origin`
 * is where the diagram's 0, 0 is on the screen, and `zoom` how much it's zoomed in. Null when
 * there's nothing in it.
 */
export function diagramBounds(parts: Box[], origin: { x: number; y: number }, zoom: number, padding = PADDING): { x: number; y: number; width: number; height: number } | null {
  if (parts.length === 0) return null;
  const left = Math.min(...parts.map((r) => r.left));
  const top = Math.min(...parts.map((r) => r.top));
  const right = Math.max(...parts.map((r) => r.right));
  const bottom = Math.max(...parts.map((r) => r.bottom));
  const x = Math.floor((left - origin.x) / zoom - padding);
  const y = Math.floor((top - origin.y) / zoom - padding);
  return { x, y, width: Math.ceil((right - origin.x) / zoom + padding) - x, height: Math.ceil((bottom - origin.y) / zoom + padding) - y };
}

/** Pixels drawn for each of the diagram's, fewer for a diagram too big to draw twice over. */
export function sharpness(width: number, height: number): number {
  return Math.min(SHARPNESS, Math.sqrt(MAX_PIXELS / (width * height)));
}

/** A PDF page's size in points for a diagram this many pixels across: as it is on the screen, unless that's more than a page can be. */
export function pageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(POINTS_PER_PIXEL, MAX_PAGE / Math.max(width, height));
  return { width: round(width * scale), height: round(height * scale) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A PDF text string: UTF-16 in hex, which takes any character and needs nothing escaped. */
function pdfText(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/**
 * A one-page PDF of a picture: `rgb` is its pixels, three bytes each, row by row from the top.
 * The page is `page` points across, and the PDF's title is `title`.
 */
export function pdfOf(rgb: Uint8Array, pixels: { width: number; height: number }, page: { width: number; height: number }, title: string): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (body: string, stream?: Uint8Array) => {
    offsets.push(length);
    write(`${offsets.length} 0 obj\n${body}\n`);
    if (stream) {
      write("stream\n");
      write(stream);
      write("\nendstream\n");
    }
    write("endobj\n");
  };

  const image = zlibSync(rgb);
  const draw = encoder.encode(`q ${page.width} 0 0 ${page.height} 0 0 cm /Diagram Do Q`);
  // A comment with bytes over 127 near the start tells programs the file is binary.
  write(new Uint8Array([...encoder.encode("%PDF-1.4\n%"), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /XObject << /Diagram 4 0 R >> >> /Contents 5 0 R >>`);
  object(`<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`, image);
  object(`<< /Length ${draw.length} >>`, draw);
  object(`<< /Title ${pdfText(title)} /Producer (open-arch) >>`);

  const xref = length;
  write(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  write(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Info ${offsets.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A canvas's pixels as three bytes each, red, green and blue: a PDF image has no transparency, and the picture's background is solid. */
export function rgbOf(rgba: Uint8ClampedArray): Uint8Array {
  const rgb = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return rgb;
}

/** What to draw, and how: the element, its size, and the style that puts the whole diagram in view. */
interface Target {
  element: HTMLElement;
  width: number;
  height: number;
  style?: Partial<CSSStyleDeclaration>;
}

/** The diagram in a part of the page: a box view's React Flow diagram, or a sequence view. */
function targetIn(container: HTMLElement): Target {
  const sequence = container.querySelector<HTMLElement>(".sequence-surface");
  if (sequence) return { element: sequence, width: sequence.offsetWidth, height: sequence.offsetHeight };
  const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) throw new Error("There's no diagram to save.");
  // The boxes, sticky notes, arrows and their labels. The arrows can go round the boxes, outside them.
  const parts = [...viewport.querySelectorAll(".react-flow__node, .react-flow__edge-path, .arrow-label")].map((e) => e.getBoundingClientRect());
  const origin = viewport.getBoundingClientRect();
  const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a || 1;
  const bounds = diagramBounds(parts, { x: origin.left, y: origin.top }, zoom);
  if (!bounds) throw new Error("This view has nothing in it to save.");
  return {
    element: viewport,
    width: bounds.width,
    height: bounds.height,
    style: { width: `${bounds.width}px`, height: `${bounds.height}px`, transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)` },
  };
}

/** Resolves once the page has been drawn again, with any change React just made. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Grips and dots for dragging, which are for the designer, not the picture. */
const skip = (node: Node) => !(node instanceof Element && (node.classList.contains("react-flow__handle") || node.classList.contains("arrow-grip")));

/**
 * The diagram in `container` as a file of this format. Call it with nothing selected: the
 * picture shows what's on the page. The diagram is drawn in light colours while it's copied.
 */
export async function diagramImage(container: HTMLElement, format: ImageFormat, title: string): Promise<Blob> {
  // Loaded when first needed, as most sessions never save a picture. It's pinned to 1.11.11 in
  // package.json: later versions lose the arrows' and lifelines' styles, so they don't show.
  const { toCanvas, toSvg } = await import("html-to-image");
  const target = targetIn(container);
  const options = { width: target.width, height: target.height, style: target.style, backgroundColor: BACKGROUND, filter: skip };
  target.element.classList.add("light-colors");
  try {
    if (format === "svg") {
      const url = await toSvg(target.element, options);
      return new Blob([decodeURIComponent(url.slice(url.indexOf(",") + 1))], { type: "image/svg+xml" });
    }
    const canvas = await toCanvas(target.element, { ...options, pixelRatio: sharpness(target.width, target.height) });
    if (format === "png") {
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the picture."))), "image/png"));
    }
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const pdf = pdfOf(rgbOf(pixels), { width: canvas.width, height: canvas.height }, pageSize(target.width, target.height), title);
    return new Blob([pdf as BlobPart], { type: "application/pdf" });
  } finally {
    target.element.classList.remove("light-colors");
  }
}
