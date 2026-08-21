// tests/lib/db/migrate-adjustments.test.ts
import { describe, it, expect } from "vitest";
import { createDb, migrateAdjustments, type DB } from "@/lib/db/connection";
import { sumAdjustments } from "@/lib/db/adjustments";
import { qtyRemaining } from "@/lib/db/inventory";

describe("adjustments schema + migration", () => {
  it("fresh db has inventory_adjustments and the new invoice columns", () => {
    const db: DB = createDb(":memory:");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(tables).toContain("inventory_adjustments");
    const inv = (db.prepare("PRAGMA table_info(invoices)").all() as any[]).map((c) => c.name);
    expect(inv).toEqual(expect.arrayContaining(["direction", "customer", "paid", "paid_on"]));
    const lines = (db.prepare("PRAGMA table_info(invoice_lines)").all() as any[]).map((c) => c.name);
    expect(lines).toContain("unit_price_cents");
  });

  it("mirrors legacy qty_samples / qty_adjustment into adjustment rows once, then zeroes them", () => {
    const db: DB = createDb(":memory:");
    // Simulate a pre-migration DB by writing the legacy columns directly
    db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased, qty_samples, qty_adjustment) VALUES (?,?,?,?,?)").run("A", 0, 100, 3, -2);
    const a = (db.prepare("SELECT id FROM inventory_items WHERE name='A'").get() as any).id;

    migrateAdjustments(db);

    // sumAdjustments sees the migrated rows: -3 (sample) + (-2) (recount) = -5
    expect(sumAdjustments(db, a)).toBe(-5);
    // qtyRemaining uses the adjustments log: 100 - 0 sold + (-5) = 95
    expect(qtyRemaining(db, a)).toBe(95);

    // Legacy columns should be zeroed
    const item = db.prepare("SELECT qty_samples, qty_adjustment FROM inventory_items WHERE id=?").get(a) as any;
    expect(item.qty_samples).toBe(0);
    expect(item.qty_adjustment).toBe(0);

    // Idempotent: second call inserts nothing new
    migrateAdjustments(db);
    expect(sumAdjustments(db, a)).toBe(-5);
  });
});
