import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtyRemaining } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { createInvoice, addInvoiceLine, addInvoiceCharge, postInvoice, previewPurchasePost, getInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("charge lines are ignored by posting and preview", () => {
  it("posting a purchase invoice adds stock for item lines but not charge lines", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 5, unitCostCents: 400 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Freight", amountCents: 900 });
    postInvoice(db, inv);
    expect(getInvoice(db, inv)!.status).toBe("posted");
    expect(qtyRemaining(db, item)).toBe(5);   // charge line added no stock
  });

  it("previewPurchasePost never lists a charge line as needing an item", () => {
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceCharge(db, { invoiceId: inv, name: "Freight", amountCents: 900 });
    expect(previewPurchasePost(db, inv)).toEqual({ autoResolved: [], needsReview: [] });
  });

  it("posting a sale invoice with a charge does not require the charge to have an item", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: item, purchasedOn: "2026-07-01", quantity: 10, unitCostCents: 100 });
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-02", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 3, unitCostCents: 0, unitPriceCents: 500 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Shipping", amountCents: 700 });
    postInvoice(db, inv);   // must NOT throw "must map to an item"
    expect(qtyRemaining(db, item)).toBe(7);   // only the item line reduced stock
  });
});
