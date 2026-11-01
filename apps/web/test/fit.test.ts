import { describe, expect, it } from "vitest";
import { fitBelowToolbar } from "../src/canvas/Canvas.js";

describe("fitBelowToolbar", () => {
  it("keeps the usual padding when the toolbar ends above it", () => {
    // React Flow turns a padding of 0.15 on an 800px canvas into 52px at the top.
    expect(fitBelowToolbar({ padding: 0.15, maxZoom: 1.2 }, 800, 30)).toEqual({ maxZoom: 1.2, padding: { x: 0.15, y: 0.15, top: "52px" } });
  });

  it("starts the diagram below a toolbar that reaches further down, such as one with a description", () => {
    expect(fitBelowToolbar({ padding: 0.15, maxZoom: 1.2 }, 800, 95.5)).toEqual({ maxZoom: 1.2, padding: { x: 0.15, y: 0.15, top: "108px" } });
    expect(fitBelowToolbar({ padding: 0.1 }, 400, 95)).toEqual({ padding: { x: 0.1, y: 0.1, top: "107px" } });
  });
});
