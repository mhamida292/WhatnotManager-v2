# In-Stock Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show on the Inventory page how much stock is on hand — in units, dollar value, and count of products still in stock — alongside the existing "True net inventory spend".

**Architecture:** A pure calc function `inStockSummary` derives the figures from the per-item `remaining` and `unitCostCents` the page already computes (negatives clamped to 0 per item). The Inventory page calls it and renders the results as `Stat` cards in a responsive grid. No DB or schema change.

**Tech Stack:** Next.js 15 (App Router, server component page), TypeScript, Vitest, Tailwind.

## Global Constraints

- Money is stored as integer cents everywhere; render with `<Money cents={...} />`.
- Negative `remaining` is clamped to 0 **per item** before summing units and value.
- Dollar value uses each item's average unit cost: `value = Σ max(remaining, 0) × unitCostCents`.
- `productsInStock` counts items with raw `remaining > 0`; `totalProducts` is `items.length`.
- Pure calc functions live in `src/lib/calc/`, take plain data (no DB), and have Vitest unit tests.
- Follow existing terse code style.

---

### Task 1: `inStockSummary` calc

**Files:**
- Create: `src/lib/calc/in-stock.ts`
- Test: `tests/lib/calc/in-stock.test.ts`

**Interfaces:**
- Consumes: nothing (pure function over plain data).
- Produces:
  ```ts
  export interface InStockItem { remaining: number; unitCostCents: number; }
  export interface InStockSummary { units: number; valueCents: number; productsInStock: number; totalProducts: number; }
  export function inStockSummary(items: InStockItem[]): InStockSummary
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/calc/in-stock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { inStockSummary } from "@/lib/calc/in-stock";

describe("inStockSummary", () => {
  it("sums units and value across items", () => {
    const out = inStockSummary([
      { remaining: 3, unitCostCents: 200 },
      { remaining: 2, unitCostCents: 150 },
    ]);
    expect(out).toEqual({ units: 5, valueCents: 900, productsInStock: 2, totalProducts: 2 });
  });

  it("clamps a negative-remaining item to 0 for units and value, but counts it in totalProducts", () => {
    const out = inStockSummary([
      { remaining: 4, unitCostCents: 100 },   // 4 units, 400c
      { remaining: -11, unitCostCents: 225 }, // oversold -> 0 units, 0c
    ]);
    expect(out).toEqual({ units: 4, valueCents: 400, productsInStock: 1, totalProducts: 2 });
  });

  it("does not count a zero-remaining item as in stock", () => {
    const out = inStockSummary([
      { remaining: 0, unitCostCents: 100 },
      { remaining: 5, unitCostCents: 100 },
    ]);
    expect(out).toEqual({ units: 5, valueCents: 500, productsInStock: 1, totalProducts: 2 });
  });

  it("returns all zeros for an empty list", () => {
    expect(inStockSummary([])).toEqual({ units: 0, valueCents: 0, productsInStock: 0, totalProducts: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/calc/in-stock.test.ts`
Expected: FAIL — `inStockSummary` is not defined / module not found.

- [ ] **Step 3: Implement the calc**

Create `src/lib/calc/in-stock.ts`:

```ts
export interface InStockItem { remaining: number; unitCostCents: number; }

export interface InStockSummary {
  units: number;            // Σ max(remaining, 0)
  valueCents: number;       // Σ max(remaining, 0) × unitCostCents
  productsInStock: number;  // count of items with remaining > 0
  totalProducts: number;    // items.length
}

/** On-hand stock derived from per-item remaining + avg unit cost. Negative
 *  remaining (oversold) is clamped to 0 per item so one bad row never drags the
 *  totals below the true on-hand count. */
export function inStockSummary(items: InStockItem[]): InStockSummary {
  let units = 0, valueCents = 0, productsInStock = 0;
  for (const it of items) {
    const onHand = Math.max(it.remaining, 0);
    units += onHand;
    valueCents += onHand * it.unitCostCents;
    if (it.remaining > 0) productsInStock += 1;
  }
  return { units, valueCents, productsInStock, totalProducts: items.length };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/calc/in-stock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/in-stock.ts tests/lib/calc/in-stock.test.ts
git commit -m "feat(inventory): inStockSummary calc (units/value/product count, clamps negatives)"
```

---

### Task 2: Render the summary on the Inventory page

**Files:**
- Modify: `src/app/inventory/page.tsx` (imports + the stat block, currently the `<div className="max-w-xs">` at lines 25-27)

**Interfaces:**
- Consumes: `inStockSummary` from Task 1; existing `items` (each has `remaining` and `unitCostCents`),
  `Stat`, `Money`, and the existing `spend` value.
- Produces: UI only.

This task is a server component render change; verify by `npm run build` (type-check) and a manual
look listed in Step 3.

- [ ] **Step 1: Wire in the summary and render the cards**

In `src/app/inventory/page.tsx`:

(a) Add the import near the other `@/lib/calc` import:

```tsx
import { inStockSummary } from "@/lib/calc/in-stock";
```

(b) After the `const spend = netInventorySpend(...)` line, compute:

```tsx
  const stock = inStockSummary(items);
```

(c) Replace this existing block:

```tsx
      <div className="max-w-xs">
        <Stat label="True net inventory spend" value={<Money cents={spend} />} />
      </div>
```

with:

```tsx
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="In stock" value={`${stock.units} units`} />
        <Stat label="In-stock value" value={<Money cents={stock.valueCents} />} />
        <Stat label="Products in stock" value={`${stock.productsInStock} of ${stock.totalProducts}`} />
        <Stat label="True net inventory spend" value={<Money cents={spend} />} />
      </div>
```

(`Stat`, `Money`, and `netInventorySpend` are already imported in this file; only `inStockSummary`
is new.)

- [ ] **Step 2: Type-check / build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors in `page.tsx`.

- [ ] **Step 3: Run the full suite + manual look**

Run: `npx vitest run`
Expected: all tests pass (prior suite + Task 1's 4 new tests).

Manual: `rm -rf .next && npm run dev`, open `/inventory` — four stat cards across the top: In stock
(units), In-stock value ($), Products in stock (N of M), True net inventory spend. Oversold items
(negative remaining) do not reduce the units/value totals.

- [ ] **Step 4: Commit**

```bash
git add src/app/inventory/page.tsx
git commit -m "feat(inventory): show in-stock units, value, and product count on the page"
```

---

## Self-Review notes

- **Spec coverage:** calc with clamp + value-by-avg-cost + product counts (Task 1); page renders the
  three new figures + existing spend in a responsive grid (Task 2); tests for sum/clamp/zero/empty
  (Task 1). All spec sections covered.
- **No DB/schema change** — confirmed; pure derivation of data already on the page.
- **Type consistency:** `InStockItem`/`InStockSummary`/`inStockSummary` names and the
  `{ units, valueCents, productsInStock, totalProducts }` shape match between Tasks 1 and 2.
