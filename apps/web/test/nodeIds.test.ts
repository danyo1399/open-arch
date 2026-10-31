import type { ArchElement } from "@open-arch/core";
import { describe, expect, it } from "vitest";
import { inNodeOrder, nodeIds } from "../src/canvas/Canvas.js";
import type { Rename } from "../src/model.js";

const rename = (id: string, to: string): Rename => ({ op: "rename", id, to });
const entries = (ids: Map<string, string>) => Object.fromEntries(ids);

describe("nodeIds", () => {
  it("gives a box its element's ID", () => {
    expect(entries(nodeIds(new Map(), [], ["web", "api"]))).toEqual({ web: "web", api: "api" });
  });

  it("keeps a box's node ID through renames", () => {
    // Typing a name, then Undo, then Redo.
    const typed = nodeIds(new Map([["new-system", "new-system"]]), [rename("new-system", "payments")], ["payments"]);
    expect(entries(typed)).toEqual({ payments: "new-system" });
    const undone = nodeIds(typed, [rename("payments", "new-system")], ["new-system"]);
    expect(entries(undone)).toEqual({ "new-system": "new-system" });
    expect(entries(nodeIds(undone, [rename("new-system", "payments"), rename("payments", "billing")], ["billing"]))).toEqual({ billing: "new-system" });
  });

  it("follows renames in order, so two boxes can swap IDs", () => {
    const swapped = nodeIds(new Map([["a", "a"], ["b", "b"]]), [rename("a", "c"), rename("b", "a"), rename("c", "b")], ["a", "b"]);
    expect(entries(swapped)).toEqual({ a: "b", b: "a" });
  });

  it("numbers a new box's node ID when another box has its element's ID", () => {
    // After new-system became payments, another new-system is added, then another.
    const added = nodeIds(new Map([["payments", "new-system"]]), [], ["payments", "new-system"]);
    expect(entries(added)).toEqual({ payments: "new-system", "new-system": "new-system#2" });
    const again = nodeIds(added, [rename("new-system", "billing")], ["payments", "billing", "new-system"]);
    expect(entries(again)).toEqual({ payments: "new-system", billing: "new-system#2", "new-system": "new-system#3" });
  });

  it("forgets boxes that left the view, and leaves boxes alone through other elements' renames", () => {
    const left = nodeIds(new Map([["payments", "new-system"], ["web", "web"]]), [rename("db", "orders-db")], ["web"]);
    expect(entries(left)).toEqual({ web: "web" });
    // The ID payments' box had is free again.
    expect(entries(nodeIds(left, [], ["web", "new-system"]))).toEqual({ web: "web", "new-system": "new-system" });
  });
});

describe("inNodeOrder", () => {
  const element = (id: string, kind: ArchElement["kind"] = "system") => ({ id, kind }) as ArchElement;

  it("keeps a renamed box where it was among the others", () => {
    // computeView's order after new-system became zebra: by kind, then ID.
    const shown = [element("customer", "person"), element("billing"), element("orders"), element("zebra")];
    const nodes = new Map([["customer", "customer"], ["billing", "billing"], ["orders", "orders"], ["zebra", "new-system"]]);
    expect(inNodeOrder(shown, nodes).map((e) => e.id)).toEqual(["customer", "billing", "zebra", "orders"]);
  });

  it("is computeView's order when nothing was renamed", () => {
    const shown = [element("customer", "person"), element("billing"), element("orders")];
    expect(inNodeOrder(shown, new Map(shown.map((e) => [e.id, e.id])))).toEqual(shown);
  });
});
