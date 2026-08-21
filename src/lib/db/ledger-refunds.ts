import type { DB } from "./connection";
import { resolveItemId } from "./aliases";

export interface RefundRow {
  showDate: string;
  amountCents: number;
  orderId: string | null;
  productName: string | null;
  itemId: number | null;
  isShipping: boolean;
}

export function listRefunds(db: DB): RefundRow[] {
  const rows = db.prepare(
    `SELECT show_date AS showDate, amount_cents AS amountCents, order_id AS orderId, message
     FROM ledger_transactions WHERE kind = 'refund' ORDER BY created_at DESC`
  ).all() as { showDate: string; amountCents: number; orderId: string | null; message: string }[];

  const saleByOrder = new Map<string, string>();
  for (const s of db.prepare(
    `SELECT order_id AS orderId, product_name AS productName FROM ledger_transactions
     WHERE kind = 'sale' AND product_name IS NOT NULL AND order_id <> ''`
  ).all() as { orderId: string; productName: string }[]) {
    saleByOrder.set(s.orderId, s.productName);
  }

  return rows.map((r) => {
    const isShipping = /shipping/i.test(r.message);
    const productName = r.orderId ? (saleByOrder.get(r.orderId) ?? null) : null;
    const itemId = productName ? resolveItemId(db, productName) : null;
    return { showDate: r.showDate, amountCents: r.amountCents, orderId: r.orderId || null, productName, itemId, isShipping };
  });
}

export function refundsTotalCents(db: DB): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS t FROM ledger_transactions WHERE kind = 'refund'").get() as { t: number };
  return Number(r.t);
}
