import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/connection";
import { SCHEMA } from "@/lib/db/schema";

/** A full database carrying the hourly-only payroll_entries shape — the one
 *  shipped between the shift reshape and piece rates. The rest of the schema is
 *  real, because migrate() runs every other migration too and several of them
 *  ALTER tables that must therefore exist. */
function hourlyShapeDb() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec(`DROP TABLE payroll_entries;
    CREATE TABLE payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
      work_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      hours REAL NOT NULL, rate_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL, note TEXT)`);
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("payroll basis migration", () => {
  it("adds basis, qty and paid_on and drops hours", () => {
    const db = hourlyShapeDb();
    migrate(db);
    const cols = columns(db, "payroll_entries");
    expect(cols).toContain("basis");
    expect(cols).toContain("qty");
    expect(cols).toContain("paid_on");
    expect(cols).not.toContain("hours");
  });

  it("carries hourly rows across as basis 'hour' with hours as qty", () => {
    const db = hourlyShapeDb();
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, start_time, end_time, hours, rate_cents, amount_cents, note)
      VALUES ('Sam','2026-07-08','18:00','23:00',5,1500,7500,'evening')`).run();
    migrate(db);
    expect(db.prepare("SELECT * FROM payroll_entries").get()).toMatchObject({
      person: "Sam", work_date: "2026-07-08", basis: "hour", qty: 5,
      start_time: "18:00", end_time: "23:00", rate_cents: 1500,
      amount_cents: 7500, paid_on: null, note: "evening",
    });
  });

  it("leaves no legacy table behind — every column maps losslessly", () => {
    const db = hourlyShapeDb();
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, start_time, end_time, hours, rate_cents, amount_cents)
      VALUES ('Sam','2026-07-08','18:00','23:00',5,1500,7500)`).run();
    migrate(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((t) => t.name);
    expect(tables).not.toContain("payroll_entries_old");
  });

  it("is idempotent and keeps the work_date index", () => {
    const db = hourlyShapeDb();
    migrate(db);
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("qty");
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[])
      .map((i) => i.name);
    expect(idx).toContain("idx_payroll_work_date");
  });

  it("allows piece entries with no clock times", () => {
    const db = hourlyShapeDb();
    migrate(db);
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, basis, qty, rate_cents, amount_cents)
      VALUES ('Sam','2026-09-09','piece',300,15,4500)`).run();
    expect(db.prepare("SELECT start_time, end_time FROM payroll_entries").get())
      .toEqual({ start_time: null, end_time: null });
  });

  it("rejects an unknown basis", () => {
    const db = hourlyShapeDb();
    migrate(db);
    expect(() => db.prepare(`INSERT INTO payroll_entries
      (person, work_date, basis, qty, rate_cents, amount_cents)
      VALUES ('Sam','2026-09-09','widget',1,15,15)`).run()).toThrow();
  });

  it("creates payroll_rates keyed on person and basis", () => {
    const db = hourlyShapeDb();
    migrate(db);
    db.prepare("INSERT INTO payroll_rates (person, basis, rate_cents) VALUES ('Sam','piece',15)").run();
    expect(() => db.prepare("INSERT INTO payroll_rates (person, basis, rate_cents) VALUES ('Sam','piece',20)").run())
      .toThrow();
  });
});
