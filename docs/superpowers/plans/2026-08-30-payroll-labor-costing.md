# Payroll as a Show Cost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each show's net profit subtract the wages paid for the day it ran, and log payroll as a shift (date + clock-in + clock-out) instead of a pay period.

**Architecture:** Two pure functions — `shiftHours` (clock arithmetic) and `allocateLabor` (wages → shows) — feed `buildLedgerReport`, which subtracts labor in its existing `netCents` line. Nothing is stored per show; labor resolves live at report time exactly as COGS already resolves through the alias map. `payroll_entries` is reshaped from `period_start`/`period_end` to `work_date`/`start_time`/`end_time`.

**Tech Stack:** Next.js 15.5 App Router, React 19, better-sqlite3 (SQLite 3.53.1), TypeScript, Vitest 4, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-30-payroll-labor-costing-design.md`

## Global Constraints

- All money is **integer cents**. Never floats. `hours` is the only real number.
- Times are `'HH:MM'`, 24-hour. Dates are `'YYYY-MM-DD'`.
- An end time **strictly before** the start means the shift crossed midnight and belongs to the **start date**. An end time **equal** to the start is **0 hours**, not 24 — the API rejects it.
- A day's wages split **evenly** across that day's shows; the remainder cent goes to the **lowest `session_seq`**.
- Wages on a date with no show are reported as `unallocatedLaborCents` and **never subtracted from any net**.
- Every API route calls `dbForRequest()`. `middleware.ts` only checks that a cookie exists, so per-route auth is the real gate.
- Do **not** touch `splitProfit`, `ownerSharePct`, or the Owner/Partner cards. Retiring the 80/20 split is the next spec. Show nets will drop once labor lands; that is expected.
- Run `npm test` (not `npx vitest`) — it is `vitest run`.

---

### Task 1: `shiftHours` — clock arithmetic

**Files:**
- Modify: `src/lib/calc/payroll-amount.ts`
- Test: `tests/lib/calc/shift-hours.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `shiftHours(start: string, end: string): number | null` — hours as a float, `null` when either time is malformed. Existing `payrollAmountCents(hours, rateCents)` is unchanged and stays in this file.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/shift-hours.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shiftHours } from "@/lib/calc/payroll-amount";

describe("shiftHours", () => {
  it("measures a same-day shift", () => {
    expect(shiftHours("09:00", "17:30")).toBe(8.5);
    expect(shiftHours("9:00", "10:00")).toBe(1); // single-digit hour accepted
  });

  it("reads an end before the start as crossing midnight", () => {
    expect(shiftHours("20:00", "01:00")).toBe(5);
    expect(shiftHours("23:45", "00:15")).toBe(0.5);
  });

  it("treats equal start and end as zero, not a full day", () => {
    expect(shiftHours("12:00", "12:00")).toBe(0);
  });

  it("returns null for malformed times", () => {
    expect(shiftHours("", "10:00")).toBeNull();
    expect(shiftHours("abc", "10:00")).toBeNull();
    expect(shiftHours("25:00", "10:00")).toBeNull();
    expect(shiftHours("10:60", "11:00")).toBeNull();
    expect(shiftHours("10:00", "")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/shift-hours.test.ts`
Expected: FAIL — `shiftHours is not a function` / no export named `shiftHours`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/calc/payroll-amount.ts` (keep the existing `payrollAmountCents` exactly as it is):

```ts
/** Minutes since midnight for an 'HH:MM' clock string; null if malformed. */
function clockMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Hours worked between two 'HH:MM' clock times. An end BEFORE the start means
 *  the shift crossed midnight (+24h) and still belongs to the start date. An end
 *  EQUAL to the start is 0, not 24 — a zero-length shift is a typo, and reading
 *  it as a full day would silently invent a day's wages. null when either time
 *  is malformed; callers reject rather than guess. */
export function shiftHours(start: string, end: string): number | null {
  const s = clockMinutes(start), e = clockMinutes(end);
  if (s == null || e == null) return null;
  if (e === s) return 0;
  const span = e > s ? e - s : e + 1440 - s;
  return span / 60;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/shift-hours.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/payroll-amount.ts tests/lib/calc/shift-hours.test.ts
git commit -m "Add shiftHours: clock-in/clock-out to hours, past midnight aware"
```

---

### Task 2: `allocateLabor` — wages onto shows

**Files:**
- Create: `src/lib/calc/labor-allocation.ts`
- Test: `tests/lib/calc/labor-allocation.test.ts`

**Interfaces:**
- Consumes: nothing (pure; takes plain arrays, no DB).
- Produces:
  - `interface LaborEntry { workDate: string; amountCents: number }`
  - `interface LaborShow { id: number; showDate: string; sessionSeq: number }`
  - `interface LaborAllocation { byShowId: Map<number, number>; unallocatedCents: number }`
  - `allocateLabor(entries: LaborEntry[], shows: LaborShow[]): LaborAllocation`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/labor-allocation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { allocateLabor } from "@/lib/calc/labor-allocation";

const show = (id: number, showDate: string, sessionSeq = 0) => ({ id, showDate, sessionSeq });

describe("allocateLabor", () => {
  it("charges a day's wages to that day's only show", () => {
    const a = allocateLabor([{ workDate: "2026-07-08", amountCents: 7500 }], [show(1, "2026-07-08")]);
    expect(a.byShowId.get(1)).toBe(7500);
    expect(a.unallocatedCents).toBe(0);
  });

  it("splits evenly across same-day sessions", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 20000 }],
      [show(1, "2026-07-08", 0), show(2, "2026-07-08", 1)],
    );
    expect(a.byShowId.get(1)).toBe(10000);
    expect(a.byShowId.get(2)).toBe(10000);
  });

  it("gives the remainder cent to the lowest session_seq", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 101 }],
      [show(2, "2026-07-08", 1), show(1, "2026-07-08", 0)], // deliberately out of order
    );
    expect(a.byShowId.get(1)).toBe(51);
    expect(a.byShowId.get(2)).toBe(50);
    expect(a.byShowId.get(1)! + a.byShowId.get(2)!).toBe(101); // no cent lost
  });

  it("sums every person working that date before splitting", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 6000 }, { workDate: "2026-07-08", amountCents: 4000 }],
      [show(1, "2026-07-08", 0), show(2, "2026-07-08", 1)],
    );
    expect(a.byShowId.get(1)).toBe(5000);
    expect(a.byShowId.get(2)).toBe(5000);
  });

  it("reports wages on a date with no show as unallocated", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-09", amountCents: 3000 }],
      [show(1, "2026-07-08")],
    );
    expect(a.byShowId.size).toBe(0);
    expect(a.unallocatedCents).toBe(3000);
  });

  it("handles empty input", () => {
    const a = allocateLabor([], []);
    expect(a.byShowId.size).toBe(0);
    expect(a.unallocatedCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/labor-allocation.test.ts`
Expected: FAIL — cannot resolve `@/lib/calc/labor-allocation`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/calc/labor-allocation.ts`:

```ts
export interface LaborEntry {
  workDate: string;      // 'YYYY-MM-DD'
  amountCents: number;
}

export interface LaborShow {
  id: number;
  showDate: string;      // 'YYYY-MM-DD'
  sessionSeq: number;
}

export interface LaborAllocation {
  byShowId: Map<number, number>;  // show id -> labor cents charged to it
  unallocatedCents: number;       // wages on dates with no show; NOT in any net
}

/** Charge each day's wages to the shows that ran that day, split evenly across
 *  same-day sessions. The remainder cent goes to the lowest session_seq so the
 *  parts always sum back to the total — same reasoning as splitProfit giving
 *  the floor to one side. Wages on a date with no show can't belong to a net,
 *  so they're reported separately rather than dropped. */
export function allocateLabor(entries: LaborEntry[], shows: LaborShow[]): LaborAllocation {
  const totalByDate = new Map<string, number>();
  for (const e of entries) {
    totalByDate.set(e.workDate, (totalByDate.get(e.workDate) ?? 0) + e.amountCents);
  }

  const showsByDate = new Map<string, LaborShow[]>();
  for (const s of shows) {
    if (!showsByDate.has(s.showDate)) showsByDate.set(s.showDate, []);
    showsByDate.get(s.showDate)!.push(s);
  }

  const byShowId = new Map<number, number>();
  let unallocatedCents = 0;

  for (const [date, total] of totalByDate) {
    const day = showsByDate.get(date);
    if (!day || day.length === 0) {
      unallocatedCents += total;
      continue;
    }
    const ordered = [...day].sort((a, b) => a.sessionSeq - b.sessionSeq);
    const base = Math.floor(total / ordered.length);
    const remainder = total - base * ordered.length;
    ordered.forEach((s, i) => {
      byShowId.set(s.id, (byShowId.get(s.id) ?? 0) + base + (i === 0 ? remainder : 0));
    });
  }

  return { byShowId, unallocatedCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/labor-allocation.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/labor-allocation.ts tests/lib/calc/labor-allocation.test.ts
git commit -m "Add allocateLabor: charge a day's wages to that day's shows"
```

---

### Task 3: Reshape `payroll_entries` to a shift

**Files:**
- Modify: `src/lib/db/schema.ts:186-195` (the `payroll_entries` block)
- Modify: `src/lib/db/connection.ts` (add `migratePayrollShifts`, call it from `migrate()`)
- Modify: `src/lib/db/payroll.ts` (whole file — columns change)
- Test: `tests/lib/db/payroll.test.ts` (rewrite — the old one uses `periodStart`/`periodEnd`)
- Test: `tests/lib/db/payroll-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces:
  - `interface PayrollRow { id: number; person: string; workDate: string; startTime: string; endTime: string; hours: number; rateCents: number; amountCents: number; note: string | null }`
  - `insertPayroll(db, e: PayrollInput): number` where `PayrollInput = Omit<PayrollRow, "id">`
  - `updatePayroll(db, id: number, e: PayrollInput): void`
  - `listPayroll(db, range?: PayrollDateRange): PayrollRow[]`
  - `getPayroll(db, id): PayrollRow | null`, `deletePayroll(db, id): void`
  - `totalPayrollCents(db, range?)`, `payrollByPerson(db, range?)` — unchanged signatures
  - `export const PAYROLL_SCHEMA: string` from `schema.ts`

- [ ] **Step 1: Write the failing tests**

Replace `tests/lib/db/payroll.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, payrollByPerson } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const shift = (over: Partial<Parameters<typeof insertPayroll>[1]> = {}) => ({
  person: "Sam", workDate: "2026-07-08", startTime: "18:00", endTime: "23:00",
  hours: 5, rateCents: 1500, amountCents: 7500, note: null, ...over,
});

describe("payroll DB layer", () => {
  it("inserts and reads back a shift", () => {
    const id = insertPayroll(db, shift({ note: "evening" }));
    expect(getPayroll(db, id)).toMatchObject({
      person: "Sam", workDate: "2026-07-08", startTime: "18:00", endTime: "23:00",
      hours: 5, rateCents: 1500, amountCents: 7500, note: "evening",
    });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, shift());
    updatePayroll(db, id, shift({ person: "Alex", hours: 6, amountCents: 9000, endTime: "00:00" }));
    expect(getPayroll(db, id)).toMatchObject({ person: "Alex", hours: 6, amountCents: 9000 });
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("filters, totals, and groups by work_date", () => {
    insertPayroll(db, shift({ workDate: "2026-07-01", amountCents: 40500 }));
    insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 45000 }));
    insertPayroll(db, shift({ person: "Alex", workDate: "2026-07-08", amountCents: 50000 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 15000 }));

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    // payrollByPerson orders by totalCents DESC, then person ASC.
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Sam", totalCents: 85500 },
      { person: "Alex", totalCents: 50000 },
    ]);
    expect(totalPayrollCents(db)).toBe(40500 + 45000 + 50000 + 15000);
  });
});
```

Create `tests/lib/db/payroll-migration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/connection";

/** Build a DB carrying the pre-shift payroll_entries shape. */
function oldShapeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE payroll_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
    period_start TEXT, period_end TEXT, hours REAL, rate_cents INTEGER,
    amount_cents INTEGER NOT NULL, note TEXT)`);
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("payroll shift migration", () => {
  it("recreates an empty old-shape table with the new columns", () => {
    const db = oldShapeDb();
    migrate(db);
    const cols = columns(db, "payroll_entries");
    expect(cols).toContain("work_date");
    expect(cols).toContain("start_time");
    expect(cols).toContain("end_time");
    expect(cols).not.toContain("period_start");
    expect(columns(db, "payroll_entries_legacy")).toHaveLength(0); // no legacy table made
  });

  it("preserves rows by renaming aside rather than dropping them", () => {
    const db = oldShapeDb();
    db.prepare("INSERT INTO payroll_entries (person, period_start, amount_cents) VALUES ('Sam','2026-07-08',7500)").run();
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("work_date");
    const kept = db.prepare("SELECT person, amount_cents AS amountCents FROM payroll_entries_legacy").all();
    expect(kept).toEqual([{ person: "Sam", amountCents: 7500 }]);
  });

  it("is idempotent", () => {
    const db = oldShapeDb();
    migrate(db);
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("work_date");
  });
});
```

`migrate()` touches many tables; on this bare DB the other `PRAGMA table_info` calls return empty and the guarded blocks no-op. If any statement throws on a missing table, wrap only the payroll assertions' prerequisites by creating that table too — do **not** weaken the migration.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/db/payroll.test.ts tests/lib/db/payroll-migration.test.ts`
Expected: FAIL — `workDate` undefined on `PayrollRow`; no `work_date` column.

- [ ] **Step 3a: Reshape the schema**

In `src/lib/db/schema.ts`, replace the `payroll_entries` block (currently lines 186–195) and export it so the migration reuses the same DDL:

```ts
export const PAYROLL_SCHEMA = `
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hours REAL NOT NULL,
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_work_date ON payroll_entries(work_date);
`;
```

Then interpolate `${PAYROLL_SCHEMA}` into the existing `SCHEMA` template literal at the point where the old `CREATE TABLE payroll_entries` sat, so fresh databases still get it.

- [ ] **Step 3b: Add the migration**

In `src/lib/db/connection.ts`, import `PAYROLL_SCHEMA` from `./schema`, add this function, and call `migratePayrollShifts(db);` from `migrate()` immediately before the `DROP TABLE IF EXISTS brother_transactions` line:

```ts
/** One-time, idempotent: payroll_entries moved from a pay period
 *  (period_start/period_end) to a single worked shift (work_date +
 *  start_time/end_time). The new hours/start/end columns are NOT NULL with no
 *  sensible default, so the table is recreated rather than ALTERed.
 *
 *  No workspace held payroll rows when this shipped, but a table that
 *  unexpectedly has some is renamed aside instead of dropped — losing wage
 *  history to a migration is far worse than leaving a stray table on disk.
 *  Guarded on the old column, so it runs exactly once. */
export function migratePayrollShifts(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(payroll_entries)").all() as { name: string }[]).map((c) => c.name);
  if (cols.length === 0 || !cols.includes("period_start")) return; // fresh schema, or already migrated
  const n = (db.prepare("SELECT COUNT(*) n FROM payroll_entries").get() as { n: number }).n;
  db.transaction(() => {
    if (n === 0) db.exec("DROP TABLE payroll_entries");
    else db.exec("ALTER TABLE payroll_entries RENAME TO payroll_entries_legacy");
    db.exec(PAYROLL_SCHEMA);
  })();
}
```

Ordering matters: `createDb` runs `db.exec(SCHEMA)` before `migrate(db)`. On an old database the `CREATE TABLE IF NOT EXISTS` is a no-op because the table already exists with the old shape, so the migration is what actually converts it.

- [ ] **Step 3c: Rewrite the payroll DB layer**

Replace `src/lib/db/payroll.ts`:

```ts
import type { DB } from "./connection";

export interface PayrollRow {
  id: number; person: string; workDate: string;
  startTime: string; endTime: string;
  hours: number; rateCents: number; amountCents: number; note: string | null;
}

export type PayrollInput = Omit<PayrollRow, "id">;
export type PayrollDateRange = { from?: string; to?: string };

/** Filter on the day the shift was worked. */
function rangeClause(range?: PayrollDateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const parts: string[] = [];
  const args: string[] = [];
  if (range.from) { parts.push("work_date >= ?"); args.push(range.from); }
  if (range.to) { parts.push("work_date <= ?"); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

const COLS = `id, person, work_date AS workDate, start_time AS startTime,
  end_time AS endTime, hours, rate_cents AS rateCents,
  amount_cents AS amountCents, note`;

export function insertPayroll(db: DB, e: PayrollInput): number {
  const info = db.prepare(`INSERT INTO payroll_entries
    (person, work_date, start_time, end_time, hours, rate_cents, amount_cents, note)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      e.person.trim(), e.workDate, e.startTime, e.endTime,
      e.hours, e.rateCents, e.amountCents, e.note?.trim() || null);
  return Number(info.lastInsertRowid);
}

export function listPayroll(db: DB, range?: PayrollDateRange): PayrollRow[] {
  const { sql, args } = rangeClause(range);
  return db.prepare(`SELECT ${COLS} FROM payroll_entries${sql}
    ORDER BY work_date DESC, start_time DESC, id DESC`).all(...args) as PayrollRow[];
}

export function getPayroll(db: DB, id: number): PayrollRow | null {
  const r = db.prepare(`SELECT ${COLS} FROM payroll_entries WHERE id = ?`).get(id) as PayrollRow | undefined;
  return r ?? null;
}

export function updatePayroll(db: DB, id: number, e: PayrollInput): void {
  db.prepare(`UPDATE payroll_entries SET person=?, work_date=?, start_time=?, end_time=?,
    hours=?, rate_cents=?, amount_cents=?, note=? WHERE id=?`).run(
      e.person.trim(), e.workDate, e.startTime, e.endTime,
      e.hours, e.rateCents, e.amountCents, e.note?.trim() || null, id);
}

export function deletePayroll(db: DB, id: number): void {
  db.prepare("DELETE FROM payroll_entries WHERE id = ?").run(id);
}

export function totalPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

export function payrollByPerson(db: DB, range?: PayrollDateRange): { person: string; totalCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT person, COALESCE(SUM(amount_cents),0) AS totalCents FROM payroll_entries${sql}
     GROUP BY person ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents) }));
}
```

The old `rangeClause` used `COALESCE(period_end, period_start)` and an `IS NOT NULL` guard. `work_date` is `NOT NULL`, so both are gone.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. The whole suite must be green — `src/app/payroll/page.tsx` and `PayrollForm` still reference the old fields, so **fix any typecheck fallout now** by having them pass the new field names; full UI work lands in Task 6.

Also run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/payroll.ts tests/lib/db/payroll.test.ts tests/lib/db/payroll-migration.test.ts
git commit -m "Reshape payroll_entries from pay period to worked shift"
```

---

### Task 4: Subtract labor in the report and dashboard

**Files:**
- Modify: `src/lib/calc/ledger-report.ts` (`ReportShow` interface, `LedgerReport.totals` type, `buildLedgerReport`)
- Modify: `src/lib/calc/dashboard.ts` (`DashboardSummary`, `dashboardSummary`)
- Modify: `docs/calculations.md`
- Test: `tests/lib/calc/ledger-report-labor.test.ts` (create)

**Interfaces:**
- Consumes: `allocateLabor`, `LaborEntry`, `LaborShow` (Task 2); `listPayroll`, `PayrollRow` (Task 3).
- Produces: `ReportShow.laborCents: number`; `LedgerReport.totals.laborCents` and `.unallocatedLaborCents`; `DashboardSummary.totalLaborCents` and `.unallocatedLaborCents`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/ledger-report-labor.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { insertPayroll } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

/** A show with a known payout and no COGS/giveaways, so net is easy to reason about. */
function showOn(date: string, payoutCents: number, sessionSeq = 0): number {
  const info = db.prepare(
    `INSERT INTO shows (show_date, payout_cents, shipping_supplies_cents, giveaway_count, session_seq)
     VALUES (?,?,0,0,?)`
  ).run(date, payoutCents, sessionSeq);
  return Number(info.lastInsertRowid);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/ledger-report-labor.test.ts`
Expected: FAIL — `laborCents` is `undefined`; `netCents` still 100000 in the first test.

- [ ] **Step 3a: Wire labor into the report**

In `src/lib/calc/ledger-report.ts`:

Add imports at the top:

```ts
import { allocateLabor } from "./labor-allocation";
import { listPayroll } from "@/lib/db/payroll";
```

Add to the `ReportShow` interface, directly after `shippingSuppliesCents: number;`:

```ts
  laborCents: number;             // wages for the day this show ran, split across its sessions
```

Add to the `LedgerReport` `totals` type, after `shippingSuppliesCents: number;`:

```ts
    laborCents: number;
    unallocatedLaborCents: number;   // wages on dates with no show; NOT inside netCents
```

Inside `buildLedgerReport`, immediately after the existing `const allShows = listShows(db);` line, add:

```ts
  // Labor resolves live at report time, like COGS through the alias map —
  // nothing is stored per show, so editing a shift reflows every report.
  const labor = allocateLabor(
    listPayroll(db).map((p) => ({ workDate: p.workDate, amountCents: p.amountCents })),
    allShows.map((s) => ({ id: s.id, showDate: s.showDate, sessionSeq: s.sessionSeq })),
  );
```

Inside the `for (const s of allShows)` loop, replace the `netCents` line (currently `ledger-report.ts:202`):

```ts
    const laborCents = labor.byShowId.get(s.id) ?? 0;
    const netCents = payout - cogsCents - giveawayCostCents - s.shippingSuppliesCents - laborCents;
```

In the `shows.push({ ... })` call, add `laborCents` to the line that currently reads
`payoutCents: payout, withdrawnToBankCents: withdrawn, cogsCents, shippingSuppliesCents: s.shippingSuppliesCents, netCents, unitsSold, saleCount,`
so it becomes:

```ts
      payoutCents: payout, withdrawnToBankCents: withdrawn, cogsCents, shippingSuppliesCents: s.shippingSuppliesCents, laborCents, netCents, unitsSold, saleCount,
```

In the totals section, beside the existing `const shippingSuppliesCents = shows.reduce(...)`:

```ts
  const laborCents = shows.reduce((sum, s) => sum + s.laborCents, 0);
```

And in the returned `totals` object, add both fields:

```ts
    totals: { revenueCents, cogsCents, giveawayCostCents, shippingSuppliesCents, laborCents, unallocatedLaborCents: labor.unallocatedCents, netCents, ownerShareCents, partnerShareCents, withdrawnToBankCents, unitsSold },
```

Do **not** subtract `labor.unallocatedCents` from `netCents`. It belongs to no show; subtracting it would contradict the design.

- [ ] **Step 3b: Surface it on the dashboard**

In `src/lib/calc/dashboard.ts`, add to `DashboardSummary`:

```ts
  totalLaborCents: number;
  unallocatedLaborCents: number;
```

and to the object returned by `dashboardSummary`:

```ts
    totalLaborCents: report.totals.laborCents,
    unallocatedLaborCents: report.totals.unallocatedLaborCents,
```

- [ ] **Step 3c: Document the new subtraction**

In `docs/calculations.md`, update the "Per-show net profit" formula to:

```
net = payout − COGS − giveawayMerchCost − shippingSupplies − labor
```

and add a bullet below the `shippingSupplies` one:

```markdown
- **labor** = wages recorded for the show's date, split evenly across that date's
  sessions (remainder cent to the earliest session). Resolved **live** from
  `payroll_entries` at report time, like COGS. Wages on a date with **no** show
  cannot belong to a net; they are reported separately as **unallocated labor**
  and are not subtracted anywhere.
```

Add a row to the Dashboard cards table:

```markdown
| **Total wages** | Σ of payroll amounts charged to shows. Unallocated wages are reported separately. |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all files. Existing report tests that assert `netCents` still pass because no fixture has payroll rows — labor is 0 for them. If one fails, the fixture gained wages unintentionally; investigate rather than adjusting the expectation.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts src/lib/calc/dashboard.ts docs/calculations.md tests/lib/calc/ledger-report-labor.test.ts
git commit -m "Subtract a day's wages from that day's show net"
```

---

### Task 5: API — validate shifts, derive amounts server-side, allow edits

**Files:**
- Modify: `src/lib/calc/payroll-amount.ts` (add `parseShiftInput`)
- Modify: `src/app/api/payroll/route.ts`
- Modify: `src/app/api/payroll/[id]/route.ts`
- Test: `tests/api/payroll-api.test.ts` (create)

**Interfaces:**
- Consumes: `shiftHours`, `payrollAmountCents` (Task 1); `insertPayroll`, `updatePayroll`, `getPayroll`, `listPayroll`, `PayrollInput` (Task 3); `rangeFromParams` from `@/lib/ui/expense-range`.
- Produces: `parseShiftInput(b: Record<string, unknown>): { ok: true; value: PayrollInput } | { ok: false; error: string }`; `PATCH` on `/api/payroll/[id]`.

- [ ] **Step 1: Write the failing test**

Create `tests/api/payroll-api.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { listPayroll } from "@/lib/db/payroll";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { POST } = await import("@/app/api/payroll/route");
const { PATCH } = await import("@/app/api/payroll/[id]/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const body = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-07-08", startTime: "20:00", endTime: "01:00",
  rateCents: 1500, note: null, ...over,
});

const post = (b: Record<string, unknown>) =>
  POST(new NextRequest("http://test/api/payroll", { method: "POST", body: JSON.stringify(b) }));

const patch = (id: number, b: Record<string, unknown>) =>
  PATCH(new NextRequest(`http://test/api/payroll/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
        { params: Promise.resolve({ id: String(id) }) });

describe("POST /api/payroll", () => {
  it("derives hours and amount from the clock times", async () => {
    const res = await post(body());
    expect(res.status).toBe(200);

    const [row] = listPayroll(db);
    expect(row.hours).toBe(5);            // 20:00 -> 01:00 crosses midnight
    expect(row.amountCents).toBe(7500);   // 5h * $15
    expect(row.workDate).toBe("2026-07-08");
  });

  it("ignores a client-supplied amount and recomputes it", async () => {
    await post(body({ amountCents: 999999, hours: 99 }));
    const [row] = listPayroll(db);
    expect(row.amountCents).toBe(7500);
    expect(row.hours).toBe(5);
  });

  it("rejects equal start and end rather than reading it as 24 hours", async () => {
    const res = await post(body({ startTime: "12:00", endTime: "12:00" }));
    expect(res.status).toBe(400);
    expect(listPayroll(db)).toHaveLength(0);
  });

  it("rejects malformed times, a missing person, and a non-positive rate", async () => {
    expect((await post(body({ endTime: "nope" }))).status).toBe(400);
    expect((await post(body({ person: "   " }))).status).toBe(400);
    expect((await post(body({ rateCents: 0 }))).status).toBe(400);
    expect((await post(body({ workDate: "07/08/2026" }))).status).toBe(400);
    expect(listPayroll(db)).toHaveLength(0);
  });
});

describe("PATCH /api/payroll/[id]", () => {
  it("updates a shift and re-derives hours and amount", async () => {
    await post(body());
    const id = listPayroll(db)[0].id;

    const res = await patch(id, body({ startTime: "18:00", endTime: "23:00", rateCents: 2000 }));
    expect(res.status).toBe(200);

    const [row] = listPayroll(db);
    expect(row.hours).toBe(5);
    expect(row.amountCents).toBe(10000);
  });

  it("404s an unknown id and validates like POST", async () => {
    expect((await patch(999, body())).status).toBe(404);
    await post(body());
    const id = listPayroll(db)[0].id;
    expect((await patch(id, body({ rateCents: -5 }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/payroll-api.test.ts`
Expected: FAIL — no `PATCH` export; POST still reads `hours`/`amountCents` from the body.

- [ ] **Step 3a: Add shared validation**

Append to `src/lib/calc/payroll-amount.ts`:

```ts
import type { PayrollInput } from "@/lib/db/payroll";

export type ShiftParse =
  | { ok: true; value: PayrollInput }
  | { ok: false; error: string };

/** Validate a shift payload and DERIVE hours and amount from it. The client
 *  never gets to assert the amount — that's what let the old form silently
 *  save $0 entries. */
export function parseShiftInput(b: Record<string, unknown>): ShiftParse {
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return { ok: false, error: "Person is required" };

  const workDate = typeof b.workDate === "string" ? b.workDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "Work date must be YYYY-MM-DD" };

  const startTime = typeof b.startTime === "string" ? b.startTime.trim() : "";
  const endTime = typeof b.endTime === "string" ? b.endTime.trim() : "";
  const hours = shiftHours(startTime, endTime);
  if (hours == null) return { ok: false, error: "Start and end must be times like 20:00" };
  if (hours <= 0) return { ok: false, error: "Start and end time cannot be the same" };

  const rateCents = Math.trunc(Number(b.rateCents));
  if (!Number.isFinite(rateCents) || rateCents <= 0) return { ok: false, error: "Rate must be greater than zero" };

  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  return {
    ok: true,
    value: { person, workDate, startTime, endTime, hours, rateCents, amountCents: payrollAmountCents(hours, rateCents), note },
  };
}
```

- [ ] **Step 3b: Rewrite the collection route**

Replace `src/app/api/payroll/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";
import { parseShiftInput } from "@/lib/calc/payroll-amount";
import { rangeFromParams } from "@/lib/ui/expense-range";

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(listPayroll(await dbForRequest(), rangeFromParams(sp)));
}

export async function POST(req: NextRequest) {
  const parsed = parseShiftInput(await req.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const id = insertPayroll(await dbForRequest(), parsed.value);
  return NextResponse.json({ id });
}
```

- [ ] **Step 3c: Add PATCH**

Replace `src/app/api/payroll/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { deletePayroll, getPayroll, updatePayroll } from "@/lib/db/payroll";
import { parseShiftInput } from "@/lib/calc/payroll-amount";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const parsed = parseShiftInput(await req.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const db = await dbForRequest();
  if (!getPayroll(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  updatePayroll(db, id, parsed.value);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deletePayroll(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
```

Both routes go through `dbForRequest()`, which is the actual auth gate — `middleware.ts` only checks that a cookie exists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` then `npx tsc --noEmit`
Expected: PASS; no typecheck output.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/payroll-amount.ts src/app/api/payroll/route.ts "src/app/api/payroll/[id]/route.ts" tests/api/payroll-api.test.ts
git commit -m "Payroll API: validate shifts, derive amount server-side, add PATCH"
```

---

### Task 6: UI — shift form, editable table, nav link, labor on show detail

**Files:**
- Modify: `src/components/payroll/PayrollForm.tsx`
- Modify: `src/components/payroll/PayrollTable.tsx`
- Modify: `src/app/payroll/page.tsx`
- Modify: `src/components/Nav.tsx:6`
- Modify: `src/app/shows/[id]/page.tsx:37-40`
- Modify: `src/app/report/page.tsx:60`

**Interfaces:**
- Consumes: `shiftHours`, `payrollAmountCents` (Task 1); `PayrollRow` (Task 3); `ReportShow.laborCents` (Task 4); `POST`/`PATCH`/`DELETE /api/payroll` (Task 5).
- Produces: no new exports.

- [ ] **Step 1: Add the nav link**

In `src/components/Nav.tsx`, change `baseLinks` (line 6) to include Payroll between Expenses and Report:

```ts
const baseLinks: [string, string][] = [
  ["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"],
  ["/invoices", "Invoices"], ["/expenses", "Expenses"], ["/payroll", "Payroll"],
  ["/report", "Report"], ["/settings", "Settings"],
];
```

- [ ] **Step 2: Show labor on the show detail page**

In `src/app/shows/[id]/page.tsx`, the rows array currently runs:

```tsx
    ["COGS (items sold)", <Money cents={-show.cogsCents} />],
    [giveawayLabel, <Money cents={-show.giveawayCostCents} />],
    ["Shipping supplies", <Money cents={-show.shippingSuppliesCents} />],
    ["Net profit", <Money cents={show.netCents} />],
```

Insert a labor row between shipping supplies and net profit:

```tsx
    ["Shipping supplies", <Money cents={-show.shippingSuppliesCents} />],
    ["Labor (wages this day)", <Money cents={-show.laborCents} />],
    ["Net profit", <Money cents={show.netCents} />],
```

In `src/app/report/page.tsx`, extend the per-show meta line (currently ending
`· Shipping <Money cents={s.shippingSuppliesCents} />` on line 60):

```tsx
            Other <Money cents={s.otherTotalCents} /> · Shipping <Money cents={s.shippingSuppliesCents} /> · Labor <Money cents={s.laborCents} />
```

- [ ] **Step 3: Rewrite the form as a shift entry**

Replace `src/components/payroll/PayrollForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";

export function PayrollForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ person: "", workDate: today, startTime: "", endTime: "", rate: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const hours = f.startTime && f.endTime ? shiftHours(f.startTime, f.endTime) : null;
  const amountCents = hours != null && rateCents != null ? payrollAmountCents(hours, rateCents) : 0;
  const ready = !!f.person.trim() && hours != null && hours > 0 && !!rateCents && rateCents > 0;

  return (
    <Card title="Log a shift">
      <form className="max-w-sm space-y-2 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch("/api/payroll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: f.person, workDate: f.workDate, startTime: f.startTime,
            endTime: f.endTime, rateCents, note: f.note || null,
          }),
        });
        if (res.ok) location.reload();
        else setError((await res.json()).error ?? "Could not save");
      }}>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person}
          onChange={(e) => setF({ ...f, person: e.target.value })} required />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.workDate}
          onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        <div className="flex gap-2">
          <input type="time" aria-label="Start time" className={`w-full ${INPUT_CLASS}`} value={f.startTime}
            onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
          <input type="time" aria-label="End time" className={`w-full ${INPUT_CLASS}`} value={f.endTime}
            onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
        </div>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Rate $/hr" value={f.rate}
          onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        <p className="text-slate-500">
          Hours: <span className="font-medium">{hours == null ? "—" : hours.toFixed(2)}</span>
          {" · "}Amount: <span className="font-medium">${(amountCents / 100).toFixed(2)}</span>
        </p>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Note" value={f.note}
          onChange={(e) => setF({ ...f, note: e.target.value })} />
        {error && <p className="text-red-600">{error}</p>}
        <Button type="submit" disabled={!ready}>Add</Button>
      </form>
    </Card>
  );
}
```

An end time earlier than the start is valid (past midnight), so the form must not block it — only a zero or unparseable span disables submit.

- [ ] **Step 4: Rewrite the table with an edit path**

Replace `src/components/payroll/PayrollTable.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import type { PayrollRow } from "@/lib/db/payroll";

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ person: "", workDate: "", startTime: "", endTime: "", rate: "" });

  function startEdit(r: PayrollRow) {
    setEditing(r.id);
    setDraft({ person: r.person, workDate: r.workDate, startTime: r.startTime, endTime: r.endTime, rate: (r.rateCents / 100).toFixed(2) });
  }

  async function save(id: number) {
    const res = await fetch(`/api/payroll/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, rateCents: Math.round(Number(draft.rate) * 100), note: null }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function del(id: number) {
    if (!confirm("Delete this shift?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }

  if (rows.length === 0) return <p className="text-sm text-slate-400">No shifts in range.</p>;

  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-slate-500">
        <th className="py-2">Date</th><th>Person</th><th>Shift</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Note</th><th></th>
      </tr></thead>
      <tbody>
        {rows.map((r) => editing === r.id ? (
          <tr key={r.id} className="border-t border-line">
            <td className="py-2"><input type="date" className={INPUT_CLASS} value={draft.workDate} onChange={(e) => setDraft({ ...draft, workDate: e.target.value })} /></td>
            <td><input className={INPUT_CLASS} value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} /></td>
            <td className="flex gap-1 py-2">
              <input type="time" className={INPUT_CLASS} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
              <input type="time" className={INPUT_CLASS} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
            </td>
            <td>{(shiftHours(draft.startTime, draft.endTime) ?? 0).toFixed(2)}</td>
            <td><input className={`w-20 ${INPUT_CLASS}`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></td>
            <td><Money cents={payrollAmountCents(shiftHours(draft.startTime, draft.endTime), Math.round(Number(draft.rate) * 100))} /></td>
            <td>{r.note ?? "—"}</td>
            <td className="whitespace-nowrap">
              <button className="text-brand-600 hover:underline" onClick={() => save(r.id)}>Save</button>
              <button className="ml-2 text-slate-400 hover:text-slate-900" onClick={() => setEditing(null)}>Cancel</button>
            </td>
          </tr>
        ) : (
          <tr key={r.id} className="border-t border-line">
            <td className="py-2">{r.workDate}</td>
            <td>{r.person}</td>
            <td>{r.startTime}–{r.endTime}</td>
            <td>{r.hours.toFixed(2)}</td>
            <td><Money cents={r.rateCents} /></td>
            <td><Money cents={r.amountCents} /></td>
            <td>{r.note ?? "—"}</td>
            <td className="whitespace-nowrap">
              <button className="text-slate-400 hover:text-slate-900" onClick={() => startEdit(r)}>Edit</button>
              <button className="ml-2 text-slate-400 hover:text-red-600" onClick={() => del(r.id)}>Delete</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Update the page copy**

In `src/app/payroll/page.tsx`, change the `PageHeader` subtitle from `"Wages paid to people"` to `"Shifts worked, charged to that day's shows"`. Everything else on the page already works: `rangeFromParams` now filters `work_date`, and `totalPayrollCents` / `payrollByPerson` are unchanged.

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm test`
Expected: PASS, all files.

Run: `npx tsc --noEmit`
Expected: no output.

Run: `npm run build`
Expected: build completes; `/payroll` and `/shows/[id]` listed in the route table.

- [ ] **Step 7: Commit**

```bash
git add src/components/payroll src/components/Nav.tsx src/app/payroll/page.tsx "src/app/shows/[id]/page.tsx" src/app/report/page.tsx
git commit -m "Payroll UI: shift entry, inline edit, nav link, labor on show detail"
```

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| `shiftHours`, midnight rule, equal-times rule | 1 |
| `allocateLabor`, even split, remainder to lowest `session_seq`, unallocated | 2 |
| Schema reshape, migration (recreate vs. rename aside), DB layer | 3 |
| `laborCents` per show + totals, `netCents`, dashboard, `calculations.md` | 4 |
| POST validation, server-side derivation, PATCH, GET range | 5 |
| Form, table, nav, show detail, report line | 6 |
| Backup | none needed — `payroll_entries` is already in `workbook.ts:18` and `ff0f8a1` added column-drift tolerance |
| 80/20 split | out of scope by design; Global Constraints forbid touching it |

**Type consistency** — `PayrollInput` is defined in Task 3 and consumed by name in Tasks 5 and 6. `parseShiftInput` returns exactly `PayrollInput`, which is what `insertPayroll`/`updatePayroll` accept, so no adapter is needed. `LaborEntry`/`LaborShow` (Task 2) are structurally satisfied by the `.map()` calls in Task 4. `ReportShow.laborCents` (Task 4) is what Task 6 renders.

**Known wrinkles flagged in-place:**
- Task 3 Step 4 warns that `payroll/page.tsx` and `PayrollForm` won't typecheck until their field names are updated; the real UI work is Task 6.
- Task 4's existing report tests stay green only because no fixture has payroll rows.
