# Real Invoice PDF Generation — Design

**Date:** 2026-07-19
**Status:** Approved (pending spec review)

## Context

Today the invoice "Generate" button opens `/invoices/[id]/print`, a Tailwind page
the user must Ctrl+P → Save-as-PDF. The owner wants a **real downloadable PDF**
that looks like a classic carbon receipt-book invoice (à la a pre-printed
wholesale invoice pad), black-and-white, US-Letter, printable and hand-off-able
to customers.

The invoice feature already stores everything needed: `Invoice` (id, `number`
via `invoiceNumber(id)` → "INV-0007", `direction` purchase|sale, `supplier`,
`customer`, `invoiceDate`, `total`) and `InvoiceLine` (productName, quantity,
unitCostCents, unitPriceCents). Only business contact fields are missing from
Settings.

## Goals

1. A **Download PDF** action produces a real `.pdf` file (server-generated, not
   the browser print dialog), US-Letter, black-and-white.
2. The PDF matches the approved **carbon-form** layout (heading, contact strip,
   Sold-To/Date strip, ruled line grid + total, spare blank rows).
3. The document **adapts to invoice direction** (sale vs purchase).
4. New **Settings** fields (telephone, address, email) fill the contact strip,
   each with a **show-on-invoice** toggle.

## Out of Scope

- Logo upload (business name/logo intentionally not shown — heading is just
  "INVOICE").
- Emailing the PDF, storing generated PDFs, or changing invoice data/lifecycle.
- The internal on-screen invoice view (`InvoiceDocument`) stays; only the
  "Generate"/print entry point is replaced by the PDF download.

---

## 1. Approved Layout

US-Letter portrait, black ink only:

- **Heading (centered):** `INVOICE` for a sale, `PURCHASE INVOICE` for a
  purchase. No business name.
- **Contact strip (centered, under heading):** telephone · address · email,
  each included only if its Settings show-flag is on. If all are off/empty, the
  strip is omitted.
- **Number (top-right):** `No. <invoiceNumber(id)>` (e.g. "No. INV-0007").
- **Party + Date strip** (one bordered row):
  - Sale → **SOLD TO** = `invoice.customer`.
  - Purchase → **SUPPLIER** = `invoice.supplier`.
  - **DATE** = `invoice.invoiceDate` (formatted; the real invoice date).
- **Line grid** (bordered, ruled) with columns:
  - `QTY` · `DESCRIPTION` · `UNIT PRICE` (sale) / `UNIT COST` (purchase) ·
    `AMOUNT`.
  - Rows auto-filled from `listInvoiceLines`: qty, productName,
    (sale: `unitPriceCents`, purchase: `unitCostCents`), and line amount
    (qty × the direction's unit value).
  - **A few spare blank rows** (default 3) after the real items, for
    handwritten additions.
  - **TOTAL** row (right-aligned) = `invoice.total`.

## 2. Multi-Page Behavior

When line items overflow one page:

- The grid flows onto additional pages.
- The **column-header row repeats** at the top of each page (react-pdf `fixed`
  header row).
- The **spare blank rows + TOTAL appear only after the last real item** (last
  page).
- A **`Page X of Y`** line renders at the foot of every page (react-pdf
  `render` with `pageNumber`/`totalPages`).

## 3. PDF Generation (server-side, no headless Chrome)

- Use **`@react-pdf/renderer`** to render the document to a PDF stream in a Next
  route handler. It runs in the Node runtime and uses built-in PDF fonts
  (Helvetica / Times) — **no Chromium, no external font files** to bundle, which
  keeps the pruned standalone Docker image small and avoids the tsx/scripts
  constraint.
- New route: `GET /api/invoices/[id]/pdf`
  - Loads the invoice + lines + settings (via `dbForRequest`), 404s if missing.
  - Renders `<InvoicePdf …/>` to a buffer and returns it with
    `Content-Type: application/pdf` and
    `Content-Disposition: attachment; filename="<invoiceNumber>.pdf"`.
  - `export const dynamic = "force-dynamic"` (auth-gated, per-request).
- New component: `src/components/pdf/InvoicePdf.tsx` — a `@react-pdf/renderer`
  `<Document>` implementing §1–§2. Pure function of `{ invoice, lines, settings }`;
  no DB access inside.
- The plan must **verify the dependency bundles into the standalone build**
  (`next build` + a Docker build smoke) since the homelab runs the pruned image.

## 4. Settings — Contact Fields

Extend `app_settings` and the Settings page.

### Schema (additive, guarded migrations in `connection.ts` `migrate()`)
```sql
ALTER TABLE app_settings ADD COLUMN invoice_phone   TEXT;
ALTER TABLE app_settings ADD COLUMN invoice_address TEXT;
ALTER TABLE app_settings ADD COLUMN invoice_email   TEXT;
ALTER TABLE app_settings ADD COLUMN invoice_show_phone   INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN invoice_show_address INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings ADD COLUMN invoice_show_email   INTEGER NOT NULL DEFAULT 1;
```
Fresh schema in `schema.ts` gains the same columns.

### DB layer (`settings.ts`)
Extend `Settings` and `getSettings`/`updateSettings` with:
`invoicePhone`, `invoiceAddress`, `invoiceEmail` (string|null) and
`invoiceShowPhone`, `invoiceShowAddress`, `invoiceShowEmail` (boolean).

### UI (`SettingsForm` / Settings page)
An "Invoice" section: three text inputs (Telephone, Address, Email), each paired
with a **"show on invoice"** checkbox. Persisted via the existing settings save
flow.

### Contact-strip rule
The PDF shows a contact item only when its text is non-empty **and** its
show-flag is true. Items joined by " · "; omit the whole strip if none qualify.

## 5. Entry Point

In `InvoiceActions`, replace the **"Generate"** button (which links to the print
page) with **"Download PDF"** linking to `/api/invoices/[id]/pdf`. The existing
`/invoices/[id]/print` page and `InvoiceDocument` may remain for on-screen
viewing, but are no longer the primary hand-off path. (Decision: keep the print
page for now; only the button label/target changes.)

## Testing

- **Pure layout helpers** (unit-tested, `tests/lib/...`): a
  `invoicePdfModel(invoice, lines, settings)` helper that produces the
  view-model the component renders — heading text ("INVOICE"/"PURCHASE
  INVOICE"), party label ("SOLD TO"/"SUPPLIER") and value, unit column label
  and per-line unit value (price vs cost by direction), line amounts, total,
  and the filtered contact list (respecting show-flags + emptiness). Test both
  directions and each show-flag combination. Keeping this logic pure means the
  react-pdf component is a thin renderer.
- **Settings DB:** migrations add columns idempotently; `getSettings`/
  `updateSettings` round-trip the six new fields; booleans coerce 0/1.
- **Route smoke** (as feasible in Vitest/node): the `/api/invoices/[id]/pdf`
  handler returns a non-empty buffer starting with the `%PDF-` magic bytes for a
  seeded invoice, and 404 for a missing id. (If the react-pdf render is awkward
  to invoke in the test env, at minimum unit-test `invoicePdfModel` and assert
  the route wiring via a light integration check.)
- Existing invoice tests stay green (no invoice data/lifecycle change).

## Migration & Data Safety

- Additive settings columns only (guarded migrations). No change to invoices,
  lines, inventory, or any calculation.
- New runtime dependency `@react-pdf/renderer`; the plan verifies it is included
  in `next build` output and the Docker standalone image.
