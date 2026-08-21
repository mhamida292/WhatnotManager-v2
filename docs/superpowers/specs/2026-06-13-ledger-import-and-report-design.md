# Ledger Import & Profit Report — Design (Phase 1)

Date: 2026-06-13
Status: Approved for spec review

## Context

The Whatnot Business Manager currently creates shows by uploading a per-show
line-item CSV and **manually typing in the payout**. This is unreliable: the
per-show CSV is only good for line items, and the payout is hand-entered.

Whatnot also exports a **full account ledger** (`ledger.csv`) containing the
actual earned amount on every transaction. Example columns:

```
"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","1924736723","1107752563","Earnings for selling a Highland Cow Squishy (Assorted Colors)  #3","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","1924736803","1107752614","Charged deduction of $0.78 for giveaway order fySiGffLWeRVZJ5qzfus7T","completed","SALES","Jun 12, 2026, 10:14:56 AM"
"Jun 10, 2026, 12:00:41 AM","$400.00","","","New Seller Sales Match Bonus","completed","ADJUSTMENT","Jun 10, 2026, 12:00:41 AM"
"Jun 8, 2026, 10:55:32 PM","$1.00","","","Received a tip from snorke","completed","TIP","Jun 11, 2026, 11:20:45 PM"
```

Observed in the real file: 271 SALES rows (positive product earnings +
negative giveaway deductions), 1 ADJUSTMENT (the $400 bonus), 1 TIP ($1),
25 giveaway deduction rows, spanning four dates (Jun 8/9/10/12).

This spec covers **Phase 1** only. Decided decomposition:

- **Phase 1 (this spec):** ledger import, profit report, settings page, alias dropdown.
- **Phase 2 (later spec):** delete inventory items, edit quantity on hand.
- **Phase 3 (later spec):** rework "brother transactions" into Sold/Purchased
  with a `source` field tied into Lots. Fuzziest; gets its own brainstorm.

## Decisions (locked in during brainstorming)

- Ledger **replaces** the manual per-show upload + payout flow. It becomes the
  single source of truth for sales.
- Transactions are grouped into shows **by calendar date** (one date = one show).
- The report breaks down **per-product, per-show**, plus a grand-total
  profit-so-far that nets out all expenses.
- "Money I made" includes giveaway deductions, the $400 bonus, and tips.
- Unmapped products: **flag + count revenue + treat cost as $0** (nothing hidden).
- Settings page makes the **owner/partner split, giveaway unit cost, and default
  shipping supplies** editable.
- The alias-map "Whatnot product name" field becomes a **dropdown/combobox**
  populated from product names seen in imports.
- **$400 double-count fix:** the bonus now comes from the ledger, so the
  duplicate negative-expense copy in the `expenses` table is no longer counted.

## Components

### 1. Ledger parser & classifier — `src/lib/csv/ledger.ts`

Parses the 8-column ledger export into typed rows. Responsibilities:

- **Amount** `"$0.49"` / `"-$0.78"` / `"$400.00"` → signed integer cents.
- **Created Date** `"Jun 12, 2026, 10:14:57 AM"` → ISO timestamp + a
  `YYYY-MM-DD` calendar date (used for show grouping).
- **Kind**, derived from Transaction Type + Message:
  - `sale` — `SALES` + message `Earnings for selling a/an <X> #n`. Product
    name extracted with the existing `baseProductName()` (strips trailing ` #n`),
    quantity 1.
  - `giveaway` — `SALES` + message `Charged deduction of $X for giveaway order …`
    (amount is negative).
  - `bonus` — `ADJUSTMENT` + message containing `Sales Match Bonus` (the $400).
  - `tip` — `TIP` (e.g. `Received a tip from …`).
  - `other` — anything unrecognized. Kept and surfaced, never silently dropped.

Types live alongside in `ledger.ts` (e.g. `LedgerRow`, `LedgerKind`). Reuses
`baseProductName()` from `src/lib/csv/classify.ts` so cost mapping stays
consistent with the existing inventory/alias logic.

### 2. Storage — `ledger_transactions` table

New table, the source of truth for ledger lines:

```sql
CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER REFERENCES shows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,          -- ISO timestamp
  show_date TEXT NOT NULL,           -- YYYY-MM-DD (grouping key)
  amount_cents INTEGER NOT NULL,     -- signed
  kind TEXT NOT NULL,                -- sale | giveaway | bonus | tip | other
  product_name TEXT,                 -- base product name (sales only)
  item_id INTEGER REFERENCES inventory_items(id),  -- resolved via product_aliases
  listing_id TEXT,
  order_id TEXT,
  message TEXT,
  status TEXT,                       -- processing | completed
  txn_type TEXT,                     -- SALES | ADJUSTMENT | TIP | ...
  dedup_key TEXT NOT NULL UNIQUE     -- hash(show_date|amount|order_id|listing_id|message)
);
```

Import behavior:

- Rows grouped by `show_date`. For each date, **upsert a `shows` row**
  (match on `show_date`); insert its transactions.
- `dedup_key` makes re-importing the same (or overlapping) file **idempotent** —
  duplicate lines are skipped, never double-counted.
- A show's payout is **computed** as `SUM(amount_cents)` of its transactions and
  written to `shows.payout_cents`, replacing manual entry. `shipping_supplies_cents`
  remains a manual per-show field (the ledger does not know box/label costs).
- `item_id` is resolved at import time via `product_aliases`; left NULL when the
  product is unmapped (recomputed on report so later mappings are reflected —
  the report resolves `item_id` live via alias join rather than trusting the
  stored value, so mapping a product after import does not require re-import).

### 3. Import UI — Shows page (`src/components/ShowUpload.tsx` + `/api/shows`)

- New "Import Ledger" upload control (distinct from the legacy per-show upload,
  which Phase 1 leaves in place but de-emphasized).
- Upload → server parses & classifies → returns a **preview grouped by date**:
  per-show computed payout, sale/giveaway/tip/bonus counts, and a **warning list
  of unmapped product names** with their occurrence counts.
- User confirms → server writes shows + `ledger_transactions` (idempotent).

### 4. Report — `/report` page + `src/lib/calc/ledger-report.ts`

Pure calc module consumes ledger transactions + inventory costs + settings,
returns a structured report. Page renders it.

Per show:
- One row per product: qty sold, unit cost, total cost (`qty × unit_cost`),
  revenue earned (sum of that product's `sale` amounts), profit (`revenue − cost`).
- Non-product lines for the show: giveaway total (negative), tips, bonus.
- **Show net = payout − COGS − shipping_supplies**, where
  `payout = SUM(amount_cents)` for the show (already includes giveaways/tips/bonus).

Unmapped products: revenue shown normally; cost rendered as `unmapped` and
treated as `$0` in totals. A per-report count of unmapped products is surfaced.

Grand total (**profit-so-far**):
- Total revenue, total COGS, total shipping supplies, **net profit**, and the
  **owner's share** computed from the configurable split (partner = floor,
  owner absorbs remainder — consistent with existing `show-pnl` rounding).

### 5. Settings — `/settings` page + `app_settings` table

Single-row config table:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_share_pct INTEGER NOT NULL DEFAULT 80,         -- partner gets 100 - this
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  default_shipping_supplies_cents INTEGER NOT NULL DEFAULT 0
);
```

- Seeded with the single row (id=1, defaults above) on schema init.
- `/settings` page: edit the three values; `/api/settings` GET/PUT.
- `ledger-report.ts` and `show-pnl.ts` read `owner_share_pct` instead of the
  hard-coded 80/20; report reads `giveaway_unit_cents`; new shows default
  `shipping_supplies_cents` from `default_shipping_supplies_cents`.

### 6. Alias map → dropdown — `InventoryForms.tsx` + `/api/aliases`

- The "Whatnot product name" free-text input becomes a **combobox**: a dropdown
  of product names seen in `ledger_transactions` (and legacy `show_line_items`),
  prioritizing **unmapped** names, while still allowing free-typed entry
  (HTML `datalist`, so existing free-text mapping is not lost).
- New endpoint (or extension of `/api/aliases`) returns distinct seen product
  names with a mapped/unmapped flag.

### 7. $400 double-count fix

- The seed currently inserts the $400 incentive as a negative expense in
  `expenses`. Since the bonus is now a real ledger line counted in show payout,
  the report/dashboard totals **must not also add the expenses-table copy**.
- Implementation: stop seeding the incentive expense (and ignore any existing
  one in the new report's totals). The dashboard's expense total continues to
  reflect real, non-ledger expenses only. This is the single change to existing
  behavior; called out explicitly and approved.

## Data flow

```
ledger.csv ──▶ parse/classify (ledger.ts) ──▶ preview (grouped by date) ──▶ user confirm
   └──▶ upsert shows (by date) + insert ledger_transactions (idempotent via dedup_key)
                                   │
inventory_items + product_aliases │ app_settings
                                   ▼
                       ledger-report.ts ──▶ /report (per-product/per-show + grand total)
```

## Error handling

- Malformed amount or date → row rejected into an `other`/error bucket shown in
  preview; import of the rest proceeds. The preview makes rejects visible before
  any write.
- Unrecognized transaction type/message → `kind = other`, surfaced in preview,
  contributes its raw amount to payout but no COGS/product attribution.
- Re-import of an already-imported file → no-ops via `dedup_key`.
- Empty/garbage upload → validation error returned to the UI, nothing written.

## Testing

Vitest units, with fixtures cut from the real `ledger.csv`:

- **Parser:** amount → signed cents (positive, negative, `$400.00`); date → ISO
  + calendar date; CSV quoting/BOM handling.
- **Classifier:** each kind (sale / giveaway / bonus / tip / other); product-name
  extraction via `baseProductName`.
- **Report calc:** per-product cost/revenue/profit; show net = payout − COGS −
  shipping; grand-total profit-so-far; unmapped → $0 cost + flagged; owner share
  from configurable split (incl. rounding remainder to owner).
- **Settings-driven split:** changing `owner_share_pct` changes the report's share.
- **Idempotency:** importing the same fixture twice yields one set of rows.

## Out of scope (Phase 1)

- Inventory delete + quantity-on-hand edit (Phase 2).
- Brother-transaction → Sold/Purchased + source/Lots rework (Phase 3).
- Removing the legacy per-show upload UI (left in place, de-emphasized).
