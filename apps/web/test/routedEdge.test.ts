import { describe, expect, it } from "vitest";
import type { ViewEdge } from "@open-arch/core";
import { estimateLabel, labelSizes, pathThrough } from "../src/canvas/RoutedEdge.js";

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
