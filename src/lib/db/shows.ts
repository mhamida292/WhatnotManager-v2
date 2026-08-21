import type { DB } from "./connection";
import { resolveItemId } from "./aliases";
import type { RowStatus } from "@/lib/csv/types";

export interface ShowLineInput {
  buyerUsername: string; productName: string; quantity: number; revenueCents: number; status: RowStatus;
}
export interface SaveShowInput {
  showDate: string; payoutCents: number; shippingSuppliesCents: number;
  giveawayCount: number; giveawayUnitCents: number; sourceHash: string; lines: ShowLineInput[];
}

export function saveShow(db: DB, s: SaveShowInput): number {
  const tx = db.transaction((s: SaveShowInput) => {
    db.prepare("DELETE FROM shows WHERE source_hash = ?").run(s.sourceHash);
    const info = db.prepare(`INSERT INTO shows
      (show_date,payout_cents,shipping_supplies_cents,giveaway_count,giveaway_unit_cents,source_hash)
      VALUES (?,?,?,?,?,?)`).run(
        s.showDate, s.payoutCents, s.shippingSuppliesCents, s.giveawayCount, s.giveawayUnitCents, s.sourceHash);
    const showId = Number(info.lastInsertRowid);
    const insLine = db.prepare(`INSERT INTO show_line_items
      (show_id,buyer_username,product_name,quantity,revenue_cents,status,item_id)
      VALUES (?,?,?,?,?,?,?)`);
    for (const l of s.lines) {
      insLine.run(showId, l.buyerUsername, l.productName, l.quantity, l.revenueCents, l.status,
        resolveItemId(db, l.productName));
    }
    return showId;
  });
  return tx(s);
}

export interface ShowLineRow extends ShowLineInput { id: number; itemId: number | null; }
export interface ShowRow {
  id: number; showDate: string; payoutCents: number; shippingSuppliesCents: number;
  giveawayCount: number; giveawayUnitCents: number; sessionSeq: number;
}

export function listShows(db: DB): ShowRow[] {
  return db.prepare(`SELECT id, show_date as showDate, payout_cents as payoutCents,
    shipping_supplies_cents as shippingSuppliesCents, giveaway_count as giveawayCount,
    giveaway_unit_cents as giveawayUnitCents, session_seq as sessionSeq
    FROM shows ORDER BY show_date DESC, session_seq ASC`).all() as ShowRow[];
}

export function getShowWithLines(db: DB, id: number): ShowRow & { lines: ShowLineRow[] } {
  const show = db.prepare(`SELECT id, show_date as showDate, payout_cents as payoutCents,
    shipping_supplies_cents as shippingSuppliesCents, giveaway_count as giveawayCount,
    giveaway_unit_cents as giveawayUnitCents, session_seq as sessionSeq FROM shows WHERE id = ?`).get(id) as ShowRow | undefined;
  if (!show) throw new Error(`Show ${id} not found`);
  const lines = db.prepare(`SELECT id, buyer_username as buyerUsername, product_name as productName,
    quantity, revenue_cents as revenueCents, status, item_id as itemId
    FROM show_line_items WHERE show_id = ? ORDER BY id`).all(id) as ShowLineRow[];
  return { ...show, lines };
}

export interface ShowDeleteImpact {
  ledgerTxns: number;
  ledgerSales: number;
  lineItems: number;
}

/** Counts of rows that a delete would remove, for the confirm dialog. */
export function showDeleteImpact(db: DB, id: number): ShowDeleteImpact {
  const count = (sql: string) => Number((db.prepare(sql).get(id) as { c: number }).c);
  return {
    ledgerTxns: count("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id = ?"),
    ledgerSales: count("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id = ? AND kind = 'sale'"),
    lineItems: count("SELECT COUNT(*) c FROM show_line_items WHERE show_id = ?"),
  };
}

/** Hard-delete a show. show_line_items and ledger_transactions are removed via
 *  their ON DELETE CASCADE FKs (foreign_keys is ON, set in createDb). */
export function deleteShow(db: DB, id: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM shows WHERE id = ?").run(id);
  })();
}
