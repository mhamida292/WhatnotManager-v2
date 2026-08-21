# Whatnot Business Manager — Design

**Date:** 2026-06-11
**Status:** Approved (pending spec review)

## Purpose

A self-hosted web app to manage a Whatnot squishy-toy resale business: track per-show
profit, inventory spend, and business expenses. Single operator. Source of truth for sales
is each show's Whatnot CSV (auto-classified), with the real **payout** entered manually from
the Shipments page.

## Users & Hosting

- **Single user** (the owner). No login/auth.
- **Self-hosted** on the owner's homelab as one Docker container; reachable from any computer
  on the local network.
- **Portable:** all data lives in one SQLite file (`data/whatnot.db`); back up or move by
  copying that file.

## Tech Stack

- **Next.js** — React frontend + API routes in one app.
- **SQLite** — single-file database.
- **Docker** — one container to deploy.

## Data Model

### Inventory

- **InventoryItem** — `name`, `cost_per_unit`, `qty_purchased`, `qty_remaining`
  (derived: purchased − sold − given to brother − given away), `lot_id`.
- **Lot** — a purchase event (e.g. "Lot 1", total $732). Has line items
  (item, qty, unit cost). The app reconciles the sum of line items against the lot total and
  flags mismatches.
- **BrotherTransaction** — one model for all brother cases, each adjusting **true net
  inventory spend** and item quantities:
  - *Split shipment* — log full shipment cost + brother's share → owner's cost auto-calculates
    (full − share).
  - *Bought from brother* — owner acquires items/owes money.
  - *Gave to brother* — items leave inventory.
  - *Payback* — money settled between them.
  - Brother is a **free-text label**.

### Shows

- **Show** — `date`, `payout` (manual, from Shipments page), `shipping_supplies_cost`
  (manual), `giveaway_count` + `giveaway_unit_cost` (auto-detected from CSV, default $5,
  editable).
- **ShowLineItem** — one per CSV row: `buyer`, `product_name`, `qty`, `revenue`
  (`original_item_price`), and an auto-assigned **status** the user can override:
  `confirmed` / `cancelled` / `failed` / `giveaway` / `suspected_duplicate`.
  COGS per line = `qty × mapped inventory item's cost_per_unit`.
- **ProductAlias** — maps a Whatnot `product_name` (e.g. "Nice-Sicle Ice Cream") to an
  **InventoryItem** (e.g. "Pushy Squishy Ice Cream"). Required because CSV product names do
  not match the owner's inventory names. First time an unknown name appears, the app prompts
  for a one-time mapping; thereafter it is automatic.

### Expenses

- **Expense** — `type` (one-time | recurring), `category`, `amount`, `date`. Separate from
  inventory.
- The **$400 Whatnot incentive** is recorded as an offset against total expenses.
- **Partner** (80/20 profit split) is a **free-text label**.

## Business Rules

- **Confirmed sale** = CSV row has a non-empty `shipment_id` **and** a blank
  `cancelled_or_failed`.
- **Cancelled / failed** = value present in `cancelled_or_failed` (these rows have no
  `shipment_id` / tracking).
- **Giveaway** = `product_name` contains "GIFTCARD GIVVY" (revenue $0).
- **Suspected duplicate** = same buyer + same product + same price within one show; **flagged
  for user confirmation, never auto-removed.**
- **Merchandise is never expensed** — inventory becomes **COGS only when sold**, tracked per
  item per show.
- **Shipping supplies = immediate expense** (entered per show).
- **Net profit per show** = `payout − COGS − giveaways − shipping_supplies`.
- **Profit split** = 80% owner / 20% partner, shown both ways.
- **True net inventory spend** = sum of lot costs adjusted by all BrotherTransactions.

## CSV Parsing Reference

Columns used: `buyer_username`, `product_name`, `product_quantity`,
`original_item_price` (revenue), `cancelled_or_failed`, `shipment_id`, `bundled`,
`gifted_to`. (Cost columns in the CSV are unreliable and ignored; costs come from
InventoryItem via ProductAlias.)

Observed in the reference file (June 11 show, 60 rows): all unique order IDs, 4 cancelled/
failed rows cleanly identifiable by empty `shipment_id`, 7 giveaway line items. No literal
duplicates present in that file; duplicate handling is therefore advisory (flag, don't strip).

## Screens

1. **Dashboard** — net profit, owner's 80% share, true net inventory spend, inventory on
   hand, total expenses (after the $400 offset).
2. **Shows** — upload CSV → review auto-classified rows → enter payout + shipping supplies →
   save. Per-show P&L. Re-uploading the same show **updates** it (no duplicate show).
3. **Inventory** — lots, items, qty remaining, brother transactions, true net spend.
4. **Expenses** — list of expenses + the incentive offset.

## CSV Upload Flow

Upload → parse → auto-classify each row → review screen (confirmed sales, flagged
cancellations, giveaways, suspected duplicates) → user overrides as needed → unmapped product
names prompt a one-time mapping to an InventoryItem → save. Re-uploading the same show
updates the existing show rather than creating a duplicate.

## Known Seed Data (to load)

- 3 shows: Jun 8, Jun 9, Jun 10 2026.
- Lot 1 inventory.
- All startup expenses.
- Per-item costs: Axolotl $2, Pushy Squishy Ice Cream $2, Rainbow Dumpling $2.50,
  Orbeez Stuffed $2.50, Viral Mystery $2.50, Mini Squish $1.50, Butter / Strawberry /
  Pink Strawberry / Tie Dye Butter $1.50, Jumbo Butter $4, Gummy Bear $1.50, Cheese $2.50,
  Highland Cow $2.50.

## Out of Scope (v1)

- Multi-user / authentication.
- Partner read access (numbers shared manually).
- Automatic duplicate removal (advisory only).
- Cloud hosting / sync (single portable DB file instead).
