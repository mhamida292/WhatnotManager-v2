import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, setSku } from "@/lib/db/inventory";
import { resolveItemId, addIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("setSku", () => {
  it("updates the sku column and the mine identifier together", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(setSku(db, id, "POK-BOOST-01")).toEqual({ ok: true });
    const row = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string };
    expect(row.sku).toBe("POK-BOOST-01");
    expect(resolveItemId(db, "POK-BOOST-01")).toBe(id);      // mine identifier updated
    expect(resolveItemId(db, "ITEM-00001")).toBeNull();       // old code no longer resolves
    const mineCount = db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(id) as { n: number };
    expect(mineCount.n).toBe(1);                              // still exactly one mine row
  });

  it("rejects a duplicate sku owned by another item", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null }); // ITEM-00001
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null }); // ITEM-00002
    expect(setSku(db, b, "ITEM-00001")).toEqual({ ok: false, reason: "duplicate" });
    const bRow = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(b) as { sku: string };
    expect(bRow.sku).toBe("ITEM-00002"); // unchanged
  });

  it("rejects setting the sku to a code this same item already uses (no crash)", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    addIdentifier(db, { itemId: id, source: "supplier", code: "FOO" });
    expect(setSku(db, id, "FOO")).toEqual({ ok: false, reason: "duplicate" }); // must NOT throw
    const row = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string };
    expect(row.sku).toBe("ITEM-00001"); // unchanged
  });

  it("rejects empty and unknown item", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(setSku(db, id, "  ")).toEqual({ ok: false, reason: "empty" });
    expect(setSku(db, 9999, "X")).toEqual({ ok: false, reason: "not_found" });
  });
});
