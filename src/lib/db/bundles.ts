import type { DB } from "./connection";
import { extractSaleNumber } from "@/lib/csv/ledger";

export interface BundleComponentInput { itemId: number; qty: number; }
export interface ShowSaleLine { id: number; productName: string | null; amountCents: number; saleNumber: string | null; }
export interface ShowBundle {
  ledgerTxnId: number;
  productName: string | null;
  amountCents: number;
  components: BundleComponentInput[];
}
export interface BundleInput { ledgerTxnId: number; components: BundleComponentInput[]; }

/** Sale-kind ledger lines for a show — the candidates that can be marked as bundles. */
export function listShowSaleLines(db: DB, showId: number): ShowSaleLine[] {
  const rows = db.prepare(
    `SELECT id, product_name AS productName, amount_cents AS amountCents, message
     FROM ledger_transactions
     WHERE show_id = ? AND kind = 'sale'
     ORDER BY created_at`
  ).all(showId) as { id: number; productName: string | null; amountCents: number; message: string }[];
  return rows.map(({ message, ...r }) => ({ ...r, saleNumber: extractSaleNumber(message) }));
}

/** All bundles for a show, grouped by sale line (only lines that have components). */
export function getShowBundles(db: DB, showId: number): ShowBundle[] {
  const rows = db.prepare(
    `SELECT bc.ledger_txn_id AS ledgerTxnId, t.product_name AS productName,
            t.amount_cents AS amountCents, bc.item_id AS itemId, bc.qty AS qty
     FROM bundle_components bc
     JOIN ledger_transactions t ON t.id = bc.ledger_txn_id
     WHERE t.show_id = ?
     ORDER BY bc.ledger_txn_id, bc.id`
  ).all(showId) as {
    ledgerTxnId: number; productName: string | null; amountCents: number; itemId: number; qty: number;
  }[];

  const byTxn = new Map<number, ShowBundle>();
  for (const r of rows) {
    let b = byTxn.get(r.ledgerTxnId);
    if (!b) {
      b = { ledgerTxnId: r.ledgerTxnId, productName: r.productName, amountCents: r.amountCents, components: [] };
      byTxn.set(r.ledgerTxnId, b);
    }
    b.components.push({ itemId: r.itemId, qty: r.qty });
  }
  return [...byTxn.values()];
}

/** Replace-all: clear the show's bundle components, then insert the supplied ones.
 *  Empty-component bundles are skipped. Mirrors setAllocations in giveaway-items.ts. */
export function setShowBundles(db: DB, showId: number, bundles: BundleInput[]): void {
  const tx = db.transaction((bundles: BundleInput[]) => {
    db.prepare(
      `DELETE FROM bundle_components
       WHERE ledger_txn_id IN (SELECT id FROM ledger_transactions WHERE show_id = ?)`
    ).run(showId);
    const ins = db.prepare(
      "INSERT INTO bundle_components (ledger_txn_id, item_id, qty) VALUES (?,?,?)"
    );
    for (const b of bundles) {
      for (const c of b.components) {
        if (c.qty > 0) ins.run(b.ledgerTxnId, c.itemId, c.qty);
      }
    }
  });
  tx(bundles);
}

/** Map of ledger sale-line id -> its components, for the report builder. */
export function getBundleComponentsByTxn(db: DB, showId: number): Map<number, BundleComponentInput[]> {
  const rows = db.prepare(
    `SELECT bc.ledger_txn_id AS ledgerTxnId, bc.item_id AS itemId, bc.qty AS qty
     FROM bundle_components bc
     JOIN ledger_transactions t ON t.id = bc.ledger_txn_id
     WHERE t.show_id = ?
     ORDER BY bc.id`
  ).all(showId) as { ledgerTxnId: number; itemId: number; qty: number }[];
  const map = new Map<number, BundleComponentInput[]>();
  for (const r of rows) {
    if (!map.has(r.ledgerTxnId)) map.set(r.ledgerTxnId, []);
    map.get(r.ledgerTxnId)!.push({ itemId: r.itemId, qty: r.qty });
  }
  return map;
}
