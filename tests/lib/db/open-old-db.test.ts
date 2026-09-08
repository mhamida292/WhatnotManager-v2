import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createDb } from "@/lib/db/connection";
import { SCHEMA } from "@/lib/db/schema";

/** Opening a database file that predates a schema change goes through
 *  createDb -> db.exec(SCHEMA) -> migrate(db). Every other test builds a fresh
 *  in-memory db, so SCHEMA only ever ran against tables it had just created;
 *  this exercises the real production path against an OLD file on disk. */
describe("opening an old database file", () => {
  it("does not throw when payroll_entries still has the pay-period shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "wm-old-"));
    const path = join(dir, "ws.db");
    try {
      const old = new Database(path);
      old.exec(SCHEMA);
      old.exec(`DROP TABLE payroll_entries;
        DROP INDEX IF EXISTS idx_payroll_work_date;
        CREATE TABLE payroll_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
          period_start TEXT, period_end TEXT, hours REAL, rate_cents INTEGER,
          amount_cents INTEGER NOT NULL, note TEXT)`);
      old.prepare("INSERT INTO payroll_entries (person, period_start, amount_cents) VALUES ('Maria','2026-07-18',8000)").run();
      old.close();

      const db = createDb(path);
      const cols = (db.prepare("PRAGMA table_info(payroll_entries)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain("work_date");
      // The wage is preserved, not dropped.
      expect((db.prepare("SELECT COUNT(*) n FROM payroll_entries_legacy").get() as { n: number }).n).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
