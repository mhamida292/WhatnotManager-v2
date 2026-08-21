# Sales invoices (wholesale) + inventory cleanup — design

**Date:** 2026-06-27
**Status:** ✅ Design — ready for user review → writing-plans
**Supersedes brainstorm:** the ad-hoc "enter pieces" wholesale idea was replaced by the
outbound-invoice model below.

## Why

Two related gaps:

1. **Wholesale sales have nowhere to live.** Every sale today comes from the Whatnot CSV
   import (`ledger_transactions`, grouped into shows). When the user sells stock off-Whatnot
   — e.g. 24 pcs ("2 display cases of 12") to one buyer at a wholesale price — there is no
   ledger row and no show, so it can't reduce stock or be counted as revenue/profit.
2. **The inventory model is confusing.** Specifically: negative values are allowed; `qty_samples`
   and `qty_adjustment` are two opaque knobs; "remaining" is computed but never shown as a
   derivation; and unmapped Whatnot product names silently count at $0 profit.

These overlap — wholesale already touches the "remaining" math and the no-negatives guard — so
they ship as one spec.

## Part A — Sales invoices (the wholesale mechanism)

### Concept

The existing invoice system is **inbound**: supplier → you, recording the **cost** of inventory
bought. This adds the **outbound** mirror: a **sales invoice**, you → a buyer. A wholesale sale
simply *is* a posted sales invoice. The same feature does double duty: internal accounting
(stock down, revenue/profit up) **and** a customer-facing printable document.

### Behavior

- An invoice gains a **direction**: `purchase` (existing) or `sale` (new). Labels in the UI:
  **Purchases** (money out) and **Sales** (money in).
- A **sales invoice** has: a **customer** (free-text, parallel to `supplier`), a date, and line
  items of **item + qty (pieces) + unit sale price**. Qty is always stored as pieces; a small
  "N packs × M per pack" helper computes pieces on entry (ad-hoc — no fixed case size on the
  product).
- Invoices keep the existing **draft / posted** status, and gain a **paid / unpaid** flag with
  an optional `paid_on` date.

### Two-stage recognition (deliberate)

- **Stock decreases when the sale is POSTED.** The goods have left inventory regardless of
  payment. Posted sale-line quantities become a new "sold" source feeding `qtySold` /
  `qtyRemaining`.
- **Revenue & profit count when the invoice is PAID.** The Report only recognizes wholesale
  revenue/COGS/profit for sale invoices that are `posted` AND `paid`. Unpaid posted invoices
  show as "owed to you" and are excluded from profit until marked Paid.

> This split is intentional: an item can be out of stock (shipped) while its revenue is still
> pending. State it clearly in the UI.

### Cost basis & profit

Wholesale COGS uses the item's **current average unit cost** (`inventory_items.unit_cost_cents`)
— the same source show COGS already uses in `buildLedgerReport`. Profit = revenue − (avg unit
cost × pieces). No per-invoice cost snapshot is stored (mirrors how shows compute COGS live).

### Oversell guard

Posting a sale whose quantity would drive an item's `remaining` below 0 is **blocked** with a
message naming the item and the available count. (Draft invoices are not guarded — only posting.)

### Owner/partner split

Wholesale net profit flows through the existing owner/partner split (`splitProfit`,
`owner_share_pct`) exactly like show profit, so "Your share" includes it. (Single flag in the
design if we ever want wholesale to be 100% owner; default = apply split.)

### Document generation

A print-friendly invoice view at `/invoices/[id]/print` (or a "Print / Save PDF" action) renders
a clean document: business name, `INVOICE #<id>`, bill-to customer + date, line table, total,
thank-you line. Dependency-free — the user prints to PDF via the browser. Uses `business_name`
from `app_settings`.

### Invoices list page

One page lists both kinds:

- Filter tabs: **All / Purchases / Sales**.
- Per row: kind (with ↗ Sale / ↘ Purchase indicator), #, party (customer or supplier), date,
  total, draft/posted status, **Paid/Unpaid** badge.
- Two running totals: **Owed to you** (Σ unpaid posted sales) and **You owe** (Σ unpaid posted
  purchases).

### Where wholesale profit shows up

1. **Report top totals** — Revenue / COGS / Net profit / Your share blend Whatnot + wholesale,
   with a small "Whatnot $X · WS $Y" sub-note on revenue.
2. **A new "Wholesale" card** on the Report, alongside the per-show cards, listing each paid
   sale invoice (customer, qty, revenue, COGS, profit). Unpaid posted invoices appear greyed
   with an "owed to you, not yet counted" note.
3. **Dashboard** headline profit numbers include wholesale.

## Part B — Inventory cleanup

### 1. Transparent "Remaining"

Show the derivation wherever remaining appears (item detail, and an expandable breakdown from
the Inventory table):

```
Purchased            144
− Sold (Whatnot 18 · wholesale 24 · brother …)   −42
− Adjustments (see log)                           −6
= Remaining                                        96
```

The "Sold" line breaks down by source (Whatnot ledger, legacy show lines, gave-to-brother,
wholesale). Adjustments link to the log (below).

### 2. Adjustments log replaces samples + adjustment

`qty_samples` and `qty_adjustment` are removed from the mental model and replaced by a single
**adjustments log**: a dated list of signed entries, each with a **reason**:
`sample`, `damage_loss`, `recount`, `other`, plus an optional note.

`remaining = qty_purchased − sold + Σ(adjustment.qty)` where adjustment qtys are signed
(samples and losses are negative; a recount can be ±). Samples are still **not** "sold" — they
're just one reason in the log.

### 3. No negatives

- Quantity and price inputs reject negative values (purchase qty, sale qty, sale price).
- The oversell guard (Part A) blocks posting a sale beyond remaining.
- Adjustment-log entries are the **only** place a signed (±) quantity is allowed, by design.

### 4. Loud alias mapping

An unmapped-names banner appears on the **Inventory page** (today the warning only lives on the
Report): "N Whatnot product names aren't mapped — their sales count at $0 profit" with a
**Map them now →** action.

## Data model changes

```sql
-- invoices: add direction, customer, paid tracking
ALTER TABLE invoices ADD COLUMN direction TEXT NOT NULL DEFAULT 'purchase'
  CHECK (direction IN ('purchase','sale'));
ALTER TABLE invoices ADD COLUMN customer TEXT;          -- buyer, for sale invoices
ALTER TABLE invoices ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;  -- 0/1
ALTER TABLE invoices ADD COLUMN paid_on TEXT;

-- invoice_lines: sale lines carry a sale price (purchase lines keep unit_cost_cents)
ALTER TABLE invoice_lines ADD COLUMN unit_price_cents INTEGER;   -- NULL for purchases

-- new: inventory adjustments log (replaces qty_samples + qty_adjustment usage)
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')),
  qty INTEGER NOT NULL,        -- signed delta to remaining
  note TEXT
);
```

**One-time migration** (runs once on existing workspaces):
- For each item with `qty_samples > 0`: insert an adjustment `(reason='sample', qty = −qty_samples)`.
- For each item with `qty_adjustment <> 0`: insert an adjustment `(reason='recount', qty = qty_adjustment)`
  (preserves the existing sign, which already added to remaining).
- After migration the remaining calc reads only `inventory_adjustments`; the legacy columns are
  left in place but no longer read (non-destructive). A follow-up can drop them.

### New / changed queries

- `qtySold` gains a wholesale source: Σ `invoice_lines.quantity` where the parent invoice has
  `direction='sale'` AND `status='posted'`, joined by `item_id`.
- `qtyRemaining` switches its adjustments term from the two columns to
  `Σ inventory_adjustments.qty`.
- Report: a wholesale roll-up = sale invoices with `status='posted'` AND `paid=1`, producing
  revenue (Σ line qty × unit_price), COGS (Σ line qty × item avg cost), profit.
- "Owed to you" = unpaid posted sales total; "You owe" = unpaid posted purchases total.

## Units & conventions

- Money is integer cents, rendered via `<Money>`. Quantities are integer pieces.
- Tailwind, mobile-first (the responsive table/nav patterns from the recent pass apply to the
  new Sales-invoice and Wholesale views too).
- No new heavy dependencies — PDF is browser print; combobox stays native.

## Out of scope (explicitly)

- Partial payments / payment schedules (paid is a single boolean + date).
- Per-invoice cost snapshots (COGS stays live off current avg cost).
- Tax/VAT lines on the document.
- Customer records as first-class entities (customer is free text for now).
- Dropping the legacy `qty_samples` / `qty_adjustment` columns (deferred; migration only).

## Affected files (for the plan)

- `src/lib/db/schema.ts` — new columns, `inventory_adjustments`, migration.
- `src/lib/db/inventory.ts` — `qtySold`/`qtyRemaining` (wholesale source + adjustments table),
  adjustment CRUD, remove `updateItemSamples`/`setItemRemaining` reliance on old columns.
- `src/lib/db/purchases.ts` / a new `src/lib/db/invoices.ts` — sale-invoice CRUD, post, paid.
- `src/lib/calc/ledger-report.ts` — fold wholesale (paid) into totals + a wholesale roll-up.
- `src/app/invoices/*` — list (tabs + paid badges + totals), sale-invoice editor, `[id]/print`.
- `src/app/report/page.tsx` — top-total blend + Wholesale card.
- `src/app/page.tsx` (Dashboard) — include wholesale in headline numbers.
- `src/app/inventory/*`, `src/components/InventoryTable.tsx`, `EditItemModal` — transparent
  remaining breakdown, adjustments-log UI, unmapped banner, no-negative inputs.
