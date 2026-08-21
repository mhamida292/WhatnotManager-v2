import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("insertItem sku", () => {
  it("assigns a unique sku and a 'mine' identifier", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const row = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string };
    expect(row.sku).toBe(`ITEM-${String(id).padStart(5, "0")}`);
    const mine = db.prepare("SELECT code FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(id) as { code: string };
    expect(mine.code).toBe(row.sku);
  });
});
