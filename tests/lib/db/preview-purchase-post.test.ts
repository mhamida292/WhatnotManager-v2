import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { createInvoice, addInvoiceLine, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

// Real signatures (verified in invoices.ts):
//   createInvoice(db, { direction?, supplier?, customer?, invoiceDate, notes }) => number
//     — invoiceDate and notes are REQUIRED (pass null when unused).
//   addInvoiceLine(db, { invoiceId, itemId, productName, quantity, unitCostCents, unitPriceCents? }) => number

describe("previewPurchasePost", () => {
  it("auto-resolves a line whose name already maps to an item", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    setAlias(db, "ACME Booster", id); // identifier exists
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 10, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([{ lineId, itemId: id }]);
    expect(pre.needsReview).toEqual([]);
  });

  it("flags an unresolved line with a best-match suggestion", () => {
    const id = insertItem(db, { name: "Pokemon Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Pokemon Booster Box (Case)", quantity: 5, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([]);
    expect(pre.needsReview).toHaveLength(1);
    expect(pre.needsReview[0]).toMatchObject({ lineId, suggestedItemId: id });
    expect(pre.needsReview[0].confident).toBe(true);
  });

  it("ignores lines already linked to an item", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: id, productName: "Widget", quantity: 1, unitCostCents: 100 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.autoResolved).toEqual([]);
    expect(pre.needsReview).toEqual([]);
  });

  it("returns empty for a sale invoice (purchase-only) even with an unresolved line", () => {
    insertItem(db, { name: "Pokemon Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Pokemon Booster Box Case", quantity: 5, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre).toEqual({ autoResolved: [], needsReview: [] });
  });
});
