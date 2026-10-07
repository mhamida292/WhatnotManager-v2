import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, whatnotAliasesByItem } from "@/lib/db/inventory";
import { setAlias, recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, name: string) {
  db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES ('2026-01-01','2026-01-01',500,'sale',?,?)`).run(name, `k-${name}-${Math.random()}`);
}

describe("whatnotAliasesByItem", () => {
  it("lists each item's Whatnot names, most-sold first, then by name", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Cat", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "AAA DONUT", a);
    setAlias(db, "ZZZ DONUT", a);
    setAlias(db, "MMM DONUT", a);
    setAlias(db, "CAT", b);
    recordSupplierIdentifier(db, "ACME-1", a); // not a Whatnot name
    addLedgerSale(db, "ZZZ DONUT");
    addLedgerSale(db, "ZZZ DONUT");

    const map = whatnotAliasesByItem(db);
    expect(map.get(a)).toEqual(["ZZZ DONUT", "AAA DONUT", "MMM DONUT"]);
    expect(map.get(b)).toEqual(["CAT"]);
  });

  it("omits items with no Whatnot names", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(whatnotAliasesByItem(db).has(a)).toBe(false);
  });
});
