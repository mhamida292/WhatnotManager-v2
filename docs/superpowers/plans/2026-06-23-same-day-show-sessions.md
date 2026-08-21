# Same-Day Show Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically split a day's Whatnot ledger transactions into separate shows wherever there is a >60-minute gap, so two streams in one day become two independent shows.

**Architecture:** A pure gap function assigns a 0-based `session_seq` to each of a date's transactions (ordered by time-of-day). At import, `regroupLedgerShows(db, date)` recomputes a date's shows from all its transactions, creating/reusing/deleting `shows` rows keyed by `(show_date, session_seq)` and reassigning `ledger_transactions.show_id`. A one-time backfill re-groups existing data. The report/dashboard label multi-session days by time.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest. Money is integer cents; time parsing avoids JS `Date` (timezone-safe).

## Global Constraints

- Money is integer cents; time is seconds-of-day (no JS `Date`).
- Session boundary rule: a new session starts when `time[i] - time[i-1] > 60 minutes`; exactly 60 minutes stays in the same show. Constant: `SESSION_GAP_MINUTES = 60`.
- A ledger show is identified by `(show_date, session_seq)`; `session_seq` is 0-based, ordered by time. Single-session days use `session_seq = 0` and behave exactly as today.
- Only `source_hash = 'ledger'` shows are sessionized; legacy non-ledger shows are never touched.
- `PRAGMA foreign_keys = ON` (set in `createDb`); `show_giveaway_allocations` and `ledger_transactions` cascade on show delete.
- Follow existing patterns: pure calc in `src/lib/calc/*.ts`, DB access in `src/lib/db/*.ts`, tests with `createDb(":memory:")` in `beforeEach`.

---

## File Structure

- **Create** `src/lib/calc/sessions.ts` — pure: `SESSION_GAP_MINUTES`, `sessionizeByGap`, `secondsToClock`.
- **Modify** `src/lib/csv/ledger.ts` — add `ledgerTimeOfDaySeconds` parser.
- **Modify** `src/lib/db/schema.ts` — add `session_seq` to the `shows` table.
- **Modify** `src/lib/db/connection.ts` — `migrate()` adds the column and runs the one-time backfill.
- **Modify** `src/lib/db/shows.ts` — `ShowRow.sessionSeq`; `listShows` selects it and orders by it.
- **Modify** `src/lib/db/ledger.ts` — `regroupLedgerShows`, `backfillSessions`; `saveLedger` regroups touched dates.
- **Create** `src/lib/ui/show-label.ts` — `showSessionLabel` display helper.
- **Modify** `src/lib/calc/ledger-report.ts` — `ReportShow` gains `sessionSeq`, `timeRange`, `dateHasMultipleSessions`.
- **Modify** `src/app/report/page.tsx`, `src/app/shows/[id]/page.tsx`, `src/app/page.tsx` — show the session label.
- **Tests**: `tests/lib/calc/sessions.test.ts`, additions to `tests/lib/db/ledger.test.ts`, `tests/lib/calc/ledger-report.test.ts`, and a new `tests/lib/ui/show-label.test.ts`.

> **Note (intentional deviation from spec):** the spec mentioned adding `timeSeconds` to `LedgerRow`. We do NOT add it — `regroupLedgerShows` re-derives times from the stored `created_at`, so a `LedgerRow.timeSeconds` field would be dead code. Only the `ledgerTimeOfDaySeconds` function is added.

---

## Task 1: Pure session grouping + time parsing

**Files:**
- Create: `src/lib/calc/sessions.ts`
- Modify: `src/lib/csv/ledger.ts`
- Test: `tests/lib/calc/sessions.test.ts`

**Interfaces:**
- Produces:
  - `export const SESSION_GAP_MINUTES = 60`
  - `export function sessionizeByGap(timesInSeconds: number[], gapSeconds: number): number[]`
  - `export function secondsToClock(sec: number): string` — e.g. `"5:02 PM"`
  - `export function ledgerTimeOfDaySeconds(createdDate: string): number` (in `src/lib/csv/ledger.ts`)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/sessions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { sessionizeByGap, secondsToClock, SESSION_GAP_MINUTES } from "@/lib/calc/sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";

const H = 3600, M = 60;

describe("sessionizeByGap", () => {
  it("returns all-zero for an empty or single input", () => {
    expect(sessionizeByGap([], 60 * M)).toEqual([]);
    expect(sessionizeByGap([10 * H], 60 * M)).toEqual([0]);
  });

  it("keeps one session when all gaps are <= threshold", () => {
    // 10:00, 10:30, 11:00 — 30-min gaps
    expect(sessionizeByGap([10 * H, 10 * H + 30 * M, 11 * H], 60 * M)).toEqual([0, 0, 0]);
  });

  it("starts a new session when a gap exceeds the threshold", () => {
    // 10:00, 10:30, then 17:00 (>60 min later), 17:20
    expect(sessionizeByGap([10 * H, 10 * H + 30 * M, 17 * H, 17 * H + 20 * M], 60 * M))
      .toEqual([0, 0, 1, 1]);
  });

  it("treats exactly 60 minutes as the same session, 61 as a new one", () => {
    expect(sessionizeByGap([10 * H, 11 * H], 60 * M)).toEqual([0, 0]);         // exactly 60
    expect(sessionizeByGap([10 * H, 11 * H + 1 * M], 60 * M)).toEqual([0, 1]); // 61
  });

  it("supports three sessions", () => {
    expect(sessionizeByGap([9 * H, 12 * H, 18 * H], 60 * M)).toEqual([0, 1, 2]);
  });
});

describe("secondsToClock", () => {
  it("formats 12-hour clock with AM/PM", () => {
    expect(secondsToClock(0)).toBe("12:00 AM");
    expect(secondsToClock(12 * H)).toBe("12:00 PM");
    expect(secondsToClock(13 * H + 5 * M)).toBe("1:05 PM");
    expect(secondsToClock(9 * H + 14 * M)).toBe("9:14 AM");
  });
});

describe("ledgerTimeOfDaySeconds", () => {
  it("parses the time of day from a Created Date string", () => {
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 10:14:57 AM")).toBe(10 * H + 14 * M + 57);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 5:02:11 PM")).toBe(17 * H + 2 * M + 11);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 12:00:00 PM")).toBe(12 * H);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 12:30:00 AM")).toBe(30 * M);
  });
  it("returns 0 on parse failure", () => {
    expect(ledgerTimeOfDaySeconds("garbage")).toBe(0);
  });
  it("exposes the 60-minute constant", () => {
    expect(SESSION_GAP_MINUTES).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/sessions.test.ts`
Expected: FAIL — cannot resolve `@/lib/calc/sessions`.

- [ ] **Step 3: Implement `src/lib/calc/sessions.ts`**

```typescript
/** A new show (session) begins when the gap to the previous transaction exceeds this. */
export const SESSION_GAP_MINUTES = 60;

/**
 * Assign a 0-based session index to each transaction time.
 * `timesInSeconds` MUST be sorted ascending (the caller sorts by time-of-day).
 * A new session starts whenever the gap from the previous time is strictly
 * greater than `gapSeconds` (exactly equal stays in the same session).
 */
export function sessionizeByGap(timesInSeconds: number[], gapSeconds: number): number[] {
  const out: number[] = [];
  let session = 0;
  for (let i = 0; i < timesInSeconds.length; i++) {
    if (i > 0 && timesInSeconds[i] - timesInSeconds[i - 1] > gapSeconds) session++;
    out.push(session);
  }
  return out;
}

/** Seconds-of-day -> "h:mm AM/PM" (e.g. 0 -> "12:00 AM", 43200 -> "12:00 PM"). */
export function secondsToClock(sec: number): string {
  const h24 = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
```

- [ ] **Step 4: Implement `ledgerTimeOfDaySeconds` in `src/lib/csv/ledger.ts`**

Add this exported function (place it just below `ledgerShowDate`, around line 34):

```typescript
/** "Jun 12, 2026, 5:02:11 PM" -> seconds since midnight (timezone-safe, no Date). */
export function ledgerTimeOfDaySeconds(createdDate: string): number {
  const m = createdDate.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let hour = Number(m[1]) % 12;
  if (/PM/i.test(m[4])) hour += 12;
  return hour * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calc/sessions.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS (existing + new).

- [ ] **Step 7: Commit**

```bash
git add src/lib/calc/sessions.ts src/lib/csv/ledger.ts tests/lib/calc/sessions.test.ts
git commit -m "feat(sessions): pure gap-grouping + time-of-day parser"
```

---

## Task 2: Schema column + listShows ordering

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/connection.ts` (migrate)
- Modify: `src/lib/db/shows.ts`
- Test: add to `tests/lib/db/shows.test.ts`

**Interfaces:**
- Produces: `shows.session_seq` column; `ShowRow` gains `sessionSeq: number`; `listShows` orders `show_date DESC, session_seq ASC`.

- [ ] **Step 1: Add the column to the schema**

In `src/lib/db/schema.ts`, in the `shows` table definition, add the column after `source_hash TEXT`:

```sql
CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_date TEXT NOT NULL,
  payout_cents INTEGER NOT NULL DEFAULT 0,
  shipping_supplies_cents INTEGER NOT NULL DEFAULT 0,
  giveaway_count INTEGER NOT NULL DEFAULT 0,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  source_hash TEXT,
  session_seq INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Add the migrate ALTER (no backfill yet)**

In `src/lib/db/connection.ts`, inside `migrate()`, add a block (after the `app_settings.business_name` block, before `backfillPurchases(db);`):

```typescript
  const shcols = (db.prepare("PRAGMA table_info(shows)").all() as { name: string }[]).map((c) => c.name);
  if (!shcols.includes("session_seq")) {
    db.exec("ALTER TABLE shows ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 0");
    // Backfill of existing dates is wired in a later task once regroupLedgerShows exists.
  }
```

- [ ] **Step 3: Write the failing test**

`tests/lib/db/shows.test.ts` already exists with the standard header (`createDb`, `listShows`, `db`, `beforeEach` are already imported/declared). Append ONLY this describe block — do not re-add imports or the `beforeEach`:

```typescript
describe("listShows sessionSeq", () => {
  it("returns session_seq and orders by date desc then session asc", () => {
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-12','ledger',1)").run();
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-12','ledger',0)").run();
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-13','ledger',0)").run();
    const rows = listShows(db);
    expect(rows.map((r) => [r.showDate, r.sessionSeq])).toEqual([
      ["2026-06-13", 0], ["2026-06-12", 0], ["2026-06-12", 1],
    ]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/shows.test.ts -t "sessionSeq"`
Expected: FAIL — `sessionSeq` is undefined / ordering wrong.

- [ ] **Step 5: Update `ShowRow` and `listShows`**

In `src/lib/db/shows.ts`, add `sessionSeq` to `ShowRow`:

```typescript
export interface ShowRow {
  id: number; showDate: string; payoutCents: number; shippingSuppliesCents: number;
  giveawayCount: number; giveawayUnitCents: number; sessionSeq: number;
}
```

Update `listShows` to select and order by it:

```typescript
export function listShows(db: DB): ShowRow[] {
  return db.prepare(`SELECT id, show_date as showDate, payout_cents as payoutCents,
    shipping_supplies_cents as shippingSuppliesCents, giveaway_count as giveawayCount,
    giveaway_unit_cents as giveawayUnitCents, session_seq as sessionSeq
    FROM shows ORDER BY show_date DESC, session_seq ASC`).all() as ShowRow[];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/shows.test.ts -t "sessionSeq"`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/shows.ts tests/lib/db/shows.test.ts
git commit -m "feat(sessions): shows.session_seq column + listShows ordering"
```

---

## Task 3: regroupLedgerShows + import integration

**Files:**
- Modify: `src/lib/db/ledger.ts`
- Test: add to `tests/lib/db/ledger.test.ts`

**Interfaces:**
- Consumes: `sessionizeByGap`, `SESSION_GAP_MINUTES` from `@/lib/calc/sessions`; `ledgerTimeOfDaySeconds` from `@/lib/csv/ledger`.
- Produces: `export function regroupLedgerShows(db: DB, showDate: string): void`; `saveLedger` now regroups each touched date.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/ledger.test.ts` (it already imports `parseLedger`, `saveLedger`; add `listShows` from `@/lib/db/shows` and any missing imports):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/ledger.test.ts -t "sessions"`
Expected: FAIL — a 2-show day currently produces one show.

- [ ] **Step 3: Implement `regroupLedgerShows` and wire it into `saveLedger`**

In `src/lib/db/ledger.ts`, add imports at the top:

```typescript
import { sessionizeByGap, SESSION_GAP_MINUTES } from "@/lib/calc/sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";
```

Add the function (export it):

```typescript
/**
 * Recompute the shows for one ledger date from all its transactions: order by
 * time-of-day, split on a >SESSION_GAP_MINUTES gap, ensure one show per session
 * (reuse by session_seq, create missing, delete emptied), reassign show_id, and
 * recompute payouts. Only touches source_hash='ledger' shows.
 */
export function regroupLedgerShows(db: DB, showDate: string): void {
  const rows = db.prepare(
    `SELECT t.id AS id, t.created_at AS createdAt
     FROM ledger_transactions t
     JOIN shows s ON s.id = t.show_id
     WHERE s.show_date = ? AND s.source_hash = 'ledger'`
  ).all(showDate) as { id: number; createdAt: string }[];
  if (rows.length === 0) return;

  rows.sort((a, b) => ledgerTimeOfDaySeconds(a.createdAt) - ledgerTimeOfDaySeconds(b.createdAt));
  const sessions = sessionizeByGap(
    rows.map((r) => ledgerTimeOfDaySeconds(r.createdAt)),
    SESSION_GAP_MINUTES * 60
  );
  const sessionCount = sessions.length ? sessions[sessions.length - 1] + 1 : 0;

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
  rows.forEach((r, i) => upd.run(showIds[sessions[i]], r.id));

  for (let k = sessionCount; k < existing.length; k++) {
    db.prepare("DELETE FROM shows WHERE id = ?").run(existing[k].id);
  }

  const recompute = db.prepare(
    "UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = ? AND kind <> 'payout') WHERE id = ?"
  );
  for (const id of showIds) recompute.run(id, id);
}
```

Now change `saveLedger` to track touched dates and regroup them. Replace the `touched`/recompute tail of the transaction body. The current code reads:

```typescript
    const touched = new Set<number>();
    let inserted = 0;
    for (const r of rows) {
      const showId = findOrCreateShow(r.showDate);
      touched.add(showId);
      const info = ins.run({ ... });
      if (info.changes > 0) inserted++;
    }
    const recompute = db.prepare(
      "UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = ? AND kind <> 'payout') WHERE id = ?"
    );
    for (const id of touched) recompute.run(id, id);
    return { inserted, skipped: rows.length - inserted, showsTouched: touched.size };
```

Replace it with (track dates, regroup each — regroup recomputes payouts):

```typescript
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
```

(Keep the existing `ins` prepared statement and `findOrCreateShow` helper above unchanged. `showsTouched` now counts dates, which is fine for the caller's messaging.)

- [ ] **Step 4: Run the sessions test to verify it passes**

Run: `npx vitest run tests/lib/db/ledger.test.ts -t "sessions"`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS. (If a pre-existing ledger test asserted `showsTouched` equals a count of shows for a multi-row single date, confirm it still holds — one date = 1 touched date.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/ledger.ts tests/lib/db/ledger.test.ts
git commit -m "feat(sessions): regroupLedgerShows + split on import"
```

---

## Task 4: One-time backfill of existing data

**Files:**
- Modify: `src/lib/db/ledger.ts`
- Modify: `src/lib/db/connection.ts`
- Test: add to `tests/lib/db/ledger.test.ts`

**Interfaces:**
- Consumes: `regroupLedgerShows` (Task 3).
- Produces: `export function backfillSessions(db: DB): void`; `migrate()` calls it once when `session_seq` is first added.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/ledger.test.ts`:

```typescript
import { backfillSessions } from "@/lib/db/ledger";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/ledger.test.ts -t "backfillSessions"`
Expected: FAIL — `backfillSessions` is not exported.

- [ ] **Step 3: Implement `backfillSessions`**

In `src/lib/db/ledger.ts`, add:

```typescript
/** One-time re-grouping of all existing ledger dates (used by the session_seq migration). */
export function backfillSessions(db: DB): void {
  const dates = db.prepare(
    "SELECT DISTINCT show_date AS showDate FROM shows WHERE source_hash = 'ledger'"
  ).all() as { showDate: string }[];
  for (const d of dates) regroupLedgerShows(db, d.showDate);
}
```

- [ ] **Step 4: Wire it into the migration**

In `src/lib/db/connection.ts`, add the import at the top:

```typescript
import { backfillSessions } from "./ledger";
```

Update the `session_seq` block in `migrate()` (from Task 2) to run the backfill once:

```typescript
  const shcols = (db.prepare("PRAGMA table_info(shows)").all() as { name: string }[]).map((c) => c.name);
  if (!shcols.includes("session_seq")) {
    db.exec("ALTER TABLE shows ADD COLUMN session_seq INTEGER NOT NULL DEFAULT 0");
    backfillSessions(db); // re-group existing dates once (fresh DBs already have the column, so this won't run for them)
  }
```

(`src/lib/db/ledger.ts` imports only the `DB` *type* from `./connection`, so this value import creates no runtime cycle.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/ledger.test.ts -t "backfillSessions"`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/ledger.ts src/lib/db/connection.ts tests/lib/db/ledger.test.ts
git commit -m "feat(sessions): one-time backfill on migration"
```

---

## Task 5: Report fields + session labels in the UI

**Files:**
- Modify: `src/lib/calc/ledger-report.ts`
- Create: `src/lib/ui/show-label.ts`
- Modify: `src/app/report/page.tsx`, `src/app/shows/[id]/page.tsx`, `src/app/page.tsx`
- Test: add to `tests/lib/calc/ledger-report.test.ts`; create `tests/lib/ui/show-label.test.ts`

**Interfaces:**
- Consumes: `ReportShow` (extended below).
- Produces:
  - `ReportShow` gains `sessionSeq: number`, `timeRange: string`, `dateHasMultipleSessions: boolean`.
  - `export function showSessionLabel(s: { showDate: string; sessionSeq: number; timeRange: string; dateHasMultipleSessions: boolean }): string`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/calc/ledger-report.test.ts`:

```typescript
import { listShows } from "@/lib/db/shows";

describe("buildLedgerReport — sessions", () => {
  const TWO = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 20, 2026, 10:00:00 AM","$3.00","L1","O1","Earnings for selling a Cheese Squishy #1","processing","SALES",""
"Jun 20, 2026, 5:00:00 PM","$4.00","L3","O3","Earnings for selling a Highland Cow #1","processing","SALES",""`;

  it("exposes sessionSeq, timeRange, and dateHasMultipleSessions", () => {
    saveLedger(db, parseLedger(TWO));
    const rep = buildLedgerReport(db);
    const day = rep.shows.filter((s) => s.showDate === "2026-06-20").sort((a, b) => a.sessionSeq - b.sessionSeq);
    expect(day).toHaveLength(2);
    expect(day.every((s) => s.dateHasMultipleSessions)).toBe(true);
    expect(day[0].sessionSeq).toBe(0);
    expect(day[0].timeRange).toBe("10:00 AM–10:00 AM");
    expect(day[1].timeRange).toBe("5:00 PM–5:00 PM");
  });
});
```

Create `tests/lib/ui/show-label.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { showSessionLabel } from "@/lib/ui/show-label";

describe("showSessionLabel", () => {
  it("returns just the date for a single-session day", () => {
    expect(showSessionLabel({ showDate: "2026-06-12", sessionSeq: 0, timeRange: "10:00 AM–11:00 AM", dateHasMultipleSessions: false }))
      .toBe("2026-06-12");
  });
  it("adds Show number and time range for a multi-session day", () => {
    expect(showSessionLabel({ showDate: "2026-06-12", sessionSeq: 1, timeRange: "5:02 PM–7:30 PM", dateHasMultipleSessions: true }))
      .toBe("2026-06-12 · Show 2 · 5:02 PM–7:30 PM");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/ui/show-label.test.ts tests/lib/calc/ledger-report.test.ts -t "sessions"`
Expected: FAIL — `@/lib/ui/show-label` missing; `sessionSeq`/`timeRange` undefined.

- [ ] **Step 3: Extend `ReportShow` and populate the fields**

In `src/lib/calc/ledger-report.ts`, add the import:

```typescript
import { secondsToClock } from "./sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";
```

Add the three fields to the `ReportShow` interface:

```typescript
  sessionSeq: number;
  timeRange: string;
  dateHasMultipleSessions: boolean;
```

Before the `for (const s of listShows(db))` loop, build a per-date session count:

```typescript
  const allShows = listShows(db);
  const dateCounts = new Map<string, number>();
  for (const s of allShows) dateCounts.set(s.showDate, (dateCounts.get(s.showDate) ?? 0) + 1);
```

Change the loop header from `for (const s of listShows(db))` to `for (const s of allShows)`.

When constructing each pushed show object, compute the time range from its transactions (`rows` is the show's transactions in the loop) and add the fields:

```typescript
    const times = rows.map((t) => ledgerTimeOfDaySeconds(t.createdAt));
    const timeRange = times.length
      ? `${secondsToClock(Math.min(...times))}–${secondsToClock(Math.max(...times))}`
      : "";
```

Then add to the `shows.push({ ... })` object:

```typescript
      sessionSeq: s.sessionSeq,
      timeRange,
      dateHasMultipleSessions: (dateCounts.get(s.showDate) ?? 0) > 1,
```

- [ ] **Step 4: Create `src/lib/ui/show-label.ts`**

```typescript
/** Human label for a show: just the date, or "<date> · Show N · <time range>" when
 *  the date has more than one session. */
export function showSessionLabel(s: {
  showDate: string;
  sessionSeq: number;
  timeRange: string;
  dateHasMultipleSessions: boolean;
}): string {
  if (!s.dateHasMultipleSessions) return s.showDate;
  return `${s.showDate} · Show ${s.sessionSeq + 1} · ${s.timeRange}`;
}
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `npx vitest run tests/lib/ui/show-label.test.ts tests/lib/calc/ledger-report.test.ts -t "sessions"`
Expected: PASS.

- [ ] **Step 6: Use the label on the report page**

In `src/app/report/page.tsx`, add the import:

```tsx
import { showSessionLabel } from "@/lib/ui/show-label";
```

Change the card title's date `<span>{s.showDate}</span>` to:

```tsx
<span>{showSessionLabel(s)}</span>
```

- [ ] **Step 7: Use the label on the show detail page**

In `src/app/shows/[id]/page.tsx`, add the import:

```tsx
import { showSessionLabel } from "@/lib/ui/show-label";
```

Change the page header from `title={`Show ${show.showDate}`}` to:

```tsx
title={`Show — ${showSessionLabel(show)}`}
```

- [ ] **Step 8: Use the label on the dashboard**

In `src/app/page.tsx`, add the import:

```tsx
import { showSessionLabel } from "@/lib/ui/show-label";
```

Change the chart points (line ~22) so multi-session days are distinguishable:

```tsx
  const points = shows.map((s) => ({
    label: s.dateHasMultipleSessions ? `${s.showDate} #${s.sessionSeq + 1}` : s.showDate,
    valueCents: s.netCents,
  }));
```

Change the breakdown table link text (the `{s.showDate}` inside the `<Link>`, line ~64) to:

```tsx
                  {showSessionLabel(s)}
```

- [ ] **Step 9: Verify build + full suite**

Run: `npx tsc --noEmit`
Expected: no NEW errors (a known pre-existing error in `tests/lib/db/giveaway-items.test.ts` may remain).

Run: `npx vitest run`
Expected: PASS (all).

- [ ] **Step 10: Manual verification**

Start `npm run dev`. Import a ledger that has a day with two streams (or rely on a backfilled DB). Confirm:
1. `/report` and the dashboard list two cards/rows for that date, labeled `… · Show 1 · …` and `… · Show 2 · …`.
2. Each show's payout/COGS/net are split correctly; single-stream days look unchanged.
3. Opening each show (`/shows/<id>`) shows the session label in the header and its own giveaways/bundles.

- [ ] **Step 11: Commit**

```bash
git add src/lib/calc/ledger-report.ts src/lib/ui/show-label.ts "src/app/report/page.tsx" "src/app/shows/[id]/page.tsx" "src/app/page.tsx" tests/lib/calc/ledger-report.test.ts tests/lib/ui/show-label.test.ts
git commit -m "feat(sessions): session labels on report, show, and dashboard"
```

---

## Self-Review Notes

- **Spec coverage:** gap rule + constant (T1), `session_seq` identity + ordering (T2), import-time regrouping with create/reuse/delete + payout recompute (T3), one-time backfill (T4), `ReportShow` fields + labels on all three pages (T5). Time parser timezone-safe (T1). Bundles unaffected (key off txn id — no task needed). Legacy non-ledger shows untouched (regroup filters `source_hash='ledger'`). The spec's `LedgerRow.timeSeconds` is intentionally omitted (documented above) as it would be dead code.
- **Type consistency:** `sessionizeByGap`/`secondsToClock`/`SESSION_GAP_MINUTES` (T1) reused in T3/T5; `ledgerTimeOfDaySeconds` (T1) reused in T3/T5; `ShowRow.sessionSeq` (T2) consumed by `regroupLedgerShows` ordering (T3) and `buildLedgerReport` (T5); `regroupLedgerShows` (T3) consumed by `backfillSessions` (T4); `ReportShow.{sessionSeq,timeRange,dateHasMultipleSessions}` (T5) consumed by `showSessionLabel` (T5) and the pages.
- **No placeholders:** every step contains full code and exact commands.
```

---

## Post-implementation revision (2026-06-23): sessions driven by sales

Live testing revealed stray non-sale ledger rows (early-morning fees, a midday bank withdrawal)
were spawning phantom shows. Fix: session boundaries are computed from **sale-kind transactions
only**; non-sale rows attach to the containing/nearest session. `src/lib/calc/sessions.ts` gains
`assignSessions(items, gapSeconds)` and `regroupLedgerShows` uses it. See the updated spec's Key
Design Decision #1 and the `sessions.ts` / `regroupLedgerShows` component notes.
