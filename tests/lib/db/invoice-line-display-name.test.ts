import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, renameItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, listInvoiceLines } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("listInvoiceLines displayName", () => {
  it("shows the linked item's CURRENT name, and updates after a rename", () => {
    const id = insertItem(db, { name: "Old Name", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: id, productName: "Old Name", quantity: 2, unitCostCents: 100 });

    expect(listInvoiceLines(db, inv)[0].displayName).toBe("Old Name");

    renameItem(db, id, "New Name");
    const line = listInvoiceLines(db, inv)[0];
    expect(line.displayName).toBe("New Name");   // live join reflects the rename
    expect(line.productName).toBe("Old Name");   // snapshot is unchanged
  });

  it("falls back to the snapshot for an unlinked line (no item_id)", () => {
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: null, productName: "Free Text Line", quantity: 1, unitCostCents: 50 });
    expect(listInvoiceLines(db, inv)[0].displayName).toBe("Free Text Line");
  });
});
