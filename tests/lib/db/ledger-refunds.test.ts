import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { listRefunds, refundsTotalCents } from "@/lib/db/ledger-refunds";

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
  setAlias(db, "Cheese Squishy", cheese);
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 14, 2026, 9:00:00 AM","-$2.76","L1","O1","Reversal of sales transaction for order refund","completed","ADJUSTMENT",""
"Jun 14, 2026, 9:00:01 AM","-$1.50","","","Deduction for order refund shipping costs [Order Id: O1]","completed","ADJUSTMENT",""`;
  saveLedger(db, parseLedger(csv));
});

describe("listRefunds", () => {
  it("matches the sale-reversal to its product via order_id and links the item", () => {
    const refunds = listRefunds(db);
    const reversal = refunds.find((r) => !r.isShipping)!;
    expect(reversal.productName).toBe("Cheese Squishy");
    expect(reversal.itemId).not.toBeNull();
    expect(reversal.amountCents).toBe(-276);
  });
  it("marks shipping-cost deductions with no product", () => {
    const shipping = listRefunds(db).find((r) => r.isShipping)!;
    expect(shipping.productName).toBeNull();
    expect(shipping.isShipping).toBe(true);
  });
  it("totals all refunds", () => {
    expect(refundsTotalCents(db)).toBe(-276 - 150);
  });
});
