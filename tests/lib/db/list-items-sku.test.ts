import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, listItems } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("listItems sku", () => {
  it("includes each item's sku", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const row = listItems(db).find((r) => r.id === id)!;
    expect(row.sku).toBe(`ITEM-${String(id).padStart(5, "0")}`);
  });
});
