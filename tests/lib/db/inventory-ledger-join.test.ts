import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtySoldFromLedger, aliasesForItem } from "@/lib/db/inventory";
import { setAlias, removeAlias } from "@/lib/db/aliases";
import { baseProductName } from "@/lib/csv/classify";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

// Mirrors production: parseLedger (src/lib/csv/ledger.ts) strips the trailing
// " #N" listing suffix via baseProductName before ledger_transactions.product_name
// is ever written, so the join always compares base names. Do the same here.
function addLedgerSale(db: DB, productName: string): void {
  db.prepare(`INSERT INTO ledger_transactions
    (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES ('2026-01-01','2026-01-01',500,'sale',?,?)`).run(baseProductName(productName), `k-${productName}-${Math.random()}`);
}

describe("ledger joins over item_identifiers", () => {
  it("qtySoldFromLedger counts sales whose base name maps to the item", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    addLedgerSale(db, "Highland Cow Squishy #1");
    addLedgerSale(db, "Highland Cow Squishy #2");
    expect(qtySoldFromLedger(db, id)).toBe(2);
  });

  it("aliasesForItem lists the mapped whatnot names with sale counts", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    addLedgerSale(db, "Highland Cow Squishy");
    const rows = aliasesForItem(db, id);
    expect(rows).toEqual([{ id: expect.any(Number), productName: "Highland Cow Squishy", saleCount: 1 }]);
  });

  it("removeAlias makes a mapped name's sales stop counting toward the item", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", id);
    setAlias(db, "Cheddar Block", id);
    addLedgerSale(db, "Cheese Squishy #3");
    addLedgerSale(db, "Cheddar Block #1");
    expect(qtySoldFromLedger(db, id)).toBe(2);

    const wrong = aliasesForItem(db, id).find((a) => a.productName === "Cheddar Block")!;
    removeAlias(db, wrong.id);

    expect(aliasesForItem(db, id).map((a) => a.productName)).toEqual(["Cheese Squishy"]);
    expect(qtySoldFromLedger(db, id)).toBe(1);
  });
});
