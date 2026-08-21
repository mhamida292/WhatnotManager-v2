import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { insertItem, qtyRemaining, warehouseQty, whatnotQty, reconcileWhatnotOnly } from "@/lib/db/inventory";
import { addPurchase, updatePurchase, deletePurchase } from "@/lib/db/purchases";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { createInvoice, addInvoiceLine, postInvoice, unpostInvoice, deleteInvoice } from "@/lib/db/invoices";
import { addAdjustment, deleteAdjustment } from "@/lib/db/adjustments";
import { addMove } from "@/lib/db/moves";

function enable(db: any) {
  updateSettings(db, { ...getSettings(db), whatnotOnly: true });
}

function assertPartition(db: any, id: number) {
  expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
}

describe("reconcileWhatnotOnly", () => {
  it("delete a received batch: reconciling brings Warehouse back to 0", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    const purchaseId = addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(10);
    assertPartition(db, id);

    deletePurchase(db, purchaseId);
    reconcileWhatnotOnly(db, id);

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(0);
    expect(qtyRemaining(db, id)).toBe(0);
    assertPartition(db, id);
  });

  it("edit a batch's quantity down: reconciling settles the delta", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    const purchaseId = addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    updatePurchase(db, purchaseId, { purchasedOn: null, quantity: 4, unitCostCents: 50 });
    reconcileWhatnotOnly(db, id);

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(4);
    assertPartition(db, id);
  });

  it("unpost a sale: Warehouse returns to 0 and Whatnot is restored", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    const invId = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "A", quantity: 3, unitCostCents: 0, unitPriceCents: 100 });
    postInvoice(db, invId);

    expect(whatnotQty(db, id)).toBe(7);

    unpostInvoice(db, invId);

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(10);
    assertPartition(db, id);
  });

  it("deleteInvoice on a posted SALE invoice: Warehouse returns to 0 and Whatnot is restored", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    const invId = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "A", quantity: 3, unitCostCents: 0, unitPriceCents: 100 });
    postInvoice(db, invId);

    expect(whatnotQty(db, id)).toBe(7);

    deleteInvoice(db, invId); // goes through the real deleteInvoice, not a hand-rolled sequence

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(10);
    assertPartition(db, id);
  });

  it("deleteInvoice on a posted PURCHASE invoice: Warehouse and qtyRemaining both return to 0", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });

    const invId = createInvoice(db, { direction: "purchase", supplier: "Co", invoiceDate: "2026-06-27", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "A", quantity: 10, unitCostCents: 50 });
    postInvoice(db, invId);

    expect(whatnotQty(db, id)).toBe(10);
    expect(warehouseQty(db, id)).toBe(0);

    deleteInvoice(db, invId); // goes through the real deleteInvoice, not a hand-rolled sequence

    expect(warehouseQty(db, id)).toBe(0);
    expect(qtyRemaining(db, id)).toBe(0);
    assertPartition(db, id);
  });

  it("is idempotent: a second call leaves buckets unchanged and writes no second move", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    const purchaseId = addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });
    deletePurchase(db, purchaseId);

    reconcileWhatnotOnly(db, id);
    const countAfterFirst = (db.prepare("SELECT COUNT(*) AS c FROM inventory_moves WHERE item_id = ?").get(id) as { c: number }).c;
    const warehouseAfterFirst = warehouseQty(db, id);
    const whatnotAfterFirst = whatnotQty(db, id);

    reconcileWhatnotOnly(db, id);
    const countAfterSecond = (db.prepare("SELECT COUNT(*) AS c FROM inventory_moves WHERE item_id = ?").get(id) as { c: number }).c;

    expect(countAfterSecond).toBe(countAfterFirst);
    expect(warehouseQty(db, id)).toBe(warehouseAfterFirst);
    expect(whatnotQty(db, id)).toBe(whatnotAfterFirst);
    assertPartition(db, id);
  });

  it("delete a pre-toggle warehouse-channel adjustment: reconciling brings Warehouse back to 0", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    // Mode OFF: a warehouse-channel adjustment is created (feeds sumAdjustments, not sumWhatnotAdjustments).
    const adjId = addAdjustment(db, { itemId: id, adjustedOn: null, reason: "recount", qty: 5, note: null, channel: "warehouse" });
    // Move all 5 units to Whatnot so Warehouse sits at 0 before the mode is enabled.
    addMove(db, { itemId: id, qty: 5, direction: "to_whatnot", note: null });
    enable(db);

    expect(warehouseQty(db, id)).toBe(0);

    deleteAdjustment(db, adjId);
    reconcileWhatnotOnly(db, id);

    expect(warehouseQty(db, id)).toBe(0);
    assertPartition(db, id);
  });

  it("delete a pre-toggle legacy NULL-channel adjustment: reconciling brings Warehouse back to 0", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    const purchaseId = addPurchase(db, { itemId: id, purchasedOn: null, quantity: 20, unitCostCents: 50 });
    void purchaseId;
    // Mode OFF: a legacy adjustment with no channel set at all (predates the channel column's use).
    const adjId = addAdjustment(db, { itemId: id, adjustedOn: null, reason: "recount", qty: -3, note: null, channel: null });
    // Move all remaining 17 units to Whatnot so Warehouse sits at 0 before the mode is enabled.
    addMove(db, { itemId: id, qty: 17, direction: "to_whatnot", note: null });
    enable(db);

    expect(warehouseQty(db, id)).toBe(0);

    deleteAdjustment(db, adjId);
    reconcileWhatnotOnly(db, id);

    expect(warehouseQty(db, id)).toBe(0);
    assertPartition(db, id);
  });

  it("is a no-op with the mode off", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    const before = warehouseQty(db, id);
    const moveCountBefore = (db.prepare("SELECT COUNT(*) AS c FROM inventory_moves WHERE item_id = ?").get(id) as { c: number }).c;

    reconcileWhatnotOnly(db, id);

    expect(warehouseQty(db, id)).toBe(before);
    const moveCountAfter = (db.prepare("SELECT COUNT(*) AS c FROM inventory_moves WHERE item_id = ?").get(id) as { c: number }).c;
    expect(moveCountAfter).toBe(moveCountBefore);
  });
});
