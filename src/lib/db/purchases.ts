import type { DB } from "./connection";
import { settleWhatnotOnly } from "./moves";

export interface Purchase {
  id: number;
  itemId: number;
  purchasedOn: string | null;
  quantity: number;
  unitCostCents: number;
  invoiceId: number | null;
}

/** Recompute an item's derived totals from its purchase batches:
 *  qty_purchased = sum of quantities, unit_cost_cents = weighted average
 *  (rounded; 0 when there are no units). Keeps the report/Remaining math working. */
export function recomputeItemTotals(db: DB, itemId: number): void {
  const r = db
    .prepare(
      "SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(quantity*unit_cost_cents),0) AS spend FROM item_purchases WHERE item_id = ?"
    )
    .get(itemId) as { qty: number; spend: number };
  const qty = Number(r.qty);
  const unit = qty > 0 ? Math.round(Number(r.spend) / qty) : 0;
  db.prepare("UPDATE inventory_items SET qty_purchased = ?, unit_cost_cents = ? WHERE id = ?").run(qty, unit, itemId);
}

export function listPurchases(db: DB, itemId: number): Purchase[] {
  return db
    .prepare(
      "SELECT id, item_id AS itemId, purchased_on AS purchasedOn, quantity, unit_cost_cents AS unitCostCents, invoice_id AS invoiceId FROM item_purchases WHERE item_id = ? ORDER BY purchased_on, id"
    )
    .all(itemId) as Purchase[];
}

/** The item a batch belongs to, or undefined if the batch doesn't exist. Callers that
 *  need to reconcile buckets after mutating/removing a batch (e.g. the purchases route)
 *  must capture this BEFORE the mutation/delete runs — there is nothing left to look up
 *  afterward. */
export function getPurchaseItemId(db: DB, id: number): number | undefined {
  const row = db.prepare("SELECT item_id AS itemId FROM item_purchases WHERE id = ?").get(id) as { itemId: number } | undefined;
  return row?.itemId;
}

/** Edit a batch, then recompute its item's totals. Atomic. */
export function updatePurchase(db: DB, id: number, p: { purchasedOn: string | null; quantity: number; unitCostCents: number }): void {
  const tx = db.transaction(() => {
    const itemId = getPurchaseItemId(db, id);
    db.prepare("UPDATE item_purchases SET purchased_on = ?, quantity = ?, unit_cost_cents = ? WHERE id = ?")
      .run(p.purchasedOn ?? null, p.quantity, p.unitCostCents, id);
    if (itemId != null) recomputeItemTotals(db, itemId);
  });
  tx();
}

/** Delete a batch, then recompute its item's totals. Atomic. */
export function deletePurchase(db: DB, id: number): void {
  const tx = db.transaction(() => {
    const itemId = getPurchaseItemId(db, id);
    db.prepare("DELETE FROM item_purchases WHERE id = ?").run(id);
    if (itemId != null) recomputeItemTotals(db, itemId);
  });
  tx();
}

/** Exact money spent acquiring an item: sum of (quantity * unit cost) over its
 *  batches. Used for the inventory-spend KPI so rounding the average never drifts it. */
export function itemSpendCents(db: DB, itemId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(quantity*unit_cost_cents),0) AS s FROM item_purchases WHERE item_id = ?").get(itemId) as { s: number };
  return Number(r.s);
}

/** Record a purchase batch, then recompute the item's derived totals. Atomic. */
export function addPurchase(
  db: DB,
  p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null }
): number {
  const tx = db.transaction(
    (p: { itemId: number; purchasedOn: string | null; quantity: number; unitCostCents: number; invoiceId?: number | null }) => {
      const info = db
        .prepare(
          "INSERT INTO item_purchases (item_id, purchased_on, quantity, unit_cost_cents, invoice_id) VALUES (?,?,?,?,?)"
        )
        .run(p.itemId, p.purchasedOn ?? null, p.quantity, p.unitCostCents, p.invoiceId ?? null);
      recomputeItemTotals(db, p.itemId);
      settleWhatnotOnly(db, p.itemId, p.quantity, "to_whatnot");
      return Number(info.lastInsertRowid);
    }
  );
  return tx(p);
}
