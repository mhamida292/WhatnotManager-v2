import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { createInvoice, addInvoiceLine, addInvoiceCharge, listInvoiceLines, getInvoice, postInvoice } from "@/lib/db/invoices";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("invoice charges/deductions", () => {
  it("a positive charge adds to the total; a negative deduction subtracts", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 2, unitCostCents: 500 }); // 1000
    addInvoiceCharge(db, { invoiceId: inv, name: "Shipping", amountCents: 1200 });   // +1200
    addInvoiceCharge(db, { invoiceId: inv, name: "Discount", amountCents: -300 });    // -300
    expect(getInvoice(db, inv)!.total).toBe(1000 + 1200 - 300);
  });

  it("marks charge lines with kind='charge' and item lines with kind='item'", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "sale", customer: "Bob", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 1, unitCostCents: 0, unitPriceCents: 900 });
    addInvoiceCharge(db, { invoiceId: inv, name: "Sales Tax", amountCents: 74 });
    const lines = listInvoiceLines(db, inv);
    expect(lines.find((l) => l.kind === "charge")).toMatchObject({ productName: "Sales Tax", quantity: 1, itemId: null });
    expect(lines.filter((l) => l.kind === "item")).toHaveLength(1);
    expect(getInvoice(db, inv)!.total).toBe(900 + 74);   // sale uses unit_price; charge counts too
  });

  it("refuses to add a charge to a posted invoice (respects the lock)", () => {
    const item = insertItem(db, { name: "Widget", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const inv = createInvoice(db, { direction: "purchase", invoiceDate: "2026-07-01", notes: null });
    addInvoiceLine(db, { invoiceId: inv, itemId: item, productName: "Widget", quantity: 1, unitCostCents: 100 });
    postInvoice(db, inv);
    expect(() => addInvoiceCharge(db, { invoiceId: inv, name: "Late Fee", amountCents: 500 })).toThrow();
  });
});
