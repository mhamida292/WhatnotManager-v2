import type { DB } from "./connection";
import { resolveItemId } from "./aliases";

export interface RefundRow {
  showDate: string;
  amountCents: number;
  orderId: string | null;
  productName: string | null;
  itemId: number | null;
  isShipping: boolean;
  /** The reversal wiped out the whole sale: the order was cancelled, not returned. */
  isCancellation: boolean;
}

/**
 * Orders whose reversal exactly offsets everything they earned: cancelled
 * before shipping, not returned. Whatnot writes the same message for both, so
 * the amount is the only signal.
 *
 * Shared with buildLedgerReport, which must not book revenue or COGS against a
 * sale that never happened.
 */
export function cancelledOrderIds(db: DB): Set<string> {
  const saleTotal = new Map<string, number>();
  for (const s of db.prepare(
    `SELECT order_id AS orderId, COALESCE(SUM(amount_cents),0) AS total FROM ledger_transactions
     WHERE kind = 'sale' AND order_id <> '' GROUP BY order_id`
  ).all() as { orderId: string; total: number }[]) {
    saleTotal.set(s.orderId, Number(s.total));
  }
  const out = new Set<string>();
  for (const r of db.prepare(
    `SELECT order_id AS orderId, COALESCE(SUM(amount_cents),0) AS total FROM ledger_transactions
     WHERE kind = 'refund' AND order_id <> '' AND message NOT LIKE '%shipping%'
     GROUP BY order_id`
  ).all() as { orderId: string; total: number }[]) {
    const sale = saleTotal.get(r.orderId);
    if (sale != null && sale > 0 && sale + Number(r.total) === 0) out.add(r.orderId);
  }
  return out;
}

export function listRefunds(db: DB): RefundRow[] {
  const rows = db.prepare(
    `SELECT show_date AS showDate, amount_cents AS amountCents, order_id AS orderId, message
     FROM ledger_transactions WHERE kind = 'refund'
     -- show_date is YYYY-MM-DD and sorts correctly; created_at is a formatted
     -- string ("Sep 9, 2026, ...") that sorts Sep before Jun and 9 before 15.
     ORDER BY show_date DESC, id DESC`
  ).all() as { showDate: string; amountCents: number; orderId: string | null; message: string }[];

  const saleByOrder = new Map<string, string>();
  for (const s of db.prepare(
    `SELECT order_id AS orderId, product_name AS productName FROM ledger_transactions
     WHERE kind = 'sale' AND product_name IS NOT NULL AND order_id <> ''`
  ).all() as { orderId: string; productName: string }[]) {
    saleByOrder.set(s.orderId, s.productName);
  }

  // Whatnot writes one message for both a cancellation and a return, so the
  // only signal is the amount: a reversal that exactly offsets everything the
  // order earned means nothing shipped.
  const saleTotalByOrder = new Map<string, number>();
  for (const s of db.prepare(
    `SELECT order_id AS orderId, COALESCE(SUM(amount_cents),0) AS total FROM ledger_transactions
     WHERE kind = 'sale' AND order_id <> '' GROUP BY order_id`
  ).all() as { orderId: string; total: number }[]) {
    saleTotalByOrder.set(s.orderId, Number(s.total));
  }

  return rows.map((r) => {
    const isShipping = /shipping/i.test(r.message);
    const productName = r.orderId ? (saleByOrder.get(r.orderId) ?? null) : null;
    const itemId = productName ? resolveItemId(db, productName) : null;
    const saleTotal = r.orderId ? saleTotalByOrder.get(r.orderId) : undefined;
    // A shipping deduction is never a cancellation, and a reversal with no sale
    // to compare against stays a refund rather than being guessed at.
    const isCancellation = !isShipping && (
      // A cancellation fee names itself; a cancelled sale is recognised only by
      // its reversal wiping out everything the order earned.
      /cancellation/i.test(r.message)
      || (saleTotal != null && saleTotal > 0 && saleTotal + r.amountCents === 0)
    );
    return { showDate: r.showDate, amountCents: r.amountCents, orderId: r.orderId || null, productName, itemId, isShipping, isCancellation };
  });
}

export function refundsTotalCents(db: DB): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS t FROM ledger_transactions WHERE kind = 'refund'").get() as { t: number };
  return Number(r.t);
}
