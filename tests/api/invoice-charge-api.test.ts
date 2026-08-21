import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createInvoice, addInvoiceCharge, listInvoiceLines, deleteInvoiceLine, getInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("charge line add/remove (data layer)", () => {
  it("adds a negative deduction and it can be deleted", () => {
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-01", notes: null });
    const id = addInvoiceCharge(db, { invoiceId: inv, name: "Loyalty Credit", amountCents: -250 });
    expect(getInvoice(db, inv)!.total).toBe(-250);
    deleteInvoiceLine(db, id);
    expect(listInvoiceLines(db, inv)).toHaveLength(0);
  });
});
