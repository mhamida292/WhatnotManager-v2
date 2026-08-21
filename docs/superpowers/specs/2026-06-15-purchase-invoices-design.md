# Purchase Invoices — Design

Date: 2026-06-15
Status: Approved for spec review

## Context

The user buys inventory in mixed multi-product lots (e.g. "today: 12 jellyfish,
12 special butter, 11 pineapple"). They want to record each purchase order as an
**invoice**: create a draft, generate a printable document, and — when the order
is real — **post** it to stock their inventory.

This builds directly on the purchase-batches feature
(`2026-06-15-purchase-batches-and-edit-modal-design.md`). An invoice's lines
become **purchase batches** when posted, so per-unit cost and weighted-average
math are reused — no parallel costing logic.

There is a vestigial `lots` table + `insertLot` in the codebase that nothing in
the UI uses and no calculation reads. It is left untouched (out of scope); this
feature does not use it.

## Decisions (locked in during brainstorming)

- **Multi-product invoices.** One invoice has many lines, each a product +
  quantity + unit price. Lines can reference existing products or name new ones.
- **No shared costs.** No shipping/tax/discount — each line's cost stands alone
  (`line total = quantity × unit price`; invoice total = sum of lines).
- **Line input:** quantity + **unit price**; line total and grand total are
  computed/displayed.
- **Draft → Post lifecycle.** Drafts never affect inventory. Posting is the only
  thing that stocks inventory. Posting/unposting are reversible mirror images.
- **Generate works in either state.** The printable document is available for a
  draft (marked "DRAFT") or a posted invoice.
- **Header fields:** auto number (`INV-0007`), supplier, date, optional notes.
- **Invoice lines and inventory purchases are never duplicated data** — posting
  is the single bridge (a purchase batch carries its `invoice_id`).

## Data model

### New table `invoices`

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT,
  invoice_date TEXT,                 -- YYYY-MM-DD
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  posted_at TEXT                     -- ISO timestamp when posted, else NULL
);
```

The display number is derived from `id`: `INV-` + zero-padded id (e.g. id 7 →
`INV-0007`). Always unique, never reused.

### New table `invoice_lines`

```sql
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,        -- snapshot label, always shown on the document
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL
);
```

- `product_name` is a snapshot taken when the line is added, so the document
  reads correctly even if the product is later renamed or deleted.
- `item_id` links to a live product. It is NULL for a new-product line until the
  invoice is posted (post creates/links the item); `ON DELETE SET NULL` so
  deleting a product later doesn't break the historical line.

### `item_purchases` gains `invoice_id`

```sql
-- added to item_purchases
invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE
```

Batches created by posting an invoice carry its `invoice_id`; manual batches
(added via the inventory Edit modal) have `invoice_id = NULL`. The
`ON DELETE CASCADE` means deleting an invoice removes its batches automatically
(the app then recomputes affected item totals — see below).

`addPurchase` (from purchases.ts) gains an optional `invoiceId` parameter
(default null) so posting can stamp batches.

## Lifecycle operations (all atomic, in transactions)

### Post (`postInvoice(db, invoiceId)`)
1. Reject if the invoice is already posted or has zero lines.
2. For each line:
   - Resolve the product: if `item_id` is set, use it; else find an existing
     item whose name matches `product_name` (case-insensitive) and use it; else
     create a new item (`insertItem` with the line's unit cost, qty 0). Write the
     resolved `item_id` back onto the line.
   - `addPurchase(db, { itemId, purchasedOn: invoice_date, quantity, unitCostCents, invoiceId })`
     — which recomputes that item's totals.
3. Set `status = 'posted'`, `posted_at = now`.

### Unpost (`unpostInvoice(db, invoiceId)`)
1. Collect the distinct `item_id`s of the invoice's purchase batches.
2. Delete `item_purchases WHERE invoice_id = ?`.
3. Recompute each affected item's totals (stock/averages revert).
4. Set `status = 'draft'`, `posted_at = NULL`. Lines are kept (editable again).
   Items first created by this invoice remain at 0 stock; re-posting re-adds
   their batch without creating duplicates (the line now has their `item_id`).

### Delete (`deleteInvoice(db, invoiceId)`)
1. Collect affected `item_id`s from the invoice's batches (if posted).
2. Delete the invoice row (cascades `invoice_lines` and `item_purchases`).
3. Recompute each affected item's totals.

### Edit guard
Adding/editing/removing lines and header fields is allowed only while
`status = 'draft'`. The API rejects line mutations on a posted invoice (`409`).

## Components

### DB layer — `src/lib/db/invoices.ts` (new)

- `interface Invoice { id; number; supplier; invoiceDate; notes; status; postedAt; total }` (number = formatted `INV-NNNN`; total = sum of line totals).
- `interface InvoiceLine { id; invoiceId; itemId; productName; quantity; unitCostCents }`
- `createInvoice(db, { supplier, invoiceDate, notes }): number` — inserts a draft.
- `updateInvoice(db, id, { supplier, invoiceDate, notes }): void` — draft only.
- `addInvoiceLine(db, { invoiceId, itemId, productName, quantity, unitCostCents }): number` — draft only.
- `updateInvoiceLine(db, id, { itemId, productName, quantity, unitCostCents }): void` — draft only.
- `deleteInvoiceLine(db, id): void` — draft only.
- `listInvoices(db): Invoice[]` — newest first, with computed totals.
- `getInvoice(db, id): Invoice | null` and `listInvoiceLines(db, invoiceId): InvoiceLine[]`.
- `postInvoice(db, id)`, `unpostInvoice(db, id)`, `deleteInvoice(db, id)` — as above.
- `invoiceNumber(id): string` — `INV-` + 4-padded id (shared formatter).

### DB layer — `src/lib/db/purchases.ts` (modify)

- `addPurchase` gains optional `invoiceId` (default `null`), written into the new
  `item_purchases.invoice_id` column.
- New `purchaseInvoiceId(db, purchaseId)` is not needed; instead `listPurchases`
  returns each batch's `invoiceId` so the detail page can link it.

### API

- **`src/app/api/invoices/route.ts`**: `GET` (list), `POST` (create draft).
- **`src/app/api/invoices/[id]/route.ts`**: `GET` (invoice + lines), `PATCH`
  (update header — draft only), `DELETE` (delete invoice).
- **`src/app/api/invoices/[id]/lines/route.ts`**: `POST` (add line), `PATCH`
  (edit line), `DELETE` (remove line) — all draft-only (return `409` if posted).
- **`src/app/api/invoices/[id]/post/route.ts`**: `POST` (post), `DELETE` (unpost).
  Validation: post rejects empty invoices (`400`).

All validation mirrors existing routes (integer ids; quantity integer ≥ 1; cost
finite ≥ 0; strings/null for text fields).

### UI

- **`src/components/Nav.tsx`** (modify): add `["/invoices", "Invoices"]` to the
  links (after Inventory).
- **`src/app/invoices/page.tsx`** (new): the list — table of number / supplier /
  date / status badge / total, with a `+ New invoice` button (POSTs a blank draft
  then navigates to it).
- **`src/app/invoices/[id]/page.tsx`** (new, server): loads the invoice + lines,
  renders `InvoiceEditor` (draft) or a locked `InvoiceDocument` (posted), plus the
  action buttons.
- **`src/components/InvoiceEditor.tsx`** (new, client): editable header + line
  editor. Each line: a product picker (dropdown of existing items, or type a new
  name) + quantity + unit price; add/remove lines; live line + grand totals.
  Buttons: **Post**, **Generate**, **Delete**. Talks to the invoices/lines APIs.
- **`src/components/InvoiceDocument.tsx`** (new, presentational): the clean
  printable layout (header, line table, grand total). Read-only. Reused by the
  posted view and the print route. Shows a "DRAFT" marker when status is draft.
- **`src/app/invoices/[id]/print/page.tsx`** (new): a minimal print-friendly page
  rendering `InvoiceDocument`; `Generate` opens it and the user prints / saves PDF
  via the browser. (No PDF library.)
- **`src/components/InvoiceActions.tsx`** (new, client): Post / Unpost / Delete /
  Generate buttons with confirms where destructive (mirrors `DeleteItemButton`).
- **`src/components/PurchaseList.tsx`** (modify): `PurchaseRow` gains optional
  `invoiceId`/`invoiceNumber`; when present, render the number as a link to
  `/invoices/[id]`. Manual batches show nothing extra.
- **`src/app/inventory/[id]/page.tsx`** (modify): pass each batch's invoice info
  into `PurchaseList`.

## Error handling

- Lifecycle mutations are transactional with item recompute, so inventory can
  never half-update.
- Line/header mutations on a posted invoice return `409`; the editor only renders
  editable controls for drafts.
- Posting an empty invoice returns `400` with a clear message; the editor
  disables Post until at least one valid line exists.
- Destructive actions (Delete, Unpost) confirm first in the UI.

## Test plan

vitest, db layer (`tests/lib/db/invoices.test.ts`):

- `createInvoice` + `addInvoiceLine` + `listInvoices`: draft shows correct total;
  no `item_purchases` created while draft (zero inventory effect).
- `postInvoice`: creates invoice-linked batches, creates new products, recomputes
  item weighted-average totals, sets status posted + `posted_at`; a new-product
  line whose name matches an existing item links to it (no duplicate item).
- `postInvoice` on an empty invoice throws / is rejected.
- `unpostInvoice`: deletes the invoice's batches, reverts affected item totals,
  returns to draft, keeps lines.
- `deleteInvoice`: removes header + lines + batches and recomputes affected items.
- Manual (`invoice_id = NULL`) batches are untouched by post/unpost/delete.
- `invoiceNumber` formats ids as `INV-0007`.
- Line/header mutations are rejected when the invoice is posted.

Routes and React components stay lightly tested, consistent with the codebase.

## Out of scope

- Shipping / tax / discount / shared-cost allocation (each line stands alone).
- The legacy `lots` table (left untouched, unused).
- Editing a posted invoice in place (must Unpost first).
- Supplier management / a suppliers table (supplier is free text).
- A PDF-generation library (printing uses the browser).
- Customer-facing / sales invoices (this is purchase orders only).
