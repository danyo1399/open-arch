import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewEdge } from "@open-arch/core";
import { estimateLabel, forgetLabelSizes, labelSizes, MEASURED_LIMIT, measureLabelSizes, pathThrough } from "../src/canvas/RoutedEdge.js";

describe("pathThrough", () => {
  it("hops over the top of an arrow it crosses, whichever way it runs", () => {
    expect(pathThrough([{ x: 0, y: 100 }, { x: 300, y: 100 }], [{ x: 150, y: 100 }])).toBe("M 0 100 L 145 100 A 5 5 0 0 1 155 100 L 300 100");
    expect(pathThrough([{ x: 300, y: 100 }, { x: 0, y: 100 }], [{ x: 150, y: 100 }])).toBe("M 300 100 L 155 100 A 5 5 0 0 0 145 100 L 0 100");
  });

  it("draws a crossing too near a corner, or right after another hop, as a plain crossing", () => {
    const route = [
      { x: 0, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ];
    const path = pathThrough(route, [
      { x: 100, y: 100 },
      { x: 106, y: 100 },
      { x: 290, y: 100 },
    ]);
    expect(path.match(/ A /g)).toHaveLength(1);
  });
});

describe("labelSizes", () => {
  const edge = (description: string, technology?: string) => ({ description, technology }) as ViewEdge;

  it("offers narrower sizes, with more lines, for a label that wraps", () => {
    const sizes = labelSizes(edge("Publishes order-placed and order-ready to", "Kafka"), estimateLabel);
    expect(sizes.map((s) => s.w)).toEqual([190, 140, 100]);
    expect(sizes[1]!.h).toBeGreaterThan(sizes[0]!.h);
    expect(sizes[2]!.h).toBeGreaterThan(sizes[1]!.h);
  });

  it("offers one size for a label that fits on a line anyway", () => {
    expect(labelSizes(edge("Charges cards", "HTTPS"), estimateLabel)).toHaveLength(1);
  });

  it("counts a word too long for a narrow label as more than one line", () => {
    // "[JDBC/PostgreSQL]" is 17 characters, and a 100px label has room for 14.
    const narrowest = labelSizes(edge("Reads orders using", "JDBC/PostgreSQL"), estimateLabel).at(-1)!;
    expect(narrowest.maxWidth).toBe(100);
    expect(narrowest.h).toBeCloseTo(4 * 14.3 + 8);
  });

  it("breaks a long word between letters, as many as fit on a line", () => {
    // At 140px there's room for 20 letters a line: 41 letters take 3 lines, and " end" fits after the last one.
    expect(estimateLabel([{ text: `${"x".repeat(41)} end` }], 140).h).toBeCloseTo(3 * 14.3 + 8);
  });

  it("doesn't count repeated or trailing spaces as taking room", () => {
    expect(estimateLabel([{ text: "abcdefghijklmnopqrst " }], 140).h).toBeCloseTo(14.3 + 8);
    expect(estimateLabel([{ text: "abcdefghi  jklmnopqr" }], 140).h).toBeCloseTo(14.3 + 8);
    expect(estimateLabel([{ text: "abcdefghijklmnopqrst " }], 190).w).toBe(20 * 6 + 16);
  });

  it("takes each size from the measure it's given, leaving out widths that make no difference", () => {
    const measure = (_lines: unknown, maxWidth: number) => ({ w: Math.min(maxWidth, 150), h: 300 / maxWidth });
    expect(labelSizes(edge("anything"), measure).map((s) => s.maxWidth)).toEqual([190, 140, 100]);
    expect(labelSizes(edge("anything"), (_lines, maxWidth) => ({ w: Math.min(maxWidth, 120), h: 20 })).map((s) => s.maxWidth)).toEqual([190, 100]);
  });

  it("has no size for an arrow with nothing to say", () => {
    expect(labelSizes(edge(""), estimateLabel)).toEqual([]);
  });
});

describe("measureLabelSizes", () => {
  // Just enough of a page to measure in: a label is 6px a letter on its longest line, up to its max-width, and 20px a line.
  let measures = 0;
  const element = () => {
    const el = {
      className: "",
      textContent: "",
      style: { cssText: "" },
      children: [] as { textContent: string }[],
      setAttribute() {},
      append(...kids: { textContent: string }[]) {
        el.children.push(...kids);
      },
      appendChild<T>(kid: T) {
        return kid;
      },
      remove() {},
      getBoundingClientRect() {
        measures++;
        const maxWidth = Number(/max-width: (\d+)px/.exec(el.style.cssText)![1]);
        return { width: Math.min(maxWidth, 6 * Math.max(...el.children.map((c) => c.textContent.length))), height: 20 * el.children.length };
      },
    };
    return el;
  };
  beforeEach(() => {
    vi.stubGlobal("document", { createElement: element, body: { appendChild: <T,>(kid: T) => kid } });
    forgetLabelSizes();
    measures = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetLabelSizes();
  });
  const edge = (description: string) => ({ description }) as ViewEdge;
  const labels = (count: number, from = 0) => Array.from({ length: count }, (_, k) => edge(`label number ${from + k} with some words in it`));

  it("measures each label once at each width, and has every size after", () => {
    const edges = [edge("first label to measure"), edge("a second, rather longer label to measure")];
    const sizes = measureLabelSizes(edges);
    // 22 letters is 132px: as wide at 140 as at 190, so 140 is left out, but narrower at 100.
    expect(sizes[0]!.map((s) => [s.maxWidth, s.w])).toEqual([
      [190, 132],
      [100, 100],
    ]);
    expect(sizes[1]!.map((s) => s.maxWidth)).toEqual([190, 140, 100]);
    expect(measures).toBe(6);
    measureLabelSizes(edges);
    expect(measures).toBe(6);
  });

  it("has a size for every label when the view needs more than it keeps, measuring only the new ones", () => {
    // Most of a view measured, then all of it, which needs more sizes than are kept: making room
    // mustn't let go of the ones the view already had. Each label takes 3 sizes, one a width.
    const total = Math.ceil(MEASURED_LIMIT / 3) + 200;
    const first = total - 500;
    const edges = labels(total);
    measureLabelSizes(edges.slice(0, first));
    expect(measures).toBe(3 * first);
    for (const sizes of measureLabelSizes(edges)) for (const size of sizes) expect(size.w).toBeGreaterThan(0);
    expect(measures).toBe(3 * total);
  });

  it("lets go of the sizes used least recently once it has more than it keeps", () => {
    // Labels a and b measured, then a again, then enough new ones to go over the limit: sizes are let
    // go one at a time, the least recently used first, so b's go, and a's, used again since, are kept.
    // Letting go of the first measured first would take a's.
    const [a, b] = [labels(1, 100_000), labels(1, 200_000)];
    measureLabelSizes(a);
    measureLabelSizes(b);
    measureLabelSizes(a);
    measureLabelSizes(labels(Math.floor(MEASURED_LIMIT / 3) - 1));
    const before = measures;
    measureLabelSizes(a);
    expect(measures, "a measured again").toBe(before);
    measureLabelSizes(b);
    expect(measures, "b measured again").toBeGreaterThan(before);
  });
});
