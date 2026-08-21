import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, previewPurchasePost } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("post-preview data", () => {
  it("returns needsReview for an unresolved purchase line", () => {
    const item = insertItem(db, { name: "Pokemon Booster Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const invId = createInvoice(db, { direction: "purchase", invoiceDate: null, notes: null });
    addInvoiceLine(db, { invoiceId: invId, itemId: null, productName: "Pokemon Booster Box Case", quantity: 5, unitCostCents: 400 });
    const pre = previewPurchasePost(db, invId);
    expect(pre.needsReview).toHaveLength(1);
    expect(pre.needsReview[0].suggestedItemId).toBe(item);
  });
});
