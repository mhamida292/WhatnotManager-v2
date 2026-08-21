import type { DB } from "./connection";
import { resolveItemId } from "./aliases";
import type { LedgerRow } from "@/lib/csv/ledger";
import { assignSessions, SESSION_GAP_MINUTES } from "@/lib/calc/sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";

export interface LedgerTxnRow extends LedgerRow {
  id: number;
  showId: number;
  itemId: number | null;
}

export interface SaveLedgerResult {
  inserted: number;
  skipped: number;
  showsTouched: number;
}

/**
 * Recompute the shows for one ledger date from all its transactions: order by
 * time-of-day, split on a >SESSION_GAP_MINUTES gap, ensure one show per session
 * (reuse by session_seq, create missing, delete emptied), reassign show_id, and
 * recompute payouts. Only touches source_hash='ledger' shows.
 */
export function regroupLedgerShows(db: DB, showDate: string): void {
  const rows = db.prepare(
    `SELECT t.id AS id, t.created_at AS createdAt, t.kind AS kind
     FROM ledger_transactions t
     JOIN shows s ON s.id = t.show_id
     WHERE s.show_date = ? AND s.source_hash = 'ledger'`
  ).all(showDate) as { id: number; createdAt: string; kind: string }[];
  if (rows.length === 0) return;

  const sessionOf = assignSessions(
    rows.map((r) => ({ timeSeconds: ledgerTimeOfDaySeconds(r.createdAt), isSale: r.kind === "sale" })),
    SESSION_GAP_MINUTES * 60
  );
  const sessionCount = Math.max(...sessionOf) + 1;

  const existing = db.prepare(
    "SELECT id FROM shows WHERE show_date = ? AND source_hash = 'ledger' ORDER BY session_seq, id"
  ).all(showDate) as { id: number }[];

  const showIds: number[] = [];
  for (let seq = 0; seq < sessionCount; seq++) {
    if (existing[seq]) {
      db.prepare("UPDATE shows SET session_seq = ? WHERE id = ?").run(seq, existing[seq].id);
      showIds.push(existing[seq].id);
    } else {
      const info = db.prepare(
        "INSERT INTO shows (show_date, payout_cents, shipping_supplies_cents, giveaway_count, giveaway_unit_cents, source_hash, session_seq) VALUES (?,0,0,0,500,'ledger',?)"
      ).run(showDate, seq);
      showIds.push(Number(info.lastInsertRowid));
    }
  }

  // Reassign every transaction to its session's show BEFORE deleting surplus shows,
  // so surplus shows are empty and their ON DELETE CASCADE removes nothing.
  const upd = db.prepare("UPDATE ledger_transactions SET show_id = ? WHERE id = ?");
  rows.forEach((r, i) => upd.run(showIds[sessionOf[i]], r.id));

  for (let k = sessionCount; k < existing.length; k++) {
    db.prepare("DELETE FROM shows WHERE id = ?").run(existing[k].id);
  }

  const recompute = db.prepare(
    "UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = ? AND kind <> 'payout') WHERE id = ?"
  );
  for (const id of showIds) recompute.run(id, id);
}

export function saveLedger(db: DB, rows: LedgerRow[]): SaveLedgerResult {
  const tx = db.transaction((rows: LedgerRow[]): SaveLedgerResult => {
    // Ledger-created shows are tagged source_hash='ledger' so we never adopt or
    // overwrite a legacy, manually-entered show that happens to share a date.
    const findShow = db.prepare("SELECT id FROM shows WHERE show_date = ? AND source_hash = 'ledger'");
    const createShow = db.prepare(
      "INSERT INTO shows (show_date, payout_cents, shipping_supplies_cents, giveaway_count, giveaway_unit_cents, source_hash) VALUES (?,0,0,0,500,'ledger')"
    );
    const findOrCreateShow = (showDate: string): number => {
      const existing = findShow.get(showDate) as { id: number } | undefined;
      if (existing) return existing.id;
      return Number(createShow.run(showDate).lastInsertRowid);
    };

    const ins = db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (show_id, created_at, show_date, amount_cents, kind, product_name, item_id,
       listing_id, order_id, message, status, txn_type, dedup_key)
      VALUES (@showId,@createdAt,@showDate,@amountCents,@kind,@productName,@itemId,
       @listingId,@orderId,@message,@status,@txnType,@dedupKey)`);
    const touchedDates = new Set<string>();
    let inserted = 0;
    for (const r of rows) {
      const showId = findOrCreateShow(r.showDate);
      touchedDates.add(r.showDate);
      const info = ins.run({
        showId, createdAt: r.createdAt, showDate: r.showDate, amountCents: r.amountCents,
        kind: r.kind, productName: r.productName,
        itemId: r.productName ? resolveItemId(db, r.productName) : null,
        listingId: r.listingId, orderId: r.orderId, message: r.message,
        status: r.status, txnType: r.txnType, dedupKey: r.dedupKey,
      });
      if (info.changes > 0) inserted++;
    }
    for (const date of touchedDates) regroupLedgerShows(db, date);
    return { inserted, skipped: rows.length - inserted, showsTouched: touchedDates.size };
  });
  return tx(rows);
}

export function listLedgerTransactions(db: DB): LedgerTxnRow[] {
  return db.prepare(`SELECT id, show_id as showId, created_at as createdAt, show_date as showDate,
    amount_cents as amountCents, kind, product_name as productName, item_id as itemId,
    listing_id as listingId, order_id as orderId, message, status, txn_type as txnType,
    dedup_key as dedupKey FROM ledger_transactions ORDER BY created_at`).all() as LedgerTxnRow[];
}

/** One-time re-grouping of all existing ledger dates (used by the session_seq migration). */
export function backfillSessions(db: DB): void {
  const dates = db.prepare(
    "SELECT DISTINCT show_date AS showDate FROM shows WHERE source_hash = 'ledger'"
  ).all() as { showDate: string }[];
  for (const d of dates) regroupLedgerShows(db, d.showDate);
}
