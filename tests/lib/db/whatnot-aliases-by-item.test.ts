import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, whatnotAliasesByItem } from "@/lib/db/inventory";
import { setAlias, recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, name: string, on = "2026-01-01") {
  db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES (?,?,500,'sale',?,?)`).run(on, on, name, `k-${name}-${Math.random()}`);
}

describe("whatnotAliasesByItem", () => {
  it("lists each item's Whatnot names, most recently sold first", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "CRUNCHY DONUT", a);
    setAlias(db, "CRUNCHY WAX DONUT", a);
    // The old name outsold the new one, but the new one is what's listed now.
    for (let n = 0; n < 3; n++) addLedgerSale(db, "CRUNCHY DONUT", "2026-09-15");
    addLedgerSale(db, "CRUNCHY WAX DONUT", "2026-09-22");

    expect(whatnotAliasesByItem(db).get(a)).toEqual(["CRUNCHY WAX DONUT", "CRUNCHY DONUT"]);
  });

  it("puts never-sold names last, and breaks ties by sales then name", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Cat", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "AAA DONUT", a);
    setAlias(db, "ZZZ DONUT", a);
    setAlias(db, "MMM DONUT", a);
    setAlias(db, "BBB DONUT", a);
    setAlias(db, "CAT", b);
    recordSupplierIdentifier(db, "ACME-1", a); // not a Whatnot name
    addLedgerSale(db, "ZZZ DONUT", "2026-05-01");
    addLedgerSale(db, "ZZZ DONUT", "2026-05-01");
    addLedgerSale(db, "MMM DONUT", "2026-05-01");

    const map = whatnotAliasesByItem(db);
    expect(map.get(a)).toEqual(["ZZZ DONUT", "MMM DONUT", "AAA DONUT", "BBB DONUT"]);
    expect(map.get(b)).toEqual(["CAT"]);
  });

  it("omits items with no Whatnot names", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(whatnotAliasesByItem(db).has(a)).toBe(false);
  });
});
