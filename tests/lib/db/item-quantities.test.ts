import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtySold, qtyRemaining, whatnotQty, warehouseQty, listItems } from "@/lib/db/inventory";
import { itemQuantities } from "@/lib/db/item-quantities";
import { setAlias } from "@/lib/db/aliases";
import { addAdjustment } from "@/lib/db/adjustments";
import { addMove } from "@/lib/db/moves";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 12, 2026, 10:15:00 AM","$1.00","L4","O4","Earnings for selling a Mango Slime #2","processing","SALES",""`;

let db: DB;
let cheese: number, mango: number, untouched: number;

beforeEach(() => {
  db = createDb(":memory:");
  cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 100, lotId: null });
  mango = insertItem(db, { name: "Mango", unitCostCents: 100, qtyPurchased: 50, lotId: null });
  // Deliberately left with no sales, moves or adjustments at all.
  untouched = insertItem(db, { name: "Untouched", unitCostCents: 50, qtyPurchased: 7, lotId: null });
  setAlias(db, "Cheese Squishy", cheese);
  setAlias(db, "Mango Slime", mango);
  saveLedger(db, parseLedger(CSV));
  addMove(db, { itemId: cheese, movedOn: "2026-06-01", qty: 30, direction: "to_whatnot", note: null });
  addMove(db, { itemId: cheese, movedOn: "2026-06-05", qty: 10, direction: "to_warehouse", note: null });
  addMove(db, { itemId: mango, movedOn: "2026-06-02", qty: 20, direction: "to_whatnot", note: null });
  addAdjustment(db, { itemId: cheese, adjustedOn: null, qty: -3, reason: "damage_loss", note: null, channel: "whatnot" });
  addAdjustment(db, { itemId: cheese, adjustedOn: null, qty: 5, reason: "recount", note: null, channel: null });
  addAdjustment(db, { itemId: mango, adjustedOn: null, qty: -2, reason: "damage_loss", note: null, channel: null });
});

describe("itemQuantities", () => {
  // The whole point of batching: it must agree with the per-item functions it
  // replaces, for every item, including ones with no activity.
  it("matches the per-item functions exactly", () => {
    const batched = itemQuantities(db);
    for (const item of listItems(db)) {
      const q = batched.get(item.id);
      expect(q, `item ${item.name} missing from batch`).toBeDefined();
      expect(q!.sold, `sold for ${item.name}`).toBe(qtySold(db, item.id));
      expect(q!.remaining, `remaining for ${item.name}`).toBe(qtyRemaining(db, item.id));
      expect(q!.whatnot, `whatnot for ${item.name}`).toBe(whatnotQty(db, item.id));
      expect(q!.warehouse, `warehouse for ${item.name}`).toBe(warehouseQty(db, item.id));
    }
  });

  it("returns a row for an item with no sales, moves or adjustments", () => {
    const q = itemQuantities(db).get(untouched)!;
    expect(q).toEqual({ sold: 0, remaining: 7, whatnot: 0, warehouse: 7 });
  });

  it("covers every item in the table", () => {
    expect(itemQuantities(db).size).toBe(listItems(db).length);
  });

  // warehouse + whatnot === remaining is the invariant the buckets promise.
  it("keeps the two buckets partitioning what is on hand", () => {
    for (const [, q] of itemQuantities(db)) {
      expect(q.warehouse + q.whatnot).toBe(q.remaining);
    }
  });

  it("counts ledger sales through the live alias map", () => {
    const q = itemQuantities(db).get(cheese)!;
    expect(q.sold).toBe(2); // two Cheese Squishy sale rows
  });

  it("is empty for a database with no items", () => {
    expect(itemQuantities(createDb(":memory:")).size).toBe(0);
  });
});
