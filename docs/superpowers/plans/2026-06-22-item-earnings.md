# Per-Product Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show revenue, cost of units sold, and profit for a product on its item detail page, inside the existing Stock breakdown card.

**Architecture:** A pure calc `itemEarnings` derives the three figures from the item's ledger sales (already loaded on the page) and its avg unit cost. The item detail page calls it and appends three rows to the existing summary table. No DB or schema change.

**Tech Stack:** Next.js 15 (App Router, async server component), TypeScript, Vitest, Tailwind.

## Global Constraints

- Money is stored as integer cents everywhere; render with `<Money cents={...} />`.
- All three figures derive from **ledger sales** only: `revenue = Σ amountCents`,
  `cost = sales.length × unitCostCents`, `profit = revenue − cost`.
- Each ledger sale row is one unit, so the sold-unit count is `sales.length`.
- Pure calc functions live in `src/lib/calc/`, take plain data (no DB), and have Vitest unit tests.
- Profit is shown green when `>= 0`, red when negative.
- Follow existing terse code style.

---

### Task 1: `itemEarnings` calc

**Files:**
- Create: `src/lib/calc/item-earnings.ts`
- Test: `tests/lib/calc/item-earnings.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over plain data).
- Produces:
  ```ts
  export interface ItemSaleAmount { amountCents: number; }
  export interface ItemEarnings { revenueCents: number; costCents: number; profitCents: number; }
  export function itemEarnings(sales: ItemSaleAmount[], unitCostCents: number): ItemEarnings
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/calc/item-earnings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { itemEarnings } from "@/lib/calc/item-earnings";

describe("itemEarnings", () => {
  it("revenue sums amounts, cost = count × unit cost, profit = revenue − cost", () => {
    const out = itemEarnings([{ amountCents: 100 }, { amountCents: 150 }, { amountCents: 200 }], 50);
    expect(out).toEqual({ revenueCents: 450, costCents: 150, profitCents: 300 });
  });

  it("returns all zeros when there are no sales", () => {
    expect(itemEarnings([], 50)).toEqual({ revenueCents: 0, costCents: 0, profitCents: 0 });
  });

  it("reports negative profit when cost exceeds revenue", () => {
    const out = itemEarnings([{ amountCents: 10 }, { amountCents: 20 }], 100);
    expect(out).toEqual({ revenueCents: 30, costCents: 200, profitCents: -170 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/calc/item-earnings.test.ts`
Expected: FAIL — `itemEarnings` is not defined / module not found.

- [ ] **Step 3: Implement the calc**

Create `src/lib/calc/item-earnings.ts`:

```ts
export interface ItemSaleAmount { amountCents: number; }

export interface ItemEarnings {
  revenueCents: number;   // Σ amountCents
  costCents: number;      // sales.length × unitCostCents
  profitCents: number;    // revenue − cost
}

/** Per-product earnings from its ledger sales. Each sale row is one unit, so the
 *  cost basis is sales.length × the item's avg unit cost — keeping revenue and
 *  cost consistent (both from the same ledger-sale set). */
export function itemEarnings(sales: ItemSaleAmount[], unitCostCents: number): ItemEarnings {
  const revenueCents = sales.reduce((a, s) => a + s.amountCents, 0);
  const costCents = sales.length * unitCostCents;
  return { revenueCents, costCents, profitCents: revenueCents - costCents };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/calc/item-earnings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/item-earnings.ts tests/lib/calc/item-earnings.test.ts
git commit -m "feat(inventory): itemEarnings calc (revenue/cost/profit from ledger sales)"
```

---

### Task 2: Show earnings rows on the item detail page

**Files:**
- Modify: `src/app/inventory/[id]/page.tsx` (imports near line 7; compute after the existing
  `sales` line ~41; the `summary` array at lines 48-57)

**Interfaces:**
- Consumes: `itemEarnings` from Task 1; the existing `sales` (each row has `amountCents`) and
  `item.unitCostCents`; existing `Money` component.
- Produces: UI only.

This task is a server-component render change; verify by `npm run build` (type-check) and the full
test suite. No new unit test.

- [ ] **Step 1: Wire in the calc and append the rows**

In `src/app/inventory/[id]/page.tsx`:

(a) Add the import after the existing `Money` import (line 7):

```tsx
import { itemEarnings } from "@/lib/calc/item-earnings";
```

(b) After the existing `const sales = ledgerSalesForItem(db, itemId);` line, add:

```tsx
  const earnings = itemEarnings(sales, item.unitCostCents);
```

(c) Replace the existing `summary` array (lines 48-57):

```tsx
  const summary: [string, React.ReactNode][] = [
    ["Unit cost", <Money cents={item.unitCostCents} />],
    ["Purchased", item.qtyPurchased],
    ["Sold — ledger sales", ledgerSold],
    ["Sold — legacy show sales", legacySold],
    ["Sold — gave to brother", brother],
    ["Sold — total", ledgerSold + legacySold + brother],
    ["Samples", item.qtySamples],
    ["Remaining", remaining],
  ];
```

with the same array plus three earnings rows appended after "Remaining":

```tsx
  const summary: [string, React.ReactNode][] = [
    ["Unit cost", <Money cents={item.unitCostCents} />],
    ["Purchased", item.qtyPurchased],
    ["Sold — ledger sales", ledgerSold],
    ["Sold — legacy show sales", legacySold],
    ["Sold — gave to brother", brother],
    ["Sold — total", ledgerSold + legacySold + brother],
    ["Samples", item.qtySamples],
    ["Remaining", remaining],
    ["Revenue (ledger sales)", <Money cents={earnings.revenueCents} />],
    ["Cost of units sold", <Money cents={earnings.costCents} />],
    ["Profit", <span className={earnings.profitCents >= 0 ? "text-emerald-700" : "text-red-600"}><Money cents={earnings.profitCents} /></span>],
  ];
```

- [ ] **Step 2: Type-check / build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors in `[id]/page.tsx`.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: all tests pass (prior suite + Task 1's 3 new tests).

- [ ] **Step 4: Commit**

```bash
git add "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): show per-product revenue, cost, and profit on item page"
```

---

## Self-Review notes

- **Spec coverage:** calc with revenue/cost/profit from ledger sales (Task 1); three rows appended
  to Stock breakdown with green/red profit (Task 2); tests for sum/zero/negative (Task 1). All spec
  sections covered.
- **No DB/schema change** — confirmed; pure derivation of data already on the page.
- **Type consistency:** `ItemSaleAmount`/`ItemEarnings`/`itemEarnings` and the
  `{ revenueCents, costCents, profitCents }` shape match between Tasks 1 and 2. The page's `sales`
  rows expose `amountCents` (from `ledgerSalesForItem`), satisfying `ItemSaleAmount`.
