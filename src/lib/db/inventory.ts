import type { DB } from "./connection";
import { baseProductName } from "@/lib/csv/classify";
import { addPurchase, recomputeItemTotals } from "./purchases";
import { sumAdjustments, addAdjustment, sumWhatnotAdjustments, type AdjustReason } from "./adjustments";
import { movedToWhatnot, movedToWarehouse, addMove } from "./moves";
import { getSettings, updateSettings } from "./settings";

export interface ItemRow { id: number; name: string; sku: string | null; unitCostCents: number; qtyPurchased: number; lotId: number | null; archivedAt: string | null; location: string | null; }

export function insertLot(db: DB, l: { name: string; totalCostCents: number; purchasedOn?: string | null }): number {
  const info = db.prepare("INSERT INTO lots (name, total_cost_cents, purchased_on) VALUES (?,?,?)")
    .run(l.name, l.totalCostCents, l.purchasedOn ?? null);
  return Number(info.lastInsertRowid);
}

export function insertItem(db: DB, i: { name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null }): number {
  const tx = db.transaction(() => {
    const info = db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased, lot_id) VALUES (?,?,?,?)")
      .run(i.name, i.unitCostCents, i.qtyPurchased, i.lotId);
    const id = Number(info.lastInsertRowid);
    const sku = `ITEM-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(sku, id);
    db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'mine', ?)").run(id, sku);
    return id;
  });
  return tx();
}

/** Create a new product together with its first purchase batch, atomically.
 *  qty_purchased / unit_cost_cents are then derived from that batch. */
export function createItemWithFirstPurchase(db: DB, p: { name: string; lotId: number | null; purchasedOn: string | null; quantity: number; unitCostCents: number }): number {
  const tx = db.transaction((p: { name: string; lotId: number | null; purchasedOn: string | null; quantity: number; unitCostCents: number }) => {
    const id = insertItem(db, { name: p.name, unitCostCents: p.unitCostCents, qtyPurchased: 0, lotId: p.lotId });
    addPurchase(db, { itemId: id, purchasedOn: p.purchasedOn, quantity: p.quantity, unitCostCents: p.unitCostCents });
    return id;
  });
  return tx(p);
}

export function listItems(db: DB): ItemRow[] {
  return db.prepare("SELECT id, name, sku, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, lot_id as lotId, archived_at as archivedAt, location FROM inventory_items ORDER BY name").all() as ItemRow[];
}


/** Delete an item: removes all of its identifiers (mine/supplier/whatnot; freed
 *  Whatnot names become unmapped — recoverable by re-adding + re-mapping),
 *  detaches legacy show rows plus any cached ledger item_id
 *  (item_id -> NULL, rows kept), then deletes the item. Atomic. */
export function deleteItem(db: DB, id: number): void {
  const tx = db.transaction((itemId: number) => {
    db.prepare("DELETE FROM item_identifiers WHERE item_id = ?").run(itemId);
    db.prepare("UPDATE show_line_items SET item_id = NULL WHERE item_id = ?").run(itemId);
    // ledger_transactions caches a resolved item_id (a FK) at import time; clear it
    // so deleting the item doesn't violate the constraint. The live sold count goes
    // through the alias join, so nulling this cached column changes no totals.
    db.prepare("UPDATE ledger_transactions SET item_id = NULL WHERE item_id = ?").run(itemId);
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(itemId);
  });
  tx(id);
}

export interface DeleteImpact { mappings: number; ledgerSales: number; showLineSales: number; }

/** Counts of what a delete will detach, for the confirmation warning. */
export function deleteImpact(db: DB, itemId: number): DeleteImpact {
  const one = (sql: string) => Number((db.prepare(sql).get(itemId) as any).n);
  return {
    mappings: one("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = ? AND source = 'whatnot'"),
    ledgerSales: Number((db.prepare(`SELECT COUNT(*) n FROM ledger_transactions lt
        JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
        WHERE lt.kind = 'sale' AND pa.item_id = ?`).get(itemId) as any).n),
    showLineSales: one("SELECT COUNT(*) n FROM show_line_items WHERE item_id = ?"),
  };
}

export function qtySoldByItem(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COALESCE(SUM(quantity),0) as q FROM show_line_items
    WHERE item_id = ? AND status = 'confirmed'`).get(itemId) as any;
  return Number(r.q);
}

/** Units sold via the imported ledger. Resolved LIVE through the item_identifiers
 *  ('whatnot' source) map (ledger product names and identifier codes are both stored
 *  as base names), so mapping a product after import immediately counts its sales.
 *  Each sale row = qty 1. */
export function qtySoldFromLedger(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COUNT(*) as q FROM ledger_transactions lt
    JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
    WHERE lt.kind = 'sale' AND pa.item_id = ?`).get(itemId) as any;
  return Number(r.q);
}

/** Units sold wholesale: Σ qty of lines on POSTED sale invoices. Stock leaves at
 *  post regardless of paid status (revenue recognition is separate — see report). */
export function qtySoldWholesale(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COALESCE(SUM(il.quantity),0) AS q FROM invoice_lines il
    JOIN invoices i ON i.id = il.invoice_id
    WHERE il.item_id = ? AND i.direction = 'sale' AND i.status = 'posted'`).get(itemId) as { q: number };
  return Number(r.q);
}

/** Total units sold: ledger sales + confirmed legacy show sales + wholesale invoices. */
export function qtySold(db: DB, itemId: number): number {
  return qtySoldFromLedger(db, itemId) + qtySoldByItem(db, itemId) + qtySoldWholesale(db, itemId);
}

export interface ItemAlias { id: number; productName: string; saleCount: number; }

/** Whatnot product names mapped to this item, each with its count of ledger sales.
 *  Ordered by name. Sales resolve via the live alias map, mirroring qtySoldFromLedger. */
export function aliasesForItem(db: DB, itemId: number): ItemAlias[] {
  return db.prepare(`SELECT pa.id, pa.code AS productName,
      COUNT(lt.id) AS saleCount
    FROM item_identifiers pa
    LEFT JOIN ledger_transactions lt
      ON lt.product_name = pa.code AND lt.kind = 'sale'
    WHERE pa.item_id = ? AND pa.source = 'whatnot'
    GROUP BY pa.id, pa.code
    ORDER BY pa.code`).all(itemId) as ItemAlias[];
}

export interface ItemSale { showDate: string; productName: string; amountCents: number; }

/** Individual ledger sale rows counting toward this item (via the alias map),
 *  oldest show first. Each row is one unit (one sale = one unit). */
export function ledgerSalesForItem(db: DB, itemId: number): ItemSale[] {
  return db.prepare(`SELECT lt.show_date AS showDate, lt.product_name AS productName,
      lt.amount_cents AS amountCents
    FROM ledger_transactions lt
    JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
    WHERE lt.kind = 'sale' AND pa.item_id = ?
    ORDER BY lt.show_date, lt.id`).all(itemId) as ItemSale[];
}

export function qtyRemaining(db: DB, itemId: number): number {
  const item = db.prepare("SELECT qty_purchased as q FROM inventory_items WHERE id = ?").get(itemId) as { q: number } | undefined;
  if (!item) return 0;
  return Number(item.q) - qtySold(db, itemId) + sumAdjustments(db, itemId);
}

/** Units currently allocated to Whatnot: moved-in − moved-out − whatnot sales + whatnot adjustments.
 *  May go negative (oversold). Whatnot sales = alias-mapped ledger sales + legacy confirmed show sales. */
export function whatnotQty(db: DB, itemId: number): number {
  const movedIn = movedToWhatnot(db, itemId);
  const movedOut = movedToWarehouse(db, itemId);
  const whatnotSales = qtySoldFromLedger(db, itemId) + qtySoldByItem(db, itemId);
  return movedIn - movedOut - whatnotSales + sumWhatnotAdjustments(db, itemId);
}

/** Units in the Warehouse bucket. Derived as remaining − whatnot so the two buckets
 *  always partition the on-hand exactly (warehouse + whatnot === qtyRemaining). */
export function warehouseQty(db: DB, itemId: number): number {
  return qtyRemaining(db, itemId) - whatnotQty(db, itemId);
}

/** Every item whose Warehouse bucket is non-zero, archived included. A negative
 *  bucket counts: it is as broken a starting point for Whatnot-only mode as a
 *  positive one. Used to gate turning Whatnot-only mode on. */
export function itemsWithWarehouseStock(db: DB): { id: number; name: string; qty: number }[] {
  const rows = db.prepare("SELECT id, name FROM inventory_items ORDER BY name").all() as { id: number; name: string }[];
  return rows
    .map((r) => ({ id: r.id, name: r.name, qty: warehouseQty(db, r.id) }))
    .filter((r) => r.qty !== 0);
}

/** Write the move that drives this item's Warehouse bucket to 0, whichever
 *  direction that requires. Unconditional — callers decide when it applies.
 *  Returns the signed bucket value that was closed: positive means units moved
 *  to Whatnot, negative means a negative balance was corrected, 0 means no move
 *  was needed and none was written. */
export function closeWarehouseBucket(db: DB, itemId: number, note: string): number {
  const w = warehouseQty(db, itemId);
  if (w > 0) addMove(db, { itemId, qty: w, direction: "to_whatnot", note });
  else if (w < 0) addMove(db, { itemId, qty: -w, direction: "to_warehouse", note });
  return w;
}

/** Move every item's Warehouse stock into Whatnot and turn Whatnot-only mode on,
 *  atomically. Verifies the gate is actually satisfied before flipping the
 *  setting, so a stock-mutating path we haven't accounted for surfaces as a
 *  rolled-back error rather than a "success" that leaves the mode unreachable. */
export function sweepWarehouseToWhatnot(db: DB): { items: number; units: number; corrections: number } {
  const tx = db.transaction(() => {
    let items = 0, units = 0, corrections = 0;
    for (const { id } of itemsWithWarehouseStock(db)) {
      const closed = closeWarehouseBucket(db, id, "sweep to Whatnot");
      if (closed === 0) continue;
      items += 1;
      if (closed > 0) units += closed;
      else corrections += 1;
    }
    const left = itemsWithWarehouseStock(db);
    if (left.length > 0) {
      throw new Error(`Sweep left ${left.length} item(s) with Warehouse stock; nothing was changed`);
    }
    updateSettings(db, { ...getSettings(db), whatnotOnly: true });
    return { items, units, corrections };
  });
  return tx();
}

/** While Whatnot-only mode is on, force this item's Warehouse bucket back to 0
 *  by writing whatever move closes the gap. Idempotent: a second call is a no-op
 *  because the bucket is already 0. Call after any flow that removes or changes
 *  stock (batch delete/edit, invoice unpost/delete), so undoing work cannot leave
 *  the buckets drifted. A no-op when the mode is off. */
export function reconcileWhatnotOnly(db: DB, itemId: number): void {
  if (!getSettings(db).whatnotOnly) return;
  closeWarehouseBucket(db, itemId, "auto (Whatnot-only)");
}

/** Set remaining to `target` by appending an adjustment for the difference.
 *  Always records the count (even if delta is 0). Never touches cost/COGS/spend. */
export function setItemRemaining(db: DB, id: number, target: number, opts?: { reason?: AdjustReason; note?: string | null; on?: string }): void {
  const on = opts?.on ?? new Date().toISOString().slice(0, 10);
  const delta = target - qtyRemaining(db, id);
  addAdjustment(db, { itemId: id, adjustedOn: on, reason: opts?.reason ?? "recount", qty: delta, note: opts?.note ?? null, counted: target });
}

/** Apply a batch count, writing one adjustment per row, all dated `on`.
 *  Calculates delta for each item from its current qtyRemaining.
 *  Always records (even zero-delta). Caller is responsible for omitting skipped items. */
export function applyCount(db: DB, on: string, rows: { itemId: number; counted: number; reason?: AdjustReason }[]): void {
  const tx = db.transaction(() => {
    for (const r of rows) {
      const delta = r.counted - qtyRemaining(db, r.itemId);
      addAdjustment(db, { itemId: r.itemId, adjustedOn: on, reason: r.reason ?? "recount", qty: delta, note: null, counted: r.counted });
    }
  });
  tx();
}

export type RenameResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "not_found" };

/** Rename an inventory item. Aliases key off item_id, so this never affects
 *  mappings, sale counts, or COGS. Rejects empty names and names already used
 *  by a *different* item (the UNIQUE constraint), surfacing a reason instead of
 *  letting SQLite throw. Renaming an item to its own current name is a no-op. */
export function renameItem(db: DB, id: number, name: string): RenameResult {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  const item = db.prepare("SELECT name FROM inventory_items WHERE id = ?").get(id) as { name: string } | undefined;
  if (!item) return { ok: false, reason: "not_found" };
  if (item.name === trimmed) return { ok: true };
  const clash = db.prepare("SELECT 1 FROM inventory_items WHERE name = ? AND id <> ?").get(trimmed, id);
  if (clash) return { ok: false, reason: "duplicate" };
  db.prepare("UPDATE inventory_items SET name = ? WHERE id = ?").run(trimmed, id);
  return { ok: true };
}

export function archiveItem(db: DB, id: number): void {
  db.prepare("UPDATE inventory_items SET archived_at = ? WHERE id = ?").run(new Date().toISOString().slice(0, 10), id);
}

export function unarchiveItem(db: DB, id: number): void {
  db.prepare("UPDATE inventory_items SET archived_at = NULL WHERE id = ?").run(id);
}

export function archiveItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) archiveItem(db, id); });
  tx(ids);
}

export function unarchiveItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) unarchiveItem(db, id); });
  tx(ids);
}

export function deleteItems(db: DB, ids: number[]): void {
  const tx = db.transaction((list: number[]) => { for (const id of list) deleteItem(db, id); });
  tx(ids);
}

export interface BulkDeleteImpact { items: number; mappings: number; ledgerSales: number; showLineSales: number; }

export function bulkDeleteImpact(db: DB, ids: number[]): BulkDeleteImpact {
  const agg: BulkDeleteImpact = { items: ids.length, mappings: 0, ledgerSales: 0, showLineSales: 0 };
  for (const id of ids) {
    const i = deleteImpact(db, id);
    agg.mappings += i.mappings;
    agg.ledgerSales += i.ledgerSales;
    agg.showLineSales += i.showLineSales;
  }
  return agg;
}

/** Set (or clear, with null) an item's physical warehouse location. */
export function setItemLocation(db: DB, id: number, location: string | null): void {
  db.prepare("UPDATE inventory_items SET location = ? WHERE id = ?").run(location?.trim() || null, id);
}

export interface ItemIdentifier {
  id: number; source: "mine" | "supplier" | "whatnot";
  code: string; supplierLabel: string | null; saleCount: number;
}

export function identifiersForItem(db: DB, itemId: number): ItemIdentifier[] {
  return db.prepare(`
    SELECT ii.id, ii.source, ii.code, ii.supplier_label AS supplierLabel,
      (SELECT COUNT(*) FROM ledger_transactions lt
        WHERE lt.product_name = ii.code AND lt.kind = 'sale' AND ii.source = 'whatnot') AS saleCount
    FROM item_identifiers ii
    WHERE ii.item_id = ?
    ORDER BY CASE ii.source WHEN 'mine' THEN 0 WHEN 'supplier' THEN 1 ELSE 2 END, ii.code
  `).all(itemId) as ItemIdentifier[];
}

export type SetSkuResult = { ok: true } | { ok: false; reason: "empty" | "not_found" | "duplicate" };

/** Change an item's SKU. Updates inventory_items.sku AND the item's 'mine'
 *  identifier code together (atomic). Collision-guarded against both the sku
 *  UNIQUE column and the item_identifiers UNIQUE(code). */
export function setSku(db: DB, itemId: number, sku: string): SetSkuResult {
  const base = baseProductName(sku);
  if (base === "") return { ok: false, reason: "empty" };
  const item = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(itemId) as { sku: string | null } | undefined;
  if (!item) return { ok: false, reason: "not_found" };
  if (item.sku === base) return { ok: true };
  // collide against another item's sku column OR any other identifier owning this code
  const skuClash = db.prepare("SELECT 1 FROM inventory_items WHERE sku = ? AND id <> ?").get(base, itemId);
  const codeClash = db.prepare("SELECT 1 FROM item_identifiers WHERE code = ?").get(base);
  if (skuClash || codeClash) return { ok: false, reason: "duplicate" };
  const tx = db.transaction(() => {
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(base, itemId);
    // keep the mine identifier's code in lockstep (upsert if somehow missing)
    const mine = db.prepare("SELECT id FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(itemId) as { id: number } | undefined;
    if (mine) db.prepare("UPDATE item_identifiers SET code = ? WHERE id = ?").run(base, mine.id);
    else db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'mine', ?)").run(itemId, base);
  });
  tx();
  return { ok: true };
}

export type MergeResult = { ok: true } | { ok: false; reason: "same_item" | "loser_not_found" | "survivor_not_found" | "survivor_archived" };

const MERGE_ITEM_TABLES = [
  "invoice_lines", "inventory_adjustments", "inventory_moves", "item_purchases",
  "show_line_items", "ledger_transactions", "bundle_components",
] as const;

/** Merge loser into survivor: re-point all history + non-mine identifiers to
 *  survivor, recompute survivor totals, delete loser. Atomic. */
export function mergeItems(db: DB, p: { loserId: number; survivorId: number }): MergeResult {
  if (p.loserId === p.survivorId) return { ok: false, reason: "same_item" };
  const survivor = db.prepare("SELECT archived_at AS archivedAt FROM inventory_items WHERE id = ?").get(p.survivorId) as { archivedAt: string | null } | undefined;
  if (!survivor) return { ok: false, reason: "survivor_not_found" };
  if (survivor.archivedAt != null) return { ok: false, reason: "survivor_archived" };
  const loser = db.prepare("SELECT 1 FROM inventory_items WHERE id = ?").get(p.loserId);
  if (!loser) return { ok: false, reason: "loser_not_found" };

  const tx = db.transaction(() => {
    for (const t of MERGE_ITEM_TABLES) {
      db.prepare(`UPDATE ${t} SET item_id = ? WHERE item_id = ?`).run(p.survivorId, p.loserId);
    }
    // Move the loser's non-identity identifiers; global UNIQUE(code) guarantees no collision.
    db.prepare("UPDATE item_identifiers SET item_id = ? WHERE item_id = ? AND source != 'mine'").run(p.survivorId, p.loserId);
    // Recompute survivor totals from the now-merged purchase batches.
    recomputeItemTotals(db, p.survivorId);
    // Delete the loser; its remaining 'mine' identifier goes via ON DELETE CASCADE.
    db.prepare("DELETE FROM inventory_items WHERE id = ?").run(p.loserId);
  });
  tx();
  return { ok: true };
}
