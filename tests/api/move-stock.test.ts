import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, whatnotQty, warehouseQty } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("move stock contract", () => {
  it("moving to whatnot updates both buckets", () => {
    const id = createItemWithFirstPurchase(db, { name: "W", lotId: null, purchasedOn: null, quantity: 50, unitCostCents: 100 });
    addMove(db, { itemId: id, qty: 20, direction: "to_whatnot", movedOn: "2026-07-15" });
    expect(whatnotQty(db, id)).toBe(20);
    expect(warehouseQty(db, id)).toBe(30);
  });
});
