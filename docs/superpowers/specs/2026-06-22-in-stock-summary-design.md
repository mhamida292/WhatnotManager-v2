# In-stock summary (units + dollars + product count) — design

Date: 2026-06-22

## Goal

Show the user, on the Inventory page, how much stock they currently hold — in **units**, in
**dollar value**, and as a **count of products still in stock** — alongside the existing
"True net inventory spend" figure.

## Decisions (made with the user)

- **Negative remaining is clamped to 0 per item.** Some items are oversold (e.g. Jellyfish −11)
  due to data quirks. "In stock" means what is actually on hand to sell, so an oversold item
  contributes 0 — it never drags the totals below the true on-hand count.
- **Dollar value uses each item's average unit cost** (`unitCostCents`, the same Avg cost shown in
  the table): `value = Σ max(remaining, 0) × unitCostCents`.
- The summary shows **three** figures plus the existing spend card: units in stock, in-stock value,
  and "{productsInStock} of {totalProducts}" products in stock.

## Changes

### 1. New calc — `src/lib/calc/in-stock.ts`

A pure function, no DB access (the page already has the per-item numbers):

```ts
export interface InStockItem { remaining: number; unitCostCents: number; }
export interface InStockSummary {
  units: number;            // Σ max(remaining, 0)
  valueCents: number;       // Σ max(remaining, 0) × unitCostCents
  productsInStock: number;  // count of items with remaining > 0
  totalProducts: number;    // items.length
}
export function inStockSummary(items: InStockItem[]): InStockSummary
```

Clamp each item's `remaining` to `>= 0` before adding to `units` and `valueCents`. Count a product
toward `productsInStock` only when its raw `remaining > 0`. `totalProducts` is `items.length`.

### 2. Inventory page — `src/app/inventory/page.tsx`

The page already builds `items` with `remaining` and `unitCostCents`. Call
`inStockSummary(items)` and render the results next to the existing "True net inventory spend"
`Stat`. Replace the current single-card `<div className="max-w-xs">` with a small responsive grid
(e.g. `grid gap-3 sm:grid-cols-2 lg:grid-cols-4`) of `Stat` cards:

- **In stock** — `{units}` (units)
- **In-stock value** — `<Money cents={valueCents} />`
- **Products in stock** — `{productsInStock} of {totalProducts}`
- **True net inventory spend** — `<Money cents={spend} />` (unchanged figure)

No change to the table, COGS, or any existing calc.

### 3. Tests — `tests/lib/calc/in-stock.test.ts`

- Sums units and value across multiple items (e.g. 3 @ $2 + 2 @ $1.50 → 5 units, $9.00).
- A negative-remaining item contributes 0 to both units and value (clamp), while a positive item
  still counts.
- `productsInStock` counts only items with `remaining > 0`; `totalProducts` is the full count
  (including zero/negative items).
- Empty list → `{ units: 0, valueCents: 0, productsInStock: 0, totalProducts: 0 }`.

## Out of scope

- No schema or DB changes — this is a pure derivation of data already computed on the page.
- No change to "True net inventory spend" (cash tied up in stock at full purchased cost is a
  different figure from current on-hand value; both are shown).
