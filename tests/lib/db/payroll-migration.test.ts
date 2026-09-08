import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/connection";
import { SCHEMA } from "@/lib/db/schema";

/** A full database carrying the pre-shift payroll_entries shape. The rest of the
 *  schema is real, because migrate() runs every other migration too and several
 *  of them ALTER tables that must therefore exist. */
function oldShapeDb() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec(`DROP TABLE payroll_entries;
    CREATE TABLE payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
      period_start TEXT, period_end TEXT, hours REAL, rate_cents INTEGER,
      amount_cents INTEGER NOT NULL, note TEXT)`);
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("payroll shift migration", () => {
  it("recreates an empty old-shape table with the new columns", () => {
    const db = oldShapeDb();
    migrate(db);
    const cols = columns(db, "payroll_entries");
    expect(cols).toContain("work_date");
    expect(cols).toContain("start_time");
    expect(cols).toContain("end_time");
    expect(cols).not.toContain("period_start");
    expect(columns(db, "payroll_entries_legacy")).toHaveLength(0); // no legacy table made
  });

  it("preserves rows by renaming aside rather than dropping them", () => {
    const db = oldShapeDb();
    db.prepare("INSERT INTO payroll_entries (person, period_start, amount_cents) VALUES ('Sam','2026-07-08',7500)").run();
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("work_date");
    const kept = db.prepare("SELECT person, amount_cents AS amountCents FROM payroll_entries_legacy").all();
    expect(kept).toEqual([{ person: "Sam", amountCents: 7500 }]);
  });

  it("is idempotent", () => {
    const db = oldShapeDb();
    migrate(db);
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("work_date");
  });
});
