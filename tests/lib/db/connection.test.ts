import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SCHEMA } from "@/lib/db/schema";
import { createDb, migrate, migrateLedgerPayoutKind, migrateLedgerPayoutFailureKind, checkpointAndClose } from "@/lib/db/connection";

describe("createDb", () => {
  it("creates all tables in an in-memory db", () => {
    const db = createDb(":memory:");
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const t of ["lots","inventory_items","shows","show_line_items","item_identifiers","expenses"]) {
      expect(names).toContain(t);
    }
  });

  it("allows inserting a row with kind 'payout'", () => {
    const db = createDb(":memory:");
    db.prepare(
      `INSERT INTO ledger_transactions
         (created_at, show_date, amount_cents, kind, dedup_key)
       VALUES ('Jun 14, 2026', '2026-06-14', -53439, 'payout', 'k1')`
    ).run();
    const n = db.prepare("SELECT COUNT(*) c FROM ledger_transactions WHERE kind='payout'").get() as { c: number };
    expect(n.c).toBe(1);
  });

  it("migrates an old-format db: reclassifies PAYOUT and recomputes show payout", () => {
    // Build a DB with the OLD kind CHECK (no 'payout'), where a PAYOUT row was
    // stored as 'other' and folded into the show payout.
    const oldSchema = SCHEMA.replace(
      "'sale','giveaway','bonus','tip','other','payout'",
      "'sale','giveaway','bonus','tip','other'"
    );
    const db = new Database(":memory:");
    db.exec(oldSchema);
    db.prepare(
      "INSERT INTO shows (id, show_date, payout_cents, source_hash) VALUES (1,'2026-06-14',0,'ledger')"
    ).run();
    const ins = db.prepare(
      `INSERT INTO ledger_transactions (show_id, created_at, show_date, amount_cents, kind, txn_type, dedup_key)
       VALUES (1,'Jun 14, 2026','2026-06-14',?,?,?,?)`
    );
    ins.run(10000, "sale", "SALES", "d1");      // $100 real sale
    ins.run(-53439, "other", "PAYOUT", "d2");   // bank withdrawal, wrongly in 'other'
    db.prepare(
      "UPDATE shows SET payout_cents=(SELECT SUM(amount_cents) FROM ledger_transactions WHERE show_id=1) WHERE id=1"
    ).run();
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=1").get() as any).c).toBe(10000 - 53439);

    migrateLedgerPayoutKind(db);

    expect((db.prepare("SELECT kind FROM ledger_transactions WHERE txn_type='PAYOUT'").get() as any).kind).toBe("payout");
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=1").get() as any).c).toBe(10000);

    // Idempotent: running again is a no-op.
    migrateLedgerPayoutKind(db);
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=1").get() as any).c).toBe(10000);
  });

  it("checkpointAndClose flushes the WAL into the main db file", () => {
    // In WAL mode, writes live in the -wal sidecar until a checkpoint folds
    // them into the main file. Prove checkpointAndClose does that fold: delete
    // the sidecars afterward and confirm the row still reads from the main file.
    const dir = mkdtempSync(join(tmpdir(), "whatnot-ckpt-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createDb(dbPath);
      db.prepare(
        `INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, dedup_key)
         VALUES ('Jun 14, 2026','2026-06-14', 100, 'sale', 'k1')`
      ).run();

      checkpointAndClose(db);

      // Remove WAL/SHM sidecars so the main file is the only data source.
      rmSync(dbPath + "-wal", { force: true });
      rmSync(dbPath + "-shm", { force: true });
      const reopened = new Database(dbPath, { readonly: true });
      const n = reopened.prepare("SELECT COUNT(*) c FROM ledger_transactions").get() as { c: number };
      reopened.close();
      expect(n.c).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("inventory_items has a qty_adjustment column defaulting to 0", () => {
    const db = createDb(":memory:");
    const cols = (db.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("qty_adjustment");
    db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased) VALUES ('X', 100, 5)").run();
    const row = db.prepare("SELECT qty_adjustment a FROM inventory_items WHERE name='X'").get() as { a: number };
    expect(row.a).toBe(0);
  });

  it("migrate drops a legacy brother_transactions table and is idempotent", () => {
    const db = createDb(":memory:");
    db.prepare(`CREATE TABLE IF NOT EXISTS brother_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, qty INTEGER)`).run();
    db.prepare("INSERT INTO brother_transactions (kind, qty) VALUES ('gave_to_brother', 3)").run();

    migrate(db);
    migrate(db); // idempotent

    const t = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='brother_transactions'"
    ).get();
    expect(t).toBeUndefined();
  });
});

describe("migrateLedgerPayoutFailureKind", () => {
  /** A DB carrying the bug: the Aug 27 withdrawal and the Sep 7 credit that
   *  cancels it, with the credit mislabeled 'refund' so it counted as revenue. */
  function buggyDb() {
    const db = createDb(":memory:");
    db.prepare("INSERT INTO shows (id, show_date, payout_cents, source_hash) VALUES (1,'2026-08-27',0,'ledger')").run();
    db.prepare("INSERT INTO shows (id, show_date, payout_cents, source_hash) VALUES (2,'2026-09-07',0,'ledger')").run();
    const ins = db.prepare(
      `INSERT INTO ledger_transactions (show_id, created_at, show_date, amount_cents, kind, message, txn_type, dedup_key)
       VALUES (?,?,?,?,?,?,?,?)`
    );
    ins.run(1, "Aug 27, 2026, 4:56:43 PM", "2026-08-27", -1372307, "payout", "Payout request: STRIPE acct_x", "PAYOUT", "k1");
    ins.run(2, "Sep 7, 2026, 4:42:20 AM", "2026-09-07", 1372307, "refund", "Payout failure refund for 1318550423", "ADJUSTMENT", "k2");
    ins.run(2, "Sep 7, 2026, 5:00:00 PM", "2026-09-07", 2000, "sale", "Earnings for selling a Thing", "SALES", "k3");
    db.prepare("UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = shows.id AND kind <> 'payout')").run();
    return db;
  }

  it("reclassifies a payout failure refund and drops it out of the show payout", () => {
    const db = buggyDb();
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=2").get() as any).c).toBe(1374307); // inflated

    migrateLedgerPayoutFailureKind(db);

    expect((db.prepare("SELECT kind k FROM ledger_transactions WHERE dedup_key='k2'").get() as any).k).toBe("payout");
    // The show keeps only its real $20 sale.
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=2").get() as any).c).toBe(2000);
    // Withdrawal and its reversal now cancel: nothing actually reached the bank.
    const w = db.prepare("SELECT COALESCE(SUM(amount_cents),0) s FROM ledger_transactions WHERE kind='payout'").get() as any;
    expect(w.s).toBe(0);
  });

  it("is idempotent and leaves ordinary refunds alone", () => {
    const db = buggyDb();
    db.prepare(
      `INSERT INTO ledger_transactions (show_id, created_at, show_date, amount_cents, kind, message, txn_type, dedup_key)
       VALUES (2,'Sep 7, 2026','2026-09-07',-644,'refund','Reversal of sales transaction for order refund','ADJUSTMENT','k4')`
    ).run();
    migrateLedgerPayoutFailureKind(db);
    const after = (db.prepare("SELECT payout_cents c FROM shows WHERE id=2").get() as any).c;
    migrateLedgerPayoutFailureKind(db);
    expect((db.prepare("SELECT payout_cents c FROM shows WHERE id=2").get() as any).c).toBe(after);
    expect((db.prepare("SELECT kind k FROM ledger_transactions WHERE dedup_key='k4'").get() as any).k).toBe("refund");
  });
});
