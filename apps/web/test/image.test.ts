import { unzlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { diagramBounds, pageSize, pdfOf, rgbOf, sharpness } from "../src/image.js";

describe("diagramBounds", () => {
  it("is the box round every part, in the diagram's own coordinates, with room round it", () => {
    // The diagram's 0, 0 is at 100, 50 on the screen, and it's zoomed to half size.
    const parts = [
      { left: 150, top: 100, right: 250, bottom: 150 },
      { left: 90, top: 200, right: 120, bottom: 260 },
    ];
    expect(diagramBounds(parts, { x: 100, y: 50 }, 0.5, 10)).toEqual({ x: -30, y: 90, width: 340, height: 340 });
  });

  it("is null for a diagram with nothing in it", () => {
    expect(diagramBounds([], { x: 0, y: 0 }, 1)).toBeNull();
  });
});

describe("sharpness", () => {
  it("draws twice the pixels, unless the picture would be too big for a phone to draw", () => {
    expect(sharpness(1000, 800)).toBe(2);
    expect(sharpness(8000, 4000)).toBeCloseTo(Math.sqrt(0.5));
    const big = sharpness(8000, 4000);
    expect(8000 * big * 4000 * big).toBeLessThanOrEqual(16_000_000 + 1);
  });
});

describe("pageSize", () => {
  it("is the diagram's size on the screen, in points", () => {
    expect(pageSize(800, 600)).toEqual({ width: 600, height: 450 });
  });

  it("is shrunk to fit the biggest page a PDF can have", () => {
    expect(pageSize(40_000, 10_000)).toEqual({ width: 14_400, height: 3600 });
  });
});

describe("rgbOf", () => {
  it("keeps the red, green and blue of each pixel, and drops the transparency", () => {
    expect([...rgbOf(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128]))]).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("pdfOf", () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
  const pdf = pdfOf(rgb, { width: 2, height: 2 }, { width: 150, height: 75.5 }, "Shop — containers");
  const text = new TextDecoder("latin1").decode(pdf);

  it("is a one-page PDF the size asked for", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Pages /Kids [3 0 R] /Count 1");
    expect(text).toContain("/MediaBox [0 0 150 75.5]");
    expect(text).toContain("q 150 0 0 75.5 0 0 cm /Diagram Do Q");
  });

  it("lists where each object starts, as readers look them up", () => {
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, i) => expect(text.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it("holds the picture's pixels, compressed", () => {
    const start = text.indexOf("stream\n", text.indexOf("/Subtype /Image")) + "stream\n".length;
    const length = Number(/\/Subtype \/Image[^>]*\/Length (\d+)/.exec(text)![1]);
    expect([...unzlibSync(pdf.slice(start, start + length))]).toEqual([...rgb]);
    expect(text).toContain("/Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode");
  });

  it("has the view's title, in any language", () => {
    const hex = /\/Title <([0-9A-F]+)>/.exec(text)![1]!;
    const units = hex.match(/.{4}/g)!.map((h) => parseInt(h, 16));
    expect(units[0]).toBe(0xfeff);
    expect(String.fromCharCode(...units.slice(1))).toBe("Shop — containers");
  });
});
