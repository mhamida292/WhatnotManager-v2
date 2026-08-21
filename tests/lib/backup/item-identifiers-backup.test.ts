import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { exportWorkbook, importWorkbook } from "@/lib/backup/workbook";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("item_identifiers backup round-trip", () => {
  it("exports and re-imports whatnot identifiers", async () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    const buf = await exportWorkbook(db);

    const db2 = createDb(":memory:");
    await importWorkbook(db2, buf);
    const rows = db2.prepare("SELECT source, code FROM item_identifiers WHERE code = 'Highland Cow Squishy'").all();
    expect(rows).toEqual([{ source: "whatnot", code: "Highland Cow Squishy" }]);
  });
});
