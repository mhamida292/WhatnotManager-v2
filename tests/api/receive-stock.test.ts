import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, listItems } from "@/lib/db/inventory";
import { addPurchase, listPurchases } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("receiving stock", () => {
  it("adds a batch and increases qty_purchased via recompute", () => {
    const id = createItemWithFirstPurchase(db, { name: "Widget", lotId: null, purchasedOn: null, quantity: 10, unitCostCents: 100 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-07-15", quantity: 5, unitCostCents: 120 });
    expect(listPurchases(db, id)).toHaveLength(2);
    expect(listItems(db).find((i) => i.id === id)?.qtyPurchased).toBe(15);
  });
});
