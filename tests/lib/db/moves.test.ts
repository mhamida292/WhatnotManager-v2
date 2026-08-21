import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase } from "@/lib/db/inventory";
import { addMove, listMoves, movedToWhatnot, movedToWarehouse } from "@/lib/db/moves";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory moves", () => {
  it("records moves and sums by direction", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 100, unitCostCents: 100 });
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot", movedOn: "2026-07-15" });
    addMove(db, { itemId: id, qty: 10, direction: "to_whatnot" });
    addMove(db, { itemId: id, qty: 5, direction: "to_warehouse" });
    expect(movedToWhatnot(db, id)).toBe(40);
    expect(movedToWarehouse(db, id)).toBe(5);
    expect(listMoves(db, id)).toHaveLength(3);
  });
  it("rejects non-positive qty", () => {
    const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 1, unitCostCents: 1 });
    expect(() => addMove(db, { itemId: id, qty: 0, direction: "to_whatnot" })).toThrow();
    expect(() => addMove(db, { itemId: id, qty: -3, direction: "to_whatnot" })).toThrow();
  });
});
