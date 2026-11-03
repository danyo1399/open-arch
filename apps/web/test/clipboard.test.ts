// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../src/hosts.js";

describe("copyText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("puts the text on the clipboard", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await copyText("flowchart TB");
    expect(write).toHaveBeenCalledWith("flowchart TB");
  });

  it("says so when the browser refuses", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Write permission denied."));
    await expect(copyText("flowchart TB")).rejects.toThrow("Write permission denied.");
  });
});
