import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { resolveItemId } from "@/lib/db/aliases";
import { createInvoice, addInvoiceLine, postInvoice, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });
// Signatures (verified in invoices.ts):
//   createInvoice(db, { direction?, invoiceDate, notes }) => number
//   addInvoiceLine(db, { invoiceId, itemId, productName, quantity, unitCostCents }) => number

describe("postInvoice with resolutions", () => {
  it("links an unlinked line via a resolution, remembers the supplier name, and adds stock", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 10, unitCostCents: 400 });
    postInvoice(db, invId, [{ lineId, itemId: id }]);
    expect(qtyRemaining(db, id)).toBe(10);               // batch added
    expect(resolveItemId(db, "ACME Booster")).toBe(id);   // remembered as supplier identifier
    // a SECOND invoice with the same supplier name now auto-resolves (no review needed):
    const inv2 = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv2, itemId: null, productName: "ACME Booster", quantity: 3, unitCostCents: 400 });
    expect(previewPurchasePost(db, inv2).needsReview).toEqual([]);
  });

  it("creates a new item from a createName resolution", () => {
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Brand New Thing", quantity: 4, unitCostCents: 250 });
    postInvoice(db, invId, [{ lineId, createName: "Brand New Thing" }]);
    const newId = resolveItemId(db, "Brand New Thing");
    expect(newId).not.toBeNull();
    expect(qtyRemaining(db, newId!)).toBe(4);
  });

  it("throws when an unlinked line has no resolution and no existing identifier", () => {
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Orphan Line", quantity: 1, unitCostCents: 100 });
    expect(() => postInvoice(db, invId)).toThrow(/needs an item/);
  });

  it("still auto-resolves an unlinked line via an existing identifier with no resolution", () => {
    const id = insertItem(db, { name: "Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    // first post remembers the supplier name "ACME Booster" as a source='supplier' identifier:
    const lineId = addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "ACME Booster", quantity: 2, unitCostCents: 400 });
    postInvoice(db, invId, [{ lineId, itemId: id }]);
    const inv2 = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv2, itemId: null, productName: "ACME Booster", quantity: 5, unitCostCents: 400 });
    postInvoice(db, inv2);  // no resolutions needed — auto-resolves via the remembered identifier
    expect(qtyRemaining(db, id)).toBe(7);
  });
});
