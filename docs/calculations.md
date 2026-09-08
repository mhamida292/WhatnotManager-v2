# Calculations Reference

The underlying math behind every number the app shows. All money is stored as
**integer cents** (no floats). Profit flows from a single source —
`buildLedgerReport` (`src/lib/calc/ledger-report.ts`) — so the Dashboard and the
`/report` page always agree.

## Dashboard cards (`src/lib/calc/dashboard.ts`)

| Card | Formula |
|---|---|
| **Gross sales** | Σ of all **product-sale** amounts only (`kind='sale'`). Excludes tips, bonus, giveaway fees, withdrawals. |
| **Total payout** | Σ over shows of each show's payout, where a show's payout = Σ of **all non-withdrawal** txns = sales + tips + bonus + giveaway-fee + other. |
| **Paid to bank** | Σ of `PAYOUT`-kind (bank-withdrawal) amounts, shown positive. A *transfer*, not income/expense — excluded from profit. |
| **Total net profit** | Σ of each show's net (see below). |
| **Owner share / Partner share** | Split of total net (see split rule). |
| **Net inventory spend** | Cash tied up in stock (balance-sheet, see below). |
| **Total expenses** | Σ of every Expenses-page entry's `amount_cents`. |
| **Total wages** | Σ of payroll amounts charged to shows. Unallocated wages are reported separately. |

## Per-show net profit — the core P&L (`ledger-report.ts`)

```
net = payout − COGS − giveawayMerchCost − shippingSupplies − labor
```

- **payout** = sales + tips + bonus + giveaway-fee + other. The giveaway *fee*
  Whatnot charges is already inside payout (as a negative amount). Bank
  withdrawals (`kind='payout'`) are excluded.
- **COGS** = Σ over sold product lines of `qty × item unit cost`. Each ledger
  sale row = 1 unit. Costs resolve **live** at report time via the alias map. An
  **unmapped** product counts as **$0 cost** (profit looks too high until mapped
  — this is the yellow "unmapped products" warning).
- **giveawayMerchCost** = `round(Σ allocation.count × (packCost ÷ packQty))` —
  the real merchandise given away, from the per-show giveaway allocations.
  Separate from the giveaway *fee* in payout. Rounded once.
- **shippingSupplies** = the per-show shipping amount (default $5.00 / 500¢).
- **labor** = wages recorded for the show's date, split evenly across that date's
  sessions (remainder cent to the earliest session). Resolved **live** from
  `payroll_entries` at report time, like COGS. Wages on a date with **no** show
  cannot belong to a net; they are reported separately as **unallocated labor**
  and are not subtracted anywhere.

## Owner / partner split (`show-pnl.ts` → `splitProfit`)

```
partnerShare = floor(net × (100 − ownerPct) / 100)
ownerShare   = net − partnerShare
```

Default `ownerPct = 80`, so partner = `floor(net × 20%)` and **the owner absorbs
the rounding remainder** (partner gets the floor; owner is never short a cent).

## "Revenue" vs "Payout" (why they differ)

- **Revenue / Gross sales** = product sales only.
- **Payout** = everything Whatnot credited (sales + tips + bonus + giveaway fee +
  other).

Payout > revenue when there were tips or the $400 bonus. Net profit is built from
**payout**, so tips and bonus *do* count toward profit.

## Bundles (override normal COGS)

For a sale line marked as a bundle:

```
bundleCost   = Σ (component qty × component unit cost)
bundleProfit = bundle revenue − bundleCost
```

The bundle's components override the alias mapping for that one line.

## Inventory (`src/lib/db/inventory.ts`, `src/lib/calc/in-stock.ts`)

```
qtySold      = ledger sale count (aliased to item) + legacy confirmed sales + gave-to-brother qty
qtyRemaining = qtyPurchased − qtySold − qtySamples + qtyAdjustment
```

- **In-stock units** = Σ `max(remaining, 0)` (oversold rows clamped to 0 so they
  can't drag the total negative).
- **In-stock value** = Σ `max(remaining, 0) × unitCost`.
- **Products in stock** = count of items with `remaining > 0`.

## Item unit cost — weighted average (`src/lib/db/purchases.ts`)

```
itemSpend = Σ over purchase batches of (batch qty × batch unit cost)
unitCost  = itemSpend ÷ total qty purchased     (weighted avg, recomputed when batches change)
```

This weighted-average unit cost is what COGS multiplies by.

## Net inventory spend — balance-sheet, NOT a deduction (`inventory-spend.ts`)

```
spend = Σ itemSpend (all purchases)
        + split_shipment owner cost
        + bought_from_brother amount
        − gave_to_brother amount
        − payback_received amount
```

This is **cash invested in stock** — a balance-sheet figure. It is deliberately
**not** subtracted from profit, because COGS already accounts for inventory that
actually *sold*. It is also roughly your **ending inventory value** for taxes
(≈ remaining × unit cost).

## Per-product earnings & average price (`item-earnings.ts`, `avg-per-unit.ts`)

```
itemRevenue = Σ sale amounts
itemCost    = saleCount × unitCost
itemProfit  = itemRevenue − itemCost
avgPerUnit  = round(revenue ÷ qty)     (blank when qty = 0)
```

## Two subtleties to remember

1. The **giveaway fee** (inside payout) and the **giveaway merchandise cost**
   (from allocations) are two different things — the app subtracts both.
2. **Net inventory spend is not an expense** — it never reduces profit; it only
   reports how much cash is sitting in unsold stock. COGS already handles sold
   inventory.
