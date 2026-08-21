import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, identifiersForItem } from "@/lib/db/inventory";
import { setAlias, recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, name: string) {
  db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES ('2026-01-01','2026-01-01',500,'sale',?,?)`).run(name, `k-${name}-${Math.random()}`);
}

describe("identifiersForItem", () => {
  it("lists mine + supplier + whatnot identifiers ordered by source then code", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    recordSupplierIdentifier(db, "ACME-1", id);
    setAlias(db, "Highland Cow Squishy", id);
    const rows = identifiersForItem(db, id);
    // mine (the sku ITEM-00001), supplier (ACME-1), whatnot (Highland Cow Squishy)
    expect(rows.map((r) => r.source)).toEqual(["mine", "supplier", "whatnot"]);
    expect(rows.find((r) => r.source === "mine")!.code).toBe("ITEM-00001");
  });

  it("reports saleCount for a whatnot identifier and 0 for others", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    recordSupplierIdentifier(db, "ACME-1", id);
    addLedgerSale(db, "Highland Cow Squishy");
    addLedgerSale(db, "Highland Cow Squishy");
    const rows = identifiersForItem(db, id);
    expect(rows.find((r) => r.source === "whatnot")!.saleCount).toBe(2);
    expect(rows.find((r) => r.source === "supplier")!.saleCount).toBe(0);
  });
});
