import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { insertItem, itemsWithWarehouseStock } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";

describe("itemsWithWarehouseStock", () => {
  it("is empty when every item has zero warehouse stock", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "Empty", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(itemsWithWarehouseStock(db)).toEqual([]);
  });

  it("lists items holding warehouse stock, with name and qty", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Blue Widget", unitCostCents: 100, qtyPurchased: 12, lotId: null });
    expect(itemsWithWarehouseStock(db)).toEqual([{ id, name: "Blue Widget", qty: 12 }]);
  });

  it("catches a negative warehouse bucket too", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Oversold", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addMove(db, { itemId: id, qty: 2, direction: "to_whatnot" });
    expect(itemsWithWarehouseStock(db)).toEqual([{ id, name: "Oversold", qty: -2 }]);
  });

  it("includes archived items", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Old Stock", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-01-01' WHERE id = ?").run(id);
    expect(itemsWithWarehouseStock(db).map((r) => r.id)).toContain(id);
  });
});
