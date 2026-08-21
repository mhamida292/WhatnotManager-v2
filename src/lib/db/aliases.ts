import type { DB } from "./connection";
import { baseProductName } from "@/lib/csv/classify";

export interface SeenProductName { productName: string; mapped: boolean; }

export type AddIdentifierResult = { ok: true; id: number } | { ok: false; reason: "empty" | "duplicate" };

export function setAlias(db: DB, productName: string, itemId: number): void {
  const base = baseProductName(productName);
  db.prepare(`INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'whatnot', ?)
    ON CONFLICT(code) DO UPDATE SET item_id = excluded.item_id, source = 'whatnot'`).run(itemId, base);
}

/** Remove a single identifier by its id. The name's sales stop counting toward
 *  the item (remaining rises; their COGS drops to $0 until re-mapped). */
export function removeAlias(db: DB, aliasId: number): void {
  db.prepare("DELETE FROM item_identifiers WHERE id = ?").run(aliasId);
}

/** Matches `code` across ANY source (mine/supplier/whatnot), not just Whatnot
 *  aliases — so an item's own sku or a supplier code also resolves here. This
 *  is intentionally broader than the aggregation joins in inventory.ts, which
 *  filter to source='whatnot' since those totals are specifically Whatnot sales. */
export function resolveItemId(db: DB, productName: string): number | null {
  const base = baseProductName(productName);
  const r = db.prepare("SELECT item_id AS id FROM item_identifiers WHERE code = ?").get(base) as any;
  return r ? Number(r.id) : null;
}

export function unmappedNames(db: DB, productNames: string[]): string[] {
  const out = new Set<string>();
  for (const n of productNames) if (resolveItemId(db, n) === null) out.add(baseProductName(n));
  return [...out];
}

/** Distinct product names seen in imported ledger sales and legacy show lines,
 *  with whether each is already mapped. Unmapped names come first. */
export function seenProductNames(db: DB): SeenProductName[] {
  const rows = db.prepare(`
    SELECT product_name AS productName FROM ledger_transactions
      WHERE kind = 'sale' AND product_name IS NOT NULL AND product_name <> ''
    UNION ALL
    SELECT product_name AS productName FROM show_line_items
      WHERE product_name IS NOT NULL AND product_name <> ''
  `).all() as { productName: string }[];
  // Normalize to base names (show_line_items keeps the raw "#N" suffix) and dedupe.
  const names = [...new Set(rows.map((r) => baseProductName(r.productName)))].filter((n) => n !== "");
  const out = names.map((productName) => ({ productName, mapped: resolveItemId(db, productName) != null }));
  out.sort((a, b) => (a.mapped === b.mapped ? a.productName.localeCompare(b.productName) : a.mapped ? 1 : -1));
  return out;
}

/** Remember a supplier's product name → item as a source='supplier' identifier.
 *  Collision-safe: writes only when the (base-normalized) code is free or already
 *  points at this same item. Returns true if an identifier now maps code→itemId,
 *  false if a different item/source already owns the code (left untouched). */
export function recordSupplierIdentifier(db: DB, code: string, itemId: number): boolean {
  const base = baseProductName(code);
  const existing = db.prepare("SELECT item_id AS itemId FROM item_identifiers WHERE code = ?").get(base) as { itemId: number } | undefined;
  if (existing) return Number(existing.itemId) === itemId; // same item → ok; different → don't steal
  db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'supplier', ?)").run(itemId, base);
  return true;
}

/** Manually add a supplier/whatnot identifier. Collision-guarded on the global
 *  UNIQUE(code): a code already owned by a DIFFERENT item is rejected as duplicate;
 *  a code already on THIS item is a no-op success. */
export function addIdentifier(
  db: DB,
  p: { itemId: number; source: "supplier" | "whatnot"; code: string; supplierLabel?: string | null },
): AddIdentifierResult {
  const base = baseProductName(p.code);
  if (base === "") return { ok: false, reason: "empty" };
  const existing = db.prepare("SELECT item_id AS itemId, id FROM item_identifiers WHERE code = ?").get(base) as { itemId: number; id: number } | undefined;
  if (existing) {
    return Number(existing.itemId) === p.itemId ? { ok: true, id: existing.id } : { ok: false, reason: "duplicate" };
  }
  const info = db.prepare("INSERT INTO item_identifiers (item_id, source, code, supplier_label) VALUES (?,?,?,?)")
    .run(p.itemId, p.source, base, p.supplierLabel ?? null);
  return { ok: true, id: Number(info.lastInsertRowid) };
}
