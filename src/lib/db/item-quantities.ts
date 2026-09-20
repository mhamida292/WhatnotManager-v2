import type { DB } from "./connection";

export interface ItemQuantities {
  sold: number;       // ledger + legacy show lines + posted wholesale
  remaining: number;  // purchased - sold + adjustments
  whatnot: number;    // moved in - moved out - whatnot sales + whatnot adjustments
  warehouse: number;  // remaining - whatnot, so the buckets partition on-hand
}

/**
 * Every item's quantities in one pass.
 *
 * The per-item functions in inventory.ts cost roughly 23 queries each once
 * their helpers fan out, which is ~4,900 queries on a 214-item catalogue and
 * several seconds of page time. These are the same sums grouped by item_id, so
 * the cost stops scaling with the number of items.
 *
 * Kept deliberately in lockstep with qtySold / qtyRemaining / whatnotQty /
 * warehouseQty -- the test asserts the two agree item by item, so change both
 * together or the test will say so.
 */
export function itemQuantities(db: DB): Map<number, ItemQuantities> {
  const sum = (sql: string): Map<number, number> => {
    const out = new Map<number, number>();
    for (const r of db.prepare(sql).all() as { itemId: number; v: number }[]) {
      if (r.itemId != null) out.set(Number(r.itemId), Number(r.v));
    }
    return out;
  };

  const purchased = sum(`SELECT id AS itemId, COALESCE(qty_purchased,0) AS v FROM inventory_items`);

  // Ledger sales resolve LIVE through the whatnot identifier map, exactly as
  // qtySoldFromLedger does, so mapping a name later counts its past sales.
  const ledgerSales = sum(`
    SELECT pa.item_id AS itemId, COUNT(*) AS v
    FROM ledger_transactions lt
    JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
    WHERE lt.kind = 'sale'
    GROUP BY pa.item_id`);

  const showSales = sum(`
    SELECT item_id AS itemId, COALESCE(SUM(quantity),0) AS v
    FROM show_line_items WHERE status = 'confirmed' GROUP BY item_id`);

  const wholesaleSales = sum(`
    SELECT il.item_id AS itemId, COALESCE(SUM(il.quantity),0) AS v
    FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
    WHERE i.direction = 'sale' AND i.status = 'posted'
    GROUP BY il.item_id`);

  const adjustments = sum(`
    SELECT item_id AS itemId, COALESCE(SUM(qty),0) AS v
    FROM inventory_adjustments GROUP BY item_id`);

  const whatnotAdjustments = sum(`
    SELECT item_id AS itemId, COALESCE(SUM(qty),0) AS v
    FROM inventory_adjustments WHERE channel = 'whatnot' GROUP BY item_id`);

  const movedIn = sum(`
    SELECT item_id AS itemId, COALESCE(SUM(qty),0) AS v
    FROM inventory_moves WHERE direction = 'to_whatnot' GROUP BY item_id`);

  const movedOut = sum(`
    SELECT item_id AS itemId, COALESCE(SUM(qty),0) AS v
    FROM inventory_moves WHERE direction = 'to_warehouse' GROUP BY item_id`);

  const out = new Map<number, ItemQuantities>();
  for (const [id, qtyPurchased] of purchased) {
    const g = (m: Map<number, number>) => m.get(id) ?? 0;
    // Whatnot sales are ledger + legacy show lines; wholesale never leaves the
    // Whatnot bucket, so it is in `sold` but not in `whatnotSales`.
    const whatnotSales = g(ledgerSales) + g(showSales);
    const sold = whatnotSales + g(wholesaleSales);
    const remaining = qtyPurchased - sold + g(adjustments);
    const whatnot = g(movedIn) - g(movedOut) - whatnotSales + g(whatnotAdjustments);
    out.set(id, { sold, remaining, whatnot, warehouse: remaining - whatnot });
  }
  return out;
}
