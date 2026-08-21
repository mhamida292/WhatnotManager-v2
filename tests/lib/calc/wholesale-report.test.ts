import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { createInvoice, addInvoiceLine, postInvoice, setInvoicePaid } from "@/lib/db/invoices";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function saleOf(item: number, qty: number, priceCents: number, paid: boolean) {
  const id = createInvoice(db, { direction: "sale", customer: "Joe", invoiceDate: "2026-06-27", notes: null });
  addInvoiceLine(db, { invoiceId: id, itemId: item, productName: "Pack", quantity: qty, unitCostCents: 0, unitPriceCents: priceCents });
  postInvoice(db, id);
  if (paid) setInvoicePaid(db, id, true, "2026-06-28");
  return id;
}

it("only PAID wholesale counts toward profit; unpaid sits in owedToYou", () => {
  const item = insertItem(db, { name: "Pack", unitCostCents: 175, qtyPurchased: 0, lotId: null });
  addPurchase(db, { itemId: item, purchasedOn: null, quantity: 100, unitCostCents: 175 });
  saleOf(item, 24, 300, true);   // revenue 7200, cogs 24*175=4200, profit 3000
  saleOf(item, 10, 300, false);  // unpaid -> owed 3000, excluded from profit

  const rep = buildLedgerReport(db);
  expect(rep.wholesale.paidRevenueCents).toBe(7200);
  expect(rep.wholesale.paidCogsCents).toBe(4200);
  expect(rep.wholesale.paidProfitCents).toBe(3000);
  expect(rep.wholesale.owedToYouCents).toBe(3000);
  expect(rep.totals.revenueCents).toBe(7200);
  expect(rep.totals.cogsCents).toBe(4200);
  expect(rep.totals.netCents).toBe(3000);
});
