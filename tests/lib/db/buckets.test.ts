import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { createItemWithFirstPurchase, qtyRemaining, whatnotQty, warehouseQty } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";
import { addAdjustment } from "@/lib/db/adjustments";

let db: DB; let id: number;
beforeEach(() => {
  db = createDb(":memory:");
  id = createItemWithFirstPurchase(db, { name: "Booster", lotId: null, purchasedOn: null, quantity: 100, unitCostCents: 100 });
});

describe("stock buckets", () => {
  it("fresh item: all in warehouse, none in whatnot", () => {
    expect(warehouseQty(db, id)).toBe(100);
    expect(whatnotQty(db, id)).toBe(0);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("move to whatnot shifts the split, total unchanged", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    expect(warehouseQty(db, id)).toBe(70);
    expect(whatnotQty(db, id)).toBe(30);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("whatnot ledger sale deducts the whatnot bucket", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    // simulate a whatnot sale via alias-mapped ledger row:
    db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'whatnot', ?)").run(id, "Booster Pack");
    db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key) VALUES ('x','2026-07-15',500,'sale','Booster Pack','k1')").run();
    expect(whatnotQty(db, id)).toBe(29);   // 30 moved − 1 sold
    expect(warehouseQty(db, id)).toBe(70); // unchanged
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("oversell: whatnot goes negative", () => {
    addMove(db, { itemId: id, qty: 1, direction: "to_whatnot" });
    db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'whatnot', ?)").run(id, "Booster Pack");
    for (const k of ["k1","k2","k3"]) db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key) VALUES ('x','2026-07-15',500,'sale','Booster Pack',?)").run(k);
    expect(whatnotQty(db, id)).toBe(-2); // 1 moved − 3 sold
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
  it("whatnot adjustment reduces the whatnot bucket", () => {
    addMove(db, { itemId: id, qty: 30, direction: "to_whatnot" });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -4, note: null, channel: "whatnot" });
    expect(whatnotQty(db, id)).toBe(26);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });
});
