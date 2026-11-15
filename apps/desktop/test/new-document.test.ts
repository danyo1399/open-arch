import { describe, expect, it } from "vitest";
import { newDocument } from "../src/saving.js";

describe("a new desktop workspace", () => {
  it("is named after its file, with its docs in the file's own folder", () => {
    expect(newDocument("/repo/payments-platform.openarch")).toMatchObject({ name: "Payments Platform", export: { docs: "." } });
    expect(newDocument("/repo/-.openarch").name).toBe("Architecture");
  });
});
