import { describe, it, expect } from "vitest";
import { invoiceAverages } from "@/lib/calc/invoice-averages";
import type { InvoiceLine } from "@/lib/db/invoices";

function line(p: Partial<InvoiceLine>): InvoiceLine {
  return {
    id: 1, invoiceId: 1, itemId: null, productName: "x", displayName: "x",
    quantity: 1, unitCostCents: 0, unitPriceCents: null, kind: "item", ...p,
  };
}

describe("invoiceAverages", () => {
  it("averages purchase item lines by unit cost, ignoring charges", () => {
    const a = invoiceAverages([
      line({ id: 1, quantity: 100, unitCostCents: 400 }),
      line({ id: 2, quantity: 100, unitCostCents: 600 }),
      line({ id: 3, kind: "charge", quantity: 1, unitCostCents: 10_000 }),
    ], "purchase");
    expect(a.units).toBe(200);
    expect(a.avgItemCents).toBe(500);       // 100000 / 200
    expect(a.avgLandedCents).toBe(550);     // (100000 + 10000) / 200
  });

  it("averages sale lines by unit price", () => {
    const a = invoiceAverages([
      line({ id: 1, quantity: 3, unitCostCents: 100, unitPriceCents: 250 }),
      line({ id: 2, kind: "charge", quantity: 1, unitCostCents: 0, unitPriceCents: 500 }),
    ], "sale");
    expect(a.units).toBe(3);
    expect(a.avgItemCents).toBe(250);
    expect(a.avgLandedCents).toBe(417);     // 1250 / 3 = 416.67 -> 417
  });

  it("treats a missing sale unit price as zero", () => {
    const a = invoiceAverages([line({ quantity: 2, unitPriceCents: null })], "sale");
    expect(a.avgItemCents).toBe(0);
  });

  it("returns null averages when there are no units", () => {
    const a = invoiceAverages([line({ kind: "charge", quantity: 1, unitCostCents: 900 })], "purchase");
    expect(a.units).toBe(0);
    expect(a.avgItemCents).toBeNull();
    expect(a.avgLandedCents).toBeNull();
  });

  it("reports no charges when the invoice has none", () => {
    const a = invoiceAverages([line({ quantity: 4, unitCostCents: 125 })], "purchase");
    expect(a.chargeCents).toBe(0);
    expect(a.avgLandedCents).toBe(125);
  });
});
