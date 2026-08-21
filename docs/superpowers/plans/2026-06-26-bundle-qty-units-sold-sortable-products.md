# Bundle qty, order numbers, units-sold & sortable Products — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user define a bundle recipe once and apply it to multiple sale lines, show order numbers in the bundle editor, display a units-sold total, and make the Products tables sortable — on the show page and the report page.

**Architecture:** No schema change. `bundle_components` stays keyed per `ledger_transactions.id`; bundle "groups" are a client-side convenience in `BundleEditor` that expand to one component-set per checked line on save (via pure helpers). Units-sold is a new field on the report builder. Sorting is a shared client component driven by a pure sort helper.

**Tech Stack:** Next.js 15 (App Router, server + client components), better-sqlite3, TypeScript, Vitest.

## Global Constraints

- Money is stored and passed as **integer cents** everywhere.
- DB modules take a `db` handle; request code resolves it via `await dbForRequest()`.
- Dashboard is **out of scope** — do not touch dashboard files.
- No DB migration, no change to the backup `TABLES` list, no bundle stock drawdown.
- Run the full suite with `npm test` (Vitest). Baseline today is green except a pre-existing tsc error in `tests/lib/db/giveaway-items.test.ts` — do not be alarmed by that one, but do not add new tsc errors.

---

### Task 1: Add `orderId` to sale lines

**Files:**
- Modify: `src/lib/db/bundles.ts` (the `ShowSaleLine` interface + `listShowSaleLines` query)
- Test: `tests/lib/db/bundles.test.ts`

**Interfaces:**
- Produces: `ShowSaleLine` now `{ id: number; productName: string | null; amountCents: number; orderId: string | null }`.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe("bundles db", …)` block in `tests/lib/db/bundles.test.ts`:

```ts
it("includes the order id on each sale line", () => {
  const { lines } = seed();
  expect(lines.map((l) => l.orderId).sort()).toEqual(["O1", "O2"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/bundles.test.ts -t "order id"`
Expected: FAIL (`orderId` is `undefined`).

- [ ] **Step 3: Implement**

In `src/lib/db/bundles.ts`, update the interface and query:

```ts
export interface ShowSaleLine { id: number; productName: string | null; amountCents: number; orderId: string | null; }
```

```ts
export function listShowSaleLines(db: DB, showId: number): ShowSaleLine[] {
  return db.prepare(
    `SELECT id, product_name AS productName, amount_cents AS amountCents, order_id AS orderId
     FROM ledger_transactions
     WHERE show_id = ? AND kind = 'sale'
     ORDER BY created_at`
  ).all(showId) as ShowSaleLine[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/bundles.test.ts`
Expected: PASS (all bundle tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/bundles.ts tests/lib/db/bundles.test.ts
git commit -m "feat(bundles): expose order_id on show sale lines"
```

---

### Task 2: Add `unitsSold` to the report builder

**Files:**
- Modify: `src/lib/calc/ledger-report.ts` (`ReportShow`, `LedgerReport.totals`, both build loops)
- Test: `tests/lib/calc/ledger-report.test.ts`

**Interfaces:**
- Produces: `ReportShow.unitsSold: number` (= `Σ products[].qty`); `LedgerReport.totals.unitsSold: number` (sum across shows).

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/calc/ledger-report.test.ts` inside `describe("buildLedgerReport", …)`. The shared `CSV` has 2 sales + 1 giveaway on one date:

```ts
it("counts units sold per show and in totals (sales only, not giveaways)", () => {
  const rep = buildLedgerReport(db);
  expect(rep.shows[0].unitsSold).toBe(2);
  expect(rep.totals.unitsSold).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts -t "units sold"`
Expected: FAIL (`unitsSold` is `undefined`).

- [ ] **Step 3: Implement**

In `src/lib/calc/ledger-report.ts`:

Add to the `ReportShow` interface (next to `netCents`):

```ts
  unitsSold: number;            // Σ product-line qty (each sale + each bundle order = 1)
```

Add to the `LedgerReport.totals` type (next to `netCents`):

```ts
    unitsSold: number;
```

In the per-show loop, after `const products = [...]` and before `shows.push`, compute it; then add the field to the pushed object:

```ts
    const unitsSold = products.reduce((sum, p) => sum + p.qty, 0);
```

In the `shows.push({ … })` object literal, add `unitsSold,` alongside `netCents`.

After the existing `const netCents = shows.reduce(...)` totals line, add:

```ts
  const unitsSold = shows.reduce((sum, s) => sum + s.unitsSold, 0);
```

In the returned `totals: { … }` object, add `unitsSold,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat(report): compute units sold per show and in totals"
```

---

### Task 3: Pure product-sort helper

**Files:**
- Create: `src/lib/calc/sort-products.ts`
- Test: `tests/lib/calc/sort-products.test.ts`

**Interfaces:**
- Produces:
  - `type SortDir = "asc" | "desc"`
  - `type SortKey = "productName" | "qty" | "unitCostCents" | "costCents" | "revenueCents" | "avgPerUnit" | "profitCents"`
  - `interface SortableProduct { productName: string; qty: number; unitCostCents: number | null; costCents: number; revenueCents: number; profitCents: number; }`
  - `sortProducts<T extends SortableProduct>(products: T[], key: SortKey, dir: SortDir): T[]` — returns a new array; rows with a `null` sort value (`unitCostCents` or computed `avgPerUnit`) always sort to the end regardless of `dir`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/sort-products.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortProducts, type SortableProduct } from "@/lib/calc/sort-products";

const rows: SortableProduct[] = [
  { productName: "Banana", qty: 1, unitCostCents: 300, costCents: 300, revenueCents: 900, profitCents: 600 },
  { productName: "Apple",  qty: 5, unitCostCents: null, costCents: 0,   revenueCents: 250, profitCents: 250 },
  { productName: "Cherry", qty: 2, unitCostCents: 100, costCents: 200, revenueCents: 200, profitCents: 0 },
];
const names = (r: SortableProduct[]) => r.map((p) => p.productName);

describe("sortProducts", () => {
  it("sorts by name ascending and descending", () => {
    expect(names(sortProducts(rows, "productName", "asc"))).toEqual(["Apple", "Banana", "Cherry"]);
    expect(names(sortProducts(rows, "productName", "desc"))).toEqual(["Cherry", "Banana", "Apple"]);
  });

  it("sorts by a numeric metric", () => {
    expect(names(sortProducts(rows, "qty", "asc"))).toEqual(["Banana", "Cherry", "Apple"]);
    expect(names(sortProducts(rows, "revenueCents", "desc"))).toEqual(["Banana", "Apple", "Cherry"]);
  });

  it("puts null unit cost last regardless of direction", () => {
    expect(names(sortProducts(rows, "unitCostCents", "asc")).at(-1)).toBe("Apple");
    expect(names(sortProducts(rows, "unitCostCents", "desc")).at(-1)).toBe("Apple");
  });

  it("sorts by avg-per-unit (revenue/qty), null qty<=0 last", () => {
    // Banana 900/1=900, Cherry 200/2=100, Apple 250/5=50
    expect(names(sortProducts(rows, "avgPerUnit", "desc"))).toEqual(["Banana", "Cherry", "Apple"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...rows];
    sortProducts(rows, "qty", "desc");
    expect(rows).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/sort-products.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/calc/sort-products.ts`:

```ts
import { avgPerUnitCents } from "./avg-per-unit";

export type SortDir = "asc" | "desc";
export type SortKey =
  | "productName" | "qty" | "unitCostCents" | "costCents"
  | "revenueCents" | "avgPerUnit" | "profitCents";

export interface SortableProduct {
  productName: string;
  qty: number;
  unitCostCents: number | null;
  costCents: number;
  revenueCents: number;
  profitCents: number;
}

/** Sort value for a row; null means "always sort last". */
function valueOf(p: SortableProduct, key: SortKey): string | number | null {
  switch (key) {
    case "productName": return p.productName;
    case "qty": return p.qty;
    case "unitCostCents": return p.unitCostCents;
    case "costCents": return p.costCents;
    case "revenueCents": return p.revenueCents;
    case "profitCents": return p.profitCents;
    case "avgPerUnit": return avgPerUnitCents(p.revenueCents, p.qty);
  }
}

/** Returns a new array sorted by `key`/`dir`. Null values always go to the end. */
export function sortProducts<T extends SortableProduct>(products: T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...products].sort((a, b) => {
    const va = valueOf(a, key);
    const vb = valueOf(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;   // nulls last, regardless of dir
    if (vb === null) return -1;
    if (typeof va === "string" && typeof vb === "string") return sign * va.localeCompare(vb);
    return sign * ((va as number) - (vb as number));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/sort-products.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/sort-products.ts tests/lib/calc/sort-products.test.ts
git commit -m "feat(report): pure sortProducts helper with nulls-last"
```

---

### Task 4: Sortable `ProductsTable` client component (show + report)

**Files:**
- Create: `src/components/ProductsTable.tsx`
- Modify: `src/app/shows/[id]/page.tsx:59-91` (replace the inline `<DataTable>` block)
- Modify: `src/app/report/page.tsx:34-51` (replace the inline `<table>` block)

**Interfaces:**
- Consumes: `sortProducts`, `SortKey`, `SortDir` (Task 3); `ReportProductLine` (from `@/lib/calc/ledger-report`, which is `SortableProduct`-compatible and adds `mapped`, `isBundle?`, `components?`).
- Produces: `ProductsTable({ products, variant }: { products: ReportProductLine[]; variant: "show" | "report" })`.

- [ ] **Step 1: Create the component**

Create `src/components/ProductsTable.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Money } from "@/components/Money";
import { DataTable } from "@/components/ui/DataTable";
import { avgPerUnitCents } from "@/lib/calc/avg-per-unit";
import { sortProducts, type SortKey, type SortDir } from "@/lib/calc/sort-products";
import type { ReportProductLine } from "@/lib/calc/ledger-report";

type Col = { key: SortKey; label: string; align?: "right" };

const SHOW_COLS: Col[] = [
  { key: "productName", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "unitCostCents", label: "Unit cost" },
  { key: "costCents", label: "Cost" },
  { key: "revenueCents", label: "Revenue" },
  { key: "avgPerUnit", label: "Avg/unit" },
  { key: "profitCents", label: "Profit", align: "right" },
];
const REPORT_COLS: Col[] = [
  { key: "productName", label: "Product" },
  { key: "qty", label: "Qty" },
  { key: "unitCostCents", label: "Unit cost" },
  { key: "costCents", label: "Cost" },
  { key: "revenueCents", label: "Revenue" },
  { key: "profitCents", label: "Profit" },
];

export function ProductsTable({ products, variant }: { products: ReportProductLine[]; variant: "show" | "report" }) {
  const [key, setKey] = useState<SortKey | null>(null);
  const [dir, setDir] = useState<SortDir>("asc");
  const cols = variant === "show" ? SHOW_COLS : REPORT_COLS;
  const rows = key ? sortProducts(products, key, dir) : products;
  const caret = (k: SortKey) => (key === k ? (dir === "asc" ? " ▲" : " ▼") : "");
  function click(k: SortKey) {
    if (key === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir("asc"); }
  }

  const nameCell = (p: ReportProductLine) => (
    <>
      {p.productName}
      {!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}
      {variant === "show" && p.isBundle && (
        <span className="ml-1 text-blue-700">
          ▸ bundle ({p.components?.length ?? 0} item{(p.components?.length ?? 0) === 1 ? "" : "s"})
        </span>
      )}
      {variant === "show" && p.isBundle && p.components && (
        <div className="mt-0.5 text-[11px] text-slate-500">
          {p.components.map((c) => `${c.qty}× ${c.name}`).join(", ")}
        </div>
      )}
    </>
  );

  if (variant === "report") {
    return (
      <table className="w-full text-left text-xs">
        <thead><tr className="border-b border-line text-slate-500">
          {cols.map((c) => (
            <th key={c.key} className="cursor-pointer select-none p-1" onClick={() => click(c.key)}>
              {c.label}{caret(c.key)}
            </th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((p, idx) => (
            <tr key={`${p.productName}-${idx}`} className="border-b border-line">
              <td className="p-1">{nameCell(p)}</td>
              <td className="p-1">{p.qty}</td>
              <td className="p-1">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
              <td className="p-1"><Money cents={p.costCents} /></td>
              <td className="p-1"><Money cents={p.revenueCents} /></td>
              <td className="p-1"><Money cents={p.profitCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <DataTable head={cols.map((c) => (
      <th key={c.key} className={`cursor-pointer select-none px-3 py-2${c.align === "right" ? " text-right" : ""}`} onClick={() => click(c.key)}>
        {c.label}{caret(c.key)}
      </th>
    ))}>
      {rows.map((p, idx) => (
        <tr key={`${p.productName}-${idx}`} className="border-t border-line">
          <td className="px-3 py-2">{nameCell(p)}</td>
          <td className="px-3 py-2">{p.qty}</td>
          <td className="px-3 py-2">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
          <td className="px-3 py-2"><Money cents={p.costCents} /></td>
          <td className="px-3 py-2"><Money cents={p.revenueCents} /></td>
          <td className="px-3 py-2">{(() => { const a = avgPerUnitCents(p.revenueCents, p.qty); return a == null ? "—" : <Money cents={a} />; })()}</td>
          <td className="px-3 py-2 text-right"><Money cents={p.profitCents} /></td>
        </tr>
      ))}
    </DataTable>
  );
}
```

- [ ] **Step 2: Wire into the show page**

In `src/app/shows/[id]/page.tsx`, add to the imports near the other component imports:

```tsx
import { ProductsTable } from "@/components/ProductsTable";
```

Replace the whole `{show.products.length > 0 && ( … )}` block (the `<DataTable head={…}> … </DataTable>` at lines ~59-91) with:

```tsx
        {show.products.length > 0 && <ProductsTable products={show.products} variant="show" />}
```

The now-unused `DataTable` and `avgPerUnitCents` imports in this file: remove them only if no longer referenced elsewhere in the file (check with a search; `DataTable` is no longer used here, `avgPerUnitCents` is no longer used here — remove both import lines).

- [ ] **Step 3: Wire into the report page**

In `src/app/report/page.tsx`, add import:

```tsx
import { ProductsTable } from "@/components/ProductsTable";
```

Replace the inline `<table className="w-full text-left text-xs"> … </table>` (lines ~34-51) with:

```tsx
          <ProductsTable products={s.products} variant="report" />
```

- [ ] **Step 4: Typecheck + run the suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "giveaway-items.test.ts" | grep "error" || echo "no new tsc errors"`
Expected: `no new tsc errors` (the only allowed error is the pre-existing giveaway-items one).

Run: `npm test`
Expected: full suite green (same as baseline).

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`, log in as `demo`/`demo`, open a show with products and the `/report` page. Click each column header: first click sorts ascending (caret ▲), second toggles descending (▼). Confirm the show table still shows the `▸ bundle` indicator and component subtext, and the report table omits Avg/unit.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProductsTable.tsx "src/app/shows/[id]/page.tsx" src/app/report/page.tsx
git commit -m "feat(ui): sortable Products table on show and report pages"
```

---

### Task 5: Units-sold in the UI (show summary + report)

**Files:**
- Modify: `src/app/shows/[id]/page.tsx` (the `rows` summary array, ~line 35)
- Modify: `src/app/report/page.tsx` (per-show summary line ~52, and totals Stats ~17)

**Interfaces:**
- Consumes: `ReportShow.unitsSold`, `LedgerReport.totals.unitsSold` (Task 2).

- [ ] **Step 1: Show-page summary line**

In `src/app/shows/[id]/page.tsx`, in the `rows` array, add a `Units sold` entry right after the `Payout` row:

```tsx
    ["Payout", <Money cents={show.payoutCents} />],
    ["Units sold", show.unitsSold],
    ["COGS (items sold)", <Money cents={-show.cogsCents} />],
```

(The `rows` value type is `React.ReactNode`, so the bare number renders fine.)

- [ ] **Step 2: Report per-show line + totals**

In `src/app/report/page.tsx`, add `Units sold` to the per-show summary line (the `<div className="mt-2 text-xs text-slate-500">` block). Insert at the start of that line's content:

```tsx
            Units sold {s.unitsSold} ·{" "}
            Payout <Money cents={s.payoutCents} /> ·{" "}
```

And add a units-sold stat to the totals grid. Change the grid wrapper to 5 columns and add the Stat:

```tsx
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Revenue" value={<Money cents={rep.totals.revenueCents} />} />
        <Stat label="Units sold" value={rep.totals.unitsSold} />
        <Stat label="COGS" value={<Money cents={rep.totals.cogsCents} />} />
        <Stat label="Net profit so far" value={<Money cents={rep.totals.netCents} />} />
        <Stat label="Your share" value={<Money cents={rep.totals.ownerShareCents} />} />
      </div>
```

(`Stat`'s `value` prop accepts a `ReactNode`; a bare number is fine.)

- [ ] **Step 3: Typecheck + manual smoke**

Run: `npx tsc --noEmit 2>&1 | grep -v "giveaway-items.test.ts" | grep "error" || echo "no new tsc errors"`
Expected: `no new tsc errors`.

Run `npm run dev`, open a show — the Summary card shows `Units sold N` under Payout. Open `/report` — each show line starts with `Units sold N` and the totals row has a Units-sold stat.

- [ ] **Step 4: Commit**

```bash
git add "src/app/shows/[id]/page.tsx" src/app/report/page.tsx
git commit -m "feat(ui): show units-sold on show summary and report"
```

---

### Task 6: Bundle grouping helpers (recipe ⇄ per-line)

**Files:**
- Create: `src/lib/calc/bundle-grouping.ts`
- Test: `tests/lib/calc/bundle-grouping.test.ts`

**Interfaces:**
- Produces:
  - `interface BundleComp { itemId: number; qty: number }`
  - `interface LoadedBundle { ledgerTxnId: number; components: BundleComp[] }`
  - `interface BundleGroup { lineIds: number[]; components: BundleComp[] }`
  - `groupBundles(bundles: LoadedBundle[]): BundleGroup[]` — merges txns with an identical component multiset into one group (order-independent), preserving first-seen order.
  - `flattenBundles(groups: BundleGroup[]): LoadedBundle[]` — one `LoadedBundle` per `lineId`, each carrying that group's components.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/bundle-grouping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupBundles, flattenBundles } from "@/lib/calc/bundle-grouping";

describe("groupBundles", () => {
  it("merges txns with identical component sets (order-independent)", () => {
    const groups = groupBundles([
      { ledgerTxnId: 10, components: [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }] },
      { ledgerTxnId: 11, components: [{ itemId: 2, qty: 1 }, { itemId: 1, qty: 1 }] }, // same recipe, reordered
      { ledgerTxnId: 12, components: [{ itemId: 1, qty: 2 }] },                        // different
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lineIds).toEqual([10, 11]);
    expect(groups[1].lineIds).toEqual([12]);
  });
});

describe("flattenBundles", () => {
  it("emits one bundle per line id with the group's components", () => {
    const out = flattenBundles([
      { lineIds: [10, 11], components: [{ itemId: 1, qty: 1 }] },
      { lineIds: [12], components: [{ itemId: 3, qty: 2 }] },
    ]);
    expect(out).toEqual([
      { ledgerTxnId: 10, components: [{ itemId: 1, qty: 1 }] },
      { ledgerTxnId: 11, components: [{ itemId: 1, qty: 1 }] },
      { ledgerTxnId: 12, components: [{ itemId: 3, qty: 2 }] },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/bundle-grouping.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/calc/bundle-grouping.ts`:

```ts
export interface BundleComp { itemId: number; qty: number }
export interface LoadedBundle { ledgerTxnId: number; components: BundleComp[] }
export interface BundleGroup { lineIds: number[]; components: BundleComp[] }

/** Canonical, order-independent key for a component multiset. */
function recipeKey(components: BundleComp[]): string {
  return JSON.stringify(
    [...components].sort((a, b) => a.itemId - b.itemId).map((c) => [c.itemId, c.qty])
  );
}

/** Merge txns that share an identical component multiset into one group. */
export function groupBundles(bundles: LoadedBundle[]): BundleGroup[] {
  const byKey = new Map<string, BundleGroup>();
  const order: string[] = [];
  for (const b of bundles) {
    const key = recipeKey(b.components);
    let g = byKey.get(key);
    if (!g) { g = { lineIds: [], components: b.components }; byKey.set(key, g); order.push(key); }
    g.lineIds.push(b.ledgerTxnId);
  }
  return order.map((k) => byKey.get(k)!);
}

/** Expand each group to one bundle per line id. */
export function flattenBundles(groups: BundleGroup[]): LoadedBundle[] {
  const out: LoadedBundle[] = [];
  for (const g of groups) {
    for (const id of g.lineIds) out.push({ ledgerTxnId: id, components: g.components });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/bundle-grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/bundle-grouping.ts tests/lib/calc/bundle-grouping.test.ts
git commit -m "feat(bundles): pure group/flatten helpers for recipe sharing"
```

---

### Task 7: BundleEditor — recipe applied to multiple sale lines

**Files:**
- Modify: `src/components/BundleEditor.tsx` (full rewrite of the component)

**Interfaces:**
- Consumes: GET/PUT `/api/shows/[id]/bundles` (unchanged contract; `saleLines[].orderId` now present from Task 1); `groupBundles`/`flattenBundles` (Task 6).

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/BundleEditor.tsx` with:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { ItemCombobox } from "@/components/ItemCombobox";
import { groupBundles, flattenBundles } from "@/lib/calc/bundle-grouping";

interface SaleLine { id: number; productName: string | null; amountCents: number; orderId: string | null; }
interface Item { id: number; name: string; unitCostCents: number; }
interface Component { cid: number; itemId: number | null; qty: number; }
interface Bundle { cid: number; lineIds: number[]; components: Component[]; }

const short = (orderId: string | null) => (orderId ? `#${orderId.slice(-6)}` : "#—");

export default function BundleEditor({ showId }: { showId: number }) {
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [saved, setSaved] = useState(false);
  const cidRef = useRef(0);
  const mint = () => cidRef.current++;

  useEffect(() => {
    fetch(`/api/shows/${showId}/bundles`).then((r) => r.json()).then((d) => {
      setSaleLines(d.saleLines);
      setItems(d.items);
      const groups = groupBundles(
        d.bundles.map((b: any) => ({ ledgerTxnId: b.ledgerTxnId, components: b.components }))
      );
      setBundles(groups.map((g) => ({
        cid: mint(), lineIds: g.lineIds,
        components: g.components.map((c) => ({ cid: mint(), itemId: c.itemId, qty: c.qty })),
      })));
    });
  }, [showId]);

  const unitOf = (id: number | null) => items.find((i) => i.id === id)?.unitCostCents ?? 0;
  const lineOf = (id: number) => saleLines.find((l) => l.id === id);
  // a line may belong to at most one bundle card
  const ownerOf = new Map<number, number>(); // lineId -> bundle index
  bundles.forEach((b, bi) => b.lineIds.forEach((id) => ownerOf.set(id, bi)));
  const dirty = () => setSaved(false);

  function updateBundle(bi: number, fn: (b: Bundle) => Bundle) {
    setBundles((prev) => prev.map((b, i) => (i === bi ? fn(b) : b))); dirty();
  }
  function addBundle() {
    const free = saleLines.find((l) => !ownerOf.has(l.id));
    setBundles((prev) => [...prev, { cid: mint(), lineIds: free ? [free.id] : [], components: [] }]); dirty();
  }
  function removeBundle(bi: number) { setBundles((prev) => prev.filter((_, i) => i !== bi)); dirty(); }
  function toggleLine(bi: number, lineId: number, on: boolean) {
    updateBundle(bi, (b) => ({
      ...b,
      lineIds: on ? [...b.lineIds, lineId] : b.lineIds.filter((id) => id !== lineId),
    }));
  }
  function addComponent(bi: number) {
    if (items[0]) updateBundle(bi, (b) => ({ ...b, components: [...b.components, { cid: mint(), itemId: items[0].id, qty: 1 }] }));
  }
  function setComponent(bi: number, ci: number, patch: Partial<Component>) {
    updateBundle(bi, (b) => ({ ...b, components: b.components.map((c, i) => (i === ci ? { ...c, ...patch } : c)) }));
  }
  function removeComponent(bi: number, ci: number) {
    updateBundle(bi, (b) => ({ ...b, components: b.components.filter((_, i) => i !== ci) }));
  }
  const unitCostOf = (b: Bundle) => b.components.reduce((s, c) => s + c.qty * unitOf(c.itemId), 0);
  const revenueOf = (b: Bundle) => b.lineIds.reduce((s, id) => s + (lineOf(id)?.amountCents ?? 0), 0);

  async function save() {
    const groups = bundles
      .map((b) => ({ lineIds: b.lineIds, components: b.components.filter((c) => c.qty > 0 && c.itemId != null).map((c) => ({ itemId: c.itemId as number, qty: c.qty })) }))
      .filter((g) => g.lineIds.length > 0 && g.components.length > 0);
    const flat = flattenBundles(groups);
    await fetch(`/api/shows/${showId}/bundles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundles: flat.map((f) => ({ ledgerTxnId: f.ledgerTxnId, components: f.components })) }),
    });
    setSaved(true);
  }

  if (saleLines.length === 0) {
    return <p className="text-sm text-slate-500">No sale lines on this show yet. Import the ledger first.</p>;
  }

  return (
    <section className="space-y-4">
      {bundles.map((b, bi) => {
        const lineCount = b.lineIds.length;
        const unitCost = unitCostOf(b);
        const cost = unitCost * lineCount;
        const revenue = revenueOf(b);
        return (
          <div key={b.cid} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Bundle ({lineCount} order{lineCount === 1 ? "" : "s"})</span>
              <button onClick={() => removeBundle(bi)} className="text-sm text-red-600 hover:underline">Remove bundle</button>
            </div>

            <div className="mt-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Orders in this bundle</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {saleLines.map((l) => {
                  const owner = ownerOf.get(l.id);
                  const checked = owner === bi;
                  const disabled = owner != null && owner !== bi;
                  return (
                    <label key={l.id} className={`flex items-center gap-2 text-sm ${disabled ? "text-slate-400" : "text-slate-700"}`}>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => toggleLine(bi, l.id, e.target.checked)} />
                      <span>{short(l.orderId)} — {(l.productName ?? "Sale")} — ${(l.amountCents / 100).toFixed(2)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {b.components.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="border-b border-line text-left text-slate-500">
                  <th className="py-1 pr-4 font-medium">Item</th>
                  <th className="py-1 pr-4 font-medium">Qty</th>
                  <th className="py-1 pr-4 font-medium">Cost</th>
                  <th className="py-1 font-medium"></th>
                </tr></thead>
                <tbody>
                  {b.components.map((c, ci) => (
                    <tr key={c.cid} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4">
                        <ItemCombobox items={items} value={c.itemId} onChange={(id) => setComponent(bi, ci, { itemId: id })} listId="bundle-item-names" placeholder="Search item…" />
                      </td>
                      <td className="py-2 pr-4">
                        <input type="number" min={0} value={c.qty}
                          onChange={(e) => setComponent(bi, ci, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                          className="w-20 rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                      </td>
                      <td className="py-2 pr-4 text-slate-600">${(c.qty * unitOf(c.itemId) / 100).toFixed(2)}</td>
                      <td className="py-2"><button onClick={() => removeComponent(bi, ci)} className="text-sm text-red-600 hover:underline">Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-4">
              <button onClick={() => addComponent(bi)} disabled={items.length === 0} className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50">+ Add component</button>
              <span className="text-sm text-slate-500">
                Cost ${(unitCost / 100).toFixed(2)} × {lineCount} = ${(cost / 100).toFixed(2)} · Revenue ${(revenue / 100).toFixed(2)} · Profit ${((revenue - cost) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button onClick={addBundle} className="text-sm font-medium text-blue-600 hover:underline">+ Add another bundle</button>
        <button onClick={save} className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save bundles</button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "giveaway-items.test.ts" | grep "error" || echo "no new tsc errors"`
Expected: `no new tsc errors`.

- [ ] **Step 3: Manual smoke (the core acceptance test)**

Run `npm run dev`, log in as `demo`/`demo`, open a show that has multiple sale lines (the demo seed includes a bundle). In the Bundles editor:
1. Add a bundle, add components (e.g. 1× of two items).
2. Check **two or more** orders for that one bundle — note the order numbers (`#xxxxxx`) and prices differ.
3. Confirm the line reads `Cost $X × N = $Y · Revenue (sum of checked lines) · Profit`.
4. Save. Reload the page — the bundle reloads as **one** card with the same orders checked (proves group-on-load).
5. Open `/report` and the show page table — each checked order appears as its own bundle row with its own revenue, and `Net`/profit reflect the shared component cost on each.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: green (same as baseline).

- [ ] **Step 5: Commit**

```bash
git add src/components/BundleEditor.tsx
git commit -m "feat(bundles): apply one recipe to multiple orders, with order numbers"
```

---

## Self-Review notes

- **Spec coverage:** Feature 1 (bundle qty) → Tasks 6+7; Feature 2 (order numbers) → Tasks 1+7; Feature 3 (units sold) → Tasks 2+5; Feature 4 (sortable tables) → Tasks 3+4. Report-page inclusion → Tasks 4 (table) + 5 (units sold). Dashboard untouched.
- **Types:** `ReportProductLine` is structurally a `SortableProduct` (has `productName`, `qty`, `unitCostCents`, `costCents`, `revenueCents`, `profitCents`); `sortProducts` is generic so the extra `mapped`/`isBundle`/`components` fields survive. `ShowSaleLine.orderId` (Task 1) feeds `SaleLine.orderId` (Task 7). `groupBundles`/`flattenBundles` signatures match their use in BundleEditor.
- **No placeholders:** every code step is complete.
