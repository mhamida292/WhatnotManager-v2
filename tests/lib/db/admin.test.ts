import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, insertLot } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { insertExpense } from "@/lib/db/expenses";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger, listLedgerTransactions } from "@/lib/db/ledger";
import { updateSettings, getSettings } from "@/lib/db/settings";
import { resetApp } from "@/lib/db/admin";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const count = (db: DB, t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

describe("resetApp", () => {
  it("clears all data and restores default settings", () => {
    const lot = insertLot(db, { name: "Lot 1", totalCostCents: 73200 });
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: lot });
    setAlias(db, "Cheese Squishy", cheese);
    insertExpense(db, { description: "Boxes", type: "one_time", amountCents: 500 });
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`));
    updateSettings(db, { giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });

    resetApp(db);

    for (const t of ["ledger_transactions", "show_line_items", "shows", "expenses",
                     "item_identifiers", "inventory_items", "lots"]) {
      expect(count(db, t)).toBe(0);
    }
    expect(listLedgerTransactions(db)).toHaveLength(0);
    expect(getSettings(db)).toEqual({ giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
  });

  it("keeps the single settings row (does not delete it)", () => {
    resetApp(db);
    expect(count(db, "app_settings")).toBe(1);
  });
});
