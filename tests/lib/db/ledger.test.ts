import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createDb, migrateLedgerRefundKind, type DB } from "@/lib/db/connection";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger, listLedgerTransactions, backfillSessions } from "@/lib/db/ledger";
import { listShows, saveShow } from "@/lib/db/shows";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"
"Jun 8, 2026, 10:55:32 PM","$1.00","","","Received a tip from snorke","completed","TIP","y"`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("saveLedger", () => {
  it("creates one show per date and stores transactions", () => {
    const res = saveLedger(db, parseLedger(CSV));
    expect(res.inserted).toBe(3);
    const shows = listShows(db);
    expect(shows.map((s) => s.showDate).sort()).toEqual(["2026-06-08", "2026-06-12"]);
  });

  it("computes each show's payout as the sum of its transaction amounts", () => {
    saveLedger(db, parseLedger(CSV));
    const shows = listShows(db);
    const jun12 = shows.find((s) => s.showDate === "2026-06-12")!;
    expect(jun12.payoutCents).toBe(49 - 78); // -29
    const jun8 = shows.find((s) => s.showDate === "2026-06-08")!;
    expect(jun8.payoutCents).toBe(100);
  });

  it("is idempotent: re-importing the same file inserts nothing new", () => {
    saveLedger(db, parseLedger(CSV));
    const res2 = saveLedger(db, parseLedger(CSV));
    expect(res2.inserted).toBe(0);
    expect(res2.skipped).toBe(3);
    expect(listLedgerTransactions(db)).toHaveLength(3);
    expect(listShows(db)).toHaveLength(2);
  });

  it("does not adopt or overwrite a legacy manually-entered show on the same date", () => {
    saveShow(db, {
      showDate: "2026-06-12", payoutCents: 99999, shippingSuppliesCents: 0,
      giveawayCount: 0, giveawayUnitCents: 500, sourceHash: "legacy-hash", lines: [],
    });
    saveLedger(db, parseLedger(CSV));
    const shows = listShows(db);
    // Two distinct shows now exist for 2026-06-12: the legacy one (untouched) and the ledger one.
    const jun12 = shows.filter((s) => s.showDate === "2026-06-12");
    expect(jun12).toHaveLength(2);
    expect(jun12.some((s) => s.payoutCents === 99999)).toBe(true); // legacy payout preserved
    expect(jun12.some((s) => s.payoutCents === 49 - 78)).toBe(true); // ledger-computed payout
  });

  it("excludes PAYOUT withdrawals from a show's payout_cents", () => {
    // PAYOUT within 60 min of the sale so BOTH rows stay in ONE session/show,
    // and the recompute's `kind <> 'payout'` exclusion is actually exercised.
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 09:30:00 AM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
    saveLedger(db, parseLedger(csv));
    const shows = listShows(db).filter((s) => s.showDate === "2026-06-14");
    expect(shows).toHaveLength(1); // sale + payout are one session
    expect(shows[0].payoutCents).toBe(10000); // withdrawal NOT subtracted
  });
});

describe("saveLedger sessions", () => {
  // Two clusters on Jun 12: morning (10:00, 10:30) and evening (17:00, 17:20) — a >60-min gap.
  const TWO_SHOWS = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:00:00 AM","$3.00","L1","O1","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 12, 2026, 10:30:00 AM","$5.00","L2","O2","Earnings for selling an Axolotl #1","processing","SALES",""
"Jun 12, 2026, 5:00:00 PM","$4.00","L3","O3","Earnings for selling a Highland Cow #1","processing","SALES",""
"Jun 12, 2026, 5:20:00 PM","$8.00","L4","O4","Earnings for selling a Mystery Box #1","processing","SALES",""`;

  it("splits a day with a >60-min gap into two shows with correct payouts", () => {
    saveLedger(db, parseLedger(TWO_SHOWS));
    const shows = listShows(db).filter((s) => s.showDate === "2026-06-12");
    expect(shows.map((s) => s.sessionSeq)).toEqual([0, 1]);
    // session 0 = morning ($3 + $5 = $8.00), session 1 = evening ($4 + $8 = $12.00)
    const s0 = shows.find((s) => s.sessionSeq === 0)!;
    const s1 = shows.find((s) => s.sessionSeq === 1)!;
    expect(s0.payoutCents).toBe(800);
    expect(s1.payoutCents).toBe(1200);
  });

  it("keeps a day with only sub-60-min gaps as one show", () => {
    const ONE = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 10:00:00 AM","$3.00","La","Oa","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 14, 2026, 10:45:00 AM","$5.00","Lb","Ob","Earnings for selling an Axolotl #1","processing","SALES",""`;
    saveLedger(db, parseLedger(ONE));
    const shows = listShows(db).filter((s) => s.showDate === "2026-06-14");
    expect(shows).toHaveLength(1);
    expect(shows[0].sessionSeq).toBe(0);
  });

  it("is idempotent: re-importing the same file preserves the two shows", () => {
    saveLedger(db, parseLedger(TWO_SHOWS));
    saveLedger(db, parseLedger(TWO_SHOWS));
    const shows = listShows(db).filter((s) => s.showDate === "2026-06-12");
    expect(shows).toHaveLength(2);
    expect(shows.map((s) => s.payoutCents).sort((a, b) => a - b)).toEqual([800, 1200]);
  });
});

describe("saveLedger sessions — stray non-sales", () => {
  it("keeps one show when a day has a single sale cluster plus stray fee + withdrawal", () => {
    const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 18, 2026, 6:30:00 AM","-$2.00","Lf","Of","Account fee","completed","ADJUSTMENT","x"
"Jun 18, 2026, 10:13:00 AM","-$534.39","Lw","Ow","Bank transfer","completed","PAYOUT","x"
"Jun 18, 2026, 4:05:00 PM","$3.00","L1","O1","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 18, 2026, 4:35:00 PM","$5.00","L2","O2","Earnings for selling an Axolotl #1","processing","SALES",""`;
    saveLedger(db, parseLedger(CSV));
    const shows = listShows(db).filter((s) => s.showDate === "2026-06-18");
    expect(shows).toHaveLength(1);
    // payout = $3 + $5 sales − $2 fee = $6.00 (the 6:30 AM `other` fee folds into the show and
    // reduces payout; the 10:13 AM bank withdrawal is excluded as kind='payout')
    expect(shows[0].payoutCents).toBe(600);
  });
});

const REFUND_CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jul 5, 2026, 4:45:55 PM","-$4.00","L1","O1","Reversal of sales transaction for order refund","completed","ADJUSTMENT",""`;

describe("refund ingestion + migration", () => {
  it("saves a refund row as kind=refund and keeps it inside the payout sum", () => {
    const db = createDb(":memory:");
    saveLedger(db, parseLedger(REFUND_CSV));
    const row = db.prepare("SELECT kind, amount_cents AS a, show_id AS s FROM ledger_transactions WHERE dedup_key IS NOT NULL").get() as any;
    expect(row.kind).toBe("refund");
    const payout = Number((db.prepare("SELECT COALESCE(SUM(amount_cents),0) t FROM ledger_transactions WHERE show_id=? AND kind <> 'payout'").get(row.s) as any).t);
    expect(payout).toBe(-400); // refund is inside the non-payout sum -> profit unchanged
  });

  it("migrateLedgerRefundKind relabels legacy 'other' refund rows and widens the CHECK", () => {
    const db = new Database(":memory:") as any;
    db.pragma("foreign_keys = OFF");
    // legacy table: CHECK lacks 'refund'
    db.exec(`CREATE TABLE ledger_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, show_id INTEGER, created_at TEXT NOT NULL, show_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout')),
      product_name TEXT, item_id INTEGER, listing_id TEXT, order_id TEXT, message TEXT, status TEXT, txn_type TEXT,
      dedup_key TEXT NOT NULL UNIQUE)`);
    db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, message, txn_type, dedup_key)
      VALUES ('Jul 5, 2026, 4:45:55 PM','2026-07-05',-400,'other','Reversal of sales transaction for order refund','ADJUSTMENT','k1')`).run();
    migrateLedgerRefundKind(db);
    expect((db.prepare("SELECT kind FROM ledger_transactions WHERE dedup_key='k1'").get() as any).kind).toBe("refund");
    // idempotent: second run is a no-op (guard sees 'refund' in the CHECK)
    migrateLedgerRefundKind(db);
    expect((db.prepare("SELECT kind FROM ledger_transactions WHERE dedup_key='k1'").get() as any).kind).toBe("refund");
  });

  it("relabels a stranded 'other' refund row even when the CHECK already has 'refund'", () => {
    // Regression: the CHECK was widened on a prior boot, but a refund row imported as
    // 'other' before the refund kind existed stayed 'other'. The always-run relabel fixes it.
    const db = new Database(":memory:") as any;
    db.pragma("foreign_keys = OFF");
    db.exec(`CREATE TABLE ledger_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, show_id INTEGER, created_at TEXT NOT NULL, show_date TEXT NOT NULL,
      amount_cents INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout','refund')),
      product_name TEXT, item_id INTEGER, listing_id TEXT, order_id TEXT, message TEXT, status TEXT, txn_type TEXT,
      dedup_key TEXT NOT NULL UNIQUE)`);
    db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, message, txn_type, dedup_key)
      VALUES ('Jun 14, 2026, 9:00:00 AM','2026-06-14',-276,'other','Reversal of sales transaction for order refund','ADJUSTMENT','k2')`).run();
    // A non-refund ADJUSTMENT (insurance claim) must stay 'other'.
    db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, message, txn_type, dedup_key)
      VALUES ('Jun 22, 2026, 9:00:00 AM','2026-06-22',100,'other','Approved Insurance Claim for shipment 1','ADJUSTMENT','k3')`).run();
    migrateLedgerRefundKind(db);
    expect((db.prepare("SELECT kind FROM ledger_transactions WHERE dedup_key='k2'").get() as any).kind).toBe("refund");
    expect((db.prepare("SELECT kind FROM ledger_transactions WHERE dedup_key='k3'").get() as any).kind).toBe("other");
  });
});

describe("backfillSessions", () => {
  it("splits an already-merged two-in-a-day date into two shows", () => {
    // Simulate a pre-migration state: one ledger show holding both clusters.
    const showId = Number(db.prepare(
      "INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-12','ledger',0)"
    ).run().lastInsertRowid);
    const ins = db.prepare(
      "INSERT INTO ledger_transactions (show_id, created_at, show_date, amount_cents, kind, dedup_key) VALUES (?,?,?,?,?,?)"
    );
    ins.run(showId, "Jun 12, 2026, 10:00:00 AM", "2026-06-12", 300, "sale", "k1");
    ins.run(showId, "Jun 12, 2026, 5:00:00 PM", "2026-06-12", 400, "sale", "k2");

    backfillSessions(db);

    const rows = db.prepare(
      "SELECT session_seq FROM shows WHERE show_date='2026-06-12' AND source_hash='ledger' ORDER BY session_seq"
    ).all() as { session_seq: number }[];
    expect(rows.map((r) => r.session_seq)).toEqual([0, 1]);
  });
});
