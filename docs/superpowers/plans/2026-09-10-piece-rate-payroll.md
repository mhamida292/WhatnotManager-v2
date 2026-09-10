# Piece-Rate Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let payroll entries be paid by hour, by piece, or by package, with saved per-person rate defaults and a paid/unpaid flag so the Payroll page shows what is still owed.

**Architecture:** `payroll_entries` gains a `basis` column and a generic `qty` column replacing `hours`, with `start_time`/`end_time` relaxed to nullable since only hourly entries have them. A rebuild-and-copy migration reshapes existing databases. A new `payroll_rates` table stores per-person defaults that only ever pre-fill the form. Labor allocation and the dashboard are untouched — they already read only `{ workDate, amountCents }`.

**Tech Stack:** Next.js 15 (App Router, server components), better-sqlite3, TypeScript, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-10-piece-rate-payroll-design.md`

## Global Constraints

- The three bases are exactly `'hour'`, `'piece'`, `'package'`. This string triple appears in the schema CHECK, the validator, the rates table, and the UI — keep it identical everywhere.
- `amount_cents` is always derived server-side as `round(qty × rate_cents)`. The client never asserts an amount; a client-supplied `amountCents` is ignored. This is load-bearing — it is what stopped the old form silently saving $0 entries.
- `paid_on` never affects allocation, COGS, net profit, or any dashboard figure. It is bookkeeping only.
- Money is integer cents everywhere. `rate_cents` is cents per hour / per piece / per package depending on `basis`.
- Dates are `YYYY-MM-DD` strings; clock times are `HH:MM` strings.
- Run tests with `npx vitest run <path>`. The full suite is `npm test`.
- Never use `cat`/heredoc to write source files — use the file-editing tools.

---

## File Structure

**Modified:**
- `src/lib/db/schema.ts` — `PAYROLL_SCHEMA` reshaped; `payroll_rates` added to `SCHEMA`
- `src/lib/db/connection.ts` — new `migratePayrollBasis`, called from `migrate()`
- `src/lib/db/payroll.ts` — new columns, owed totals, paid setter
- `src/lib/calc/payroll-amount.ts` — `parseShiftInput` becomes `parsePayrollInput`
- `src/lib/backup/workbook.ts` — `TABLES`, `RENAMED_COLUMNS`
- `src/app/api/payroll/route.ts`, `src/app/api/payroll/[id]/route.ts`
- `src/app/payroll/page.tsx`
- `src/components/payroll/PayrollForm.tsx`, `src/components/payroll/PayrollTable.tsx`

**Created:**
- `src/lib/ui/payroll-basis.ts` — the basis list and label helpers, shared by form and table
- `src/lib/db/payroll-rates.ts` — rates CRUD, kept out of `payroll.ts` because nothing at report time reads it
- `src/app/api/payroll/[id]/paid/route.ts` — the paid toggle, deliberately its own endpoint so editing a row can never clear its paid date
- `src/app/api/payroll/rates/route.ts`
- `src/components/payroll/PayrollRates.tsx`
- `tests/lib/db/payroll-basis-migration.test.ts`
- `tests/lib/db/payroll-rates.test.ts`
- `tests/api/payroll-paid-api.test.ts`

**Tests updated in place** (they assert the old `hours` field and will fail until their task updates them): `tests/lib/db/payroll.test.ts`, `tests/api/payroll-api.test.ts`, `tests/lib/calc/ledger-report-labor.test.ts`, `tests/lib/calc/payroll-amount.test.ts`.

---

### Task 1: Schema and migration

Reshape the table and add the rates table. Nothing reads the new columns yet — this task only proves an old database opens correctly and a new one is created in the right shape.

**Files:**
- Modify: `src/lib/db/schema.ts:9-21` (`PAYROLL_SCHEMA`), and `SCHEMA` (append `payroll_rates`)
- Modify: `src/lib/db/connection.ts:102` (call site), and add `migratePayrollBasis` beside `migratePayrollShifts` at `src/lib/db/connection.ts:276`
- Test: `tests/lib/db/payroll-basis-migration.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `payroll_entries(id, person, work_date, basis, qty, start_time, end_time, rate_cents, amount_cents, paid_on, note)`; `payroll_rates(person, basis, rate_cents)`; `export function migratePayrollBasis(db: DB): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/payroll-basis-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { migrate } from "@/lib/db/connection";
import { SCHEMA } from "@/lib/db/schema";

/** A full database carrying the hourly-only payroll_entries shape — the one
 *  shipped between the shift reshape and piece rates. The rest of the schema is
 *  real, because migrate() runs every other migration too and several of them
 *  ALTER tables that must therefore exist. */
function hourlyShapeDb() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  db.exec(`DROP TABLE payroll_entries;
    CREATE TABLE payroll_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, person TEXT NOT NULL,
      work_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      hours REAL NOT NULL, rate_cents INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL, note TEXT)`);
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe("payroll basis migration", () => {
  it("adds basis, qty and paid_on and drops hours", () => {
    const db = hourlyShapeDb();
    migrate(db);
    const cols = columns(db, "payroll_entries");
    expect(cols).toContain("basis");
    expect(cols).toContain("qty");
    expect(cols).toContain("paid_on");
    expect(cols).not.toContain("hours");
  });

  it("carries hourly rows across as basis 'hour' with hours as qty", () => {
    const db = hourlyShapeDb();
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, start_time, end_time, hours, rate_cents, amount_cents, note)
      VALUES ('Sam','2026-07-08','18:00','23:00',5,1500,7500,'evening')`).run();
    migrate(db);
    expect(db.prepare("SELECT * FROM payroll_entries").get()).toMatchObject({
      person: "Sam", work_date: "2026-07-08", basis: "hour", qty: 5,
      start_time: "18:00", end_time: "23:00", rate_cents: 1500,
      amount_cents: 7500, paid_on: null, note: "evening",
    });
  });

  it("leaves no legacy table behind — every column maps losslessly", () => {
    const db = hourlyShapeDb();
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, start_time, end_time, hours, rate_cents, amount_cents)
      VALUES ('Sam','2026-07-08','18:00','23:00',5,1500,7500)`).run();
    migrate(db);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((t) => t.name);
    expect(tables).not.toContain("payroll_entries_old");
  });

  it("is idempotent and keeps the work_date index", () => {
    const db = hourlyShapeDb();
    migrate(db);
    migrate(db);
    expect(columns(db, "payroll_entries")).toContain("qty");
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[])
      .map((i) => i.name);
    expect(idx).toContain("idx_payroll_work_date");
  });

  it("allows piece entries with no clock times", () => {
    const db = hourlyShapeDb();
    migrate(db);
    db.prepare(`INSERT INTO payroll_entries
      (person, work_date, basis, qty, rate_cents, amount_cents)
      VALUES ('Sam','2026-09-09','piece',300,15,4500)`).run();
    expect(db.prepare("SELECT start_time, end_time FROM payroll_entries").get())
      .toEqual({ start_time: null, end_time: null });
  });

  it("rejects an unknown basis", () => {
    const db = hourlyShapeDb();
    migrate(db);
    expect(() => db.prepare(`INSERT INTO payroll_entries
      (person, work_date, basis, qty, rate_cents, amount_cents)
      VALUES ('Sam','2026-09-09','widget',1,15,15)`).run()).toThrow();
  });

  it("creates payroll_rates keyed on person and basis", () => {
    const db = hourlyShapeDb();
    migrate(db);
    db.prepare("INSERT INTO payroll_rates (person, basis, rate_cents) VALUES ('Sam','piece',15)").run();
    expect(() => db.prepare("INSERT INTO payroll_rates (person, basis, rate_cents) VALUES ('Sam','piece',20)").run())
      .toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/payroll-basis-migration.test.ts`
Expected: FAIL — the first test reports `basis` missing from the column list.

- [ ] **Step 3: Reshape `PAYROLL_SCHEMA`**

In `src/lib/db/schema.ts`, replace the `PAYROLL_SCHEMA` block (keep the existing doc comment above it, and extend it with the second paragraph shown here):

```typescript
/** Split out of SCHEMA so the payroll migrations recreate the table from the very
 *  same DDL a fresh database gets, instead of a copy that could drift from it.
 *
 *  Table only, no index: SCHEMA runs BEFORE migrate() on an existing file, where
 *  CREATE TABLE IF NOT EXISTS is a no-op against the old pay-period table. An
 *  index over work_date here would then be built against a table that does not
 *  have that column yet and abort the open. migrate() creates it after the
 *  reshape instead.
 *
 *  qty carries hours for an 'hour' entry and a piece/package count otherwise;
 *  start_time/end_time are null for anything but 'hour'. paid_on is bookkeeping
 *  only -- an entry costs the business the day it is worked, never the day the
 *  cash moves, so nothing in allocation or the dashboard reads it. */
export const PAYROLL_SCHEMA = `
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  work_date TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT 'hour' CHECK (basis IN ('hour','piece','package')),
  qty REAL NOT NULL,
  start_time TEXT,
  end_time TEXT,
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_on TEXT,
  note TEXT
);
`;
```

- [ ] **Step 4: Add `payroll_rates` to `SCHEMA`**

In `src/lib/db/schema.ts`, append to the end of the `SCHEMA` template string (after the `show_giveaway_allocations` block):

```sql
CREATE TABLE IF NOT EXISTS payroll_rates (
  person TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('hour','piece','package')),
  rate_cents INTEGER NOT NULL,
  PRIMARY KEY (person, basis)
);
```

- [ ] **Step 5: Write the migration**

In `src/lib/db/connection.ts`, add directly below `migratePayrollShifts` (which ends at line 285):

```typescript
/** One-time, idempotent: hourly-only payroll_entries gains a pay basis. hours
 *  becomes the generic qty, start/end times become nullable (only an 'hour'
 *  entry has them), and paid_on arrives. SQLite cannot drop a column or relax a
 *  NOT NULL in place, so the table is rebuilt and copied.
 *
 *  Unlike migratePayrollShifts, every old column has a lossless destination
 *  here, so the copy is complete and the old table is dropped rather than left
 *  aside. Guarded on the old column, so it runs exactly once. */
export function migratePayrollBasis(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(payroll_entries)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("hours")) return; // fresh schema, or already migrated
  db.transaction(() => {
    db.exec("ALTER TABLE payroll_entries RENAME TO payroll_entries_old");
    db.exec(PAYROLL_SCHEMA);
    db.exec(`INSERT INTO payroll_entries
      (id, person, work_date, basis, qty, start_time, end_time, rate_cents, amount_cents, paid_on, note)
      SELECT id, person, work_date, 'hour', hours, start_time, end_time,
             rate_cents, amount_cents, NULL, note
      FROM payroll_entries_old`);
    db.exec("DROP TABLE payroll_entries_old");
  })();
}
```

- [ ] **Step 6: Call it from `migrate()`**

In `src/lib/db/connection.ts`, edit the payroll block at line 102 so it reads:

```typescript
  migratePayrollShifts(db);
  // After the pay-period reshape: on a very old file that migration recreates
  // the table straight from the current PAYROLL_SCHEMA, so there is no `hours`
  // column left and this one correctly no-ops.
  migratePayrollBasis(db);
  // After both reshapes, never before: on an existing file SCHEMA has already run
  // against the old table, so this is the first point work_date is guaranteed
  // to exist.
  db.exec("CREATE INDEX IF NOT EXISTS idx_payroll_work_date ON payroll_entries(work_date)");
```

The `RENAME TO payroll_entries_old` inside the migration moves the index along with the table; dropping that table drops it, and the `CREATE INDEX IF NOT EXISTS` above rebuilds it.

- [ ] **Step 7: Run the new test to verify it passes**

Run: `npx vitest run tests/lib/db/payroll-basis-migration.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 8: Run the neighbouring migration tests**

Run: `npx vitest run tests/lib/db/payroll-migration.test.ts tests/lib/db/open-old-db.test.ts tests/lib/db/connection.test.ts`
Expected: PASS unchanged. A pay-period-shaped database is rebuilt straight from the new `PAYROLL_SCHEMA` by `migratePayrollShifts`, so it lands in the basis shape in one hop and still keeps its rows in `payroll_entries_legacy`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/db/payroll-basis-migration.test.ts
git commit -m "Add a pay basis, qty and paid_on to payroll_entries"
```

---

### Task 2: DB layer — entries

Teach `payroll.ts` the new columns, and add owed totals and the paid setter. `updatePayroll` deliberately does not write `paid_on`, so editing a row can never silently clear its paid date.

**Files:**
- Modify: `src/lib/db/payroll.ts` (whole file)
- Test: `tests/lib/db/payroll.test.ts` (update in place)

**Interfaces:**
- Consumes: the Task 1 schema.
- Produces:
  - `export type PayrollBasis = "hour" | "piece" | "package"`
  - `export interface PayrollRow { id: number; person: string; workDate: string; basis: PayrollBasis; qty: number; startTime: string | null; endTime: string | null; rateCents: number; amountCents: number; paidOn: string | null; note: string | null }`
  - `export type PayrollInput = Omit<PayrollRow, "id" | "paidOn">`
  - `insertPayroll(db, e: PayrollInput): number`, `listPayroll(db, range?): PayrollRow[]`, `getPayroll(db, id): PayrollRow | null`, `updatePayroll(db, id, e: PayrollInput): void`, `deletePayroll(db, id): void`
  - `totalPayrollCents(db, range?): number`
  - `owedPayrollCents(db, range?): number`
  - `payrollByPerson(db, range?): { person: string; totalCents: number; owedCents: number }[]`
  - `setPayrollPaid(db, id: number, paidOn: string | null): void`

- [ ] **Step 1: Update the failing test**

Replace `tests/lib/db/payroll.test.ts` entirely:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll, getPayroll, updatePayroll, deletePayroll,
  totalPayrollCents, owedPayrollCents, payrollByPerson, setPayrollPaid,
  type PayrollInput } from "@/lib/db/payroll";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const shift = (over: Partial<PayrollInput> = {}): PayrollInput => ({
  person: "Sam", workDate: "2026-07-08", basis: "hour", qty: 5,
  startTime: "18:00", endTime: "23:00", rateCents: 1500, amountCents: 7500,
  note: null, ...over,
});

const piece = (over: Partial<PayrollInput> = {}): PayrollInput => ({
  person: "Sam", workDate: "2026-09-09", basis: "piece", qty: 300,
  startTime: null, endTime: null, rateCents: 15, amountCents: 4500,
  note: null, ...over,
});

describe("payroll DB layer", () => {
  it("inserts and reads back a shift", () => {
    const id = insertPayroll(db, shift({ note: "evening" }));
    expect(getPayroll(db, id)).toMatchObject({
      person: "Sam", workDate: "2026-07-08", basis: "hour", qty: 5,
      startTime: "18:00", endTime: "23:00", rateCents: 1500,
      amountCents: 7500, paidOn: null, note: "evening",
    });
  });

  it("inserts a piece entry with no clock times", () => {
    const id = insertPayroll(db, piece());
    expect(getPayroll(db, id)).toMatchObject({
      basis: "piece", qty: 300, startTime: null, endTime: null, amountCents: 4500,
    });
  });

  it("inserts a package entry", () => {
    const id = insertPayroll(db, piece({ basis: "package", qty: 120, rateCents: 50, amountCents: 6000 }));
    expect(getPayroll(db, id)).toMatchObject({ basis: "package", qty: 120, amountCents: 6000 });
  });

  it("updates and deletes", () => {
    const id = insertPayroll(db, shift());
    updatePayroll(db, id, shift({ person: "Alex", qty: 6, amountCents: 9000, endTime: "00:00" }));
    expect(getPayroll(db, id)).toMatchObject({ person: "Alex", qty: 6, amountCents: 9000 });
    deletePayroll(db, id);
    expect(getPayroll(db, id)).toBeNull();
  });

  it("marks paid and unpaid without touching anything else", () => {
    const id = insertPayroll(db, piece());
    setPayrollPaid(db, id, "2026-09-12");
    expect(getPayroll(db, id)).toMatchObject({ paidOn: "2026-09-12", amountCents: 4500 });
    setPayrollPaid(db, id, null);
    expect(getPayroll(db, id)!.paidOn).toBeNull();
  });

  it("keeps the paid date across an edit", () => {
    const id = insertPayroll(db, piece());
    setPayrollPaid(db, id, "2026-09-12");
    updatePayroll(db, id, piece({ qty: 400, amountCents: 6000 }));
    expect(getPayroll(db, id)).toMatchObject({ qty: 400, paidOn: "2026-09-12" });
  });

  it("filters, totals, and groups by work_date", () => {
    insertPayroll(db, shift({ workDate: "2026-07-01", amountCents: 40500 }));
    insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 45000 }));
    insertPayroll(db, shift({ person: "Alex", workDate: "2026-07-08", amountCents: 50000 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 15000 }));

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(listPayroll(db, july)).toHaveLength(3);
    expect(totalPayrollCents(db, july)).toBe(40500 + 45000 + 50000);
    expect(payrollByPerson(db, july)).toEqual([
      { person: "Alex", totalCents: 50000, owedCents: 50000 },
      { person: "Sam", totalCents: 85500, owedCents: 85500 },
    ].sort((a, b) => b.totalCents - a.totalCents));
  });

  it("counts only unpaid entries as owed, and respects the range", () => {
    const a = insertPayroll(db, shift({ workDate: "2026-07-08", amountCents: 6000 }));
    insertPayroll(db, shift({ workDate: "2026-07-09", amountCents: 4500 }));
    insertPayroll(db, shift({ workDate: "2026-06-30", amountCents: 9900 }));
    setPayrollPaid(db, a, "2026-07-10");

    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect(totalPayrollCents(db, july)).toBe(10500);
    expect(owedPayrollCents(db, july)).toBe(4500);
    expect(owedPayrollCents(db)).toBe(4500 + 9900);
  });

  it("reports owed per person alongside earned", () => {
    const a = insertPayroll(db, shift({ person: "Ahmed", amountCents: 6000 }));
    insertPayroll(db, shift({ person: "Ahmed", amountCents: 4500 }));
    const s = insertPayroll(db, shift({ person: "Sara", amountCents: 9900 }));
    setPayrollPaid(db, a, "2026-07-10");
    setPayrollPaid(db, s, "2026-07-10");

    expect(payrollByPerson(db)).toEqual([
      { person: "Sara", totalCents: 9900, owedCents: 0 },
      { person: "Ahmed", totalCents: 10500, owedCents: 4500 },
    ].sort((a, b) => b.totalCents - a.totalCents));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/payroll.test.ts`
Expected: FAIL — `owedPayrollCents` and `setPayrollPaid` are not exported.

- [ ] **Step 3: Rewrite the DB layer**

Replace `src/lib/db/payroll.ts` entirely:

```typescript
import type { DB } from "./connection";

export type PayrollBasis = "hour" | "piece" | "package";

export interface PayrollRow {
  id: number; person: string; workDate: string;
  basis: PayrollBasis; qty: number;
  startTime: string | null; endTime: string | null;
  rateCents: number; amountCents: number;
  paidOn: string | null; note: string | null;
}

/** paid_on is deliberately outside the input type: it moves through
 *  setPayrollPaid alone, so editing an entry can never clear its paid date. */
export type PayrollInput = Omit<PayrollRow, "id" | "paidOn">;
export type PayrollDateRange = { from?: string; to?: string };

/** Filter on the day the work was done. */
function rangeClause(range?: PayrollDateRange): { sql: string; args: string[] } {
  if (!range || (!range.from && !range.to)) return { sql: "", args: [] };
  const parts: string[] = [];
  const args: string[] = [];
  if (range.from) { parts.push("work_date >= ?"); args.push(range.from); }
  if (range.to) { parts.push("work_date <= ?"); args.push(range.to); }
  return { sql: " WHERE " + parts.join(" AND "), args };
}

const COLS = `id, person, work_date AS workDate, basis, qty,
  start_time AS startTime, end_time AS endTime, rate_cents AS rateCents,
  amount_cents AS amountCents, paid_on AS paidOn, note`;

export function insertPayroll(db: DB, e: PayrollInput): number {
  const info = db.prepare(`INSERT INTO payroll_entries
    (person, work_date, basis, qty, start_time, end_time, rate_cents, amount_cents, note)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      e.person.trim(), e.workDate, e.basis, e.qty,
      e.startTime, e.endTime, e.rateCents, e.amountCents, e.note?.trim() || null);
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
  db.prepare(`UPDATE payroll_entries SET person=?, work_date=?, basis=?, qty=?,
    start_time=?, end_time=?, rate_cents=?, amount_cents=?, note=? WHERE id=?`).run(
      e.person.trim(), e.workDate, e.basis, e.qty,
      e.startTime, e.endTime, e.rateCents, e.amountCents, e.note?.trim() || null, id);
}

/** A date stamps the entry paid; null returns it to owed. Touches nothing else. */
export function setPayrollPaid(db: DB, id: number, paidOn: string | null): void {
  db.prepare("UPDATE payroll_entries SET paid_on = ? WHERE id = ?").run(paidOn, id);
}

export function deletePayroll(db: DB, id: number): void {
  db.prepare("DELETE FROM payroll_entries WHERE id = ?").run(id);
}

export function totalPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${sql}`).get(...args) as { t: number };
  return Number(r.t);
}

/** Wages logged but not yet marked paid. Bookkeeping only -- no report reads it. */
export function owedPayrollCents(db: DB, range?: PayrollDateRange): number {
  const { sql, args } = rangeClause(range);
  const where = sql ? `${sql} AND paid_on IS NULL` : " WHERE paid_on IS NULL";
  const r = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM payroll_entries${where}`).get(...args) as { t: number };
  return Number(r.t);
}

export function payrollByPerson(db: DB, range?: PayrollDateRange): { person: string; totalCents: number; owedCents: number }[] {
  const { sql, args } = rangeClause(range);
  const rows = db.prepare(
    `SELECT person,
            COALESCE(SUM(amount_cents),0) AS totalCents,
            COALESCE(SUM(CASE WHEN paid_on IS NULL THEN amount_cents ELSE 0 END),0) AS owedCents
     FROM payroll_entries${sql}
     GROUP BY person ORDER BY totalCents DESC, person ASC`
  ).all(...args) as { person: string; totalCents: number; owedCents: number }[];
  return rows.map((r) => ({ person: r.person, totalCents: Number(r.totalCents), owedCents: Number(r.owedCents) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/payroll.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the labor allocation test's fixture**

`tests/lib/calc/ledger-report-labor.test.ts` builds payroll rows with a `shift()` helper that still passes `hours`. Update only that helper — every assertion in the file stays as it is, and their passing is the proof that allocation and net profit are undisturbed. Replace the helper with:

```typescript
const shift = (workDate: string, amountCents: number) => ({
  person: "Sam", workDate, basis: "hour" as const, qty: 5,
  startTime: "18:00", endTime: "23:00",
  rateCents: Math.round(amountCents / 5), amountCents, note: null,
});
```

- [ ] **Step 6: Run the allocation and report tests**

Run: `npx vitest run tests/lib/calc/ledger-report-labor.test.ts tests/lib/calc/labor-allocation.test.ts tests/lib/calc/ledger-report.test.ts`
Expected: PASS, with no assertion changes — allocation never learned about `basis`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/payroll.ts tests/lib/db/payroll.test.ts tests/lib/calc/ledger-report-labor.test.ts
git commit -m "Read and write payroll entries by basis, with owed totals"
```

---

### Task 3: DB layer — rates

Per-person defaults. A separate module because nothing at report time reads it — it exists only to pre-fill a form.

**Files:**
- Create: `src/lib/db/payroll-rates.ts`
- Test: `tests/lib/db/payroll-rates.test.ts` (new)

**Interfaces:**
- Consumes: `PayrollBasis` from `@/lib/db/payroll`.
- Produces:
  - `export interface PayrollRate { person: string; basis: PayrollBasis; rateCents: number }`
  - `listPayrollRates(db): PayrollRate[]`
  - `setPayrollRate(db, person: string, basis: PayrollBasis, rateCents: number): void`
  - `deletePayrollRate(db, person: string, basis: PayrollBasis): void`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/payroll-rates.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { listPayrollRates, setPayrollRate, deletePayrollRate } from "@/lib/db/payroll-rates";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("payroll rate defaults", () => {
  it("stores a rate per person per basis", () => {
    setPayrollRate(db, "Ahmed", "hour", 1800);
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "Sara", "piece", 20);
    expect(listPayrollRates(db)).toEqual([
      { person: "Ahmed", basis: "hour", rateCents: 1800 },
      { person: "Ahmed", basis: "piece", rateCents: 15 },
      { person: "Sara", basis: "piece", rateCents: 20 },
    ]);
  });

  it("overwrites rather than duplicating an existing person and basis", () => {
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "Ahmed", "piece", 18);
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "piece", rateCents: 18 }]);
  });

  it("trims the person so 'Ahmed ' does not become a second worker", () => {
    setPayrollRate(db, "Ahmed", "piece", 15);
    setPayrollRate(db, "  Ahmed  ", "piece", 18);
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "piece", rateCents: 18 }]);
  });

  it("deletes one basis without disturbing the others", () => {
    setPayrollRate(db, "Ahmed", "hour", 1800);
    setPayrollRate(db, "Ahmed", "piece", 15);
    deletePayrollRate(db, "Ahmed", "piece");
    expect(listPayrollRates(db)).toEqual([{ person: "Ahmed", basis: "hour", rateCents: 1800 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/payroll-rates.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/payroll-rates`.

- [ ] **Step 3: Write the module**

Create `src/lib/db/payroll-rates.ts`:

```typescript
import type { DB } from "./connection";
import type { PayrollBasis } from "./payroll";

/** Defaults that pre-fill the entry form. Nothing at report time reads these --
 *  an entry stores the rate it was actually paid at, so changing a default
 *  never rewrites history. */
export interface PayrollRate { person: string; basis: PayrollBasis; rateCents: number }

export function listPayrollRates(db: DB): PayrollRate[] {
  return db.prepare(
    "SELECT person, basis, rate_cents AS rateCents FROM payroll_rates ORDER BY person ASC, basis ASC"
  ).all() as PayrollRate[];
}

export function setPayrollRate(db: DB, person: string, basis: PayrollBasis, rateCents: number): void {
  db.prepare(`INSERT INTO payroll_rates (person, basis, rate_cents) VALUES (?,?,?)
    ON CONFLICT(person, basis) DO UPDATE SET rate_cents = excluded.rate_cents`)
    .run(person.trim(), basis, rateCents);
}

export function deletePayrollRate(db: DB, person: string, basis: PayrollBasis): void {
  db.prepare("DELETE FROM payroll_rates WHERE person = ? AND basis = ?").run(person.trim(), basis);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/payroll-rates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/payroll-rates.ts tests/lib/db/payroll-rates.test.ts
git commit -m "Store per-person payroll rate defaults"
```

---

### Task 4: Validation

`parseShiftInput` becomes `parsePayrollInput`, branching on basis. This is the file that stops the client asserting an amount, so the branch must derive `qty` in every case.

**Files:**
- Modify: `src/lib/calc/payroll-amount.ts`
- Test: `tests/lib/calc/payroll-amount.test.ts` (update in place)

**Interfaces:**
- Consumes: `PayrollInput`, `PayrollBasis` from `@/lib/db/payroll`.
- Produces:
  - `export function payrollAmountCents(qty: number | null, rateCents: number | null): number` (unchanged signature)
  - `export function shiftHours(start: string, end: string): number | null` (unchanged)
  - `export type PayrollParse = { ok: true; value: PayrollInput } | { ok: false; error: string }`
  - `export function parsePayrollInput(b: Record<string, unknown>): PayrollParse`

- [ ] **Step 1: Update the failing test**

Replace `tests/lib/calc/payroll-amount.test.ts` entirely (`shiftHours` keeps its own file, `tests/lib/calc/shift-hours.test.ts`, untouched):

```typescript
import { describe, it, expect } from "vitest";
import { payrollAmountCents, parsePayrollInput } from "@/lib/calc/payroll-amount";

describe("payrollAmountCents", () => {
  it("multiplies quantity by rate and rounds to a cent", () => {
    expect(payrollAmountCents(30, 1500)).toBe(45000);
    expect(payrollAmountCents(2.5, 1333)).toBe(3333); // 3332.5 -> 3333
    expect(payrollAmountCents(333, 15)).toBe(4995);   // 333 pieces at 15c
  });
  it("returns 0 when quantity or rate is missing", () => {
    expect(payrollAmountCents(null, 1500)).toBe(0);
    expect(payrollAmountCents(10, null)).toBe(0);
    expect(payrollAmountCents(NaN, 1500)).toBe(0);
  });
});

const hourly = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-07-08", basis: "hour",
  startTime: "20:00", endTime: "01:00", rateCents: 1500, note: null, ...over,
});

const byPiece = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-09-09", basis: "piece",
  qty: 300, rateCents: 15, note: null, ...over,
});

const ok = (b: Record<string, unknown>) => {
  const p = parsePayrollInput(b);
  if (!p.ok) throw new Error(`expected ok, got: ${p.error}`);
  return p.value;
};

describe("parsePayrollInput — hourly", () => {
  it("derives qty from the clock times, including across midnight", () => {
    expect(ok(hourly())).toMatchObject({
      basis: "hour", qty: 5, startTime: "20:00", endTime: "01:00", amountCents: 7500,
    });
  });

  it("defaults a missing basis to hour, so an old client still works", () => {
    const { basis, ...noBasis } = hourly();
    expect(ok(noBasis)).toMatchObject({ basis: "hour", qty: 5 });
  });

  it("rejects equal start and end rather than reading it as 24 hours", () => {
    expect(parsePayrollInput(hourly({ startTime: "12:00", endTime: "12:00" })).ok).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(parsePayrollInput(hourly({ endTime: "nope" })).ok).toBe(false);
  });
});

describe("parsePayrollInput — piece and package", () => {
  it("takes the count as qty and stores no clock times", () => {
    expect(ok(byPiece())).toEqual({
      person: "Sam", workDate: "2026-09-09", basis: "piece", qty: 300,
      startTime: null, endTime: null, rateCents: 15, amountCents: 4500, note: null,
    });
  });

  it("handles packages the same way", () => {
    expect(ok(byPiece({ basis: "package", qty: 120, rateCents: 50 })))
      .toMatchObject({ basis: "package", qty: 120, amountCents: 6000 });
  });

  it("ignores clock times sent alongside a count", () => {
    expect(ok(byPiece({ startTime: "20:00", endTime: "23:00" })))
      .toMatchObject({ startTime: null, endTime: null, qty: 300 });
  });

  it("rejects zero, negative and fractional counts", () => {
    expect(parsePayrollInput(byPiece({ qty: 0 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: -5 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: 2.5 })).ok).toBe(false);
    expect(parsePayrollInput(byPiece({ qty: "many" })).ok).toBe(false);
  });
});

describe("parsePayrollInput — shared rules", () => {
  it("rejects a missing person, a bad date and a non-positive rate on every basis", () => {
    for (const make of [hourly, byPiece]) {
      expect(parsePayrollInput(make({ person: "   " })).ok).toBe(false);
      expect(parsePayrollInput(make({ workDate: "07/08/2026" })).ok).toBe(false);
      expect(parsePayrollInput(make({ rateCents: 0 })).ok).toBe(false);
      expect(parsePayrollInput(make({ rateCents: -5 })).ok).toBe(false);
    }
  });

  it("rejects an unknown basis", () => {
    expect(parsePayrollInput(byPiece({ basis: "widget" })).ok).toBe(false);
  });

  it("ignores a client-supplied amount", () => {
    expect(ok(byPiece({ amountCents: 999999 })).amountCents).toBe(4500);
    expect(ok(hourly({ amountCents: 999999, qty: 99 })).amountCents).toBe(7500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/payroll-amount.test.ts`
Expected: FAIL — `parsePayrollInput` is not exported.

- [ ] **Step 3: Rewrite the validator**

In `src/lib/calc/payroll-amount.ts`: keep `shiftHours` and its `clockMinutes` helper exactly as they are, change the import and the doc comment on `payrollAmountCents` to speak of quantity rather than hours, and replace the `ShiftParse` type and `parseShiftInput` function with:

```typescript
import type { PayrollBasis, PayrollInput } from "@/lib/db/payroll";

const BASES: PayrollBasis[] = ["hour", "piece", "package"];

export type PayrollParse =
  | { ok: true; value: PayrollInput }
  | { ok: false; error: string };

/** Validate a payroll payload and DERIVE qty and amount from it. The client
 *  never gets to assert the amount -- that's what let the old form silently
 *  save $0 entries. An hour entry derives qty from its clock times; a piece or
 *  package entry takes a whole count and stores no times at all. */
export function parsePayrollInput(b: Record<string, unknown>): PayrollParse {
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return { ok: false, error: "Person is required" };

  const workDate = typeof b.workDate === "string" ? b.workDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { ok: false, error: "Work date must be YYYY-MM-DD" };

  // An absent basis means an older client that only ever sent shifts.
  const basis = (b.basis ?? "hour") as PayrollBasis;
  if (!BASES.includes(basis)) return { ok: false, error: "Basis must be hour, piece or package" };

  const rateCents = Math.trunc(Number(b.rateCents));
  if (!Number.isFinite(rateCents) || rateCents <= 0) return { ok: false, error: "Rate must be greater than zero" };

  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;

  let qty: number;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (basis === "hour") {
    startTime = typeof b.startTime === "string" ? b.startTime.trim() : "";
    endTime = typeof b.endTime === "string" ? b.endTime.trim() : "";
    const hours = shiftHours(startTime, endTime);
    if (hours == null) return { ok: false, error: "Start and end must be times like 20:00" };
    if (hours <= 0) return { ok: false, error: "Start and end time cannot be the same" };
    qty = hours;
  } else {
    const count = Number(b.qty);
    // A fractional count is a typo, not half a piece -- rejected, never rounded.
    if (!Number.isInteger(count) || count <= 0) {
      return { ok: false, error: `${basis === "piece" ? "Pieces" : "Packages"} must be a whole number greater than zero` };
    }
    qty = count;
  }

  return {
    ok: true,
    value: { person, workDate, basis, qty, startTime, endTime, rateCents,
             amountCents: payrollAmountCents(qty, rateCents), note },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/payroll-amount.test.ts tests/lib/calc/shift-hours.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/payroll-amount.ts tests/lib/calc/payroll-amount.test.ts
git commit -m "Validate payroll input by pay basis"
```

---

### Task 5: API routes

Wire the new validator through, and add the paid toggle as its own endpoint.

**Files:**
- Modify: `src/app/api/payroll/route.ts`, `src/app/api/payroll/[id]/route.ts`
- Create: `src/app/api/payroll/[id]/paid/route.ts`, `src/app/api/payroll/rates/route.ts`
- Test: `tests/api/payroll-api.test.ts` (update in place), `tests/api/payroll-paid-api.test.ts` (new)

**Interfaces:**
- Consumes: `parsePayrollInput`, `setPayrollPaid`, `listPayrollRates`, `setPayrollRate`, `deletePayrollRate`.
- Produces:
  - `PATCH /api/payroll/[id]/paid` with body `{ paidOn: string | null }` → `{ ok: true }`, 400 on a malformed date, 404 on an unknown id
  - `GET /api/payroll/rates` → `PayrollRate[]`
  - `PUT /api/payroll/rates` with body `{ person, basis, rateCents }` → `{ ok: true }`; a `rateCents` of `0` or `null` deletes that default

- [ ] **Step 1: Update the entry-API test**

In `tests/api/payroll-api.test.ts`, change the `body` helper to carry a basis and every `row.hours` assertion to `row.qty`, then add the piece cases. The helper becomes:

```typescript
const body = (over: Record<string, unknown> = {}) => ({
  person: "Sam", workDate: "2026-07-08", basis: "hour",
  startTime: "20:00", endTime: "01:00", rateCents: 1500, note: null, ...over,
});
```

Replace `expect(row.hours).toBe(5)` with `expect(row.qty).toBe(5)` in both places it appears, `post(body({ amountCents: 999999, hours: 99 }))` with `post(body({ amountCents: 999999, qty: 99 }))`, and `expect(row.hours).toBe(6)`-style assertions in the PATCH block with `row.qty`. Then append this describe block to the end of the file:

```typescript
describe("POST /api/payroll — piece and package", () => {
  it("saves a piece entry with no clock times", async () => {
    const res = await post({ person: "Ahmed", workDate: "2026-09-09", basis: "piece", qty: 300, rateCents: 15 });
    expect(res.status).toBe(200);
    const [row] = listPayroll(db);
    expect(row).toMatchObject({
      basis: "piece", qty: 300, startTime: null, endTime: null,
      amountCents: 4500, paidOn: null,
    });
  });

  it("saves a package entry", async () => {
    await post({ person: "Ahmed", workDate: "2026-09-08", basis: "package", qty: 120, rateCents: 50 });
    expect(listPayroll(db)[0]).toMatchObject({ basis: "package", qty: 120, amountCents: 6000 });
  });

  it("rejects a fractional count and an unknown basis", async () => {
    const base = { person: "Ahmed", workDate: "2026-09-09", rateCents: 15 };
    expect((await post({ ...base, basis: "piece", qty: 2.5 })).status).toBe(400);
    expect((await post({ ...base, basis: "widget", qty: 5 })).status).toBe(400);
    expect(listPayroll(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the failing paid-API test**

Create `tests/api/payroll-paid-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { PATCH } = await import("@/app/api/payroll/[id]/paid/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const entry = () => insertPayroll(db, {
  person: "Ahmed", workDate: "2026-09-09", basis: "piece", qty: 300,
  startTime: null, endTime: null, rateCents: 15, amountCents: 4500, note: null,
});

const patch = (id: number, b: Record<string, unknown>) =>
  PATCH(new NextRequest(`http://test/api/payroll/${id}/paid`, { method: "PATCH", body: JSON.stringify(b) }),
        { params: Promise.resolve({ id: String(id) }) });

describe("PATCH /api/payroll/[id]/paid", () => {
  it("stamps and clears the paid date", async () => {
    const id = entry();
    expect((await patch(id, { paidOn: "2026-09-12" })).status).toBe(200);
    expect(listPayroll(db)[0].paidOn).toBe("2026-09-12");

    expect((await patch(id, { paidOn: null })).status).toBe(200);
    expect(listPayroll(db)[0].paidOn).toBeNull();
  });

  it("leaves the amount alone", async () => {
    const id = entry();
    await patch(id, { paidOn: "2026-09-12" });
    expect(listPayroll(db)[0].amountCents).toBe(4500);
  });

  it("rejects a malformed date and 404s an unknown id", async () => {
    const id = entry();
    expect((await patch(id, { paidOn: "09/12/2026" })).status).toBe(400);
    expect(listPayroll(db)[0].paidOn).toBeNull();
    expect((await patch(999, { paidOn: "2026-09-12" })).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/api/payroll-api.test.ts tests/api/payroll-paid-api.test.ts`
Expected: FAIL — `parseShiftInput` no longer exists (import error in the entry routes), and `@/app/api/payroll/[id]/paid/route` cannot be resolved.

- [ ] **Step 4: Point the entry routes at the new validator**

In `src/app/api/payroll/route.ts` and `src/app/api/payroll/[id]/route.ts`, change the import to `import { parsePayrollInput } from "@/lib/calc/payroll-amount";` and each call site from `parseShiftInput(...)` to `parsePayrollInput(...)`. Nothing else in those files changes.

- [ ] **Step 5: Write the paid route**

Create `src/app/api/payroll/[id]/paid/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { getPayroll, setPayrollPaid } from "@/lib/db/payroll";

/** Paid state moves on its own endpoint so an ordinary edit of an entry can
 *  never clear the date it was settled on. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = await req.json() as { paidOn?: unknown };
  const raw = body.paidOn;
  const paidOn = raw == null ? null : String(raw).trim();
  if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return NextResponse.json({ error: "Paid date must be YYYY-MM-DD" }, { status: 400 });
  }
  const db = await dbForRequest();
  if (!getPayroll(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  setPayrollPaid(db, id, paidOn);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Write the rates route**

Create `src/app/api/payroll/rates/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { listPayrollRates, setPayrollRate, deletePayrollRate } from "@/lib/db/payroll-rates";
import type { PayrollBasis } from "@/lib/db/payroll";

const BASES: PayrollBasis[] = ["hour", "piece", "package"];

export async function GET() {
  return NextResponse.json(listPayrollRates(await dbForRequest()));
}

export async function PUT(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>;
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return NextResponse.json({ error: "Person is required" }, { status: 400 });
  const basis = b.basis as PayrollBasis;
  if (!BASES.includes(basis)) return NextResponse.json({ error: "Basis must be hour, piece or package" }, { status: 400 });

  const db = await dbForRequest();
  const rateCents = b.rateCents == null ? 0 : Math.trunc(Number(b.rateCents));
  if (!Number.isFinite(rateCents) || rateCents < 0) {
    return NextResponse.json({ error: "Rate cannot be negative" }, { status: 400 });
  }
  // Clearing the field removes the default rather than saving a $0 one, which
  // would pre-fill an amount the form then refuses to submit.
  if (rateCents === 0) deletePayrollRate(db, person, basis);
  else setPayrollRate(db, person, basis, rateCents);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Run the API tests to verify they pass**

Run: `npx vitest run tests/api/payroll-api.test.ts tests/api/payroll-paid-api.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/payroll tests/api/payroll-api.test.ts tests/api/payroll-paid-api.test.ts
git commit -m "Accept every pay basis over the API and add a paid toggle"
```

---

### Task 6: Backup and restore

The workbook derives columns from the live schema, so the new columns ride along on their own. Two things do not: the `hours` → `qty` rename, and the new table.

**Files:**
- Modify: `src/lib/backup/workbook.ts:8-21` (`TABLES`), `src/lib/backup/workbook.ts:66-70` (`RENAMED_COLUMNS`)
- Test: `tests/lib/backup/old-backup-restore.test.ts` (add a case)

**Interfaces:**
- Consumes: the Task 1 schema.
- Produces: no new exports; `TABLES` gains `"payroll_rates"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/backup/old-backup-restore.test.ts`. It reuses that file's existing `oldBackup` helper, so build the workbook with the hourly column list rather than the pay-period one — define this constant next to `OLD_PAYROLL_COLS` at the top of the file:

```typescript
/** payroll_entries as it was AFTER the shift reshape but BEFORE pay bases. */
const HOURLY_PAYROLL_COLS = ["id", "person", "work_date", "start_time", "end_time", "hours", "rate_cents", "amount_cents", "note"];
```

Then generalise the helper's signature from `oldBackup(payrollRows)` to `oldBackup(payrollRows, payrollCols = OLD_PAYROLL_COLS)` and use `payrollCols` in place of `OLD_PAYROLL_COLS` inside it, leaving every existing call site working unchanged. Add this test:

```typescript
it("carries an hourly backup's hours across as qty", async () => {
  const buf = await oldBackup(
    [[1, "Maria", "2026-07-18", "18:00", "23:00", 5, 1500, 7500, "evening"]],
    HOURLY_PAYROLL_COLS,
  );
  const db = createDb(":memory:");
  await importWorkbook(db, buf);

  const [row] = listPayroll(db);
  expect(row).toMatchObject({
    person: "Maria", workDate: "2026-07-18", basis: "hour", qty: 5,
    startTime: "18:00", endTime: "23:00", rateCents: 1500,
    amountCents: 7500, paidOn: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/backup/old-backup-restore.test.ts`
Expected: FAIL — `qty` comes back as `0`, the `NOT NULL` placeholder, because `hours` was dropped as an unknown column.

- [ ] **Step 3: Register the rename**

In `src/lib/backup/workbook.ts`, extend `RENAMED_COLUMNS.payroll_entries`:

```typescript
const RENAMED_COLUMNS: Record<string, Record<string, string>> = {
  // A pay period became a worked shift. period_start is the day the work happened,
  // which is what labor allocation keys on; period_end carried no extra information
  // for a single-day entry and start/end clock times simply did not exist.
  //
  // A shift then became one basis among three: hours is just the quantity of an
  // 'hour' entry, and basis takes its schema default of 'hour' on import, which
  // is exactly right for a workbook written before piece rates existed.
  payroll_entries: { period_start: "work_date", hours: "qty" },
};
```

- [ ] **Step 4: Add the rates table to the backup**

In `src/lib/backup/workbook.ts`, add `payroll_rates` to `TABLES` beside `payroll_entries`:

```typescript
  "payroll_entries", "payroll_rates",
```

`payroll_rates` has no foreign keys, so its position is free; keeping it next to the entries keeps the two payroll sheets together.

Note for the implementer: `old-backup-restore.test.ts` derives its `OLD_TABLES` from `TABLES`, so those fixtures will now write an empty `payroll_rates` sheet. That is harmless — the import reads it as zero rows — and no assertion in that file depends on the table list's length.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/backup/`
Expected: PASS, the whole backup directory.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backup/workbook.ts tests/lib/backup/old-backup-restore.test.ts
git commit -m "Back up payroll rates and carry an old backup's hours into qty"
```

---

### Task 7: Shared basis labels

One tiny module so the form, the table and the rates card cannot drift on wording.

**Files:**
- Create: `src/lib/ui/payroll-basis.ts`
- Test: `tests/lib/ui/payroll-basis.test.ts` (new)

**Interfaces:**
- Consumes: `PayrollBasis` from `@/lib/db/payroll`.
- Produces:
  - `export const PAYROLL_BASES: readonly PayrollBasis[]`
  - `basisLabel(basis): string` — "Hour" | "Piece" | "Package"
  - `qtyLabel(basis): string` — the form's field label: "Hours" | "Pieces" | "Packages"
  - `rateLabel(basis): string` — "$/hr" | "$/piece" | "$/package"
  - `workLabel(basis, qty): string` — the table cell: "5.50 hrs" | "300 pieces" | "1 package"

- [ ] **Step 1: Write the failing test**

Create `tests/lib/ui/payroll-basis.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PAYROLL_BASES, basisLabel, qtyLabel, rateLabel, workLabel } from "@/lib/ui/payroll-basis";

describe("payroll basis labels", () => {
  it("lists the three bases in entry order", () => {
    expect(PAYROLL_BASES).toEqual(["hour", "piece", "package"]);
  });

  it("labels each basis", () => {
    expect(PAYROLL_BASES.map(basisLabel)).toEqual(["Hour", "Piece", "Package"]);
    expect(PAYROLL_BASES.map(qtyLabel)).toEqual(["Hours", "Pieces", "Packages"]);
    expect(PAYROLL_BASES.map(rateLabel)).toEqual(["$/hr", "$/piece", "$/package"]);
  });

  it("shows hours to two places and counts as whole numbers", () => {
    expect(workLabel("hour", 5.5)).toBe("5.50 hrs");
    expect(workLabel("piece", 300)).toBe("300 pieces");
    expect(workLabel("package", 120)).toBe("120 packages");
  });

  it("does not say '1 pieces'", () => {
    expect(workLabel("piece", 1)).toBe("1 piece");
    expect(workLabel("package", 1)).toBe("1 package");
  });

  it("groups a large count for readability", () => {
    expect(workLabel("piece", 2000)).toBe("2,000 pieces");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ui/payroll-basis.test.ts`
Expected: FAIL — cannot resolve `@/lib/ui/payroll-basis`.

- [ ] **Step 3: Write the module**

Create `src/lib/ui/payroll-basis.ts`:

```typescript
import type { PayrollBasis } from "@/lib/db/payroll";

/** In the order the form offers them. */
export const PAYROLL_BASES: readonly PayrollBasis[] = ["hour", "piece", "package"] as const;

const LABELS: Record<PayrollBasis, string> = { hour: "Hour", piece: "Piece", package: "Package" };
const PLURALS: Record<PayrollBasis, string> = { hour: "Hours", piece: "Pieces", package: "Packages" };
const RATES: Record<PayrollBasis, string> = { hour: "$/hr", piece: "$/piece", package: "$/package" };

export function basisLabel(basis: PayrollBasis): string { return LABELS[basis]; }

/** The form's quantity field label. */
export function qtyLabel(basis: PayrollBasis): string { return PLURALS[basis]; }

export function rateLabel(basis: PayrollBasis): string { return RATES[basis]; }

/** The table's Work cell. Hours keep two decimals because a shift is rarely
 *  whole; counts are integers and grouped, since piece jobs run to thousands. */
export function workLabel(basis: PayrollBasis, qty: number): string {
  if (basis === "hour") return `${qty.toFixed(2)} hrs`;
  const noun = qty === 1 ? basis : PLURALS[basis].toLowerCase();
  return `${qty.toLocaleString("en-US")} ${noun}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ui/payroll-basis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/payroll-basis.ts tests/lib/ui/payroll-basis.test.ts
git commit -m "Share payroll basis wording between the form and the table"
```

---

### Task 8: The entry form

A basis toggle that swaps the clock times for a count field, with the rate pre-filled from the person's saved default.

**Files:**
- Modify: `src/components/payroll/PayrollForm.tsx` (whole file)

**Interfaces:**
- Consumes: `PAYROLL_BASES`, `basisLabel`, `qtyLabel`, `rateLabel`; `PayrollRate` from `@/lib/db/payroll-rates`; `POST /api/payroll`.
- Produces: `export function PayrollForm({ rates }: { rates: PayrollRate[] })` — the page now passes the saved rates in, rather than the component fetching them.

- [ ] **Step 1: Rewrite the form**

Replace `src/components/payroll/PayrollForm.tsx` entirely:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import { PAYROLL_BASES, basisLabel, qtyLabel, rateLabel } from "@/lib/ui/payroll-basis";
import type { PayrollBasis } from "@/lib/db/payroll";
import type { PayrollRate } from "@/lib/db/payroll-rates";

export function PayrollForm({ rates }: { rates: PayrollRate[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [basis, setBasis] = useState<PayrollBasis>("hour");
  const [f, setF] = useState({ person: "", workDate: today, startTime: "", endTime: "", count: "", rate: "", note: "" });
  const [error, setError] = useState<string | null>(null);

  /** The saved default for a person on a basis, as a form-shaped string. */
  function savedRate(person: string, b: PayrollBasis): string {
    const hit = rates.find((r) => r.person.toLowerCase() === person.trim().toLowerCase() && r.basis === b);
    return hit ? (hit.rateCents / 100).toFixed(2) : "";
  }

  // Changing either the person or the basis re-fills the rate, but only while
  // the field still holds a default -- never over a rate typed by hand.
  function pickPerson(person: string) {
    const wasDefault = f.rate === "" || f.rate === savedRate(f.person, basis);
    setF({ ...f, person, rate: wasDefault ? savedRate(person, basis) : f.rate });
  }
  function pickBasis(b: PayrollBasis) {
    const wasDefault = f.rate === "" || f.rate === savedRate(f.person, basis);
    if (wasDefault) setF({ ...f, rate: savedRate(f.person, b) });
    setBasis(b);
  }

  const rateCents = f.rate === "" ? null : Math.round(Number(f.rate) * 100);
  const count = f.count === "" ? null : Number(f.count);
  const qty = basis === "hour"
    ? (f.startTime && f.endTime ? shiftHours(f.startTime, f.endTime) : null)
    : (count != null && Number.isInteger(count) && count > 0 ? count : null);
  const amountCents = qty != null && rateCents != null ? payrollAmountCents(qty, rateCents) : 0;
  const ready = !!f.person.trim() && qty != null && qty > 0 && !!rateCents && rateCents > 0;

  return (
    <Card title="Log work">
      <form className="max-w-sm space-y-2 text-sm" onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        const res = await fetch("/api/payroll", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            person: f.person, workDate: f.workDate, basis,
            startTime: f.startTime, endTime: f.endTime, qty: count,
            rateCents, note: f.note || null,
          }),
        });
        if (res.ok) location.reload();
        else setError((await res.json()).error ?? "Could not save");
      }}>
        <div className="flex rounded-xl border border-line p-0.5">
          {PAYROLL_BASES.map((b) => (
            <button key={b} type="button" onClick={() => pickBasis(b)}
              className={`flex-1 rounded-lg px-3 py-1.5 ${b === basis ? "bg-brand-600 font-medium text-white" : "text-slate-500 hover:text-slate-900"}`}>
              {basisLabel(b)}
            </button>
          ))}
        </div>
        <input className={`w-full ${INPUT_CLASS}`} placeholder="Person" value={f.person}
          onChange={(e) => pickPerson(e.target.value)} required />
        <input type="date" className={`w-full ${INPUT_CLASS}`} value={f.workDate}
          onChange={(e) => setF({ ...f, workDate: e.target.value })} required />
        {basis === "hour" ? (
          <div className="flex gap-2">
            <input type="time" aria-label="Start time" className={`w-full ${INPUT_CLASS}`} value={f.startTime}
              onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
            <input type="time" aria-label="End time" className={`w-full ${INPUT_CLASS}`} value={f.endTime}
              onChange={(e) => setF({ ...f, endTime: e.target.value })} required />
          </div>
        ) : (
          <input type="number" min="1" step="1" aria-label={qtyLabel(basis)}
            className={`w-full ${INPUT_CLASS}`} placeholder={qtyLabel(basis)} value={f.count}
            onChange={(e) => setF({ ...f, count: e.target.value })} required />
        )}
        <input className={`w-full ${INPUT_CLASS}`} placeholder={`Rate ${rateLabel(basis)}`} value={f.rate}
          onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        <p className="text-slate-500">
          {qtyLabel(basis)}: <span className="font-medium">{qty == null ? "—" : basis === "hour" ? qty.toFixed(2) : qty}</span>
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

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: one error only — `src/app/payroll/page.tsx` renders `<PayrollForm />` without the new required `rates` prop. Task 10 fixes it. If any other error appears, fix it before moving on.

- [ ] **Step 3: Commit**

```bash
git add src/components/payroll/PayrollForm.tsx
git commit -m "Log work by hour, piece or package from one form"
```

---

### Task 9: The table

Basis and Work columns replacing Shift and Hours, and a clickable Paid column.

**Files:**
- Modify: `src/components/payroll/PayrollTable.tsx` (whole file)

**Interfaces:**
- Consumes: `PayrollRow`, `workLabel`, `basisLabel`, `qtyLabel`; `PATCH /api/payroll/:id`, `PATCH /api/payroll/:id/paid`.
- Produces: `export function PayrollTable({ rows }: { rows: PayrollRow[] })` — signature unchanged.

- [ ] **Step 1: Rewrite the table**

Replace `src/components/payroll/PayrollTable.tsx` entirely:

```tsx
"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { shiftHours, payrollAmountCents } from "@/lib/calc/payroll-amount";
import { basisLabel, qtyLabel, workLabel } from "@/lib/ui/payroll-basis";
import type { PayrollRow } from "@/lib/db/payroll";

const BASIS_CLASS: Record<string, string> = {
  hour: "border-sky-200 bg-sky-50 text-sky-700",
  piece: "border-emerald-200 bg-emerald-50 text-emerald-700",
  package: "border-violet-200 bg-violet-50 text-violet-700",
};

export function PayrollTable({ rows }: { rows: PayrollRow[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ person: "", workDate: "", startTime: "", endTime: "", count: "", rate: "" });

  function startEdit(r: PayrollRow) {
    setEditing(r.id);
    setDraft({
      person: r.person, workDate: r.workDate,
      startTime: r.startTime ?? "", endTime: r.endTime ?? "",
      count: r.basis === "hour" ? "" : String(r.qty),
      rate: (r.rateCents / 100).toFixed(2),
    });
  }

  /** The quantity the draft would save, on the row's own basis. */
  function draftQty(r: PayrollRow): number | null {
    if (r.basis === "hour") return shiftHours(draft.startTime, draft.endTime);
    const n = Number(draft.count);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  async function save(r: PayrollRow) {
    const res = await fetch(`/api/payroll/${r.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person: draft.person, workDate: draft.workDate, basis: r.basis,
        startTime: draft.startTime, endTime: draft.endTime,
        qty: draft.count === "" ? null : Number(draft.count),
        rateCents: Math.round(Number(draft.rate) * 100), note: r.note,
      }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function togglePaid(r: PayrollRow) {
    const paidOn = r.paidOn ? null : new Date().toISOString().slice(0, 10);
    const res = await fetch(`/api/payroll/${r.id}/paid`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paidOn }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  async function del(id: number) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`/api/payroll/${id}`, { method: "DELETE" });
    location.reload();
  }

  if (rows.length === 0) return <p className="text-sm text-slate-400">No work logged in range.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-sm">
        <thead><tr className="text-left text-slate-500">
          <th className="py-2">Date</th><th>Person</th><th>Basis</th><th>Work</th>
          <th>Rate</th><th>Amount</th><th>Paid</th><th>Note</th><th></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => editing === r.id ? (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2"><input type="date" className={INPUT_CLASS} value={draft.workDate} onChange={(e) => setDraft({ ...draft, workDate: e.target.value })} /></td>
              <td><input className={INPUT_CLASS} value={draft.person} onChange={(e) => setDraft({ ...draft, person: e.target.value })} /></td>
              <td className="text-slate-500">{basisLabel(r.basis)}</td>
              <td className="py-2">
                {r.basis === "hour" ? (
                  <span className="flex gap-1">
                    <input type="time" className={INPUT_CLASS} value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
                    <input type="time" className={INPUT_CLASS} value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
                  </span>
                ) : (
                  <input type="number" min="1" step="1" aria-label={qtyLabel(r.basis)} className={`w-24 ${INPUT_CLASS}`}
                    value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} />
                )}
              </td>
              <td><input className={`w-20 ${INPUT_CLASS}`} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></td>
              <td><Money cents={payrollAmountCents(draftQty(r), Math.round(Number(draft.rate) * 100))} /></td>
              <td className="text-slate-400">—</td>
              <td>{r.note ?? "—"}</td>
              <td className="whitespace-nowrap">
                <button className="text-brand-600 hover:underline" onClick={() => save(r)}>Save</button>
                <button className="ml-2 text-slate-400 hover:text-slate-900" onClick={() => setEditing(null)}>Cancel</button>
              </td>
            </tr>
          ) : (
            <tr key={r.id} className="border-t border-line">
              <td className="py-2">{r.workDate}</td>
              <td>{r.person}</td>
              <td>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${BASIS_CLASS[r.basis]}`}>{r.basis}</span>
              </td>
              <td>
                {workLabel(r.basis, r.qty)}
                {r.basis === "hour" && r.startTime && (
                  <span className="ml-2 text-xs text-slate-400">{r.startTime}–{r.endTime}</span>
                )}
              </td>
              <td><Money cents={r.rateCents} /></td>
              <td><Money cents={r.amountCents} /></td>
              <td>
                <button onClick={() => togglePaid(r)}
                  title={r.paidOn ? "Click to mark unpaid" : "Click to mark paid today"}
                  className={r.paidOn ? "text-emerald-600 hover:underline" : "font-medium text-amber-600 hover:underline"}>
                  {r.paidOn ? `☑ ${r.paidOn}` : "☐ unpaid"}
                </button>
              </td>
              <td>{r.note ?? "—"}</td>
              <td className="whitespace-nowrap">
                <button className="text-slate-400 hover:text-slate-900" onClick={() => startEdit(r)}>Edit</button>
                <button className="ml-2 text-slate-400 hover:text-red-600" onClick={() => del(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

A row's basis is fixed once saved — the edit row shows it as text, not a control. Changing how a job was paid means deleting the entry and logging it again, which is the honest operation.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: still only the `PayrollForm` prop error from Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/components/payroll/PayrollTable.tsx
git commit -m "Show pay basis, work done and paid state in the payroll table"
```

---

### Task 10: The page — owed stat and rates card

Wire everything together and add the rates editor.

**Files:**
- Modify: `src/app/payroll/page.tsx`
- Create: `src/components/payroll/PayrollRates.tsx`

**Interfaces:**
- Consumes: `owedPayrollCents`, `payrollByPerson` (now with `owedCents`), `listPayrollRates`, `PayrollForm({ rates })`, `PUT /api/payroll/rates`.
- Produces: `export function PayrollRates({ rates, people }: { rates: PayrollRate[]; people: string[] })`.

- [ ] **Step 1: Write the rates card**

Create `src/components/payroll/PayrollRates.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { PAYROLL_BASES, basisLabel } from "@/lib/ui/payroll-basis";
import type { PayrollBasis } from "@/lib/db/payroll";
import type { PayrollRate } from "@/lib/db/payroll-rates";

/** `people` is everyone who appears in payroll history, so the card lists the
 *  workers you actually have without asking you to name them again. */
export function PayrollRates({ rates, people }: { rates: PayrollRate[]; people: string[] }) {
  const [adding, setAdding] = useState("");
  const named = Array.from(new Set([...people, ...rates.map((r) => r.person)])).sort();

  const rateFor = (person: string, basis: PayrollBasis) =>
    rates.find((r) => r.person === person && r.basis === basis);

  async function save(person: string, basis: PayrollBasis, value: string) {
    const rateCents = value.trim() === "" ? null : Math.round(Number(value) * 100);
    if (rateCents != null && !Number.isFinite(rateCents)) return;
    const res = await fetch("/api/payroll/rates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person, basis, rateCents }),
    });
    if (res.ok) location.reload(); else alert((await res.json()).error ?? "Could not save");
  }

  return (
    <Card title="Rates">
      {named.length === 0 ? (
        <p className="text-sm text-slate-400">Log some work first, then set each person&apos;s default rates here.</p>
      ) : (
        <table className="text-sm">
          <thead><tr className="text-left text-slate-500">
            <th className="py-1 pr-6">Person</th>
            {PAYROLL_BASES.map((b) => <th key={b} className="px-3 py-1 font-normal">{basisLabel(b)}</th>)}
          </tr></thead>
          <tbody>
            {named.map((person) => (
              <tr key={person} className="border-t border-line">
                <td className="py-2 pr-6">{person}</td>
                {PAYROLL_BASES.map((b) => (
                  <td key={b} className="px-3 py-2">
                    <input className={`w-24 ${INPUT_CLASS}`} placeholder="—"
                      aria-label={`${person} ${basisLabel(b)} rate`}
                      defaultValue={rateFor(person, b) ? (rateFor(person, b)!.rateCents / 100).toFixed(2) : ""}
                      onBlur={(e) => {
                        const current = rateFor(person, b);
                        const was = current ? (current.rateCents / 100).toFixed(2) : "";
                        if (e.target.value.trim() !== was) save(person, b, e.target.value);
                      }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex gap-2 text-sm">
        <input className={INPUT_CLASS} placeholder="Add a person" value={adding}
          onChange={(e) => setAdding(e.target.value)} />
        <button className="text-brand-600 hover:underline"
          onClick={() => { if (adding.trim()) save(adding, "hour", "0.00"); }}>Add</button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        These only pre-fill the form. Any entry can be saved at a different rate, and changing a
        rate here never alters work already logged.
      </p>
    </Card>
  );
}
```

Adding a person writes a `$0` hour rate, which the API turns into a delete — so the name only sticks once a real rate is typed into the row. Blank a field to drop that default.

- [ ] **Step 2: Update the page**

Replace `src/app/payroll/page.tsx` entirely:

```tsx
import { Suspense } from "react";
import { dbForRequest } from "@/lib/auth/request";
import { listPayroll, totalPayrollCents, owedPayrollCents, payrollByPerson } from "@/lib/db/payroll";
import { listPayrollRates } from "@/lib/db/payroll-rates";
import { rangeFromParams } from "@/lib/ui/expense-range";
import { PayrollForm } from "@/components/payroll/PayrollForm";
import { PayrollTable } from "@/components/payroll/PayrollTable";
import { PayrollRates } from "@/components/payroll/PayrollRates";
import { PayrollMonthFilter } from "@/components/payroll/PayrollMonthFilter";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const range = rangeFromParams(sp);
  const db = await dbForRequest();
  const rows = listPayroll(db, range);
  const byPerson = payrollByPerson(db, range);
  const rates = listPayrollRates(db);
  // Everyone in payroll history, not just this range, so the rates card does not
  // lose a worker the moment you filter to a month they did not work.
  const people = payrollByPerson(db).map((p) => p.person);
  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Work logged, charged to that day's shows" action={<Suspense fallback={null}><PayrollMonthFilter /></Suspense>} />
      <div className="grid gap-4 sm:grid-cols-[auto,auto,1fr] sm:items-start">
        <Stat label={range ? "Total (selected period)" : "Total payroll"} value={<Money cents={totalPayrollCents(db, range)} />} />
        <Stat label="Still owed" value={<Money cents={owedPayrollCents(db, range)} />} sub="Logged, not yet marked paid" />
        <Card title="By person">
          {byPerson.length === 0 ? <p className="text-sm text-slate-400">No payroll in range.</p> : (
            <ul className="space-y-1 text-sm">
              {byPerson.map((p) => (
                <li key={p.person} className="flex justify-between gap-6">
                  <span>{p.person}</span>
                  <span className="flex gap-4">
                    <span className="font-medium"><Money cents={p.totalCents} /></span>
                    <span className={p.owedCents > 0 ? "text-amber-600" : "text-slate-400"}>
                      {p.owedCents > 0 ? <><Money cents={p.owedCents} /> owed</> : "paid up"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <PayrollTable rows={rows} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <PayrollForm rates={rates} />
        <PayrollRates rates={rates} people={people} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, every test.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/payroll/page.tsx src/components/payroll/PayrollRates.tsx
git commit -m "Show what is still owed and edit rate defaults on the payroll page"
```

---

### Task 11: Manual verification and docs

The one thing tests cannot check: that a real database migrates and the page works in a browser.

**Files:**
- Modify: `README.md` (the To do list)

- [ ] **Step 1: Run the dev server against real data**

Run: `npm run dev`, open `http://localhost:3000/payroll`.

Verify: existing hourly entries still show their times and hours, and the page did not error on open — that is the migration running against your actual workspace database.

- [ ] **Step 2: Walk the feature**

1. Log a piece entry: person, today, Piece, 300, rate 0.15 → row reads `300 pieces`, `$0.15`, `$45.00`, `☐ unpaid`.
2. Set that person's piece rate in the Rates card to `0.15`; retype their name in the form with Piece selected → the rate pre-fills.
3. Click the unpaid marker → it becomes today's date, and Still owed drops by $45.00.
4. Edit the entry's count to 400 → amount becomes $60.00 and the paid date is still there.
5. Log an hourly shift → the time inputs come back and the hours still derive.
6. Check the dashboard: a piece entry dated on a show day is inside that show's labor; one on a day with no show appears as unallocated labor.

- [ ] **Step 3: Round-trip a backup**

In Settings, export the workspace to Excel and re-import it. Verify the piece entry, its paid date, and the rates all survive.

- [ ] **Step 4: Update the README to-do list**

In `README.md`, the To do list is where this feature was implicitly waiting. Add a line recording what was deliberately left out, so it is not rediscovered as a bug:

```markdown
- Payroll: sub-penny piece rates (rate_cents is whole cents), and auto-counting pieces from show or invoice data
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Note the piece-rate payroll follow-ups"
```

---

## Verification

The change is done when:

- `npm test` passes, including the unchanged `labor-allocation` and `ledger-report` tests — the proof that net profit was not disturbed.
- `npx tsc --noEmit` and `npm run build` are clean.
- An existing workspace database opens with its hourly history intact as `basis='hour'`.
- All three bases can be logged, marked paid, and unmarked, and Still owed matches the sum of unpaid entries in the selected range.
- An Excel backup round-trips basis, qty, paid dates, and rates.
