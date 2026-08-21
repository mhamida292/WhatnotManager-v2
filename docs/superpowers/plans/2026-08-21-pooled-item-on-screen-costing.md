# Pooled ("Item On Screen") Costing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-workspace "pooled" costing mode so a workspace running Whatnot's random "Item On Screen" format can report profit without per-SKU sale attribution, using a blended pool average cost instead.

**Architecture:** A new `costing_mode` (`per_sku` default / `pooled`) + `avg_method` (`moving` default / `live`) setting per workspace. `buildLedgerReport` branches on it: `per_sku` keeps today's alias-resolution behavior byte-for-byte; `pooled` skips alias resolution entirely and prices every sale from a whole-pool weighted-average cost computed live from all purchase batches (and, for `moving`, a chronological purchases+sales walk). No new tables; two new `app_settings` columns and one new pure calculation module.

**Tech Stack:** Next.js (App Router, server components), better-sqlite3, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-pooled-item-on-screen-costing-design.md`

## Global Constraints

- All money is integer cents — never floats. Round with `Math.round`, matching every existing calc module.
- `per_sku` behavior must not change in any way — it is the default and remains today's exact code path.
- No stored/derived cost state — both averaging methods are pure functions recomputed live at report time, matching the app's existing "costs resolve live" philosophy (`docs/calculations.md`).
- No fork, no new repo — this ships inside the existing app as a per-workspace setting (workspaces are already isolated per user account).
- Follow existing patterns exactly: idempotent `ALTER TABLE ADD COLUMN` migrations in `src/lib/db/connection.ts`, `?? null` binding, `Money`/`Card`/`Stat`/`PageHeader`/`DataTable` UI components, camelCase DB row mapping via `AS` aliases.

---

### Task 1: `costing_mode` / `avg_method` settings

**Files:**
- Modify: `src/lib/db/schema.ts` (CREATE TABLE `app_settings`)
- Modify: `src/lib/db/connection.ts` (`migrate()`)
- Modify: `src/lib/db/settings.ts` (`Settings` interface, `getSettings`, `updateSettings`)
- Modify: `tests/lib/db/settings.test.ts`
- Modify (compile fixups — these construct a full `Settings` object literal and must include the two new required fields): `tests/lib/backup/workbook.test.ts`, `tests/lib/calc/ledger-report.test.ts`, `tests/lib/calc/dashboard.test.ts`, `tests/lib/db/admin.test.ts`

**Interfaces:**
- Produces: `Settings.costingMode: "per_sku" | "pooled"`, `Settings.avgMethod: "live" | "moving"`, exported types `CostingMode`, `AvgMethod` from `@/lib/db/settings`. Every later task that reads settings uses these two fields and these exact type names.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/settings.test.ts`, inside the existing `describe("settings", ...)` block (update the two existing `toEqual` calls too, since they assert the *entire* settings object):

```ts
  it("returns the seeded defaults", () => {
    expect(getSettings(db)).toEqual({
      ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving",
    });
  });

  it("updates and reads back", () => {
    updateSettings(db, {
      ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz",
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "pooled", avgMethod: "live",
    });
    expect(getSettings(db)).toEqual({
      ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: "DirectDealzz",
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "pooled", avgMethod: "live",
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lib/db/settings.test.ts`
Expected: FAIL — `toEqual` mismatch, missing `costingMode`/`avgMethod` keys (TypeScript will also refuse to compile once Step 5's type change lands first in practice; write the test first per TDD, then implement).

- [ ] **Step 3: Add the columns to the fresh schema**

In `src/lib/db/schema.ts`, inside `CREATE TABLE IF NOT EXISTS app_settings`, add two columns before the closing `);`:

```sql
  whatnot_only INTEGER NOT NULL DEFAULT 0,
  costing_mode TEXT NOT NULL DEFAULT 'per_sku' CHECK (costing_mode IN ('per_sku','pooled')),
  avg_method TEXT NOT NULL DEFAULT 'moving' CHECK (avg_method IN ('moving','live'))
);
```

(Replace the existing `whatnot_only INTEGER NOT NULL DEFAULT 0` line — it currently ends with `);`; the new version above ends the column list with the two new lines instead.)

- [ ] **Step 4: Add the idempotent migration**

In `src/lib/db/connection.ts`, in `migrate()`, right after the existing `if (!scols.includes("whatnot_only")) db.exec(...)` line, add:

```ts
  if (!scols.includes("costing_mode")) db.exec("ALTER TABLE app_settings ADD COLUMN costing_mode TEXT NOT NULL DEFAULT 'per_sku'");
  if (!scols.includes("avg_method")) db.exec("ALTER TABLE app_settings ADD COLUMN avg_method TEXT NOT NULL DEFAULT 'moving'");
```

(No inline `CHECK` on the `ALTER TABLE` — matches the existing `invoices.direction` precedent, which also has no `CHECK` when added via migration. Validity is enforced in `updateSettings`/the API route, added in Task 6.)

- [ ] **Step 5: Update the `Settings` type and read/write functions**

Replace the full contents of `src/lib/db/settings.ts`:

```ts
import type { DB } from "./connection";

export type CostingMode = "per_sku" | "pooled";
export type AvgMethod = "live" | "moving";

export interface Settings {
  ownerSharePct: number;
  giveawayUnitCents: number;
  defaultShippingSuppliesCents: number;
  businessName: string | null;
  invoicePhone: string | null;
  invoiceAddress: string | null;
  invoiceEmail: string | null;
  invoiceShowPhone: boolean;
  invoiceShowAddress: boolean;
  invoiceShowEmail: boolean;
  whatnotOnly: boolean;
  costingMode: CostingMode;
  avgMethod: AvgMethod;
}

export function getSettings(db: DB): Settings {
  const r = db.prepare(`SELECT owner_share_pct as ownerSharePct,
    giveaway_unit_cents as giveawayUnitCents,
    default_shipping_supplies_cents as defaultShippingSuppliesCents,
    business_name as businessName,
    invoice_phone as invoicePhone, invoice_address as invoiceAddress, invoice_email as invoiceEmail,
    invoice_show_phone as invoiceShowPhone, invoice_show_address as invoiceShowAddress, invoice_show_email as invoiceShowEmail,
    whatnot_only as whatnotOnly,
    costing_mode as costingMode, avg_method as avgMethod
    FROM app_settings WHERE id = 1`).get() as (Omit<Settings, "invoiceShowPhone"|"invoiceShowAddress"|"invoiceShowEmail"|"whatnotOnly"> & { invoiceShowPhone: number; invoiceShowAddress: number; invoiceShowEmail: number; whatnotOnly: number }) | undefined;
  if (!r) throw new Error("app_settings row is missing");
  return { ...r, invoiceShowPhone: !!r.invoiceShowPhone, invoiceShowAddress: !!r.invoiceShowAddress, invoiceShowEmail: !!r.invoiceShowEmail, whatnotOnly: !!r.whatnotOnly };
}

export function updateSettings(db: DB, s: Settings): void {
  db.prepare(`UPDATE app_settings SET owner_share_pct = ?,
    giveaway_unit_cents = ?, default_shipping_supplies_cents = ?, business_name = ?,
    invoice_phone = ?, invoice_address = ?, invoice_email = ?,
    invoice_show_phone = ?, invoice_show_address = ?, invoice_show_email = ?,
    whatnot_only = ?, costing_mode = ?, avg_method = ?
    WHERE id = 1`)
    .run(s.ownerSharePct, s.giveawayUnitCents, s.defaultShippingSuppliesCents, s.businessName,
      s.invoicePhone ?? null, s.invoiceAddress ?? null, s.invoiceEmail ?? null,
      s.invoiceShowPhone ? 1 : 0, s.invoiceShowAddress ? 1 : 0, s.invoiceShowEmail ? 1 : 0,
      s.whatnotOnly ? 1 : 0, s.costingMode, s.avgMethod);
}
```

- [ ] **Step 6: Run the settings tests to verify they pass**

Run: `npm test -- tests/lib/db/settings.test.ts`
Expected: PASS

- [ ] **Step 7: Fix other tests that construct a full `Settings` literal**

These four files build a complete `Settings` object by hand for `updateSettings` and will fail to typecheck/run without the two new fields.

In `tests/lib/backup/workbook.test.ts`, the `seed()` helper currently does:
```ts
  updateSettings(db, { ownerSharePct: 75, giveawayUnitCents: 400, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz" } as any);
```
Replace it with (also add `getSettings` to the existing `import { updateSettings } from "@/lib/db/settings";` line, making it `import { getSettings, updateSettings } from "@/lib/db/settings";`):
```ts
  updateSettings(db, { ...getSettings(db), ownerSharePct: 75, giveawayUnitCents: 400, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz" });
```

In `tests/lib/calc/ledger-report.test.ts`, both occurrences of:
```ts
    updateSettings(db, { ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false });
```
and
```ts
    updateSettings(db, { ownerSharePct: 80, giveawayUnitCents: 700, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false });
```
each get `costingMode: "per_sku", avgMethod: "moving",` appended before the closing `});` (right after `whatnotOnly: false,`).

In `tests/lib/calc/dashboard.test.ts`:
```ts
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false });
```
becomes:
```ts
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
```

In `tests/lib/db/admin.test.ts`:
```ts
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false });
```
becomes:
```ts
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
```
Also, a few lines below in the same file, change:
```ts
    expect(getSettings(db)).toEqual({ ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false });
```
to:
```ts
    expect(getSettings(db)).toEqual({ ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0, businessName: null,
      invoicePhone: null, invoiceAddress: null, invoiceEmail: null,
      invoiceShowPhone: true, invoiceShowAddress: true, invoiceShowEmail: true, whatnotOnly: false,
      costingMode: "per_sku", avgMethod: "moving" });
```

- [ ] **Step 8: Run the full suite to verify nothing else broke**

Run: `npm test`
Expected: PASS (all suites, including the four files just touched)

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/settings.ts \
  tests/lib/db/settings.test.ts tests/lib/backup/workbook.test.ts \
  tests/lib/calc/ledger-report.test.ts tests/lib/calc/dashboard.test.ts tests/lib/db/admin.test.ts
git commit -m "Add costing_mode/avg_method workspace settings"
```

---

### Task 2: `listAllPurchases` — all purchase batches across every item

**Files:**
- Modify: `src/lib/db/purchases.ts`
- Modify: `tests/lib/db/purchases.test.ts`

**Interfaces:**
- Consumes: `item_purchases` table (unchanged).
- Produces: `listAllPurchases(db: DB): { id: number; purchasedOn: string | null; quantity: number; unitCostCents: number }[]`, exported from `@/lib/db/purchases`, ordered NULL-dates-first then oldest-first then by id. Task 3 calls this directly.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/db/purchases.test.ts` (add `listAllPurchases` to the existing import line from `@/lib/db/purchases`):

```ts
  it("listAllPurchases returns every batch across all items, NULL dates first then oldest-first", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: a, purchasedOn: "2026-06-09", quantity: 5, unitCostCents: 180 });
    addPurchase(db, { itemId: b, purchasedOn: null, quantity: 2, unitCostCents: 50 });
    addPurchase(db, { itemId: a, purchasedOn: "2026-03-02", quantity: 12, unitCostCents: 150 });

    const rows = listAllPurchases(db);
    expect(rows.map((r) => r.purchasedOn)).toEqual([null, "2026-03-02", "2026-06-09"]);
    expect(rows.map((r) => r.quantity)).toEqual([2, 12, 5]);
    expect(rows.map((r) => r.unitCostCents)).toEqual([50, 150, 180]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/lib/db/purchases.test.ts`
Expected: FAIL — `listAllPurchases is not a function` / not exported.

- [ ] **Step 3: Implement**

In `src/lib/db/purchases.ts`, add near the top (after the `Purchase` interface):

```ts
export interface PurchaseRow {
  id: number;
  purchasedOn: string | null;
  quantity: number;
  unitCostCents: number;
}

/** Every purchase batch across every item, workspace-wide — the raw feed for
 *  pool-average costing (src/lib/calc/pool-cost.ts). NULL purchase dates sort
 *  first (treated as earliest-possible), then oldest-first, then by id. */
export function listAllPurchases(db: DB): PurchaseRow[] {
  return db
    .prepare(
      `SELECT id, purchased_on AS purchasedOn, quantity, unit_cost_cents AS unitCostCents
       FROM item_purchases ORDER BY purchased_on IS NULL DESC, purchased_on, id`
    )
    .all() as PurchaseRow[];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/lib/db/purchases.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/purchases.ts tests/lib/db/purchases.test.ts
git commit -m "Add listAllPurchases for workspace-wide pool costing"
```

---

### Task 3: Pool cost calculation (`live` + `moving` average)

**Files:**
- Create: `src/lib/calc/pool-cost.ts`
- Create: `tests/lib/calc/pool-cost.test.ts`

**Interfaces:**
- Consumes: `listAllPurchases(db)` (Task 2), `listLedgerTransactions(db)` from `@/lib/db/ledger` (existing — returns rows with `id`, `kind`, `amountCents`, `showDate`, `createdAt`), `ledgerTimeOfDaySeconds(createdAt)` from `@/lib/csv/ledger` (existing), `AvgMethod` type from `@/lib/db/settings` (Task 1).
- Produces: `computePoolCost(db: DB, avgMethod: AvgMethod): PoolCostResult` where
  ```ts
  interface PoolCostResult {
    currentAvgUnitCostCents: number;
    totalUnitsPurchased: number;
    totalSpendCents: number;
    totalSaleCount: number;
    costBySaleTxnId: Map<number, number>;
  }
  ```
  exported from `@/lib/calc/pool-cost`. Task 4 (`buildLedgerReport`) calls this directly and reads every field.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/calc/pool-cost.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { computePoolCost } from "@/lib/calc/pool-cost";

let db: DB;
let itemId: number;
beforeEach(() => {
  db = createDb(":memory:");
  itemId = insertItem(db, { name: "Dummy", unitCostCents: 0, qtyPurchased: 0, lotId: null });
});

const SALE = (date: string, id: string) =>
  `"${date}","$12.00","L${id}","O${id}","Earnings for selling a Item On Screen #${id}","processing","SALES",""`;

function saleCsv(rows: string[]): string {
  return `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"\n${rows.join("\n")}`;
}

describe("computePoolCost — live method", () => {
  it("returns $0 avg with no purchases", () => {
    const result = computePoolCost(db, "live");
    expect(result.currentAvgUnitCostCents).toBe(0);
    expect(result.totalUnitsPurchased).toBe(0);
  });

  it("applies one all-time blended average to every sale, regardless of purchase order", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-01-01", quantity: 10, unitCostCents: 200 });
    saveLedger(db, parseLedger(saleCsv([
      SALE("Jan 15, 2026, 10:00:00 AM", "1"),
      SALE("Jan 15, 2026, 10:01:00 AM", "2"),
      SALE("Jan 15, 2026, 10:02:00 AM", "3"),
      SALE("Jan 15, 2026, 10:03:00 AM", "4"),
    ])));
    addPurchase(db, { itemId, purchasedOn: "2026-02-01", quantity: 10, unitCostCents: 400 });

    const result = computePoolCost(db, "live");
    expect(result.totalUnitsPurchased).toBe(20);
    expect(result.totalSpendCents).toBe(6000);
    expect(result.totalSaleCount).toBe(4);
    expect(result.currentAvgUnitCostCents).toBe(300); // (2000+4000)/20
    // Even the January sales cost $3.00 once Feb's purchase is folded into the all-time average.
    expect([...result.costBySaleTxnId.values()]).toEqual([300, 300, 300, 300]);
  });
});

describe("computePoolCost — moving average (AVCO)", () => {
  it("costs a sale at $0 when it happens before any purchase exists", () => {
    saveLedger(db, parseLedger(saleCsv([SALE("Jan 1, 2026, 09:00:00 AM", "1")])));
    const result = computePoolCost(db, "moving");
    expect([...result.costBySaleTxnId.values()]).toEqual([0]);
    expect(result.currentAvgUnitCostCents).toBe(0);
  });

  it("applies a same-day purchase before that day's sales", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-03-01", quantity: 5, unitCostCents: 100 });
    saveLedger(db, parseLedger(saleCsv([SALE("Mar 1, 2026, 09:00:00 AM", "1")])));
    const result = computePoolCost(db, "moving");
    expect([...result.costBySaleTxnId.values()]).toEqual([100]);
  });

  it("locks each sale's cost at that moment's average; a later purchase never restates it", () => {
    addPurchase(db, { itemId, purchasedOn: "2026-01-01", quantity: 10, unitCostCents: 200 });
    saveLedger(db, parseLedger(saleCsv([
      SALE("Jan 15, 2026, 10:00:00 AM", "1"),
      SALE("Jan 15, 2026, 10:01:00 AM", "2"),
      SALE("Jan 15, 2026, 10:02:00 AM", "3"),
      SALE("Jan 15, 2026, 10:03:00 AM", "4"),
    ])));
    addPurchase(db, { itemId, purchasedOn: "2026-02-01", quantity: 10, unitCostCents: 400 });

    const result = computePoolCost(db, "moving");
    // All 4 January sales are locked at $2.00 — the pre-Feb average — forever.
    expect([...result.costBySaleTxnId.values()]).toEqual([200, 200, 200, 200]);
    // Current average reflects what's left: (10*200 - 4*200 + 10*400) / (10-4+10) = 5200/16.
    expect(result.currentAvgUnitCostCents).toBe(325);
    expect(result.totalUnitsPurchased).toBe(20);
    expect(result.totalSpendCents).toBe(6000);
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `npm test -- tests/lib/calc/pool-cost.test.ts`
Expected: FAIL — `Cannot find module '@/lib/calc/pool-cost'`.

- [ ] **Step 3: Implement**

Create `src/lib/calc/pool-cost.ts`:

```ts
import type { DB } from "@/lib/db/connection";
import { listAllPurchases } from "@/lib/db/purchases";
import { listLedgerTransactions } from "@/lib/db/ledger";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";
import type { AvgMethod } from "@/lib/db/settings";

export interface PoolCostResult {
  currentAvgUnitCostCents: number;
  totalUnitsPurchased: number;
  totalSpendCents: number;
  totalSaleCount: number;
  costBySaleTxnId: Map<number, number>;
}

/** Whole-pool weighted-average cost, for workspaces where a sale can't be
 *  attributed to a specific SKU (Whatnot's "Item On Screen" format). Both
 *  methods are pure and recomputed live — no stored derived state, matching
 *  how the rest of the app resolves cost (docs/calculations.md). */
export function computePoolCost(db: DB, avgMethod: AvgMethod): PoolCostResult {
  const purchases = listAllPurchases(db);
  const sales = listLedgerTransactions(db).filter((t) => t.kind === "sale");

  const totalUnitsPurchased = purchases.reduce((s, p) => s + p.quantity, 0);
  const totalSpendCents = purchases.reduce((s, p) => s + p.quantity * p.unitCostCents, 0);
  const totalSaleCount = sales.length;

  if (avgMethod === "live") {
    const avg = totalUnitsPurchased > 0 ? Math.round(totalSpendCents / totalUnitsPurchased) : 0;
    const costBySaleTxnId = new Map(sales.map((s) => [s.id, avg]));
    return { currentAvgUnitCostCents: avg, totalUnitsPurchased, totalSpendCents, totalSaleCount, costBySaleTxnId };
  }

  // Moving average (AVCO): merge purchases and sales into one chronological
  // timeline and walk it, locking each sale's cost at that moment's average.
  // Same-day: purchases apply before sales. Purchase dates are day-only
  // (no time component); sale ordering within a day uses time-of-day.
  type PurchaseEvent = { kind: "purchase"; date: string; id: number; quantity: number; unitCostCents: number };
  type SaleEvent = { kind: "sale"; date: string; timeSeconds: number; id: number };
  const events: (PurchaseEvent | SaleEvent)[] = [
    ...purchases.map((p): PurchaseEvent => ({ kind: "purchase", date: p.purchasedOn ?? "", id: p.id, quantity: p.quantity, unitCostCents: p.unitCostCents })),
    ...sales.map((s): SaleEvent => ({ kind: "sale", date: s.showDate, timeSeconds: ledgerTimeOfDaySeconds(s.createdAt), id: s.id })),
  ];
  events.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "purchase" ? -1 : 1;
    if (a.kind === "sale" && b.kind === "sale") return a.timeSeconds - b.timeSeconds || a.id - b.id;
    return a.id - b.id;
  });

  let runningUnits = 0;
  let runningValueCents = 0;
  const costBySaleTxnId = new Map<number, number>();
  for (const e of events) {
    if (e.kind === "purchase") {
      runningUnits += e.quantity;
      runningValueCents += e.quantity * e.unitCostCents;
    } else {
      const avg = runningUnits > 0 ? Math.round(runningValueCents / runningUnits) : 0;
      costBySaleTxnId.set(e.id, avg);
      runningValueCents -= avg;
      runningUnits -= 1;
    }
  }
  const currentAvgUnitCostCents = runningUnits > 0 ? Math.round(runningValueCents / runningUnits) : 0;
  return { currentAvgUnitCostCents, totalUnitsPurchased, totalSpendCents, totalSaleCount, costBySaleTxnId };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npm test -- tests/lib/calc/pool-cost.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/pool-cost.ts tests/lib/calc/pool-cost.test.ts
git commit -m "Add pool-cost: live and moving-average whole-pool costing"
```

---

### Task 4: `buildLedgerReport` branches on `costingMode`

**Files:**
- Modify: `src/lib/calc/ledger-report.ts`
- Modify: `tests/lib/calc/ledger-report.test.ts`

**Interfaces:**
- Consumes: `computePoolCost(db, avgMethod)` (Task 3), `settings.costingMode` / `settings.avgMethod` (Task 1).
- Produces: `ReportShow.pooledSales?: { amountCents: number; costCents: number; createdAt: string }[]` (populated only when pooled), `LedgerReport.pool?: PoolSummary` where
  ```ts
  interface PoolSummary {
    currentAvgUnitCostCents: number;
    totalUnitsPurchased: number;
    totalSaleCount: number;
    unitsOnHand: number;
    valueOnHandCents: number;
  }
  ```
  Both exported from `@/lib/calc/ledger-report`. Task 5 (Dashboard page) reads `LedgerReport.pool`; Task 7 (Report page) reads `ReportShow.pooledSales` and `ReportShow.products` (now `[]` for pooled shows).

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/calc/ledger-report.test.ts` (add `addPurchase` to the `@/lib/db/purchases` import — currently not imported there — and `getSettings` to the existing `@/lib/db/settings` import, making it `import { getSettings, updateSettings } from "@/lib/db/settings";`; add `import { addPurchase } from "@/lib/db/purchases";`):

```ts
describe("buildLedgerReport — pooled costing mode", () => {
  it("prices every sale from the pool average instead of per-product alias resolution", () => {
    const db2 = createDb(":memory:");
    const item = insertItem(db2, { name: "Dummy", unitCostCents: 0, qtyPurchased: 0, lotId: null });
    addPurchase(db2, { itemId: item, purchasedOn: "2026-06-01", quantity: 10, unitCostCents: 200 });
    updateSettings(db2, { ...getSettings(db2), costingMode: "pooled", avgMethod: "live" });
    saveLedger(db2, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$12.00","L1","O1","Earnings for selling a Item On Screen #1","processing","SALES",""
"Jun 12, 2026, 10:15:57 AM","$8.00","L2","O2","Earnings for selling a Item On Screen #2","processing","SALES",""`));

    const rep = buildLedgerReport(db2);
    const show = rep.shows[0];
    expect(show.products).toEqual([]);
    expect(show.unitsSold).toBe(2);
    expect(show.cogsCents).toBe(400); // 2 sales x $2.00 pool avg
    expect(show.pooledSales).toEqual([
      { amountCents: 1200, costCents: 200, createdAt: "Jun 12, 2026, 10:14:57 AM" },
      { amountCents: 800, costCents: 200, createdAt: "Jun 12, 2026, 10:15:57 AM" },
    ]);
    expect(rep.totals.revenueCents).toBe(2000); // from pooledSales, not empty products
    expect(rep.unmappedCount).toBe(0); // no alias resolution attempted at all
    expect(rep.pool).toEqual({
      currentAvgUnitCostCents: 200,
      totalUnitsPurchased: 10,
      totalSaleCount: 2,
      unitsOnHand: 8,
      valueOnHandCents: 1600,
    });
  });

  it("leaves per_sku workspaces with pool undefined and unchanged products/cogs behavior", () => {
    const rep = buildLedgerReport(db); // outer beforeEach db: default costingMode "per_sku"
    expect(rep.pool).toBeUndefined();
    expect(rep.shows[0].pooledSales).toBeUndefined();
    expect(rep.shows[0].products.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `npm test -- tests/lib/calc/ledger-report.test.ts`
Expected: FAIL — `show.products` is not `[]` (pooled branch doesn't exist yet), `rep.pool` is `undefined` vs expected object, etc.

- [ ] **Step 3: Implement**

In `src/lib/calc/ledger-report.ts`, add the import:

```ts
import { computePoolCost } from "./pool-cost";
```

Add a new interface near `ReportProductLine` (after its closing `}`):

```ts
export interface ReportPooledSale {
  amountCents: number;
  costCents: number;
  createdAt: string;
}
```

In `ReportShow`, add one field right after `products: ReportProductLine[];`:

```ts
  pooledSales?: ReportPooledSale[];
```

Add a new interface after `WholesaleRollup`:

```ts
export interface PoolSummary {
  currentAvgUnitCostCents: number;
  totalUnitsPurchased: number;
  totalSaleCount: number;
  unitsOnHand: number;
  valueOnHandCents: number;
}
```

In `LedgerReport`, add one field after `unmappedCount: number;`:

```ts
  pool?: PoolSummary;
```

Now replace the body of `buildLedgerReport` (from `const settings = getSettings(db);` through the final `return { ... };`) with:

```ts
export function buildLedgerReport(db: DB): LedgerReport {
  const settings = getSettings(db);
  const items = listItems(db);
  const itemCost = new Map(items.map((i) => [i.id, i.unitCostCents]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const giveawayUnit = new Map(
    listGiveawayItems(db).map((g) => [g.id, g.packCostCents / g.packQty])
  );
  const resolvedCache = new Map<string, number | null>();
  const resolve = (name: string): number | null => {
    if (!resolvedCache.has(name)) resolvedCache.set(name, resolveItemId(db, name));
    return resolvedCache.get(name)!;
  };
  const pool = settings.costingMode === "pooled" ? computePoolCost(db, settings.avgMethod) : null;
  const txns = listLedgerTransactions(db);
  const byShow = new Map<number, typeof txns>();
  for (const t of txns) {
    if (!byShow.has(t.showId)) byShow.set(t.showId, []);
    byShow.get(t.showId)!.push(t);
  }

  const unmapped = new Set<string>();
  const shows: ReportShow[] = [];

  const allShows = listShows(db);
  const dateCounts = new Map<string, number>();
  for (const s of allShows) dateCounts.set(s.showDate, (dateCounts.get(s.showDate) ?? 0) + 1);

  for (const s of allShows) {
    const rows = byShow.get(s.id) ?? [];
    const productMap = new Map<string, ReportProductLine>();
    const bundleLines: ReportProductLine[] = [];
    const pooledSales: ReportPooledSale[] = [];
    const componentsByTxn = getBundleComponentsByTxn(db, s.id);
    let giveaway = 0, giveawayCount = 0, tip = 0, bonus = 0, other = 0, payout = 0, withdrawn = 0, saleCount = 0;

    for (const t of rows) {
      if (t.kind === "payout") { withdrawn += t.amountCents; continue; }
      payout += t.amountCents;
      if (t.kind === "sale") saleCount += 1;
      if (pool && t.kind === "sale") {
        pooledSales.push({
          amountCents: t.amountCents,
          costCents: pool.costBySaleTxnId.get(t.id) ?? 0,
          createdAt: t.createdAt,
        });
      } else if (t.kind === "sale" && componentsByTxn.has(t.id)) {
        const comps = componentsByTxn.get(t.id)!;
        const components = comps.map((c) => {
          const unitCostCents = itemCost.get(c.itemId) ?? 0;
          return { name: itemName.get(c.itemId) ?? "?", qty: c.qty, unitCostCents, costCents: unitCostCents * c.qty };
        });
        const costCents = components.reduce((sum, c) => sum + c.costCents, 0);
        bundleLines.push({
          productName: t.productName ?? "Bundle", itemId: null, mapped: true,
          unitCostCents: null, qty: 1, costCents, revenueCents: t.amountCents,
          profitCents: t.amountCents - costCents, isBundle: true, components,
        });
      } else if (t.kind === "sale" && t.productName) {
        let line = productMap.get(t.productName);
        if (!line) {
          const itemId = resolve(t.productName); // live resolution (memoized per build)
          const unitCostCents = itemId != null ? (itemCost.get(itemId) ?? null) : null;
          line = {
            productName: t.productName, itemId, mapped: itemId != null,
            unitCostCents, qty: 0, costCents: 0, revenueCents: 0, profitCents: 0,
          };
          productMap.set(t.productName, line);
          if (itemId == null) unmapped.add(t.productName);
        }
        line.qty += 1;
        line.revenueCents += t.amountCents;
        line.costCents += line.unitCostCents ?? 0;
        line.profitCents = line.revenueCents - line.costCents;
      } else if (t.kind === "giveaway") { giveaway += t.amountCents; giveawayCount += 1; }
      else if (t.kind === "tip") tip += t.amountCents;
      else if (t.kind === "bonus") bonus += t.amountCents;
      else if (t.kind === "other") other += t.amountCents;
    }

    const products = pool ? [] : [...productMap.values(), ...bundleLines].sort((a, b) => a.productName.localeCompare(b.productName));
    const unitsSold = pool ? saleCount : products.reduce((sum, p) => sum + p.qty, 0);
    const cogsCents = pool ? pooledSales.reduce((sum, ps) => sum + ps.costCents, 0) : products.reduce((sum, p) => sum + p.costCents, 0);
    // Each giveaway costs us a unit of merchandise computed from per-show allocations.
    // This is a real cost NOT present in the ledger (the ledger only has Whatnot's small fee).
    const allocs = getAllocations(db, s.id);
    const giveawayCostCents = Math.round(
      allocs.reduce((sum, a) => sum + a.count * (giveawayUnit.get(a.giveawayItemId) ?? 0), 0)
    );
    const giveawayUnallocated = giveawayCount > 0 && allocs.length === 0;
    const netCents = payout - cogsCents - giveawayCostCents - s.shippingSuppliesCents;
    const times = rows.map((t) => ledgerTimeOfDaySeconds(t.createdAt));
    const timeRange = times.length
      ? `${secondsToClock(Math.min(...times))}–${secondsToClock(Math.max(...times))}`
      : "";
    shows.push({
      showId: s.id, showDate: s.showDate,
      sessionSeq: s.sessionSeq,
      timeRange,
      dateHasMultipleSessions: (dateCounts.get(s.showDate) ?? 0) > 1,
      products,
      pooledSales: pool ? pooledSales : undefined,
      giveawayTotalCents: giveaway, giveawayCount, giveawayCostCents, giveawayUnallocated,
      tipTotalCents: tip, bonusTotalCents: bonus, otherTotalCents: other,
      payoutCents: payout, withdrawnToBankCents: withdrawn, cogsCents, shippingSuppliesCents: s.shippingSuppliesCents, netCents, unitsSold, saleCount,
    });
  }

  // build wholesale rollup
  const saleInvoices = db.prepare(
    "SELECT id, customer, paid FROM invoices WHERE direction='sale' AND status='posted' ORDER BY id DESC"
  ).all() as { id: number; customer: string | null; paid: number }[];
  const wholesaleInvoices = saleInvoices.map((inv) => {
    const lines = db.prepare("SELECT item_id AS itemId, quantity, unit_price_cents AS price FROM invoice_lines WHERE invoice_id = ? AND kind = 'item'").all(inv.id) as { itemId: number; quantity: number; price: number }[];
    let qty = 0, revenue = 0, cogs = 0;
    for (const l of lines) { qty += l.quantity; revenue += l.quantity * (l.price ?? 0); cogs += l.quantity * (itemCost.get(l.itemId) ?? 0); }
    return { invoiceId: inv.id, number: invoiceNumber(inv.id), customer: inv.customer, paid: !!inv.paid, qty, revenueCents: revenue, cogsCents: cogs, profitCents: revenue - cogs };
  });
  const paidWholesale = wholesaleInvoices.filter((w) => w.paid);
  const wholesale: WholesaleRollup = {
    invoices: wholesaleInvoices,
    paidRevenueCents: paidWholesale.reduce((s, w) => s + w.revenueCents, 0),
    paidCogsCents: paidWholesale.reduce((s, w) => s + w.cogsCents, 0),
    paidProfitCents: paidWholesale.reduce((s, w) => s + w.profitCents, 0),
    owedToYouCents: wholesaleInvoices.filter((w) => !w.paid).reduce((s, w) => s + w.revenueCents, 0),
  };

  let revenueCents = shows.reduce((sum, s) => sum + (pool
    ? (s.pooledSales ?? []).reduce((a, ps) => a + ps.amountCents, 0)
    : s.products.reduce((a, p) => a + p.revenueCents, 0)), 0);
  let cogsCents = shows.reduce((sum, s) => sum + s.cogsCents, 0);
  const giveawayCostCents = shows.reduce((sum, s) => sum + s.giveawayCostCents, 0);
  const shippingSuppliesCents = shows.reduce((sum, s) => sum + s.shippingSuppliesCents, 0);
  let netCents = shows.reduce((sum, s) => sum + s.netCents, 0);
  const withdrawnToBankCents = shows.reduce((sum, s) => sum + s.withdrawnToBankCents, 0);
  let unitsSold = shows.reduce((sum, s) => sum + s.unitsSold, 0);

  // fold ONLY paid wholesale into the grand totals
  revenueCents += wholesale.paidRevenueCents;
  cogsCents += wholesale.paidCogsCents;
  netCents += wholesale.paidProfitCents;
  unitsSold += paidWholesale.reduce((s, w) => s + w.qty, 0);

  const { ownerShareCents, partnerShareCents } = splitProfit(netCents, settings.ownerSharePct);

  const poolSummary: PoolSummary | undefined = pool
    ? {
        currentAvgUnitCostCents: pool.currentAvgUnitCostCents,
        totalUnitsPurchased: pool.totalUnitsPurchased,
        totalSaleCount: pool.totalSaleCount,
        unitsOnHand: pool.totalUnitsPurchased - pool.totalSaleCount,
        valueOnHandCents: (pool.totalUnitsPurchased - pool.totalSaleCount) * pool.currentAvgUnitCostCents,
      }
    : undefined;

  return {
    shows,
    giveawayUnitCents: settings.giveawayUnitCents,
    totals: { revenueCents, cogsCents, giveawayCostCents, shippingSuppliesCents, netCents, ownerShareCents, partnerShareCents, withdrawnToBankCents, unitsSold },
    wholesale,
    unmappedNames: [...unmapped].sort(),
    unmappedCount: unmapped.size,
    pool: poolSummary,
  };
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `npm test -- tests/lib/calc/ledger-report.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (confirms `dashboard.test.ts`, which calls `buildLedgerReport` indirectly via `dashboardSummary`, still passes unchanged since it never sets `costingMode: "pooled"`)

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "buildLedgerReport: branch on costingMode, add pooled costing path"
```

---

### Task 5: Settings UI — costing mode + avg method

**Files:**
- Modify: `src/app/api/settings/route.ts`
- Modify: `src/components/SettingsForm.tsx`
- Create: `tests/api/settings-costing-mode.test.ts`

**Interfaces:**
- Consumes: `Settings.costingMode` / `Settings.avgMethod` (Task 1).
- Produces: `PUT /api/settings` accepts and persists `costingMode`/`avgMethod` in the request body, falling back to the current value when omitted (matching the existing `whatnotOnly` pattern) — verified by test, no new exported functions.

- [ ] **Step 1: Write the failing test**

Create `tests/api/settings-costing-mode.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDb, type DB } from "@/lib/db/connection";
import { getSettings } from "@/lib/db/settings";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/request", () => ({ dbForRequest: async () => getDb() }));

const { PUT } = await import("@/app/api/settings/route");

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  getDb.mockReturnValue(db);
});

const baseBody = { ownerSharePct: 50, defaultShippingSuppliesCents: 0 };

function putSettings(body: Record<string, unknown>) {
  const req = new NextRequest("http://test/api/settings", { method: "PUT", body: JSON.stringify(body) });
  return PUT(req);
}

describe("PUT /api/settings — costing mode", () => {
  it("defaults to per_sku/moving and persists an explicit change to pooled/live", async () => {
    expect(getSettings(db).costingMode).toBe("per_sku");

    const res = await putSettings({ ...baseBody, costingMode: "pooled", avgMethod: "live" });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("pooled");
    expect(getSettings(db).avgMethod).toBe("live");
  });

  it("omitting costingMode/avgMethod leaves the current values untouched", async () => {
    await putSettings({ ...baseBody, costingMode: "pooled", avgMethod: "live" });

    const res = await putSettings({ ...baseBody });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("pooled");
    expect(getSettings(db).avgMethod).toBe("live");
  });

  it("rejects an invalid costingMode/avgMethod value by falling back to the current setting", async () => {
    const res = await putSettings({ ...baseBody, costingMode: "not_a_mode" });

    expect(res.status).toBe(200);
    expect(getSettings(db).costingMode).toBe("per_sku"); // invalid value ignored, default kept
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/api/settings-costing-mode.test.ts`
Expected: FAIL — `getSettings(db).costingMode` is `"per_sku"` already (Task 1 default), but the PUT doesn't persist `pooled`/`live` yet, so the second assertion in the first test fails.

- [ ] **Step 3: Implement the API route**

In `src/app/api/settings/route.ts`, change:

```ts
  const { giveawayUnitCents, whatnotOnly: wasWhatnotOnly } = getSettings(db);
  const whatnotOnly = typeof body.whatnotOnly === "boolean" ? body.whatnotOnly : wasWhatnotOnly;
```
to:
```ts
  const { giveawayUnitCents, whatnotOnly: wasWhatnotOnly, costingMode: wasCostingMode, avgMethod: wasAvgMethod } = getSettings(db);
  const whatnotOnly = typeof body.whatnotOnly === "boolean" ? body.whatnotOnly : wasWhatnotOnly;
  const costingMode = body.costingMode === "per_sku" || body.costingMode === "pooled" ? body.costingMode : wasCostingMode;
  const avgMethod = body.avgMethod === "live" || body.avgMethod === "moving" ? body.avgMethod : wasAvgMethod;
```

And change the `updateSettings` call to include the two new fields:
```ts
  updateSettings(db, {
    ownerSharePct, giveawayUnitCents, defaultShippingSuppliesCents, businessName,
    invoicePhone, invoiceAddress, invoiceEmail,
    invoiceShowPhone: body.invoiceShowPhone !== false,
    invoiceShowAddress: body.invoiceShowAddress !== false,
    invoiceShowEmail: body.invoiceShowEmail !== false,
    whatnotOnly, costingMode, avgMethod,
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- tests/api/settings-costing-mode.test.ts`
Expected: PASS

Also run: `npm test -- tests/api/settings-whatnot-only-gate.test.ts`
Expected: PASS (unchanged — confirms the fallback pattern didn't disturb the existing `whatnotOnly` gate tests)

- [ ] **Step 5: Add the Settings UI control**

This layer has no existing test coverage in the codebase (`src/components/*.tsx` page-level forms aren't unit-tested here — only API routes and `lib/`); verify it manually per Step 6 below.

In `src/components/SettingsForm.tsx`, add two state hooks after `const [whatnotOnly, setWhatnotOnly] = useState(initial.whatnotOnly);`:
```tsx
  const [costingMode, setCostingMode] = useState<Settings["costingMode"]>(initial.costingMode);
  const [avgMethod, setAvgMethod] = useState<Settings["avgMethod"]>(initial.avgMethod);
```

In `save()`, add to the JSON body (after `whatnotOnly,`):
```tsx
        costingMode, avgMethod,
```

Add a new block right after the "Whatnot-only mode" `<div className="space-y-2 border-t border-line pt-4">...</div>` block and before the submit-button `<div className="flex items-center gap-3 border-t border-line pt-4">`:
```tsx
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Costing</p>
          <div>
            <label className="block font-medium text-slate-700">Costing mode</label>
            <select className={`mt-1 w-full ${INPUT_CLASS}`} value={costingMode}
              onChange={(e) => { setCostingMode(e.target.value as Settings["costingMode"]); setSaved(false); }}>
              <option value="per_sku">Per-SKU — costs each sale via product mapping</option>
              <option value="pooled">Pooled — one blended cost across all purchased stock (for mystery/random-pull streams)</option>
            </select>
          </div>
          {costingMode === "pooled" && (
            <div>
              <label className="block font-medium text-slate-700">Pool average method</label>
              <select className={`mt-1 w-full ${INPUT_CLASS}`} value={avgMethod}
                onChange={(e) => { setAvgMethod(e.target.value as Settings["avgMethod"]); setSaved(false); }}>
                <option value="moving">Moving average — a show's cost never changes once booked</option>
                <option value="live">Live average — all-time blended, shifts past shows when you buy more</option>
              </select>
            </div>
          )}
        </div>
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`
- Visit `/settings`, confirm a new "Costing" section appears with "Costing mode" defaulted to "Per-SKU".
- Switch it to "Pooled" — confirm the "Pool average method" selector appears, defaulted to "Moving average".
- Click Save, reload the page — confirm both selections persisted.
- Switch back to "Per-SKU" and Save — confirm the per-SKU value round-trips too.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/settings/route.ts src/components/SettingsForm.tsx tests/api/settings-costing-mode.test.ts
git commit -m "Add costing mode + avg method controls to Settings"
```

---

### Task 6: Dashboard — pool-aware units on hand

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `LedgerReport.pool` (Task 4).

- [ ] **Step 1: Implement**

No unit test exists for this file today (page components aren't covered by the Vitest suite here — verify manually per Step 2). In `src/app/page.tsx`, change:

```tsx
  const unitsOnHand = listItems(db).reduce((s, i) => s + qtyRemaining(db, i.id), 0);
```
to:
```tsx
  const unitsOnHand = rep.pool ? rep.pool.unitsOnHand : listItems(db).reduce((s, i) => s + qtyRemaining(db, i.id), 0);
```

And change the stats grid:
```tsx
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Gross sales" value={<Money cents={d.grossSalesCents} />} />
        <Stat label="Total payout" value={<Money cents={d.totalPayoutCents} />} />
        <Stat label="Paid to bank" value={<Money cents={d.paidToBankCents} />} />
        <Stat label="Inventory spend" value={<Money cents={d.netInventorySpendCents} />} />
        <Stat label="Expenses" value={<Money cents={d.totalExpensesCents} />} />
        <Stat label="Units on hand" value={unitsOnHand} />
      </div>
```
to:
```tsx
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Gross sales" value={<Money cents={d.grossSalesCents} />} />
        <Stat label="Total payout" value={<Money cents={d.totalPayoutCents} />} />
        <Stat label="Paid to bank" value={<Money cents={d.paidToBankCents} />} />
        <Stat label="Inventory spend" value={<Money cents={d.netInventorySpendCents} />} />
        <Stat label="Expenses" value={<Money cents={d.totalExpensesCents} />} />
        <Stat label="Units on hand" value={unitsOnHand} />
        {rep.pool && <Stat label="Pool avg cost/unit" value={<Money cents={rep.pool.currentAvgUnitCostCents} />} />}
        {rep.pool && <Stat label="Pool value on hand" value={<Money cents={rep.pool.valueOnHandCents} />} />}
      </div>
```

- [ ] **Step 2: Manually verify in the browser**

With the dev server running (`npm run dev`):
- On a `per_sku` workspace, confirm the Dashboard looks exactly as before (no "Pool avg cost/unit" or "Pool value on hand" stats, "Units on hand" computed as before).
- Switch a workspace to "Pooled" in Settings (Task 5), add an inventory item + purchase batch, import a ledger CSV with a couple of sales. Confirm "Units on hand" now equals `total purchased − total sale count`, and the two new pool stats appear with sane values.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "Dashboard: use pool units-on-hand and show pool cost stats when pooled"
```

---

### Task 7: Report page — pooled show detail (aggregate line + collapsible raw sales)

**Files:**
- Create: `src/components/report/PooledShowDetail.tsx`
- Modify: `src/app/report/page.tsx`

**Interfaces:**
- Consumes: `ReportShow.pooledSales`, `ReportShow.unitsSold`, `ReportShow.cogsCents` (Task 4), `LedgerReport.pool` (Task 4) to decide which renderer to use.
- Produces: `PooledShowDetail({ show }: { show: ReportShow }): JSX.Element`, exported from `@/components/report/PooledShowDetail`.

- [ ] **Step 1: Implement the component**

No test exists for this layer (React components under `src/components/report/` aren't unit-tested in this codebase — verify manually per Step 3). Create `src/components/report/PooledShowDetail.tsx`, following the `<details>` pattern already used in `src/components/inventory/ArchivedTable.tsx`:

```tsx
import { Money } from "@/components/Money";
import type { ReportShow } from "@/lib/calc/ledger-report";

export function PooledShowDetail({ show }: { show: ReportShow }) {
  const sales = show.pooledSales ?? [];
  return (
    <div className="text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
        <span>Units sold <b>{show.unitsSold}</b></span>
        <span>Pool COGS <b><Money cents={show.cogsCents} /></b></span>
      </div>
      {sales.length > 0 && (
        <details className="mt-2 rounded-lg border border-line bg-white">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-600">
            {sales.length} individual sale{sales.length === 1 ? "" : "s"}
          </summary>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-t border-line text-slate-500">
                <th className="px-3 py-1.5">Sold at</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
                <th className="px-3 py-1.5 text-right">Pool cost</th>
                <th className="px-3 py-1.5 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-3 py-1.5">{s.createdAt}</td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.amountCents} /></td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.costCents} /></td>
                  <td className="px-3 py-1.5 text-right"><Money cents={s.amountCents - s.costCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the report page**

In `src/app/report/page.tsx`, add the import:
```tsx
import { PooledShowDetail } from "@/components/report/PooledShowDetail";
```

Replace:
```tsx
          <ProductsTable products={s.products} variant="report" />
```
with:
```tsx
          {rep.pool ? <PooledShowDetail show={s} /> : <ProductsTable products={s.products} variant="report" />}
```

- [ ] **Step 3: Manually verify in the browser**

With the dev server running and a workspace set to "Pooled" (Task 5) with a purchase batch and an imported ledger CSV with a few sales (Task 6's verification data works too):
- Visit `/report`.
- Confirm each show now shows "Units sold" / "Pool COGS" instead of a product table.
- Confirm the "N individual sales" `<details>` expands to a table of each sale's amount, pool cost, and profit, and collapses again on click.
- Switch back to "Per-SKU" in Settings and confirm `/report` renders the original per-product table unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/report/PooledShowDetail.tsx src/app/report/page.tsx
git commit -m "Report page: pooled show detail with collapsible raw sales list"
```

---

## Final verification

- [ ] Run `npm test` — full suite passes.
- [ ] Run `npm run build` (or the project's typecheck script) — no TypeScript errors.
- [ ] Manual smoke test end-to-end: create a second user account (Settings → Users), log in as it, set Costing mode to Pooled, add one inventory item + purchase batch, import a small Whatnot ledger CSV with a few "Item On Screen" sales, and confirm the Dashboard and `/report` page show sane pool-based numbers. Then log back into the original account and confirm nothing changed there.
