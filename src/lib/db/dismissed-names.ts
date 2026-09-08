import type { DB } from "./connection";
import { baseProductName } from "@/lib/csv/classify";

export interface DismissedName {
  code: string;
  dismissedAt: string;
  /** Sales still counting for this name. Dismissing does NOT give them a cost, so
   *  this is revenue booked at $0 COGS — shown next to the restore button so the
   *  overstatement stays one click away rather than invisible. */
  revenueCents: number;
  saleCount: number;
}

/** Mark a Whatnot product name as deliberately unmapped. Normalized through
 *  baseProductName exactly like an alias, so 'NAME #4' and 'NAME' are one entry. */
export function dismissProductName(db: DB, productName: string): void {
  const code = baseProductName(productName);
  if (code === "") return;
  db.prepare(
    `INSERT INTO dismissed_product_names (code, dismissed_at) VALUES (?, ?)
     ON CONFLICT(code) DO NOTHING`
  ).run(code, new Date().toISOString());
}

/** Put a name back in the unmapped list — the undo for an accidental dismissal. */
export function restoreProductName(db: DB, productName: string): void {
  db.prepare("DELETE FROM dismissed_product_names WHERE code = ?").run(baseProductName(productName));
}

/** The set the report checks. A Set because it is consulted once per product line. */
export function dismissedCodes(db: DB): Set<string> {
  const rows = db.prepare("SELECT code FROM dismissed_product_names").all() as { code: string }[];
  return new Set(rows.map((r) => r.code));
}

export function listDismissedNames(db: DB): DismissedName[] {
  return db.prepare(
    `SELECT d.code,
            d.dismissed_at AS dismissedAt,
            COALESCE(SUM(t.amount_cents), 0) AS revenueCents,
            COUNT(t.id) AS saleCount
       FROM dismissed_product_names d
       LEFT JOIN ledger_transactions t
         ON t.product_name = d.code AND t.kind = 'sale'
      GROUP BY d.code, d.dismissed_at
      ORDER BY revenueCents DESC, d.code ASC`
  ).all() as DismissedName[];
}
