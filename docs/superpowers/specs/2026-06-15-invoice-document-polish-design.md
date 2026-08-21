# Professional Purchase-Invoice Document — Design

Date: 2026-06-15
Status: Approved for spec review

## Context

The purchase-invoices feature (`2026-06-15-purchase-invoices-design.md`) ships a
basic printable `InvoiceDocument`. The user wants the **Generate** output to look
like a real purchase invoice for tax/bookkeeping — no branding or logos, just the
record: what was bought, how many, the cost, the date, and the two parties.

Decided in brainstorming (with visual mockups):

- **No letterhead / logo / address.** Keep it plain and factual.
- **Two parties:** **From** = the supplier (per invoice; the existing `supplier`
  field). **To** = the user's own business name (e.g. "DirectDealzz"), which is
  the same on every invoice → **saved once in Settings**, not retyped.
- Layout: title + invoice number, a From / To / Date meta row, an itemized table
  (Product · Qty · Unit cost · Line total), the Total, and a one-line
  "N units across M products" summary.

## Data model

Add one column to the existing single-row `app_settings` table:

```sql
-- app_settings gains:
business_name TEXT
```

Idempotent migration in `connection.ts` `migrate()` (mirrors the existing
`qty_samples` / `invoice_id` additions): if `app_settings` lacks `business_name`,
`ALTER TABLE app_settings ADD COLUMN business_name TEXT`.

`src/lib/db/settings.ts`:
- `Settings` interface gains `businessName: string | null`.
- `getSettings` selects `business_name AS businessName`.
- `updateSettings` writes it.

## Components

### Settings (the "To")

- **`src/components/SettingsForm.tsx`**: add a **Business name** text input (the
  name shown as "To" on invoices). Submits with the other settings.
- **`src/app/api/settings/route.ts`**: accept `businessName` (string or null) in
  the PATCH/POST body, pass through to `updateSettings`. (Follow the existing
  handler's shape.)

### Date formatter

- **`src/lib/format-date.ts`** (new): `longDate(iso: string | null): string` —
  turns `"2026-06-15"` into `"June 15, 2026"`; returns `"—"` for null/empty/
  unparseable. Pure, unit-tested. Parses the `YYYY-MM-DD` parts directly (no
  `Date` timezone drift), mirroring `ledgerShowDate` in `csv/ledger.ts`.

### InvoiceDocument redesign

- **`src/components/InvoiceDocument.tsx`** (rewrite): props gain
  `businessName: string | null`. Renders:
  - `Purchase Invoice` heading + `invoice.number`.
  - Meta row: **From (supplier)** = `invoice.supplier ?? "—"`; **To** =
    `businessName ?? "—"`; **Date** = `longDate(invoice.invoiceDate)`.
  - Table: Product · Qty · Unit cost · Line total, then a **Total** row, then a
    muted **"{units} units across {lineCount} products"** line
    (units = sum of quantities; lineCount = number of lines).
  - `invoice.notes` shown below if present.
  - Clean print-friendly styling (the visual mockup): ruled table, uppercase
    micro-labels, tabular-nums on figures. Keeps the existing "DRAFT" marker when
    `invoice.status === "draft"`.

### Wiring

- **`src/app/invoices/[id]/print/page.tsx`** and
  **`src/app/invoices/[id]/page.tsx`**: read `getSettings(db).businessName` and
  pass it as `businessName` to `InvoiceDocument`.

## Data flow

Settings page saves the business name once → every invoice's document/print page
reads it from settings and renders it as "To". Supplier/date/lines come from the
invoice itself. No new per-invoice fields.

## Error handling

- Missing business name (not set yet) renders as `—`, never breaks the page.
- Null/blank/invalid invoice date renders as `—`.
- `business_name` migration is idempotent and safe on existing DBs.

## Test plan

vitest:
- `tests/lib/db/settings.test.ts` (extend or create): `getSettings`/
  `updateSettings` round-trip `businessName`, including null.
- `tests/lib/format-date.test.ts` (new): `longDate("2026-06-15") === "June 15,
  2026"`; `longDate(null) === "—"`; `longDate("") === "—"`; a single-digit day
  pads/formats correctly (e.g. `"2026-06-05" === "June 5, 2026"`).

`InvoiceDocument`, `SettingsForm`, and the settings route stay lightly tested
(presentational / thin), consistent with the codebase.

## Out of scope

- Business address, logo, email, phone, or any branding.
- Tax, shipping, or discount lines on the document.
- Per-invoice "To" override (it always comes from Settings).
- Customer-facing / sales invoices.
