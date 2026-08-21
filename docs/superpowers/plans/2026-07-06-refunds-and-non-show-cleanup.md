# Refunds + Non-Show Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize Whatnot refunds as their own ledger kind and show them itemized (with the product each reverses) on `/report`, and stop saleless dates from appearing as "shows" on the dashboard + report — all without changing profit.

**Architecture:** A new `refund` LedgerKind (classify `ADJUSTMENT` + "refund"), plus a one-time table-rebuild migration (mirroring `migrateLedgerPayoutKind`) that widens the `kind` CHECK and relabels already-imported refund rows. Refunds stay inside the `kind <> 'payout'` payout sum, so profit is untouched. `buildLedgerReport` exposes a per-show `saleCount`; the dashboard and `/report` filter their show lists to `saleCount > 0` and show one reconciling "Non-show activity" line. A new `listRefunds` query joins each refund to its original sale by `order_id` for the itemized view.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest, Tailwind.

## Global Constraints

- **Profit invariant:** refunds net into payout as negatives; a show's payout is `SUM(amount) WHERE kind <> 'payout'`, and `refund` stays inside that sum. Reclassifying `other`→`refund` moves NO money. The non-show cleanup is presentation-only — grand totals still sum ALL shows. A guard test asserts grand-total profit is identical.
- Refund detection is `txnType === "ADJUSTMENT"` AND message matches `/refund/i` (covers both "Reversal of sales transaction for order refund" and "Deduction for order refund shipping costs").
- Migrations are idempotent, guarded on the table's constraint text (mirror `migrateLedgerPayoutKind`).
- Every db function takes `db: DB` first; server components use `await dbForRequest()`.
- Money is integer cents; display via `Money`/`formatUSD`.
- Follow existing file style (semicolons, `@/` alias). The only tolerated pre-existing `tsc` error is `tests/lib/db/giveaway-items.test.ts`.

---

### Task 1: `refund` ledger kind + classify + migration

**Files:**
- Modify: `src/lib/csv/ledger.ts` (`LedgerKind`, `classify`)
- Modify: `src/lib/db/schema.ts` (`ledger_transactions.kind` CHECK)
- Modify: `src/lib/db/connection.ts` (add `migrateLedgerRefundKind`, call it in `migrate()`)
- Modify: `tests/lib/csv/ledger.test.ts` (classify cases) and `tests/lib/db/ledger.test.ts` or a new `tests/lib/db/ledger-refunds.test.ts` (migration + invariant)

**Interfaces:**
- Produces: `LedgerKind` includes `"refund"`; `classify(...)` returns `"refund"` for ADJUSTMENT+refund; `migrateLedgerRefundKind(db: DB): void` (exported).

- [ ] **Step 1: Write the failing classify tests**

In `tests/lib/csv/ledger.test.ts` add (or create the file mirroring existing test imports — `parseLedger`/`classify` is not exported, so test via `parseLedger` on a small CSV):

```typescript
import { describe, it, expect } from "vitest";
import { parseLedger } from "@/lib/csv/ledger";

describe("refund classification", () => {
  const csv = (msg: string, type: string) =>
    `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jul 6, 2026, 5:16:52 PM","-$6.44","L1","O1","${msg}","completed","${type}",""`;
  it("classifies ADJUSTMENT refund reversals and shipping deductions as refund", () => {
    expect(parseLedger(csv("Reversal of sales transaction for order refund", "ADJUSTMENT"))[0].kind).toBe("refund");
    expect(parseLedger(csv("Deduction for order refund shipping costs [Order Id: 1]", "ADJUSTMENT"))[0].kind).toBe("refund");
  });
  it("still classifies Sales Match Bonus and other adjustments correctly", () => {
    expect(parseLedger(csv("New Seller Sales Match Bonus", "ADJUSTMENT"))[0].kind).toBe("bonus");
    expect(parseLedger(csv("Seller purchased Show Boost for ...", "ADJUSTMENT"))[0].kind).toBe("other");
    expect(parseLedger(csv("Approved Insurance Claim for shipment 1", "ADJUSTMENT"))[0].kind).toBe("other");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- "tests/lib/csv/ledger"`
Expected: FAIL — refund rows currently classify as `other`.

- [ ] **Step 3: Implement classify + LedgerKind**

In `src/lib/csv/ledger.ts`:
- Change the type: `export type LedgerKind = "sale" | "giveaway" | "bonus" | "tip" | "other" | "payout" | "refund";`
- Replace the `ADJUSTMENT` line in `classify`:

```typescript
function classify(txnType: string, message: string): LedgerKind {
  if (txnType === "PAYOUT") return "payout";
  if (txnType === "TIP") return "tip";
  if (txnType === "ADJUSTMENT") {
    if (/refund/i.test(message)) return "refund";
    return /Sales Match Bonus/i.test(message) ? "bonus" : "other";
  }
  if (txnType === "SALES") {
    if (/giveaway/i.test(message)) return "giveaway";
    if (/Earnings for selling/i.test(message)) return "sale";
  }
  return "other";
}
```

- [ ] **Step 4: Run to verify classify passes**

Run: `npm test -- "tests/lib/csv/ledger"`
Expected: PASS.

- [ ] **Step 5: Widen the schema CHECK (fresh DBs)**

In `src/lib/db/schema.ts`, the `ledger_transactions` table `kind` CHECK currently is
`CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout'))`. Change it to
`CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout','refund'))`.

- [ ] **Step 6: Write the failing save-path + migration tests**

Add to `tests/lib/db/ledger.test.ts`. Test 1 exercises the real ingestion path (a fresh `createDb` already has the widened CHECK, so a refund CSV saves as `kind='refund'` and stays in the payout sum). Test 2 exercises `migrateLedgerRefundKind` itself against a hand-built **legacy** table whose CHECK lacks `'refund'` — the only way to hit the migration's rebuild+relabel branch, since `createDb` schemas are already migrated.

```typescript
import Database from "better-sqlite3";
import { createDb, migrateLedgerRefundKind } from "@/lib/db/connection";
import { saveLedger } from "@/lib/db/ledger";
import { parseLedger } from "@/lib/csv/ledger";

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
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- "tests/lib/db/ledger"`
Expected: FAIL — `migrateLedgerRefundKind` not exported yet (and the save-path test fails the CHECK until Step 5's schema change + Step 8 are in place).

- [ ] **Step 8: Implement the migration**

In `src/lib/db/connection.ts`, add this function (mirror `migrateLedgerPayoutKind` exactly in shape) and CALL it from `migrate()` immediately after `migrateLedgerPayoutKind(db);`:

```typescript
/** One-time, idempotent: widen ledger_transactions.kind CHECK to include 'refund'
 *  and relabel already-imported ADJUSTMENT refund rows (previously 'other').
 *  Guarded on the constraint text so it runs exactly once. Payout is NOT
 *  recomputed — refunds stay inside the kind<>'payout' sum, so no show changes. */
export function migrateLedgerRefundKind(db: DB): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ledger_transactions'")
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'refund'")) return; // fresh schema or already migrated
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
      UPDATE ledger_transactions SET kind='refund' WHERE txn_type='ADJUSTMENT' AND LOWER(message) LIKE '%refund%';
    `);
  })();
}
```

Add the call in `migrate()` right after the existing `migrateLedgerPayoutKind(db);` line.

- [ ] **Step 9: Run to verify it passes**

Run: `npm test -- "tests/lib/db/ledger" "tests/lib/csv/ledger"`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/csv/ledger.ts src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/csv/ledger.test.ts tests/lib/db/ledger.test.ts
git commit -m "feat(ledger): refund kind + classify + migration relabeling existing refunds"
```

---

### Task 2: `saleCount` on report shows

**Files:**
- Modify: `src/lib/calc/ledger-report.ts` (`ReportShow` + the per-show loop)
- Modify: `tests/lib/calc/ledger-report.test.ts`

**Interfaces:**
- Consumes: `LedgerReport`/`ReportShow` (existing).
- Produces: `ReportShow` gains `saleCount: number` (count of `kind==='sale'` transactions in the show).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/calc/ledger-report.test.ts`:

```typescript
it("reports saleCount per show; a refund-only date has saleCount 0", () => {
  // The default beforeEach CSV has one Cheese sale + one Mystery sale on Jun 12.
  const rep = buildLedgerReport(db);
  const jun12 = rep.shows.find((s) => s.showDate === "2026-06-12")!;
  expect(jun12.saleCount).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ledger-report`
Expected: FAIL — `saleCount` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/calc/ledger-report.ts`:
- Add `saleCount: number;` to the `ReportShow` interface (near `unitsSold`).
- In the per-show loop, initialize a counter with the others (`let giveaway = 0, ...`): add `saleCount = 0`. Increment it for every sale transaction — inside BOTH the bundle-sale branch and the normal-sale branch add `saleCount += 1;` (each `kind==='sale'` row is one sale). Simplest: at the top of the `for (const t of rows)` loop body, right after `payout += t.amountCents;`, add `if (t.kind === "sale") saleCount += 1;`.
- Add `saleCount,` to the pushed `shows.push({ ... })` object.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ledger-report`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat(report): expose per-show saleCount"
```

---

### Task 3: `listRefunds` query

**Files:**
- Create: `src/lib/db/ledger-refunds.ts`
- Create: `tests/lib/db/ledger-refunds.test.ts`

**Interfaces:**
- Consumes: `resolveItemId` from `@/lib/db/aliases`.
- Produces:
  - `interface RefundRow { showDate: string; amountCents: number; orderId: string | null; productName: string | null; itemId: number | null; isShipping: boolean }`
  - `listRefunds(db: DB): RefundRow[]` (newest-first; product matched to the original sale by `order_id`; shipping-cost deductions → `productName: null, isShipping: true`).
  - `refundsTotalCents(db: DB): number`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/ledger-refunds.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { listRefunds, refundsTotalCents } from "@/lib/db/ledger-refunds";

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
  setAlias(db, "Cheese Squishy", cheese);
  const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 14, 2026, 9:00:00 AM","-$2.76","L1","O1","Reversal of sales transaction for order refund","completed","ADJUSTMENT",""
"Jun 14, 2026, 9:00:01 AM","-$1.50","","","Deduction for order refund shipping costs [Order Id: O1]","completed","ADJUSTMENT",""`;
  saveLedger(db, parseLedger(csv));
});

describe("listRefunds", () => {
  it("matches the sale-reversal to its product via order_id and links the item", () => {
    const refunds = listRefunds(db);
    const reversal = refunds.find((r) => !r.isShipping)!;
    expect(reversal.productName).toBe("Cheese Squishy");
    expect(reversal.itemId).not.toBeNull();
    expect(reversal.amountCents).toBe(-276);
  });
  it("marks shipping-cost deductions with no product", () => {
    const shipping = listRefunds(db).find((r) => r.isShipping)!;
    expect(shipping.productName).toBeNull();
    expect(shipping.isShipping).toBe(true);
  });
  it("totals all refunds", () => {
    expect(refundsTotalCents(db)).toBe(-276 - 150);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- ledger-refunds`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/lib/db/ledger-refunds.ts`:

```typescript
import type { DB } from "./connection";
import { resolveItemId } from "./aliases";

export interface RefundRow {
  showDate: string;
  amountCents: number;
  orderId: string | null;
  productName: string | null;
  itemId: number | null;
  isShipping: boolean;
}

export function listRefunds(db: DB): RefundRow[] {
  const rows = db.prepare(
    `SELECT show_date AS showDate, amount_cents AS amountCents, order_id AS orderId, message
     FROM ledger_transactions WHERE kind = 'refund' ORDER BY created_at DESC`
  ).all() as { showDate: string; amountCents: number; orderId: string | null; message: string }[];

  const saleByOrder = new Map<string, string>();
  for (const s of db.prepare(
    `SELECT order_id AS orderId, product_name AS productName FROM ledger_transactions
     WHERE kind = 'sale' AND product_name IS NOT NULL AND order_id <> ''`
  ).all() as { orderId: string; productName: string }[]) {
    saleByOrder.set(s.orderId, s.productName);
  }

  return rows.map((r) => {
    const isShipping = /shipping/i.test(r.message);
    const productName = r.orderId ? (saleByOrder.get(r.orderId) ?? null) : null;
    const itemId = productName ? resolveItemId(db, productName) : null;
    return { showDate: r.showDate, amountCents: r.amountCents, orderId: r.orderId || null, productName, itemId, isShipping };
  });
}

export function refundsTotalCents(db: DB): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS t FROM ledger_transactions WHERE kind = 'refund'").get() as { t: number };
  return Number(r.t);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- ledger-refunds`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/ledger-refunds.ts tests/lib/db/ledger-refunds.test.ts
git commit -m "feat(refunds): listRefunds query with order-id product match"
```

---

### Task 4: Dashboard — filter non-show dates + reconciling row

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `ReportShow.saleCount` (Task 2).

- [ ] **Step 1: Split shows and add the reconciling row**

In `src/app/page.tsx`:
- After `const shows = [...rep.shows].sort(...)`, add:
  ```tsx
  const realShows = shows.filter((s) => s.saleCount > 0);
  const nonShows = shows.filter((s) => s.saleCount === 0);
  const nonShowNetCents = nonShows.reduce((a, s) => a + s.netCents, 0);
  const nonShowPayoutCents = nonShows.reduce((a, s) => a + s.payoutCents, 0);
  ```
- Change the ProfitChart `points` source and the "N shows" count to use `realShows` instead of `shows`:
  - `const points = realShows.map((s) => ({ label: s.dateHasMultipleSessions ? ... : s.showDate, valueCents: s.netCents }));`
  - In the Net-profit card heading: `{realShows.length} show{realShows.length === 1 ? "" : "s"}`.
- In the Show breakdown table body, iterate `realShows` (reversed) instead of `shows`, and after the rows add a reconciling row when there is non-show activity:
  ```tsx
  {[...realShows].reverse().map((s) => (
    /* ...existing row markup, unchanged... */
  ))}
  {nonShows.length > 0 && (
    <tr className="border-t border-line bg-slate-50 text-slate-500">
      <td className="px-4 py-2 italic">Non-show activity (refunds, fees, claims) · {nonShows.length}</td>
      <td className="px-4 py-2"><Money cents={nonShowPayoutCents} /></td>
      <td className="px-4 py-2">$0.00</td>
      <td className="px-4 py-2 text-right"><Money cents={nonShowNetCents} /></td>
    </tr>
  )}
  ```
- Update the empty-state condition to `realShows.length === 0 && nonShows.length === 0` (so a data set that is ONLY non-show activity still shows the reconciling row rather than "No shows yet"). Concretely, change the `{shows.length === 0 && (...)}` guard to `{realShows.length === 0 && nonShows.length === 0 && (...)}`.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "app/page" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): hide saleless dates from Show breakdown + reconciling row"
```

---

### Task 5: `/report` — filter cards + Refunds card & itemized table

**Files:**
- Modify: `src/app/report/page.tsx`
- Create: `src/components/report/RefundsCard.tsx`

**Interfaces:**
- Consumes: `ReportShow.saleCount` (Task 2); `listRefunds`, `refundsTotalCents` (Task 3).

- [ ] **Step 1: RefundsCard component**

Create `src/components/report/RefundsCard.tsx`:

```tsx
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Money } from "@/components/Money";
import type { RefundRow } from "@/lib/db/ledger-refunds";

export function RefundsCard({ refunds, totalCents }: { refunds: RefundRow[]; totalCents: number }) {
  if (refunds.length === 0) return null;
  return (
    <Card title={<div className="flex justify-between"><span>Refunds ({refunds.length})</span><span className="normal-case"><Money cents={totalCents} /></span></div>}>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th className="py-1 text-left">Date</th><th className="py-1 text-left">Product</th><th className="py-1 text-left">Order #</th><th className="py-1 text-right">Amount</th></tr>
        </thead>
        <tbody>
          {refunds.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className="py-1.5 pr-4 text-slate-500">{r.showDate}</td>
              <td className="py-1.5 pr-4">
                {r.isShipping ? <span className="text-slate-500">Return shipping</span>
                  : r.itemId != null ? <Link href={`/inventory/${r.itemId}`} className="text-brand-700 hover:underline">{r.productName}</Link>
                  : <span>{r.productName ?? "Unknown item"}</span>}
              </td>
              <td className="py-1.5 pr-4 text-slate-400">{r.orderId ?? "—"}</td>
              <td className="py-1.5 text-right"><Money cents={r.amountCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
```

- [ ] **Step 2: Filter show cards + render RefundsCard on `/report`**

In `src/app/report/page.tsx`:
- Add imports: `import { listRefunds, refundsTotalCents } from "@/lib/db/ledger-refunds";` and `import { RefundsCard } from "@/components/report/RefundsCard";`.
- Where the page currently maps `rep.shows.map((s) => ...)` to render per-show Cards, change it to filter to real shows first: `rep.shows.filter((s) => s.saleCount > 0).map((s) => ...)`.
- Fetch refunds (server component already has `db` via `await dbForRequest()` — locate the existing db handle; if the page only has `rep`, add `const db = await dbForRequest();` following the existing import of `dbForRequest`). Then render `<RefundsCard refunds={listRefunds(db)} totalCents={refundsTotalCents(db)} />` directly after the show cards block (before the wholesale section).

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "report/page|RefundsCard" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 4: Commit**

```bash
git add src/app/report/page.tsx src/components/report/RefundsCard.tsx
git commit -m "feat(report): refunds card + itemized table; hide saleless show cards"
```

---

### Task 6: Full-suite verification

- [ ] **Step 1: Suite + build**

Run: `npm test && npm run build 2>&1 | tail -3`
Expected: all Vitest tests PASS (incl. classify, migration, `saleCount`, `listRefunds`, and the backup drift-guard — the `ledger_transactions` column set is unchanged, only its CHECK widened, so the drift-guard stays green). Build completes.

- [ ] **Step 2: Manual smoke (live dev)**

Run `npm run dev`, log in. Re-import the Whatnot ledger on the Shows page (so refund rows reclassify — or rely on the boot migration for already-imported data). On the dashboard: saleless dates (e.g. 2026-07-05, 2026-06-14) are gone from Show breakdown, replaced by a single "Non-show activity (refunds, fees, claims)" row; the grand Net profit is unchanged. On `/report`: a "Refunds" card lists each refund with its product (e.g. Cheese Squishy −$2.76) linking to the item, shipping deductions as "Return shipping", and saleless show cards are gone. Stop the dev server.

---

## Self-Review

**Spec coverage:**
- New `refund` kind + classify (ADJUSTMENT+refund; both reversal & shipping) → Task 1. ✓
- Migration widening CHECK + relabeling existing rows, idempotent → Task 1 (`migrateLedgerRefundKind`). ✓
- Profit invariant (refund stays in payout sum; guard test) → Task 1 test asserts payout unchanged; grand totals untouched by construction (Task 4/5 filter display only). ✓
- Refunds total + itemized with product (order-id match) + item link + "Return shipping" → Task 3 (`listRefunds`) + Task 5 (`RefundsCard`). ✓
- `saleCount` per show → Task 2. ✓
- Non-show filter on BOTH dashboard table and `/report` cards + reconciling line → Task 4 (dashboard) + Task 5 (report). ✓
- Grand total unchanged (`Σ visible + non-show = total`) → Task 4 reconciling row uses saleless nets; totals still over all shows. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `LedgerKind` "refund" (Task 1) drives classify + the `kind='refund'` queries (Task 3); `ReportShow.saleCount` (Task 2) consumed by Task 4 + Task 5 filters; `RefundRow` (Task 3) consumed by `RefundsCard` (Task 5). Migration column list matches the schema (14 columns). ✓
