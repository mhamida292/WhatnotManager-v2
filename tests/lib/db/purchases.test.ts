import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB, backfillPurchases } from "@/lib/db/connection";
import { insertItem, createItemWithFirstPurchase } from "@/lib/db/inventory";
import { addPurchase, listPurchases, recomputeItemTotals, updatePurchase, deletePurchase, itemSpendCents, getPurchaseItemId } from "@/lib/db/purchases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("item purchases", () => {
  it("addPurchase appends a batch and recomputes weighted-average totals", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 12, unitCostCents: 180 });

    const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item.q).toBe(24);
    expect(item.c).toBe(165); // round((12*150 + 12*180) / 24)
  });

  it("listPurchases returns batches oldest first", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 5, unitCostCents: 180 });
    addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    const rows = listPurchases(db, id);
    expect(rows.map((r) => r.purchasedOn)).toEqual(["2026-03-02", "2026-06-09"]);
    expect(rows[0]).toMatchObject({ quantity: 12, unitCostCents: 150 });
  });

  it("recomputeItemTotals sets totals to zero when there are no batches", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 999, qtyPurchased: 7, lotId: null });
    recomputeItemTotals(db, id);
    const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ q: 0, c: 0 });
  });

  it("updatePurchase corrects a batch and recomputes totals", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const pid = addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    updatePurchase(db, pid, { purchasedOn: "2026-03-02", quantity: 10, unitCostCents: 200 });
    const item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ q: 10, c: 200 });
  });

  it("deletePurchase removes a batch; deleting the last one zeroes totals", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const a = addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    const b = addPurchase(db, { itemId: id, purchasedOn: "2026-06-09", quantity: 12, unitCostCents: 180 });
    deletePurchase(db, b);
    let item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ q: 12, c: 150 });
    deletePurchase(db, a);
    item = db.prepare("SELECT qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ q: 0, c: 0 });
    expect(listPurchases(db, id)).toHaveLength(0);
  });

  it("createItemWithFirstPurchase makes the item and its first batch atomically", () => {
    const id = createItemWithFirstPurchase(db, { name: "Gel", lotId: null, purchasedOn: "2026-06-01", quantity: 10, unitCostCents: 250 });
    const item = db.prepare("SELECT name, qty_purchased AS q, unit_cost_cents AS c FROM inventory_items WHERE id = ?").get(id) as any;
    expect(item).toMatchObject({ name: "Gel", q: 10, c: 250 });
    expect(listPurchases(db, id)).toHaveLength(1);
  });

  it("backfillPurchases seeds one batch per legacy item and is idempotent", () => {
    db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('Legacy', 150, 12)").run();
    const id = db.prepare("SELECT id FROM inventory_items WHERE name='Legacy'").get() as { id: number };

    backfillPurchases(db);
    let rows = listPurchases(db, id.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 12, unitCostCents: 150, purchasedOn: null });

    backfillPurchases(db); // running again must not duplicate
    rows = listPurchases(db, id.id);
    expect(rows).toHaveLength(1);
  });

  it("backfillPurchases skips items with zero purchased", () => {
    db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('Empty', 150, 0)").run();
    const id = db.prepare("SELECT id FROM inventory_items WHERE name='Empty'").get() as { id: number };
    backfillPurchases(db);
    expect(listPurchases(db, id.id)).toHaveLength(0);
  });

  it("addPurchase records an optional invoiceId, exposed by listPurchases", () => {
    const id = insertItem(db, { name: "Gel", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    db.prepare("INSERT INTO invoices (supplier) VALUES ('Co')").run();
    const invId = Number((db.prepare("SELECT id FROM invoices").get() as any).id);
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 5, unitCostCents: 100, invoiceId: invId });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 100 });
    const rows = listPurchases(db, id);
    expect(rows.find((r) => r.quantity === 5)!.invoiceId).toBe(invId);
    expect(rows.find((r) => r.quantity === 3)!.invoiceId).toBeNull();
  });

  it("getPurchaseItemId returns the owning item for an existing batch, undefined for a missing one", () => {
    const id = insertItem(db, { name: "Butter", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const pid = addPurchase(db, { itemId: id, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });
    expect(getPurchaseItemId(db, pid)).toBe(id);
    expect(getPurchaseItemId(db, pid + 999)).toBeUndefined();
  });

  it("itemSpendCents is the exact sum of batch costs (no rounding drift)", () => {
    const id = insertItem(db, { name: "Odd", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 100 });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 3, unitCostCents: 101 });
    // avg rounds to 101 (round(603/6)=101) -> avg*qty = 606, but exact spend is 603.
    expect(itemSpendCents(db, id)).toBe(603);
  });
});
