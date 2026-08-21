# Exclude Bank Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Whatnot `PAYOUT` (bank-withdrawal) transactions from corrupting show P&L by giving them their own `payout` kind that is excluded from all payout/profit totals, and surface a single "Paid to bank" figure on the dashboard.

**Architecture:** Add a `payout` ledger kind. The classifier tags `txn_type='PAYOUT'` rows as `payout`; persistence and report calc exclude that kind from payout sums and instead accumulate a `withdrawnToBankCents` total. A guarded, idempotent migration widens the `kind` CHECK constraint, reclassifies the already-imported PAYOUT row, and recomputes affected shows so existing data is corrected.

**Tech Stack:** Next.js 15, better-sqlite3, TypeScript, Vitest.

---

## File structure

- `src/lib/csv/ledger.ts` — classifier; add `"payout"` to `LedgerKind`, classify `PAYOUT`.
- `src/lib/db/schema.ts` — widen `ledger_transactions.kind` CHECK.
- `src/lib/db/connection.ts` — new `migrateLedgerPayoutKind(db)`, called from `migrate()`.
- `src/lib/db/ledger.ts` — per-show payout recompute excludes `payout` kind.
- `src/lib/calc/ledger-report.ts` — exclude `payout` from `payoutCents`; add `withdrawnToBankCents`.
- `src/lib/calc/dashboard.ts` — add `paidToBankCents`.
- `src/lib/csv/ledger-preview.ts` — add `payoutCount`.
- `src/app/page.tsx` — "Paid to bank" Stat.
- Tests under `tests/lib/...` mirror each.

---

## Task 1: Classify PAYOUT as its own kind

**Files:**
- Modify: `src/lib/csv/ledger.ts`
- Test: `tests/lib/csv/ledger.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/csv/ledger.test.ts`:

```ts
it("classifies a PAYOUT (bank withdrawal) as kind 'payout'", () => {
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","-$534.39","","","Payout to bank account","completed","PAYOUT","z"`;
  const rows = parseLedger(csv);
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("payout");
  expect(rows[0].amountCents).toBe(-53439);
});
```

(If `tests/lib/csv/ledger.test.ts` does not already `import { parseLedger } from "@/lib/csv/ledger";`, add it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/ledger.test.ts -t "PAYOUT"`
Expected: FAIL — `expected 'other' to be 'payout'`.

- [ ] **Step 3: Implement** — in `src/lib/csv/ledger.ts`:

Change the union:
```ts
export type LedgerKind = "sale" | "giveaway" | "bonus" | "tip" | "other" | "payout";
```
Add the first check in `classify()` (before the `TIP` line):
```ts
function classify(txnType: string, message: string): LedgerKind {
  if (txnType === "PAYOUT") return "payout";
  if (txnType === "TIP") return "tip";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/ledger.test.ts -t "PAYOUT"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/ledger.ts tests/lib/csv/ledger.test.ts
git commit -m "feat(ledger): classify PAYOUT withdrawals as 'payout' kind"
```

---

## Task 2: Widen the kind CHECK constraint

**Files:**
- Modify: `src/lib/db/schema.ts:112`
- Test: `tests/lib/db/connection.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/db/connection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/connection.test.ts -t "payout"`
Expected: FAIL — `CHECK constraint failed`.

- [ ] **Step 3: Implement** — in `src/lib/db/schema.ts` change the CHECK on `ledger_transactions.kind`:

```sql
  kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout')),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/connection.test.ts -t "payout"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts tests/lib/db/connection.test.ts
git commit -m "feat(schema): allow 'payout' kind on ledger_transactions"
```

---

## Task 3: Migration — reclassify existing PAYOUT rows + recompute shows

**Files:**
- Modify: `src/lib/db/connection.ts`
- Test: `tests/lib/db/connection.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/db/connection.test.ts` (add imports `import Database from "better-sqlite3";` and `import { SCHEMA } from "@/lib/db/schema";` and `import { migrateLedgerPayoutKind } from "@/lib/db/connection";` at the top if missing):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/connection.test.ts -t "migrates an old-format"`
Expected: FAIL — `migrateLedgerPayoutKind is not a function` / not exported.

- [ ] **Step 3: Implement** — in `src/lib/db/connection.ts`, add this exported function and call it from `migrate()`.

Add the function (e.g. below `backfillPurchases`):
```ts
/** One-time, idempotent: widen the ledger_transactions.kind CHECK to include
 *  'payout', reclassify already-imported PAYOUT rows (previously bucketed as
 *  'other'), and recompute ledger shows' payout_cents excluding withdrawals.
 *  Guarded on the constraint text, so it runs exactly once and is a no-op after. */
export function migrateLedgerPayoutKind(db: DB): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_transactions'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'payout'")) return; // fresh schema or already migrated
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
    INSERT INTO ledger_transactions_new SELECT * FROM ledger_transactions;
    DROP TABLE ledger_transactions;
    ALTER TABLE ledger_transactions_new RENAME TO ledger_transactions;
    UPDATE ledger_transactions SET kind='payout' WHERE txn_type='PAYOUT';
    UPDATE shows SET payout_cents = (
      SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions
      WHERE show_id = shows.id AND kind <> 'payout'
    ) WHERE source_hash='ledger';
  `);
}
```

In `migrate(db)`, add a call at the end (after `backfillPurchases(db);`):
```ts
  migrateLedgerPayoutKind(db);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/connection.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/connection.ts tests/lib/db/connection.test.ts
git commit -m "feat(db): migrate existing PAYOUT rows to 'payout' kind and recompute shows"
```

---

## Task 4: saveLedger excludes payout from show payout_cents

**Files:**
- Modify: `src/lib/db/ledger.ts:50-51`
- Test: `tests/lib/db/ledger.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/db/ledger.test.ts`:

```ts
it("excludes PAYOUT withdrawals from a show's payout_cents", () => {
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
  saveLedger(db, parseLedger(csv));
  const show = listShows(db).find((s) => s.showDate === "2026-06-14")!;
  expect(show.payoutCents).toBe(10000); // withdrawal NOT subtracted
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/ledger.test.ts -t "excludes PAYOUT"`
Expected: FAIL — `expected -43439 to be 10000`.

- [ ] **Step 3: Implement** — in `src/lib/db/ledger.ts`, change the `recompute` statement (line ~51):

```ts
    const recompute = db.prepare(
      "UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = ? AND kind <> 'payout') WHERE id = ?"
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/ledger.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/ledger.ts tests/lib/db/ledger.test.ts
git commit -m "feat(ledger): exclude payout kind from show payout recompute"
```

---

## Task 5: ledger-report excludes payout, adds withdrawnToBankCents

**Files:**
- Modify: `src/lib/calc/ledger-report.ts`
- Test: `tests/lib/calc/ledger-report.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/calc/ledger-report.test.ts`. (Match the file's existing setup for building a DB and saving a ledger; use `buildLedgerReport(db)`.) Use this body:

```ts
it("excludes payout withdrawals from payoutCents and reports them as withdrawnToBankCents", () => {
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
  saveLedger(db, parseLedger(csv));
  const rep = buildLedgerReport(db);
  const show = rep.shows.find((s) => s.showDate === "2026-06-14")!;
  expect(show.payoutCents).toBe(10000);
  expect(show.withdrawnToBankCents).toBe(-53439);
  expect(rep.totals.withdrawnToBankCents).toBe(-53439);
});
```

(Ensure the test file imports `saveLedger`, `parseLedger`, `buildLedgerReport`, and creates `db` via `createDb(":memory:")` as the other cases in that file do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts -t "withdrawnToBank"`
Expected: FAIL — `payoutCents` is `-43439` / `withdrawnToBankCents` undefined.

- [ ] **Step 3: Implement** — in `src/lib/calc/ledger-report.ts`:

Add to the `ReportShow` interface (after `payoutCents`):
```ts
  withdrawnToBankCents: number;   // Σ of bank-withdrawal (payout-kind) amounts; signed (negative)
```
Add to `LedgerReport["totals"]` (after `partnerShareCents`):
```ts
    withdrawnToBankCents: number;
```
In the per-show loop, change the accumulator init and the payout line. Replace:
```ts
    let giveaway = 0, giveawayCount = 0, tip = 0, bonus = 0, other = 0, payout = 0;

    for (const t of rows) {
      payout += t.amountCents;
      if (t.kind === "sale" && t.productName) {
```
with:
```ts
    let giveaway = 0, giveawayCount = 0, tip = 0, bonus = 0, other = 0, payout = 0, withdrawn = 0;

    for (const t of rows) {
      if (t.kind === "payout") { withdrawn += t.amountCents; continue; }
      payout += t.amountCents;
      if (t.kind === "sale" && t.productName) {
```
Add `withdrawnToBankCents: withdrawn,` to the `shows.push({ ... })` object (next to `payoutCents: payout,`).
After the existing `const netCents = shows.reduce(...)` total line, add:
```ts
  const withdrawnToBankCents = shows.reduce((sum, s) => sum + s.withdrawnToBankCents, 0);
```
Add `withdrawnToBankCents` to the returned `totals` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat(report): exclude payout from payoutCents, add withdrawnToBankCents"
```

---

## Task 6: Dashboard summary exposes paidToBankCents

**Files:**
- Modify: `src/lib/calc/dashboard.ts`
- Test: `tests/lib/calc/dashboard.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/calc/dashboard.test.ts` (follow the file's existing DB/ledger setup helpers):

```ts
it("reports paidToBankCents and keeps withdrawals out of totalPayout", () => {
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
  saveLedger(db, parseLedger(csv));
  const d = dashboardSummary(db);
  expect(d.totalPayoutCents).toBe(10000);
  expect(d.paidToBankCents).toBe(53439); // positive amount moved to bank
});
```

(Ensure imports for `saveLedger`, `parseLedger`, `dashboardSummary`, and `createDb` exist in the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/dashboard.test.ts -t "paidToBank"`
Expected: FAIL — `paidToBankCents` undefined.

- [ ] **Step 3: Implement** — in `src/lib/calc/dashboard.ts`:

Add to `DashboardSummary` (after `totalPayoutCents`):
```ts
  paidToBankCents: number;
```
Add to the returned object (after `totalPayoutCents: ...`):
```ts
    // Total balance withdrawn to the user's bank (transfer, not income/expense).
    // report total is signed/negative; present as a positive amount.
    paidToBankCents: -report.totals.withdrawnToBankCents,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/dashboard.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/dashboard.ts tests/lib/calc/dashboard.test.ts
git commit -m "feat(dashboard): expose paidToBankCents"
```

---

## Task 7: Import preview counts payout rows

**Files:**
- Modify: `src/lib/csv/ledger-preview.ts`
- Test: `tests/lib/csv/ledger-preview.test.ts`

- [ ] **Step 1: Write the failing test** — append to `tests/lib/csv/ledger-preview.test.ts` (follow existing setup; it builds a db and calls `buildLedgerPreview(db, csv)`):

```ts
it("counts PAYOUT rows as payoutCount and keeps them out of otherCount", () => {
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank account","completed","PAYOUT","b"`;
  const prev = buildLedgerPreview(db, csv);
  const show = prev.shows.find((s) => s.showDate === "2026-06-14")!;
  expect(show.payoutCount).toBe(1);
  expect(show.otherCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/ledger-preview.test.ts -t "payoutCount"`
Expected: FAIL — `payoutCount` undefined.

- [ ] **Step 3: Implement** — in `src/lib/csv/ledger-preview.ts`:

Add `payoutCount: number;` to `LedgerPreviewShow` (after `otherCount`). Add `payoutCount: 0,` to the `s = { ... }` initializer. In the classify chain, add a branch before the final `else`:
```ts
    else if (r.kind === "bonus") s.bonusCount++;
    else if (r.kind === "payout") s.payoutCount++;
    else s.otherCount++;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/ledger-preview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/ledger-preview.ts tests/lib/csv/ledger-preview.test.ts
git commit -m "feat(preview): count payout rows in ledger import preview"
```

---

## Task 8: Dashboard UI — "Paid to bank" stat

**Files:**
- Modify: `src/app/page.tsx:40-47`

- [ ] **Step 1: Add the Stat** — inside the `<div className="grid grid-cols-2 ...">` block, add after the "Total payout" Stat:

```tsx
        <Stat label="Paid to bank" value={<Money cents={d.paidToBankCents} />} />
```

Update the grid column count if desired (it currently uses `lg:grid-cols-6` for 6 stats; with 7 stats either leave as-is — it wraps — or bump to `lg:grid-cols-7`). Leave wrapping as-is unless it looks cramped when verified in Task 9.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): show 'Paid to bank' stat"
```

---

## Task 9: Full verification + migrate real data

**Files:** none (verification + data commit)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass (37 prior + the new cases).

- [ ] **Step 2: Production typecheck/build smoke**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Apply the migration to the real DB and verify**

Start the app (`npm run dev`), which runs `migrate()` against `data/whatnot.db` on first `getDb()`. Then verify via API:

Run:
```bash
curl -s localhost:3000/api/dashboard
```
Expected: `totalPayoutCents` is **291547** (was 238108) and `paidToBankCents` is **53439**.

Also confirm the reclassification landed:
```bash
node -e "const D=require('better-sqlite3');const db=new D('data/whatnot.db',{readonly:true});console.log(db.prepare(\"SELECT kind,COUNT(*) n,SUM(amount_cents) c FROM ledger_transactions WHERE txn_type='PAYOUT' GROUP BY kind\").all())"
```
Expected: one row, `kind: 'payout'`, `n: 1`, `c: -53439`.

Open `http://localhost:3000` and confirm the "Paid to bank" stat reads **$534.39** and "Total payout" rose accordingly.

- [ ] **Step 4: Commit the migrated database**

```bash
git add data/whatnot.db
git commit -m "data: reclassify bank PAYOUT, restore corrected show payout"
```

- [ ] **Step 5: Stop the dev server** (kill the background `npm run dev`).

---

## Notes for the executor

- Only `txn_type === 'PAYOUT'` is classified as `payout`; no other withdrawal type exists in current data. Extending is a one-line change in `classify()` if Whatnot ever uses another label.
- `migrateLedgerPayoutKind` is guarded on the CHECK-constraint text, so it is safe to run on every boot and on already-migrated/fresh DBs.
- Refund `ADJUSTMENT`/`other` rows are intentionally unchanged — they correctly reduce their show's payout.
- After merge, the homelab gets the fix the same way the data arrived: pull on the homelab and rebuild its container image (`docker compose up -d --build`) so its app carries the migration too.
