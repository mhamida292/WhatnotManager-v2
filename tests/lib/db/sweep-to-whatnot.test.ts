import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import {
  insertItem, itemsWithWarehouseStock, qtyRemaining,
  sweepWarehouseToWhatnot, warehouseQty, whatnotQty,
} from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";
import { getSettings } from "@/lib/db/settings";

// The real property at risk during a sweep: closing the Warehouse bucket must
// shift units between buckets, not change how many units exist in total.
// (warehouseQty is *defined* as qtyRemaining - whatnotQty, so asserting that
// identity can never fail — it holds by construction regardless of what the
// sweep does. Capturing qtyRemaining before and comparing after is the check
// that can actually catch a bug.)
function captureRemaining(db: any, id: number): number {
  return qtyRemaining(db, id);
}
function expectRemainingUnchanged(db: any, id: number, before: number) {
  expect(qtyRemaining(db, id)).toBe(before);
}

describe("sweepWarehouseToWhatnot", () => {
  it("moves every item's warehouse stock to whatnot and turns the mode on", () => {
    const db = createDb(":memory:");
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 4, lotId: null });
    const remA = captureRemaining(db, a);
    const remB = captureRemaining(db, b);

    const res = sweepWarehouseToWhatnot(db);

    expect(res).toEqual({ items: 2, units: 14, corrections: 0 });
    expect(warehouseQty(db, a)).toBe(0);
    expect(warehouseQty(db, b)).toBe(0);
    expect(whatnotQty(db, a)).toBe(10);
    expect(whatnotQty(db, b)).toBe(4);
    expect(getSettings(db).whatnotOnly).toBe(true);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
    expectRemainingUnchanged(db, a, remA);
    expectRemainingUnchanged(db, b, remB);
  });

  it("corrects a negative warehouse bucket and counts it", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Oversold", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addMove(db, { itemId: id, qty: 2, direction: "to_whatnot" }); // warehouse -> -2
    const rem = captureRemaining(db, id);

    const res = sweepWarehouseToWhatnot(db);

    expect(res.corrections).toBe(1);
    expect(warehouseQty(db, id)).toBe(0);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
    expectRemainingUnchanged(db, id, rem);
  });

  it("sweeps archived items too", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Old", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-01-01' WHERE id = ?").run(id);

    sweepWarehouseToWhatnot(db);

    expect(warehouseQty(db, id)).toBe(0);
    expect(itemsWithWarehouseStock(db)).toEqual([]);
  });

  it("succeeds with nothing to move and just enables the mode", () => {
    const db = createDb(":memory:");
    const res = sweepWarehouseToWhatnot(db);
    expect(res).toEqual({ items: 0, units: 0, corrections: 0 });
    expect(getSettings(db).whatnotOnly).toBe(true);
  });

  it("writes exactly one move row per swept item", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 4, lotId: null });
    insertItem(db, { name: "Empty", unitCostCents: 100, qtyPurchased: 0, lotId: null });

    sweepWarehouseToWhatnot(db);

    expect((db.prepare("SELECT COUNT(*) AS c FROM inventory_moves").get() as any).c).toBe(2);
  });

  // Step 5: the post-sweep verification-and-throw branch (itemsWithWarehouseStock
  // still non-empty right after the sweep loop) is a self-check against a
  // stock-mutating path we haven't accounted for. It is not reachable through
  // normal data: closeWarehouseBucket always drives an item's Warehouse bucket
  // to exactly 0, so the recheck is empty right after the loop in every real
  // scenario we could construct, and provoking it without a test-only hook in
  // inventory.ts would mean contorting production code. Per the brief we do not
  // weaken or delete that check; instead we provoke a throw a different way —
  // by making the final `updateSettings` write fail after moves have already
  // been written inside the same transaction — and assert the real property
  // the design point cares about: on ANY throw inside the sweep transaction,
  // nothing partial persists. No inventory_moves rows survive and whatnotOnly
  // stays false.
  it("rolls back every move and leaves the mode off when the transaction throws", () => {
    const realDb = createDb(":memory:");
    insertItem(realDb, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    insertItem(realDb, { name: "B", unitCostCents: 100, qtyPurchased: 4, lotId: null });

    // Proxy that behaves exactly like the real db except the settings-update
    // statement throws. Everything sweepWarehouseToWhatnot does (closing
    // buckets, writing moves, rechecking) goes through the real connection
    // untouched; only the final flip fails, mid-transaction.
    // Count INSERTs into inventory_moves as they're prepared, so we can prove
    // writes were actually attempted before the sabotaged UPDATE throws — a
    // bare "0 rows survive" assertion would also pass if the loop never wrote
    // anything at all.
    let insertMovePrepareCount = 0;
    const sabotagedDb = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("INSERT INTO inventory_moves")) {
              insertMovePrepareCount += 1;
            }
            if (sql.includes("UPDATE app_settings")) {
              throw new Error("forced failure: settings write blocked for test");
            }
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    expect(() => sweepWarehouseToWhatnot(sabotagedDb as any)).toThrow(/forced failure/);

    expect(insertMovePrepareCount).toBe(2);
    expect((realDb.prepare("SELECT COUNT(*) AS c FROM inventory_moves").get() as any).c).toBe(0);
    expect(getSettings(realDb).whatnotOnly).toBe(false);
  });
});
