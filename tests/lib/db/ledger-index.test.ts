import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createDb, migrate } from "@/lib/db/connection";
import { SCHEMA } from "@/lib/db/schema";

const indexes = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ledger_transactions'")
    .all() as { name: string }[]).map((r) => r.name);

describe("ledger_transactions lookup index", () => {
  it("exists on a fresh database", () => {
    expect(indexes(createDb(":memory:"))).toContain("idx_lt_product_kind");
  });

  it("is added to a database that predates it, and re-running is a no-op", () => {
    const db = new Database(":memory:");
    db.exec(SCHEMA);
    db.exec("DROP INDEX IF EXISTS idx_lt_product_kind");
    expect(indexes(db)).not.toContain("idx_lt_product_kind");

    migrate(db);
    expect(indexes(db)).toContain("idx_lt_product_kind");
    migrate(db);
    expect(indexes(db).filter((n) => n === "idx_lt_product_kind")).toHaveLength(1);
  });

  it("makes the per-item sales count an index search rather than a table scan", () => {
    const db = createDb(":memory:");
    const steps = (db.prepare(`EXPLAIN QUERY PLAN
      SELECT COUNT(*) FROM ledger_transactions lt
      JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
      WHERE lt.kind = 'sale' AND pa.item_id = ?`).all(1) as { detail: string }[])
      .map((r) => r.detail);

    // The ledger step must go through the index. SQLite may pick either a covering
    // scan or a search depending on table size; both read only the index. What must
    // never appear is a bare "SCAN lt" — a full pass over every ledger row, once per
    // inventory item, which is what made the dashboard quadratic.
    expect(steps.join(" | ")).toContain("idx_lt_product_kind");
    expect(steps).not.toContain("SCAN lt");
  });
});
