import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { dismissProductName, restoreProductName, listDismissedNames, dismissedCodes } from "@/lib/db/dismissed-names";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("dismissed product names", () => {
  it("dismisses a name and reports it back", () => {
    dismissProductName(db, "BUNDLE ON SCREEN");
    expect(listDismissedNames(db).map((d) => d.code)).toEqual(["BUNDLE ON SCREEN"]);
    expect(dismissedCodes(db).has("BUNDLE ON SCREEN")).toBe(true);
  });

  it("normalizes to the base name, so #N variants dismiss together", () => {
    dismissProductName(db, "BUNDLE ON SCREEN #4");
    expect(dismissedCodes(db).has("BUNDLE ON SCREEN")).toBe(true);
  });

  it("is idempotent — dismissing twice keeps one row", () => {
    dismissProductName(db, "ON SCREEN BUNDLE");
    dismissProductName(db, "ON SCREEN BUNDLE");
    expect(listDismissedNames(db)).toHaveLength(1);
  });

  it("restores a name", () => {
    dismissProductName(db, "BUNDLE ON SCREEN");
    restoreProductName(db, "BUNDLE ON SCREEN");
    expect(listDismissedNames(db)).toEqual([]);
    expect(dismissedCodes(db).size).toBe(0);
  });

  it("reports the revenue still counting at $0 cost", () => {
    db.prepare(
      `INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
       VALUES ('Jul 6, 2026','2026-07-06',?,'sale',?,?)`
    ).run(50000, "BUNDLE ON SCREEN", "k1");
    db.prepare(
      `INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
       VALUES ('Jul 7, 2026','2026-07-07',?,'sale',?,?)`
    ).run(24000, "BUNDLE ON SCREEN", "k2");
    dismissProductName(db, "BUNDLE ON SCREEN");

    const [row] = listDismissedNames(db);
    expect(row.revenueCents).toBe(74000);
    expect(row.saleCount).toBe(2);
  });
});
