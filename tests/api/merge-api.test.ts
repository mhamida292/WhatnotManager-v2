import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, mergeItems, qtyRemaining } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("merge api (data layer)", () => {
  it("merges and combines stock", () => {
    const survivor = insertItem(db, { name: "Real", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: survivor, purchasedOn: "2026-07-01", quantity: 4, unitCostCents: 100 });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-01", quantity: 6, unitCostCents: 100 });
    expect(mergeItems(db, { loserId: loser, survivorId: survivor })).toEqual({ ok: true });
    expect(qtyRemaining(db, survivor)).toBe(10);
  });
});
