// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PNG_FILE, saveFile } from "../src/providers.js";

type Picker = { showSaveFilePicker?: unknown };

describe("saveFile", () => {
  afterEach(() => {
    delete (window as Picker).showSaveFilePicker;
    vi.restoreAllMocks();
  });

  it("makes a picture only once the person has chosen where it goes", async () => {
    const order: string[] = [];
    const written: unknown[] = [];
    (window as Picker).showSaveFilePicker = async (options: { suggestedName: string; types: unknown[] }) => {
      order.push(`pick ${options.suggestedName}`);
      expect(options.types).toEqual([{ description: "PNG image", accept: { "image/png": [".png"] } }]);
      return { createWritable: async () => ({ write: async (data: unknown) => void written.push(data), close: async () => void order.push("close") }) };
    };
    const blob = new Blob(["png"]);
    const saved = await saveFile("landscape.png", async () => (order.push("make"), blob), PNG_FILE);
    expect(saved).toBe(true);
    expect(order).toEqual(["pick landscape.png", "make", "close"]);
    expect(written).toEqual([blob]);
  });

  it("makes nothing when the person cancels", async () => {
    (window as Picker).showSaveFilePicker = async () => {
      throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    };
    const make = vi.fn(async () => new Blob(["png"]));
    expect(await saveFile("landscape.png", make, PNG_FILE)).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });

  it("downloads the file in a browser that can't ask where to save it", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await saveFile("landscape.png", async () => new Blob(["png"]), PNG_FILE)).toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("landscape.png");
  });
});
