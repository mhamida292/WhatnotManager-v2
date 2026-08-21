# Earnings per product (item detail page) — design

Date: 2026-06-22

## Goal

On the item detail page (`/inventory/[id]`), show how much the product earned: **revenue**,
**cost of units sold**, and **profit** — three lines added to the existing "Stock breakdown" card.

## Definition (confirmed with the user)

Each ledger sale row is one unit and its `amountCents` is the Whatnot payout for that unit. All three
figures derive from the item's **ledger sales**, so revenue and cost stay apples-to-apples:

- **Revenue** = Σ of the item's ledger-sale `amountCents`.
- **Cost of units sold** = (count of those ledger sales) × the item's avg unit cost (`unitCostCents`).
- **Profit** = Revenue − Cost.

Cost is based on **ledger-sold units**, not "Sold — total", because revenue only exists for ledger
sales: legacy show sales aren't tracked per item with a dollar amount, and "gave to brother" is not a
cash sale ($0). For current data (legacy and brother sold counts are 0 on these items) ledger-sold
equals total-sold anyway. Since each ledger sale row equals one unit, the count is simply
`sales.length`, so revenue and cost both come from the same `sales` array.

## Changes

### 1. New calc — `src/lib/calc/item-earnings.ts`

A pure function, no DB access:

```ts
export interface ItemSaleAmount { amountCents: number; }
export interface ItemEarnings { revenueCents: number; costCents: number; profitCents: number; }
export function itemEarnings(sales: ItemSaleAmount[], unitCostCents: number): ItemEarnings
```

- `revenueCents` = sum of `amountCents` over `sales`.
- `costCents` = `sales.length × unitCostCents`.
- `profitCents` = `revenueCents − costCents`.

### 2. Item detail page — `src/app/inventory/[id]/page.tsx`

The page already loads `sales = ledgerSalesForItem(db, itemId)` (each row has `amountCents`) and
`item.unitCostCents`. Call `itemEarnings(sales, item.unitCostCents)` and append three rows to the
existing `summary` array, after the "Remaining" row:

- **Revenue (ledger sales)** — `<Money cents={revenueCents} />`
- **Cost of units sold** — `<Money cents={costCents} />`
- **Profit** — `<Money cents={profitCents} />`, shown green when `profitCents >= 0` and red when
  negative (e.g. wrap in a `<span>` with a conditional `text-emerald-700` / `text-red-600` class).

No change to the existing rows, the mappings card, purchases, ledger-sales table, or any other calc.

### 3. Tests — `tests/lib/calc/item-earnings.test.ts`

- Revenue sums the amounts; cost = count × unit cost; profit = revenue − cost
  (e.g. three sales of [100, 150, 200] @ unit cost 50 → revenue 450, cost 150, profit 300).
- No sales → `{ revenueCents: 0, costCents: 0, profitCents: 0 }`.
- Negative profit when cost exceeds revenue (e.g. two sales of [10, 20] @ unit cost 100 →
  revenue 30, cost 200, profit −170).

## Out of scope

- No schema or DB change — pure derivation of data already loaded on the page.
- Legacy show-sale revenue and brother transactions are not folded in (not tracked as per-item cash
  sales); only ledger-sale revenue/cost/profit is shown.
