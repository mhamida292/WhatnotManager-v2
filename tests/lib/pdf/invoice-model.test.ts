import { describe, it, expect } from "vitest";
import { invoicePdfModel } from "@/lib/pdf/invoice-model";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";
import type { Settings } from "@/lib/db/settings";

const baseSettings: Settings = {
  ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz",
  invoicePhone: "(313) 555-0142", invoiceAddress: "123 Warehouse Ave", invoiceEmail: "b@x.com",
  invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
};
const line = (over: Partial<InvoiceLine>): InvoiceLine => ({
  id: 1, invoiceId: 1, itemId: null, productName: "Widget", displayName: "Widget", quantity: 2, unitCostCents: 100, unitPriceCents: 150, ...over,
});
const inv = (over: Partial<Invoice>): Invoice => ({
  id: 7, number: "INV-0007", direction: "sale", supplier: null, customer: "FE Wholesale",
  invoiceDate: "2026-07-19", notes: null, status: "posted", postedAt: null, paid: false, paidOn: null, total: 300, ...over,
});

describe("invoicePdfModel", () => {
  it("sale: INVOICE / SOLD TO=customer / unit price", () => {
    const m = invoicePdfModel(inv({}), [line({ quantity: 2, unitPriceCents: 150 })], baseSettings);
    expect(m.heading).toBe("INVOICE");
    expect(m.partyLabel).toBe("SOLD TO");
    expect(m.partyValue).toBe("FE Wholesale");
    expect(m.unitLabel).toBe("Unit price");
    expect(m.lines[0]).toEqual({ qty: 2, description: "Widget", unitCents: 150, amountCents: 300 });
    expect(m.totalCents).toBe(300);
    expect(m.number).toBe("No. INV-0007");
    expect(m.date).toBe("July 19, 2026");
  });
  it("purchase: PURCHASE INVOICE / SUPPLIER=supplier / unit cost", () => {
    const m = invoicePdfModel(
      inv({ direction: "purchase", supplier: "Acme", customer: null }),
      [line({ quantity: 3, unitCostCents: 100 })], baseSettings);
    expect(m.heading).toBe("PURCHASE INVOICE");
    expect(m.partyLabel).toBe("SUPPLIER");
    expect(m.partyValue).toBe("Acme");
    expect(m.unitLabel).toBe("Unit cost");
    expect(m.lines[0]).toEqual({ qty: 3, description: "Widget", unitCents: 100, amountCents: 300 });
  });
  it("contact respects show-flags and emptiness", () => {
    expect(invoicePdfModel(inv({}), [], baseSettings).contact).toEqual(["(313) 555-0142", "123 Warehouse Ave", "b@x.com"]);
    expect(invoicePdfModel(inv({}), [], { ...baseSettings, invoiceShowEmail: false }).contact).toEqual(["(313) 555-0142", "123 Warehouse Ave"]);
    expect(invoicePdfModel(inv({}), [], { ...baseSettings, invoicePhone: null, invoiceShowAddress: false, invoiceShowEmail: false }).contact).toEqual([]);
  });
  it("missing party value renders empty string", () => {
    expect(invoicePdfModel(inv({ customer: null }), [], baseSettings).partyValue).toBe("");
  });
  it("totalPieces sums quantities of item lines and excludes charge lines", () => {
    const lines = [
      line({ quantity: 6, kind: "item" }),
      line({ quantity: 4, kind: "item" }),
      line({ quantity: 1, kind: "charge", productName: "Shipping", displayName: "Shipping" }),
    ];
    const m = invoicePdfModel(inv({}), lines, baseSettings);
    expect(m.totalPieces).toBe(10);   // 6 + 4, charge excluded
  });
});
