import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { insertPayroll } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

/** A show with a known payout and no COGS/giveaways, so net is easy to reason about.
 *  The payout has to come from a ledger row: buildLedgerReport sums it live from
 *  ledger_transactions rather than reading shows.payout_cents. 'other' keeps the
 *  row out of the product lines, so nothing is unmapped and COGS stays 0. */
function showOn(date: string, payoutCents: number, sessionSeq = 0): number {
  const info = db.prepare(
    `INSERT INTO shows (show_date, payout_cents, shipping_supplies_cents, giveaway_count, session_seq)
     VALUES (?,?,0,0,?)`
  ).run(date, payoutCents, sessionSeq);
  const id = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO ledger_transactions (show_id, created_at, show_date, amount_cents, kind, dedup_key)
     VALUES (?,?,?,?,'other',?)`
  ).run(id, `${date} 10:00:00 AM`, date, payoutCents, `k-${id}`);
  return id;
}

const shift = (workDate: string, amountCents: number) => ({
  person: "Sam", workDate, startTime: "18:00", endTime: "23:00",
  hours: 5, rateCents: amountCents / 5, amountCents, note: null,
});

describe("buildLedgerReport — labor", () => {
  it("subtracts the day's wages from that show's net", () => {
    const id = showOn("2026-07-08", 100000);
    insertPayroll(db, shift("2026-07-08", 15000));

    const show = buildLedgerReport(db).shows.find((s) => s.showId === id)!;
    expect(show.laborCents).toBe(15000);
    expect(show.netCents).toBe(100000 - 15000);
  });

  it("reports zero labor for a show with no wages that day", () => {
    const id = showOn("2026-07-08", 100000);
    const show = buildLedgerReport(db).shows.find((s) => s.showId === id)!;
    expect(show.laborCents).toBe(0);
    expect(show.netCents).toBe(100000);
  });

  it("totals labor across shows", () => {
    showOn("2026-07-08", 100000);
    showOn("2026-07-09", 50000);
    insertPayroll(db, shift("2026-07-08", 15000));
    insertPayroll(db, shift("2026-07-09", 5000));

    expect(buildLedgerReport(db).totals.laborCents).toBe(20000);
  });

  it("reports wages with no show as unallocated without reducing any net", () => {
    const id = showOn("2026-07-08", 100000);
    insertPayroll(db, shift("2026-07-20", 9000)); // no show that day

    const rep = buildLedgerReport(db);
    expect(rep.totals.unallocatedLaborCents).toBe(9000);
    expect(rep.totals.laborCents).toBe(0);
    expect(rep.shows.find((s) => s.showId === id)!.netCents).toBe(100000);
  });
});
