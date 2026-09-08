import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { SCHEMA } from "./schema";
import { backfillSessions } from "./ledger";

export type DB = Database.Database;

export function createDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Idempotent column additions for databases created before a column existed
 *  (SQLite has no ADD COLUMN IF NOT EXISTS). */
export function migrate(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("qty_samples")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN qty_samples INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("qty_adjustment")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN qty_adjustment INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.includes("archived_at")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN archived_at TEXT");
  }
  if (!cols.includes("location")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN location TEXT");
  }
  if (!cols.includes("sku")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN sku TEXT");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS item_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('mine','supplier','whatnot')),
    code TEXT NOT NULL, supplier_label TEXT)`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_item_identifiers_code ON item_identifiers(code)");
  migrateItemIdentifiers(db);
  const pcols = (db.prepare("PRAGMA table_info(item_purchases)").all() as { name: string }[]).map((c) => c.name);
  if (!pcols.includes("invoice_id")) {
    // SQLite's ALTER TABLE ADD COLUMN cannot attach ON DELETE CASCADE, so on a
    // migrated DB this FK lacks the cascade the fresh schema has. That's fine:
    // deleteInvoice() in invoices.ts deletes an invoice's batches explicitly
    // before deleting the invoice, so it never depends on the cascade. Don't
    // "simplify" deleteInvoice to rely on cascade — it would break migrated DBs.
    db.exec("ALTER TABLE item_purchases ADD COLUMN invoice_id INTEGER REFERENCES invoices(id)");
  }
  const scols = (db.prepare("PRAGMA table_info(app_settings)").all() as { name: string }[]).map((c) => c.name);
  if (!scols.includes("business_name")) {
    db.exec("ALTER TABLE app_settings ADD COLUMN business_name TEXT");
  }
  if (!scols.includes("invoice_phone")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_phone TEXT");
  if (!scols.includes("invoice_address")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_address TEXT");
  if (!scols.includes("invoice_email")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_email TEXT");
  if (!scols.includes("invoice_show_phone")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_phone INTEGER NOT NULL DEFAULT 1");
  if (!scols.includes("invoice_show_address")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_address INTEGER NOT NULL DEFAULT 1");
  if (!scols.includes("invoice_show_email")) db.exec("ALTER TABLE app_settings ADD COLUMN invoice_show_email INTEGER NOT NULL DEFAULT 1");
  if (!scols.includes("whatnot_only")) db.exec("ALTER TABLE app_settings ADD COLUMN whatnot_only INTEGER NOT NULL DEFAULT 0");
  if (!scols.includes("costing_mode")) db.exec("ALTER TABLE app_settings ADD COLUMN costing_mode TEXT NOT NULL DEFAULT 'per_sku'");
  if (!scols.includes("avg_method")) db.exec("ALTER TABLE app_settings ADD COLUMN avg_method TEXT NOT NULL DEFAULT 'moving'");
  const shcols = (db.prepare("PRAGMA table_info(shows)").all() as { name: string }[]).map((c) => c.name);
  if (!shcols.includes("session_seq")) {
    db.exec("ALTER TABLE shows ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 0");
    backfillSessions(db); // re-group existing dates once (fresh DBs already have the column, so this won't run for them)
  }
  backfillPurchases(db);
  migrateLedgerPayoutKind(db);
  migrateLedgerRefundKind(db);
  migrateLedgerPayoutFailureKind(db); // after the refund relabel: a payout failure outranks it
  const icols = (db.prepare("PRAGMA table_info(invoices)").all() as { name: string }[]).map((c) => c.name);
  if (!icols.includes("direction")) db.exec("ALTER TABLE invoices ADD COLUMN direction TEXT NOT NULL DEFAULT 'purchase'");
  if (!icols.includes("customer")) db.exec("ALTER TABLE invoices ADD COLUMN customer TEXT");
  if (!icols.includes("paid")) db.exec("ALTER TABLE invoices ADD COLUMN paid INTEGER NOT NULL DEFAULT 0");
  if (!icols.includes("paid_on")) db.exec("ALTER TABLE invoices ADD COLUMN paid_on TEXT");
  const lcols = (db.prepare("PRAGMA table_info(invoice_lines)").all() as { name: string }[]).map((c) => c.name);
  if (!lcols.includes("unit_price_cents")) db.exec("ALTER TABLE invoice_lines ADD COLUMN unit_price_cents INTEGER");
  if (!lcols.includes("kind")) db.exec("ALTER TABLE invoice_lines ADD COLUMN kind TEXT NOT NULL DEFAULT 'item'");
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT, reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')), qty INTEGER NOT NULL, note TEXT, counted INTEGER, channel TEXT)`);
  const acols = (db.prepare("PRAGMA table_info(inventory_adjustments)").all() as { name: string }[]).map((c) => c.name);
  if (!acols.includes("counted")) db.exec("ALTER TABLE inventory_adjustments ADD COLUMN counted INTEGER");
  if (!acols.includes("channel")) db.exec("ALTER TABLE inventory_adjustments ADD COLUMN channel TEXT");
  migrateAdjustments(db);
  const ecols = (db.prepare("PRAGMA table_info(expenses)").all() as { name: string }[]).map((c) => c.name);
  if (!ecols.includes("paid_by")) db.exec("ALTER TABLE expenses ADD COLUMN paid_by TEXT");
  if (!ecols.includes("reimbursable")) db.exec("ALTER TABLE expenses ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0");
  if (!ecols.includes("reimbursed_on")) db.exec("ALTER TABLE expenses ADD COLUMN reimbursed_on TEXT");

  // Retired 2026-07-27: the brother cost-sharing concept was removed. The table
  // was unreachable (no writer) and its rows contributed 0 to every calculation.
  db.prepare("DROP TABLE IF EXISTS brother_transactions").run();
}

/** Back-fill SKUs, seed one 'mine' identifier per item, and fold any legacy
 *  product_aliases rows into item_identifiers as 'whatnot'. Idempotent. */
function migrateItemIdentifiers(db: DB): void {
  const needSku = db.prepare("SELECT id FROM inventory_items WHERE sku IS NULL OR sku = ''").all() as { id: number }[];
  for (const { id } of needSku) {
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(`ITEM-${String(id).padStart(5, "0")}`, id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku)");

  db.exec(`INSERT OR IGNORE INTO item_identifiers (item_id, source, code)
    SELECT i.id, 'mine', i.sku FROM inventory_items i
    WHERE NOT EXISTS (SELECT 1 FROM item_identifiers ii WHERE ii.item_id = i.id AND ii.source = 'mine')`);

  const hasAliases = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_aliases'").get();
  if (hasAliases) {
    const aliasCount = (db.prepare("SELECT COUNT(*) n FROM product_aliases").get() as { n: number }).n;
    const whatnotBefore = (db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE source='whatnot'").get() as { n: number }).n;
    db.exec(`INSERT OR IGNORE INTO item_identifiers (item_id, source, code)
      SELECT item_id, 'whatnot', product_name FROM product_aliases`);
    const whatnotAfter = (db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE source='whatnot'").get() as { n: number }).n;
    if (whatnotAfter - whatnotBefore !== aliasCount) {
      throw new Error(`item_identifiers migration would lose ${aliasCount - (whatnotAfter - whatnotBefore)} product_aliases row(s) to a code collision; aborting before DROP TABLE product_aliases`);
    }
    db.exec("DROP TABLE product_aliases");
  }
}

/** Seed one purchase batch per item created before item_purchases existed, so the
 *  derived totals reproduce the original scalar qty/cost. Idempotent: items that
 *  already have a batch are skipped; items with no purchased units get none. */
export function backfillPurchases(db: DB): void {
  const items = db.prepare("SELECT id, qty_purchased AS qty, unit_cost_cents AS cost FROM inventory_items WHERE qty_purchased > 0").all() as { id: number; qty: number; cost: number }[];
  const has = db.prepare("SELECT 1 FROM item_purchases WHERE item_id = ? LIMIT 1");
  const insert = db.prepare("INSERT INTO item_purchases (item_id, purchased_on, quantity, unit_cost_cents) VALUES (?, NULL, ?, ?)");
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!has.get(it.id)) insert.run(it.id, it.qty, it.cost);
    }
  });
  tx();
}

/** One-time, idempotent: widen the ledger_transactions.kind CHECK to include
 *  'payout', reclassify already-imported PAYOUT rows (previously bucketed as
 *  'other'), and recompute ledger shows' payout_cents excluding withdrawals.
 *  Guarded on the constraint text, so it runs exactly once and is a no-op after. */
export function migrateLedgerPayoutKind(db: DB): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_transactions'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'payout'")) return; // fresh schema or already migrated
  const cols = "id, show_id, created_at, show_date, amount_cents, kind, product_name, item_id, listing_id, order_id, message, status, txn_type, dedup_key";
  db.transaction(() => {
    db.exec(`
      CREATE TABLE ledger_transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        show_id INTEGER REFERENCES shows(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        show_date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout')),
        product_name TEXT,
        item_id INTEGER REFERENCES inventory_items(id),
        listing_id TEXT,
        order_id TEXT,
        message TEXT,
        status TEXT,
        txn_type TEXT,
        dedup_key TEXT NOT NULL UNIQUE
      );
      INSERT INTO ledger_transactions_new (${cols}) SELECT ${cols} FROM ledger_transactions;
      DROP TABLE ledger_transactions;
      ALTER TABLE ledger_transactions_new RENAME TO ledger_transactions;
      UPDATE ledger_transactions SET kind='payout' WHERE txn_type='PAYOUT';
      UPDATE shows SET payout_cents = (
        SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
        WHERE show_id = shows.id AND kind <> 'payout'
      ) WHERE source_hash='ledger';
    `);
  })();
}

/** One-time, idempotent: widen ledger_transactions.kind CHECK to include 'refund'
 *  and relabel already-imported ADJUSTMENT refund rows (previously 'other').
 *  Guarded on the constraint text so it runs exactly once. Payout is NOT
 *  recomputed — refunds stay inside the kind<>'payout' sum, so no show changes. */
export function migrateLedgerRefundKind(db: DB): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_transactions'")
    .get() as { sql: string } | undefined;
  if (!row) return;
  // One-time: widen the CHECK by rebuilding the table (guarded on the constraint text).
  if (!row.sql.includes("'refund'")) {
    const cols = "id, show_id, created_at, show_date, amount_cents, kind, product_name, item_id, listing_id, order_id, message, status, txn_type, dedup_key";
    db.transaction(() => {
      db.exec(`
        CREATE TABLE ledger_transactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          show_id INTEGER REFERENCES shows(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          show_date TEXT NOT NULL,
          amount_cents INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout','refund')),
          product_name TEXT,
          item_id INTEGER REFERENCES inventory_items(id),
          listing_id TEXT,
          order_id TEXT,
          message TEXT,
          status TEXT,
          txn_type TEXT,
          dedup_key TEXT NOT NULL UNIQUE
        );
        INSERT INTO ledger_transactions_new (${cols}) SELECT ${cols} FROM ledger_transactions;
        DROP TABLE ledger_transactions;
        ALTER TABLE ledger_transactions_new RENAME TO ledger_transactions;
      `);
    })();
  }
  // ALWAYS relabel (idempotent, cheap): an ADJUSTMENT whose message mentions a refund
  // is a refund. This catches rows imported as 'other' before the refund kind existed,
  // even on a DB whose CHECK was already widened on a prior boot (so the rebuild above
  // is skipped). Once a row is 'refund' the predicate no longer matches it.
  db.prepare(
    `UPDATE ledger_transactions SET kind='refund'
      WHERE kind='other' AND txn_type='ADJUSTMENT' AND LOWER(message) LIKE '%refund%'
        AND LOWER(message) NOT LIKE '%payout failure%'`
  ).run();
}

/** Idempotent: relabel a bounced payout's return credit as 'payout' and recompute
 *  the shows it inflated.
 *
 *  Whatnot never marks the original PAYOUT row as failed -- its Status stays
 *  'completed' -- and refunds the money days later as an ADJUSTMENT whose message
 *  happens to contain the word "refund". Imported before this was understood, that
 *  credit landed as kind 'refund', which the report folds into show revenue: the
 *  day's profit gained the full payout, and the withdrawal it reversed still read
 *  as money paid to the bank. As 'payout' the pair cancels and neither is income.
 *
 *  Runs on every boot rather than once behind a schema guard, because the rows it
 *  fixes were written by a correct-looking import, not by an old schema. Once a
 *  row is 'payout' the predicate no longer matches it. */
export function migrateLedgerPayoutFailureKind(db: DB): void {
  const changed = db.prepare(
    `UPDATE ledger_transactions SET kind='payout'
      WHERE kind <> 'payout' AND txn_type='ADJUSTMENT' AND LOWER(message) LIKE '%payout failure%'`
  ).run().changes;
  if (changed === 0) return;
  // Only ledger-sourced shows derive payout_cents from these rows; a manually
  // entered show's payout is typed in and must not be recomputed away.
  db.prepare(
    `UPDATE shows SET payout_cents = (
       SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
       WHERE show_id = shows.id AND kind <> 'payout'
     ) WHERE source_hash='ledger'`
  ).run();
}

/** One-time, idempotent: mirror legacy qty_samples (as negative 'sample') and
 *  qty_adjustment (sign-preserved 'recount') into inventory_adjustments, then zero
 *  the legacy columns so remaining (now read from the log) isn't double-counted.
 *  Guarded per-item on a marker: skip items that already have a migrated row. */
export function migrateAdjustments(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("qty_samples")) return;
  const items = db.prepare("SELECT id, qty_samples AS s, qty_adjustment AS a FROM inventory_items WHERE qty_samples <> 0 OR qty_adjustment <> 0").all() as { id: number; s: number; a: number }[];
  const insert = db.prepare("INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note) VALUES (?,?,?,?,?)");
  const tx = db.transaction(() => {
    for (const it of items) {
      if (it.s !== 0) insert.run(it.id, null, "sample", -it.s, "migrated from qty_samples");
      if (it.a !== 0) insert.run(it.id, null, "recount", it.a, "migrated from qty_adjustment");
      db.prepare("UPDATE inventory_items SET qty_samples = 0, qty_adjustment = 0 WHERE id = ?").run(it.id);
    }
  });
  tx();
}

/** Fold the WAL into the main db file and close the connection. SQLite leaves
 *  recent writes in the -wal sidecar until a checkpoint; without this, an
 *  unclean shutdown (Docker SIGTERM) leaves the git-tracked whatnot.db stale
 *  while the live data sits uncommitted in the WAL. */
export function checkpointAndClose(db: DB): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

export function dataDir(): string {
  return process.env.DATA_DIR ?? resolve(process.cwd(), "data");
}

export function workspacePath(userId: number): string {
  return join(dataDir(), "ws", `${userId}.db`);
}

const cache = new Map<number, DB>();

export function getDb(userId: number): DB {
  let db = cache.get(userId);
  if (!db) {
    mkdirSync(join(dataDir(), "ws"), { recursive: true });
    db = createDb(workspacePath(userId));
    cache.set(userId, db);
    registerShutdownHandlers(); // registers once
  }
  return db;
}

export function closeAllDbs(): void {
  for (const db of cache.values()) { if (db.open) checkpointAndClose(db); }
  cache.clear();
  shutdownRegistered = false;
}

let shutdownRegistered = false;
function registerShutdownHandlers(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;
  const shutdown = () => { try { closeAllDbs(); } finally { process.exit(0); } };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
