// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { canCopyImages, copyImage, copyText } from "../src/hosts.js";

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

describe("copyImage", () => {
  const realItem = globalThis.ClipboardItem;
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.ClipboardItem = realItem;
  });

  it("puts the picture on the clipboard as a PNG, asking for the clipboard before the picture is drawn", async () => {
    let finish!: (blob: Blob) => void;
    const png = new Promise<Blob>((resolve) => (finish = resolve));
    const write = vi.spyOn(navigator.clipboard, "write").mockResolvedValue();
    const copied = copyImage(png);
    // Safari only allows the clipboard while the click still counts, so it's asked for at once.
    expect(write).toHaveBeenCalledTimes(1);
    const [item] = write.mock.calls[0]![0];
    expect(item!.types).toEqual(["image/png"]);
    const picture = new Blob(["png"], { type: "image/png" });
    finish(picture);
    await copied;
    expect(await (await item!.getType("image/png")).text()).toBe("png");
  });

  it("says why drawing the picture failed, not what the clipboard says", async () => {
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(new Error("Failed to read the clipboard item."));
    await expect(copyImage(Promise.reject(new Error("This view has nothing in it to make a picture of.")))).rejects.toThrow("nothing in it to make a picture of");
  });

  it("says so when the browser refuses", async () => {
    vi.spyOn(navigator.clipboard, "write").mockRejectedValue(new Error("Document is not focused."));
    await expect(copyImage(Promise.resolve(new Blob(["png"])))).rejects.toThrow("Document is not focused.");
  });

  it("says to save the picture instead in a browser that can't copy one", async () => {
    // @ts-expect-error A browser without ClipboardItem, such as an older Firefox.
    delete globalThis.ClipboardItem;
    expect(canCopyImages()).toBe(false);
    await expect(copyImage(Promise.reject(new Error("unused")))).rejects.toThrow("Save it as a PNG instead.");
  });
});
