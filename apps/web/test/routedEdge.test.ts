import { describe, expect, it } from "vitest";
import type { ViewEdge } from "@open-arch/core";
import { labelSizes, pathThrough } from "../src/canvas/RoutedEdge.js";

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
    const sizes = labelSizes(edge("Publishes order-placed and order-ready to", "Kafka"));
    expect(sizes.map((s) => s.w)).toEqual([190, 140, 100]);
    expect(sizes[1]!.h).toBeGreaterThan(sizes[0]!.h);
    expect(sizes[2]!.h).toBeGreaterThan(sizes[1]!.h);
  });

  it("offers one size for a label that fits on a line anyway", () => {
    expect(labelSizes(edge("Charges cards", "HTTPS"))).toHaveLength(1);
  });

  it("counts a word too long for a narrow label as more than one line", () => {
    // "[JDBC/PostgreSQL]" is 17 characters, and a 100px label has room for 14.
    const narrowest = labelSizes(edge("Reads orders using", "JDBC/PostgreSQL")).at(-1)!;
    expect(narrowest.maxWidth).toBe(100);
    expect(narrowest.h).toBeCloseTo(4 * 14.3 + 8);
  });

  it("breaks a long word between letters, as many as fit on a line", () => {
    // 41 characters with the brackets: a 140px label has room for 20 a line, so 3 lines.
    const sizes = labelSizes(edge("", "https://example.com/a-very-long/path/xy"));
    expect(sizes[1]!.maxWidth).toBe(140);
    expect(sizes[1]!.h).toBeCloseTo(3 * 14.3 + 8);
  });

  it("breaks a URL after its slashes, as the browser does", () => {
    // At 140px: "[https://", "example.com/", then the 27-letter rest split 20 and 7.
    const sizes = labelSizes(edge("", "https://example.com/abcdefghijklmnopqrstuvwxyz"));
    expect(sizes[1]!.maxWidth).toBe(140);
    expect(sizes[1]!.h).toBeCloseTo(4 * 14.3 + 8);
  });

  it("has no size for an arrow with nothing to say", () => {
    expect(labelSizes(edge(""))).toEqual([]);
  });
});
