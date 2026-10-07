import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, recordSupplierIdentifier } from "@/lib/db/aliases";
import { listWhatnotMappings } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, name: string, on: string, kind = "sale") {
  db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES (?,?,500,?,?,?)`).run(on, on, kind, name, `k-${name}-${Math.random()}`);
}

describe("listWhatnotMappings", () => {
  it("lists every Whatnot name with its item, sales and last sale", () => {
    const a = insertItem(db, { name: "Donut", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Cat", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-08-01' WHERE id = ?").run(b);
    setAlias(db, "CRUNCHY DONUT", a);
    setAlias(db, "MINI CAT", b);
    recordSupplierIdentifier(db, "ACME-1", a);       // supplier codes are not mappings
    addLedgerSale(db, "CRUNCHY DONUT", "2026-09-01");
    addLedgerSale(db, "CRUNCHY DONUT", "2026-09-15");
    addLedgerSale(db, "CRUNCHY DONUT", "2026-09-20", "refund"); // only sales count

    const rows = listWhatnotMappings(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.productName === "CRUNCHY DONUT")).toMatchObject({
      itemId: a, itemName: "Donut", archived: false, saleCount: 2, lastSoldOn: "2026-09-15",
    });
    expect(rows.find((r) => r.productName === "MINI CAT")).toMatchObject({
      itemId: b, itemName: "Cat", archived: true, saleCount: 0, lastSoldOn: null,
    });
  });
});
