import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, mergeItems, qtyRemaining, identifiersForItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { setAlias, recordSupplierIdentifier, resolveItemId } from "@/lib/db/aliases";
import { addAdjustment } from "@/lib/db/adjustments";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("mergeItems", () => {
  it("moves purchases, identifiers, and adjustments onto the survivor and deletes the loser", () => {
    const survivor = insertItem(db, { name: "Real Booster", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup Booster", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    // survivor: 5 units purchased; loser: 8 units + a supplier code + a whatnot alias + a -2 adjustment
    addPurchase(db, { itemId: survivor, purchasedOn: "2026-07-01", quantity: 5, unitCostCents: 400 });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-02", quantity: 8, unitCostCents: 400 });
    recordSupplierIdentifier(db, "ACME-DUP", loser);
    setAlias(db, "Booster Dupe Name", loser);
    addAdjustment(db, { itemId: loser, reason: "damage_loss", qty: -2, adjustedOn: "2026-07-03", note: null });

    const r = mergeItems(db, { loserId: loser, survivorId: survivor });
    expect(r).toEqual({ ok: true });

    // loser gone
    expect(db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(loser)).toBeUndefined();
    // survivor now has 5 + 8 = 13 purchased, minus 2 adjustment = 11 remaining
    expect(qtyRemaining(db, survivor)).toBe(11);
    // loser's supplier + whatnot identifiers now resolve to the survivor
    expect(resolveItemId(db, "ACME-DUP")).toBe(survivor);
    expect(resolveItemId(db, "Booster Dupe Name")).toBe(survivor);
    // survivor identifier list includes its own mine + the moved supplier + whatnot (loser's mine gone)
    const sources = identifiersForItem(db, survivor).map((i) => i.source).sort();
    expect(sources).toEqual(["mine", "supplier", "whatnot"]);
    // loser's mine sku no longer resolves (row cascade-deleted with the loser)
    expect(resolveItemId(db, "ITEM-00002")).toBeNull();
  });

  it("rejects merging an item into itself", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(mergeItems(db, { loserId: a, survivorId: a })).toEqual({ ok: false, reason: "same_item" });
  });

  it("rejects when the survivor or loser does not exist", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(mergeItems(db, { loserId: a, survivorId: 9999 })).toEqual({ ok: false, reason: "survivor_not_found" });
    expect(mergeItems(db, { loserId: 9999, survivorId: a })).toEqual({ ok: false, reason: "loser_not_found" });
  });

  it("rejects merging into an archived survivor", () => {
    const survivor = insertItem(db, { name: "Archived", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Live", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-07-01' WHERE id = ?").run(survivor);
    expect(mergeItems(db, { loserId: loser, survivorId: survivor })).toEqual({ ok: false, reason: "survivor_archived" });
    // loser untouched (not deleted)
    expect(db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(loser)).toBeDefined();
  });

  it("re-points wholesale invoice lines so survivor stock reflects them", () => {
    const survivor = insertItem(db, { name: "Real", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: loser, purchasedOn: "2026-07-01", quantity: 10, unitCostCents: 100 });
    // a posted SALE invoice line against the loser (wholesale sold 3)
    const inv = db.prepare("INSERT INTO invoices (direction, status, invoice_date) VALUES ('sale','posted','2026-07-02')").run().lastInsertRowid;
    db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents) VALUES (?,?,?,?,?)")
      .run(inv, loser, "Dup", 3, 100);

    mergeItems(db, { loserId: loser, survivorId: survivor });
    // survivor: 10 purchased − 3 wholesale sold = 7 remaining
    expect(qtyRemaining(db, survivor)).toBe(7);
  });

  it("re-points RESTRICT-FK tables (ledger, show lines, bundle) and moves inventory_moves so the loser can be deleted", () => {
    const survivor = insertItem(db, { name: "Real", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const loser = insertItem(db, { name: "Dup", unitCostCents: 100, qtyPurchased: 0, lotId: null });

    // a show + a show_line_item for the loser
    const show = db.prepare("INSERT INTO shows (show_date, payout_cents) VALUES ('2026-07-01', 0)").run().lastInsertRowid;
    db.prepare("INSERT INTO show_line_items (show_id, product_name, quantity, revenue_cents, status, item_id) VALUES (?,?,?,?,?,?)")
      .run(show, "Dup", 1, 500, "confirmed", loser);
    // a ledger sale row cached to the loser
    db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, item_id, dedup_key) VALUES ('2026-07-01','2026-07-01',500,'sale','Dup',?, 'k-merge-1')").run(loser);
    // an inventory_move for the loser
    db.prepare("INSERT INTO inventory_moves (item_id, moved_on, qty, direction) VALUES (?, '2026-07-01', 3, 'to_whatnot')").run(loser);
    // a bundle_component referencing the loser (needs a ledger_txn parent)
    const bt = db.prepare("INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key) VALUES ('2026-07-01','2026-07-01',0,'sale','Bundle','k-merge-2')").run().lastInsertRowid;
    db.prepare("INSERT INTO bundle_components (ledger_txn_id, item_id, qty) VALUES (?, ?, 1)").run(bt, loser);

    const r = mergeItems(db, { loserId: loser, survivorId: survivor });
    expect(r).toEqual({ ok: true });                               // DELETE did not throw a FK violation
    expect(db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(loser)).toBeUndefined();
    // every row now belongs to the survivor
    for (const [t] of [["show_line_items"],["ledger_transactions"],["inventory_moves"],["bundle_components"]] as const) {
      const onLoser = db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE item_id = ?`).get(loser) as { n: number };
      expect(onLoser.n).toBe(0);
    }
    const survivorShowLines = db.prepare("SELECT COUNT(*) n FROM show_line_items WHERE item_id = ?").get(survivor) as { n: number };
    expect(survivorShowLines.n).toBe(1);
  });
});
