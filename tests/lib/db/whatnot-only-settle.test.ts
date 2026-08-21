import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { insertItem, qtyRemaining, warehouseQty, whatnotQty } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { addAdjustment } from "@/lib/db/adjustments";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { createInvoice, addInvoiceLine, postInvoice } from "@/lib/db/invoices";

function enable(db: any) {
  updateSettings(db, { ...getSettings(db), whatnotOnly: true });
}

describe("whatnot-only compensation", () => {
  it("receiving lands in Whatnot, leaving Warehouse at 0", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(10);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });

  it("receiving while OFF still lands in Warehouse (unchanged behavior)", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    expect(warehouseQty(db, id)).toBe(10);
    expect(whatnotQty(db, id)).toBe(0);
  });

  it("adjustments record on the whatnot channel while ON", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -2, note: null });

    const row = db.prepare("SELECT channel FROM inventory_adjustments WHERE item_id = ?").get(id) as { channel: string };
    expect(row.channel).toBe("whatnot");
    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(8);
  });

  it("posting a wholesale sale draws down Whatnot, leaving Warehouse at 0", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    const invId = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "A", quantity: 3, unitCostCents: 0, unitPriceCents: 100 });
    postInvoice(db, invId);

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(7);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
});
