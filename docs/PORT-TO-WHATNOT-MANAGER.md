# Port Prompt — Unified Item Identifiers → whatnot-business-manager

> **This is a living document.** It is written as a prompt you can hand to the agent
> working in the **whatnot-business-manager** app. It describes, feature by feature,
> changes originally built in the sibling **Warehouse-Manager** app so they can be
> re-implemented there. New features are appended as they're built.

---

## How to run this

Hand this **entire file** to the coding agent working in your **whatnot-business-manager**
repo and tell it: *"Implement these features in order, on a new branch, test-first."* Each
feature below is self-contained. **Feature 1 is a prerequisite for Features 2–8** — do it
first. After each feature, the agent should run `npm test` and `npm run build` before moving
on. The **GOTCHA** notes are the highest-value part — they are real bugs found in code review
that another implementer would otherwise re-hit.

**What's covered (everything built in the Warehouse-Manager app so far):**
1. Unified item identifiers + SKUs (data backbone) — **required first**
2. Whatnot suggest-and-confirm mapping
3. Supplier invoice suggest-and-confirm (purchase posting)
4. SKU-manager identifiers panel
5. Item merge (fix duplicates)
6. Invoices show the live item name (rename propagation)
7. Invoice charges & deductions (non-inventory lines that adjust the total)
8. Total pieces on the invoice PDF
9. Removal of the dead "brother" cost-sharing concept (source app only — check your app's
   state before following this one)
10. Whatnot-only inventory mode (settings toggle that hides the Warehouse/Whatnot split —
    **check your app has an equivalent two-bucket stock model before following this one**)

---

## Instructions to the implementing agent

You are working in the **whatnot-business-manager** app: a self-hosted **Next.js 15 (App
Router) + better-sqlite3 + TypeScript** app with Tailwind and Vitest (node test env, **no
React Testing Library**). Data lives in per-workspace SQLite DBs; the schema is created
from a `SCHEMA` string and then patched for existing DBs by an idempotent `migrate(db)`
function in `src/lib/db/connection.ts` (SQLite has no `ADD COLUMN IF NOT EXISTS`, so column
adds are guarded by `PRAGMA table_info` checks — follow that existing pattern).

**This is a hand-port, not a merge:** the two repos share no git history, and this app's
version of a given file may differ from the source. For every change below, **read the
target file first and reconcile** — apply the described behavior, matching this app's
existing conventions and names. Work **test-first** (this repo uses Vitest; build a DB in
tests with `createDb(":memory:")`). Verify with `npm test` and `npm run build` after each
feature.

**Do all of this on a feature branch, never on `main`/`master`.** Keep commits small
(one per sub-feature) and TDD-style.

The features are ordered by dependency. **Feature 1 (data backbone) is a prerequisite for
Features 2–8.** Implement in order.

---

## Feature 1 — Unified item identifiers + SKUs (data backbone) [REQUIRED FIRST]

**Goal:** Replace the Whatnot-only `product_aliases` mapping table with one unified
`item_identifiers` table, and give every inventory item a stable auto-generated `sku` that
is its identity (so renaming an item's display name never breaks matching).

**Schema (`src/lib/db/schema.ts`):**
- Add `sku TEXT UNIQUE` to `inventory_items`.
- Replace the `product_aliases` table with:
  ```sql
  CREATE TABLE IF NOT EXISTS item_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('mine','supplier','whatnot')),
    code TEXT NOT NULL,
    supplier_label TEXT,
    UNIQUE(code)
  );
  ```
  `UNIQUE(code)` is **global** — a given code/name resolves to exactly one item, and two
  different items can never hold the same code. (This fact simplifies later features.)

**Migration (`migrate(db)` in `src/lib/db/connection.ts`), idempotent:**
1. `ALTER TABLE inventory_items ADD COLUMN sku TEXT` (guarded by a `PRAGMA table_info` check).
2. `CREATE TABLE IF NOT EXISTS item_identifiers (...)` + `CREATE UNIQUE INDEX IF NOT EXISTS ... ON item_identifiers(code)`.
3. Back-fill a unique `sku` for every item missing one — format `ITEM-` + zero-padded 5-digit id (e.g. `ITEM-00042`). Then `CREATE UNIQUE INDEX IF NOT EXISTS ... ON inventory_items(sku)`.
4. Seed one `source='mine'` identifier per item with `code = sku` (`INSERT OR IGNORE ... WHERE NOT EXISTS(mine row)`).
5. If `product_aliases` still exists: copy every row into `item_identifiers` as `source='whatnot'` (`code = product_name`).
   - **GOTCHA (data-loss guard — do NOT skip):** before dropping `product_aliases`,
     assert the copy was lossless. Count `product_aliases` rows and the delta of
     `whatnot` identifiers before/after the copy; if they differ (a code collided and was
     silently `INSERT OR IGNORE`-dropped), **throw and abort the migration** rather than
     dropping the table. Losing an alias is irreversible.
   - Then `DROP TABLE product_aliases`.
- **Do NOT rewrite any `item_id` on existing sales/invoice/purchase rows** — the migration
  is purely additive plus the alias→identifier move. Verify no stock/profit number changes.

**Deliberately KEEP** the `name UNIQUE` constraint on `inventory_items` (dropping it needs a
full table rebuild and isn't required — identity is the `sku`, not the name).

**`insertItem` (`src/lib/db/inventory.ts`):** wrap in a transaction; after inserting the
row, set `sku = ITEM-<zero-padded id>` and insert a matching `source='mine'` identifier.
Still return the new id. (Nested transactions are fine — callers like
`createItemWithFirstPurchase`/`postInvoice` wrap it; better-sqlite3 uses savepoints.)

**Resolver (`src/lib/db/aliases.ts` or equivalent):** re-point these to `item_identifiers`,
keeping the same exported names/signatures so callers don't change:
- `setAlias(db, productName, itemId)` → upsert a `source='whatnot'` identifier keyed on the
  base-normalized code: `INSERT ... ON CONFLICT(code) DO UPDATE SET item_id = excluded.item_id, source = 'whatnot'`.
- `removeAlias(db, id)` → `DELETE FROM item_identifiers WHERE id = ?` (works for any source).
- `resolveItemId(db, productName) → number | null` → look up `item_identifiers.code` (any
  source), base-normalized. Whatnot names are stored base-normalized (strip trailing ` #N`);
  keep using the existing `baseProductName` helper on both write and lookup.
- `seenProductNames`/`unmappedNames` delegate to `resolveItemId` — unchanged behavior.

**Re-point every remaining `product_aliases` consumer** to `item_identifiers` with a
`source='whatnot'` predicate where it matters (so `mine`/`supplier` codes don't leak into
Whatnot sale counts). In the source app these were in `inventory.ts`
(`qtySoldFromLedger`, `aliasesForItem`, `ledgerSalesForItem`, `deleteItem`, `deleteImpact`),
plus `admin.ts` (reset) and the Excel-backup `TABLES` list. The join pattern:
`JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'`.
After this, `grep product_aliases src` should return only the migration code in `connection.ts`.

**GOTCHA (backup):** register `item_identifiers` in the Excel-backup `TABLES` list (replacing
`product_aliases`), positioned after `inventory_items` (FK order), or backup/restore silently
drops it.

**Surface the sku:** add `sku: string | null` to the item row type and the `listItems`
SELECT; render `SKU: <sku>` on the item detail page header.

**Tests:** migration is lossless (aliases→whatnot, every item gets sku + mine identifier, no
item_id changes) and idempotent; the collision-abort path (seed an alias equal to a
to-be-generated sku → migration throws); resolver across all three sources; the ledger joins
still count correctly.

---

## Feature 2 — Whatnot suggest-and-confirm mapping

**Goal:** On the Inventory page, turn the passive "unmapped Whatnot names" banner into an
active card that pre-matches each unmapped name to its best-guess item; the user confirms
with one click (never auto-linked).

**Reuse the existing fuzzy scorer** if present (`src/lib/calc/name-match.ts`: `score`,
`bestMatch(name, items) → {itemId, score}|null`, `MATCH_THRESHOLD`). If this app lacks it,
port it — Levenshtein + token-set containment over normalized names.

**Pure function `buildMapSuggestions(unmappedNames, items) → MapSuggestion[]`** (new, e.g.
`src/lib/calc/map-suggestions.ts`): for each name, `bestMatch` → `{ productName,
suggestedItemId, suggestedItemName, score, confident }` where `confident = score >=
MATCH_THRESHOLD`; null suggestion/score 0 when no items. Sort **worst-score-first** (ties by
productName). Unit-tested.

**Client component `UnmappedSuggestions`** on the Inventory page: one row per suggestion —
the name, "Best match: <item> (N%)" (or "low confidence, please review" when not confident),
an item picker to override, and a Confirm/Map button. Confirm posts to the existing
`POST /api/aliases` (`{ productName, itemId }`) then `location.reload()`. **Always ask:** the
suggestion is only pre-selected; nothing is written without a click.

**GOTCHAS:**
- Node test env / no RTL → the component has no render test; put logic in the tested
  `buildMapSuggestions`. Verify the component via build + manual smoke.
- Give each row's `<datalist>`/picker a unique `id` (use the row index, not the sanitized
  name — two names can sanitize to the same string and collide).
- Use this app's design tokens (in the source app, `border-line`) not hard-coded colors.

---

## Feature 3 — Supplier invoice suggest-and-confirm (purchase posting)

**Goal:** When posting a **purchase** invoice, stop silently exact-name-matching-or-creating
unlinked lines. Instead: remember each supplier's product name as a `source='supplier'`
identifier (so future invoices auto-resolve), and for a line with no match, confirm a
best-guess item at Post time. **Sales invoices are unchanged.**

**`recordSupplierIdentifier(db, code, itemId) → boolean`** (in the aliases module):
base-normalize; if the code already exists pointing at the same item → return true (no-op);
at a **different** item/source → return false and **do not overwrite** (never steal a code);
else insert `source='supplier'` and return true. (This is the `UNIQUE(code)` hardening.)

**`previewPurchasePost(db, invoiceId) → { autoResolved: {lineId,itemId}[]; needsReview:
LineReview[] }`**: **purchase-only — GOTCHA: gate on `direction`; return empty for a
non-purchase (or missing) invoice**, else the confirm modal wrongly appears on sale invoices
and the post then fails. For each unlinked line: `resolveItemId(productName)` → autoResolved;
else `bestMatch` → needsReview (`{lineId, productName, suggestedItemId, suggestedItemName,
score, confident}`). Lines already linked are ignored.

**Extend `postInvoice(db, id, resolutions?)`** — `resolutions?: ({lineId,itemId} |
{lineId,createName})[]`, optional (existing callers unchanged). In the **purchase** path,
replace silent exact-match-or-create: per unlinked line use a matching resolution (link
existing / `insertItem` new), else `resolveItemId(productName)`, else throw ``Line "<name>"
needs an item``. After determining the itemId, set the line's `item_id`, call
`recordSupplierIdentifier(db, productName, itemId)` (unconditionally — remember for next
time), then create the purchase batch as before. Keep it all in the existing transaction.
**Sales path unchanged.**

**API:** new `GET /api/invoices/[id]/post-preview` → `previewPurchasePost`; extend
`POST /api/invoices/[id]/post` to read an optional `{ resolutions }` body and pass it
through. **GOTCHA:** a POST with no body must still work (default to `[]`) and must preserve
the 400-on-throw error path so ``needs an item`` reaches the client.

**Client:** the Post button first GETs `post-preview`; if `needsReview` is empty it posts
directly (no modal, backward-compatible); otherwise it opens a "Confirm items before
posting" modal (best-match pre-selected, override picker, "create new item" checkbox) and
"Confirm all & post" builds `resolutions` and posts. Always ask — a line links only via an
explicit confirm or a pre-existing identifier, never from a score.

**GOTCHA (behavior change to call out):** posting an unlinked purchase line now *requires*
an explicit item; existing tests that relied on silent auto-create must be updated to the new
contract (pass a resolution or seed an identifier), preserving each test's intent.

---

## Feature 4 — SKU-manager identifiers panel (item detail page)

**Goal:** Replace the item page's Whatnot-mappings card with a unified **Identifiers** panel:
show every identifier grouped by source (mine/supplier/whatnot), edit the SKU, add a
supplier/Whatnot identifier, remove any non-`mine` identifier.

**DB functions:**
- `identifiersForItem(db, itemId) → { id, source, code, supplierLabel, saleCount }[]` ordered
  by source (mine, supplier, whatnot) then code. `saleCount` = ledger sales matching the code
  **and** `source='whatnot'` (0 for others — put the `source='whatnot'` predicate inside the
  correlated subquery so a non-whatnot code that coincidentally matches a sale name still
  reports 0).
- `addIdentifier(db, {itemId, source:'supplier'|'whatnot', code, supplierLabel?})` →
  collision-guarded: empty → error; code owned by a different item → duplicate (no steal);
  already on this item → ok no-op; else insert. Returns `{ok:true,id} | {ok:false,reason}`.
- `setSku(db, itemId, sku)` → update `inventory_items.sku` **and** the item's `mine`
  identifier's `code` **in one transaction** (they must stay equal). Collision-guard against
  BOTH `inventory_items.sku` and `item_identifiers.code`.
  **GOTCHA:** the `code` collision check must catch the item's **own** existing
  supplier/whatnot code too (query `WHERE code = ?` with **no** `item_id <> ?` exclusion) —
  otherwise promoting an item's own code to its SKU throws an uncaught `UNIQUE` 500 instead
  of a clean "duplicate". Keep the `item.sku === base` no-op fast path before the check.

**API:** `POST /api/identifiers` (add) and `DELETE /api/identifiers` (`{id}`) — **the DELETE
must look up the identifier's source first and refuse to delete a `mine` row** (that's the
item's identity). Extend `PATCH /api/inventory` to accept `sku` → `setSku` (409 duplicate).

**Client `ItemIdentifiers` panel:** editable SKU field (save on blur, revert on error, no
Remove on the `mine` row), a table of identifiers with Remove for non-`mine`, and an add form
(source select + code). Refresh via `router.refresh()`.
**GOTCHA:** keep a **confirm() before Remove** that warns removal stops those sales counting
toward the item (remaining rises, COGS drops to $0 until re-mapped), especially when
`saleCount > 0` — don't delete on a bare click.

---

## Feature 5 — Item merge (fix duplicates)

**Goal:** Merge one item (loser) into another (survivor): move all of the loser's history and
identifiers to the survivor, recompute survivor totals, delete the loser. Atomic. The only
operation that rewrites `item_id` on posted rows — only on explicit user action.

**`mergeItems(db, {loserId, survivorId}) → {ok:true} | {ok:false; reason}`:** in ONE
transaction:
1. Re-point `item_id` loser→survivor across **every** history table with an `item_id` FK to
   `inventory_items` **except `item_identifiers`**. In the source app that's exactly:
   `invoice_lines`, `inventory_adjustments`, `inventory_moves`, `item_purchases`,
   `show_line_items`, `ledger_transactions`, `bundle_components`. (The source app used
   to also list `brother_transactions` here; that table was dropped entirely — see
   Feature 9. If your app still has an equivalent "brother"/cost-share table, keep it
   in **your** list until you've ported Feature 9, or this merge step will throw a FK
   violation on any loser row it holds.)
   **GOTCHA — verify this list against THIS app's schema**: enumerate every table whose
   `item_id` references `inventory_items(id)` and include all of them. A missed CASCADE table
   loses its rows when the loser is deleted; a missed RESTRICT table (no `ON DELETE` clause)
   makes the final delete **throw a FK violation**.
2. Move the loser's non-identity identifiers:
   `UPDATE item_identifiers SET item_id = survivor WHERE item_id = loser AND source != 'mine'`.
   (No collision possible — global `UNIQUE(code)`. The loser's `mine` row stays and is removed
   by `ON DELETE CASCADE` on the delete.)
3. `recomputeItemTotals(db, survivorId)` (recomputes `qty_purchased` + weighted-avg
   `unit_cost_cents` from the now-merged `item_purchases`).
4. `DELETE FROM inventory_items WHERE id = loser`.
   **All re-points MUST happen before this delete** (load-bearing given the RESTRICT FKs).
- **Guards before the transaction:** `loserId === survivorId` → `same_item`; missing survivor
  → `survivor_not_found`; missing loser → `loser_not_found`; **survivor is archived →
  `survivor_archived`** (reject — don't fold live stock onto a hidden item).

**Note on Whatnot sales:** sale counts resolve via the `item_identifiers` (whatnot) join on
`product_name`, not via `ledger_transactions.item_id` — so **moving the whatnot identifiers**
is what preserves the counts; re-pointing `ledger_transactions.item_id` is only needed to
satisfy the FK before delete.

**API:** `POST /api/inventory/merge` `{loserId, survivorId}` → validate integers (400), map
reasons to messages (`same_item`→"Cannot merge an item into itself",
`survivor_archived`→"Cannot merge into an archived item", not-found→"Item not found"), all
400; success `{ok:true}`.

**Client `MergeItemButton`** in the item detail **danger zone**: a survivor picker
(**exclude self and archived items**), a strong `confirm()` naming both items and stating it's
irreversible, POST `{loserId: thisItem, survivorId: picked}`, and on success
`router.push("/inventory")`.

**Tests:** merge combines stock, moves identifiers (loser's supplier/whatnot codes resolve to
survivor), deletes the loser, loser's SKU stops resolving; rejects self/missing/archived; and
a test that populates loser rows in the RESTRICT-FK tables (ledger/show/bundle, plus your
app's brother/cost-share table if it still has one) so the
delete is exercised — mutation-check it by removing one table from the re-point list and
confirming the delete then throws.

---

## Feature 6 — Invoices show the live item name (rename propagation)

**Goal:** When you rename an inventory item in the app, all of its invoices (past and future)
show the **current** item name — with no data migration. Falls back to the stored line
snapshot for lines that aren't linked to an item.

**How:** it's a **display-time join**, not stored data. In the invoice-line fetch
(`listInvoiceLines`), add a computed `displayName`:
```sql
SELECT ..., il.product_name AS productName,
  COALESCE(ii.name, il.product_name) AS displayName, ...
FROM invoice_lines il
LEFT JOIN inventory_items ii ON ii.id = il.item_id
WHERE il.invoice_id = ? ORDER BY il.id
```
Add `displayName: string` to the `InvoiceLine` type. **Keep `productName` (the raw snapshot)
unchanged.** Then render `displayName` on the three display surfaces: the on-screen invoice
document (also used by the print page), the draft editor's existing-line rows, and the PDF
model's line `description`.

**GOTCHAS:**
- **LEFT JOIN, not INNER** — an unlinked line (`item_id IS NULL`) or a deleted-item line
  (`item_id` set NULL via `ON DELETE SET NULL`) must still return a row and fall back to the
  snapshot; `COALESCE(item name, snapshot)` handles this.
- **Do NOT switch posting/preview logic to `displayName`.** `postInvoice` and
  `previewPurchasePost` resolve unlinked lines by their **snapshot** `productName` text — they
  must keep using `productName`, not the live name.
- If the editor optimistically appends new lines to client state, include `displayName` on
  those objects too (else the display cell is `undefined` until refresh).
- **Trade-off to state for the user:** this drops point-in-time fidelity — an old invoice
  (or an already-sent PDF, when re-rendered) now shows the renamed item instead of its
  original wording. That's the intended behavior for keeping inventory consistent.

**Tests:** `listInvoiceLines` returns the item's current name for a linked line; after a
rename `displayName` updates while `productName` stays the snapshot; an unlinked line falls
back to the snapshot.

---

## Feature 7 — Invoice charges & deductions

**Goal:** Invoices can carry non-inventory **charge** lines — a free-text name + a signed
amount (positive = a charge like shipping/tax/fee; negative = a deduction/discount) — that
adjust the invoice total but never post to inventory and are excluded from goods money
reports. Flat amounts only; both purchase and sale invoices.

**Data model:** add `kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','charge'))` to
`invoice_lines` (migration: guarded `ALTER TABLE invoice_lines ADD COLUMN kind TEXT NOT NULL
DEFAULT 'item'`; existing lines become `'item'`). Add `kind` to the `InvoiceLine` type + the
`listInvoiceLines` SELECT.

**A charge line** = `kind='charge'`, `product_name` = the name, `quantity = 1`, `item_id =
NULL`, and the **signed amount written into BOTH `unit_cost_cents` and `unit_price_cents`** —
so the existing direction-based total formula (`SUM(quantity × price-or-cost by direction)`)
includes it for purchase and sale alike, with negatives subtracting. **No total-math change
needed.** Add `addInvoiceCharge(db, {invoiceId, name, amountCents})`.

**GOTCHAS (all real, review-found):**
- **`addInvoiceCharge` MUST call the same posted-invoice-lock guard** (`assertDraft`, or
  whatever this app's `addInvoiceLine`/`deleteInvoiceLine` use) as its **first** statement.
  Missing it lets a charge mutate a *posted* invoice's finalized total, and if the API wraps
  the call in a try/catch that returns "locked" on throw, that becomes dead code (silent
  success). Mirror the sibling line mutators exactly.
- **Charge lines must be skipped in EVERY inventory/goods-money path** or they corrupt stock
  and reports:
  - `postInvoice` — skip charges in the sale-path "must map to an item" check AND the
    stock-quantity aggregation, and in the purchase-path batch loop (`if (kind==='charge')
    continue;`). Charges never create batches / never reduce stock.
  - `previewPurchasePost` — skip charges (they have `item_id NULL`; without the skip they'd be
    classified as "needs an item").
  - The wholesale sale report's line query — add `AND kind = 'item'` so charges don't inflate
    units/revenue/profit.
  - `qtySoldWholesale`-style queries that already filter `item_id = ?` exclude charges for
    free (charges have `item_id NULL`), but add `AND kind='item'` if you want it explicit.
  - Any "N units / M products" summary on the invoice document — exclude `kind='charge'` (a
    charge is not a product/unit). But the invoice **total** must still include charges.
- **Allow negative amounts** in the API (don't run charges through the item-line `>= 0`
  validation); reject only a **zero** amount (parity with the UI).

**UI:** an "Add charge / deduction" form in the invoice editor (Name + Amount$, negatives
allowed — no `min`), posting `{kind:"charge", name, amountCents}` to the lines route. Render
charge rows on the editor, the invoice document, and the PDF with the name + amount and
**blank qty/unit** (a documented `qty=1 / unit=amount` PDF fallback is acceptable if the PDF
template can't blank cells — amount/total must be exact). When appending a new charge to
client-side editor state, include `displayName` (= the name) or the row shows blank until
refresh.

**Tests:** total includes a positive charge and subtracts a negative one (both directions);
posting a purchase/sale invoice with a charge adds/leaves stock only for item lines and does
not require the charge to have an item; `previewPurchasePost` never lists a charge;
`addInvoiceCharge` throws on a posted invoice.

---

## Feature 8 — Total pieces on the invoice PDF

**Goal:** Show a **Total pieces** count on the invoice PDF — the sum of unit quantities across
the invoice's inventory (item) lines, excluding non-inventory charge/deduction lines.

**How:** add `totalPieces: number` to the PDF view-model (the app's `invoicePdfModel` or
equivalent), computed as `Σ quantity over kind === 'item'` lines, and render it near the total
on the PDF document component.

**GOTCHAS:**
- Compute from the **raw** invoice lines (which carry `kind`), NOT the mapped PDF rows — charge
  rows carry `quantity: 1`, so summing the mapped rows would wrongly include them.
- If the PDF view-model is a typed object built in tests, update those model literals to include
  `totalPieces` (else the suite won't type-check).
- Consistency: this matches the on-screen invoice document's units count (also item-lines-only).

**Tests:** `totalPieces` sums item-line quantities and excludes a charge line (e.g. two item
lines 6 + 4 plus a charge → 10).

---

## Feature 9 — Removal of the dead "brother" cost-sharing concept

**STOP AND CHECK FIRST — this feature may not apply to you as-is.** In the source app the
"brother" concept (a side-channel for tracking inventory given to a cost-sharing partner) was
already **dead**: nothing but tests called `insertBrotherTxn`, and the one surviving UI row
("Sold — gave to brother" on the item detail page) always rendered qty 0 / $0 because nothing
wrote real data into `brother_transactions` anymore. Deleting it changed zero numbers. **Your
app may be different** — if `whatnot-business-manager` still has a live brother/cost-share UI
with real non-zero rows, do **not** blindly delete it by following these steps. First verify,
in your own app:
1. Is there still a reachable code path (a route, a form, a button) that writes to the
   brother-equivalent table? If yes, this is a live feature, not dead code — stop and raise
   that with whoever owns the port instead of removing it.
2. Are there existing rows with non-zero `qty`/cost? Query the table. If real data exists,
   removal is a product decision (what happens to that data / those numbers), not a
   mechanical port.

**If — and only if — your app's equivalent is confirmed dead (no live caller, inert
display),** the goal and steps are:

**Goal:** Remove the concept end to end: drop the table, delete its DB helper functions, strip
its field from delete-impact interfaces, remove it from the reset/merge table lists, remove
its dead UI row, and remove it from the Excel-backup `TABLES` list.

**Steps (mirror what the source app did):**
1. Drop the table inside `migrate(db)`, guarded (`DROP TABLE IF EXISTS ...`).
2. Delete the insert/query helper functions for it (e.g. `insertBrotherTxn`,
   `qtyGivenToBrother`, a cost-computation helper like `brotherShipmentOwnerCost`).
3. Remove its field from `DeleteImpact` **and** any bulk/aggregate variant of that interface
   (e.g. `BulkDeleteImpact`) — the two are easy to update in lockstep and easy to forget one of.
4. Remove the table's name from the merge re-point list (Feature 5, step 1) and from
   `resetApp`/admin-reset's table list.
5. Remove the dead row from the item detail page.
6. Remove the table from the Excel-backup `TABLES` list. Before you do, **verify how your
   importer works**: this is only safe for restoring older backups if `importWorkbook` (or
   your app's equivalent) reads sheets **by name from that `TABLES` list**, so an
   older-format sheet that isn't in the list is simply ignored on import rather than causing
   an error. Confirm that in your app's code — don't assume it matches the source app.

**GOTCHAS (real, transferable):**
- **Port the tests, don't delete them.** Several tests in the source app used a brother row as
  a convenient way to create "sold" units for stock-math assertions. Deleting those tests along
  with the feature silently loses that stock-math coverage. Rewrite them against another sale
  path instead (e.g. a confirmed show line item) so the same math gets exercised.
- **Check before touching `warehouseQty`.** It may already be a *derived* value (in the source
  app, `qtyRemaining - whatnotQty`) with no separate brother term to remove — verify the
  formula before editing it, so you don't "fix" something that was never broken.
- **`DeleteImpact` + its bulk/aggregate variant move together.** Removing a field from one and
  not the other leaves a type mismatch or a silently-stale bulk report.
- **Order matters: drop the table in the same deployable unit as removing the FK-detach
  code.** If the re-point/detach lines are removed while the table still exists, delete/merge/
  reset can throw on any row that still has a non-NULL `item_id` pointing at a real item. Don't
  ship "remove the code" and "drop the table" as separate deploys.
- **"No numbers changed" is a claim you must verify, not assume.** It was true here because the
  only surviving row was inert (qty 0, cost $0) — confirm the equivalent is actually inert in
  your app (see the STOP-AND-CHECK step above) before repeating that claim in your own PR
  description.
- **Backup/restore safety is conditional, not automatic.** Dropping a table from the export
  `TABLES` list only keeps older backups restorable if the importer looks up sheets by name
  from that same list (so an unlisted sheet is skipped, not rejected). Verify that behavior in
  your app's importer rather than assuming it matches the source app's.

**Tests:** migration drops the table without error on a DB that has it and on one that
doesn't (idempotent); `DeleteImpact`/bulk variant no longer reference the field and callers
compile; merge/reset no longer name the table; any stock-math test that used to seed a brother
row now seeds an equivalent show/ledger sale and still passes; backup export/import round-trip
no longer includes the sheet, and importing an **old** backup that still has the sheet does not
error.

---

## Feature 10 — Whatnot-only inventory mode

**STOP AND CHECK FIRST — this feature depends on a precondition that may not hold in your
app.** It only makes sense if `whatnot-business-manager` already splits each item's on-hand
into two buckets the way the source app does (see
`2026-07-18-whatnot-warehouse-stock-buckets-design.md` if you ported that). **If your app
has no equivalent two-bucket stock model, most of this doesn't apply — stop and check with
whoever owns the port rather than inventing a Warehouse/Whatnot split just to hang this
toggle on.**

**Goal:** A settings toggle for a seller who is currently Whatnot-only and not wholesaling
yet: hide the Warehouse/Whatnot split and show one "In stock" number, with a gate that only
allows turning it on when Warehouse is genuinely empty everywhere, and compensation logic
that keeps Warehouse pinned at 0 while the mode stays on.

**Background (source app's bucket math, untouched by this feature):**
`whatnotQty = movedToWhatnot - movedToWarehouse - whatnotSales + whatnotAdjustments`;
`warehouseQty = qtyRemaining - whatnotQty`. The existing invariant
`warehouseQty + whatnotQty === qtyRemaining` must keep holding exactly as before — this
feature is display-and-compensation, never a change to the formulas.

**1. The setting:** `app_settings.whatnot_only INTEGER NOT NULL DEFAULT 0`, added by a
guarded `PRAGMA table_info` check in `migrate(db)` (`src/lib/db/connection.ts`), matching the
pattern already used for the other boolean settings columns. Surface as
`whatnotOnly: boolean` through `getSettings`/`updateSettings` (`src/lib/db/settings.ts`),
same boolean-coercion pattern as the app's other checkbox settings. Default off, so nothing
changes until deliberately enabled.

**2. The gate (enable only):** `itemsWithWarehouseStock(db)` (`src/lib/db/inventory.ts`)
returns `{ id, name, qty }` for **every** item whose `warehouseQty !== 0` — **archived items
included** (leftover stock in an archived item is still stock) and **negative buckets
included** (a bucket at −2 is as broken a starting point as +12). `PUT /api/settings` computes
this only when `whatnotOnly` is flipping **false → true**; if the list is non-empty it returns
**409** with `{ error, items: [{id,name,qty}] }` and does not save. Turning the mode **off** is
never gated — Warehouse is supposed to already be 0.

**3. Forward compensation:** `settleWhatnotOnly(db, itemId, qty, direction)`
(`src/lib/db/moves.ts`) writes an `inventory_moves` row noted `"auto (Whatnot-only)"`; it is a
no-op both when `qty <= 0` and when the mode is off, so every call site can call it
unconditionally. Three call sites:
- `addPurchase` (`src/lib/db/purchases.ts`) — `to_whatnot` for the received qty, so new stock
  lands in Whatnot instead of Warehouse.
- `postInvoice`'s **sale** branch (`src/lib/db/invoices.ts`), in the existing `qtyByItem`
  aggregation loop — `to_warehouse` for the total sold qty, so the existing deduction
  consumes it and Warehouse returns to 0.
- `addAdjustment` (`src/lib/db/adjustments.ts`) — no move; instead it **forces**
  `channel: 'whatnot'` regardless of what the caller passed, while the mode is on.

**4. Reversal compensation:** `reconcileWhatnotOnly(db, itemId)` (`src/lib/db/inventory.ts`)
is the idempotent counterpart — it reads the current `warehouseQty` and writes whichever
single move (`to_whatnot` if positive, `to_warehouse` if negative) drives it back to 0; a
second call is a no-op because the bucket is already 0. It is a no-op when the mode is off.
Called from:
- `unpostInvoice` — both the sale branch and the purchase branch, after the status flip.
- `deleteInvoice` — after computing the affected item ids from both `item_purchases` and
  `invoice_lines`, but before/while those rows are deleted (ids captured first — see Gotcha 6).
- At the **route layer**, not inside the DB functions, for: `PATCH`/`DELETE`
  `/api/purchases` (capturing the batch's `itemId` via `getPurchaseItemId` before
  update/delete) and `DELETE` `/api/inventory/[id]/adjustments` (the item id is already the
  route param, so no extra lookup is needed there).

**5. UI while the mode is on:**
- `InventoryTable`: the Warehouse and Whatnot columns collapse into one "In stock" column
  (existing total, oversold-red styling goes with the split); the per-row Move button is not
  rendered.
- `AdjustmentsLog`: the channel picker is hidden and the form always posts
  `channel: 'whatnot'`.
- `POST /api/inventory/move` returns **409** while the mode is on, so the server enforces the
  rule even if a client somehow still renders the button.
- Backup export is unchanged — `inventory_moves` keeps exporting, so the auto-generated
  compensating moves aren't lost.

**GOTCHAS (these are the highest-value part — every one below was a real defect caught in
code review on this branch, not a hypothetical):**

1. **Do not make the bucket formulas depend on the flag.** Leave `warehouseQty`/`whatnotQty`
   untouched and do all the work through real `inventory_moves`/adjustment rows via
   `settleWhatnotOnly`/`reconcileWhatnotOnly`. This keeps history reproducible and — critically
   — the existing partition-invariant test (`warehouseQty + whatnotQty === qtyRemaining`)
   keeps passing **unmodified**. If you find yourself editing that formula for this feature,
   stop.
2. **Ordering inside `postInvoice`'s sale branch matters.** The compensating
   `settleWhatnotOnly(..., "to_warehouse")` call MUST happen **before** the invoice status
   flips to `posted`, because the wholesale sold-quantity query only counts **posted** lines —
   flip first and the compensation undercounts by exactly this invoice.
3. **The settings endpoint must not treat an absent `whatnotOnly` key as false.** A generic
   "save settings" request that doesn't include the field would otherwise silently disable the
   mode on any unrelated save (e.g. editing the business name). Keep the previously stored
   value unless the request body has an **explicit boolean**, and make sure the settings form
   always sends the field (not just when the checkbox is checked).
4. **Forward compensation alone is not enough.** Every reversal path — unpost, delete invoice,
   delete/edit a purchase batch, delete an adjustment — must call the reconciler, or Warehouse
   drifts (often negative), and **the drift is invisible while the mode is on** because the
   column showing it is hidden. Prefer one idempotent "drive Warehouse to 0" reconciler over
   trying to locate and delete the one specific compensating move that caused the drift.
5. **`deleteAdjustment`/its route is the easiest reversal path to miss.** Deleting an
   adjustment whose `channel` is not `'whatnot'` moves the item's total but not its Whatnot
   bucket, silently pushing Warehouse away from 0. Adjustments created **before** the mode was
   ever enabled all have `channel = 'warehouse'` or `NULL` — and those are exactly the old rows
   a user is most likely to prune later.
6. **For delete paths, capture the affected item ids BEFORE the rows are removed.** After a
   purchase batch or invoice line is deleted there's nothing left to join against to find which
   items were affected, and a reconcile call made against an empty id list is a silent no-op
   that still lets a naive test pass.
7. **Watch for an import cycle between the reconciler and the move/adjustment writers.** The
   reconciler needs both the bucket-math reads and a move writer. In the source app,
   `inventory.ts` imports `purchases.ts` and `adjustments.ts` (for `recomputeItemTotals` and
   adjustment sums), so those two modules **cannot** import `inventory.ts` back to call the
   reconciler themselves — that's why the purchases-route and adjustments-route call sites are
   wired at the **route layer** instead of inside `purchases.ts`/`adjustments.ts`. Check your
   app's actual import graph before deciding where to call the reconciler from; don't assume it
   matches this shape.
8. **The gate is a point-in-time precondition, not an enforced invariant.** It only proves
   Warehouse is 0 at the instant the mode is enabled; after that, staying at 0 depends on every
   stock-mutating call site remembering to compensate or reconcile. Enumerate the
   stock-mutating paths in **your** app exhaustively (don't just copy this list) — a missed one
   fails silently because the column is hidden.
9. **Turning the mode off does not undo the auto-generated moves.** They remain ordinary
   `inventory_moves` rows indistinguishable from a manual Move once written, so a later
   reversal (e.g. deleting a purchase that was received while the mode was on, after the mode
   is later turned off) can still push Warehouse negative. This is a known, accepted risk in
   the source app — document it for your users rather than trying to "fix" it by deleting the
   auto-moves on disable (which would itself need its own careful bookkeeping).

**Tests:** migration adds `whatnot_only` defaulting to 0, idempotent; `getSettings`/
`updateSettings` round-trip the boolean and an update omitting the key preserves the stored
value; the gate rejects with the item list (including an archived item and a negative bucket)
and allows when all buckets are 0; receiving stock while on lands it in Whatnot leaving
Warehouse at 0; posting a wholesale sale while on leaves Warehouse at 0 and decreases Whatnot,
verified against the posted-status-flip ordering; adjustments while on record
`channel: 'whatnot'` regardless of the requested channel; deleting an old (`warehouse`/`NULL`
channel) adjustment while on reconciles Warehouse back to 0; unposting/deleting an invoice and
editing/deleting a purchase batch each reconcile their affected items; the existing
partition-invariant test passes unmodified; `POST /api/inventory/move` returns 409 while on.

---

## Source-of-truth references (in the Warehouse-Manager repo)

If you want the exact original code/tests, these design specs and plans describe each feature
in full detail (copy them over if useful):
- Spec: `docs/superpowers/specs/2026-07-23-unified-item-identifiers-design.md`
- Plans: `docs/superpowers/plans/2026-07-23-unified-item-identifiers-1-backbone.md`,
  `2026-07-24-unified-item-identifiers-2-suggest-confirm.md`,
  `2026-07-25-unified-item-identifiers-3-invoice-supplier.md`,
  `2026-07-25-unified-item-identifiers-4-sku-manager.md`,
  `2026-07-25-unified-item-identifiers-5-item-merge.md`,
  `2026-07-25-invoice-live-item-name.md` (Feature 6),
  `2026-07-25-invoice-charges-deductions.md` (Feature 7),
  `2026-07-25-invoice-pdf-total-pieces.md` (Feature 8)
- Spec: `docs/superpowers/specs/2026-07-27-remove-brother-concept-design.md`
- Plan: `docs/superpowers/plans/2026-07-27-remove-brother-concept.md` (Feature 9)
- Spec: `docs/superpowers/specs/2026-07-27-whatnot-only-inventory-toggle-design.md`
- Plan: `docs/superpowers/plans/2026-07-27-whatnot-only-inventory-toggle.md` (Feature 10)

---

## Changelog (append new features here as they're built)

- 2026-07-25 — Seeded with Features 1–5 (unified identifiers backbone, Whatnot
  suggest-and-confirm, supplier invoice suggest-and-confirm, SKU-manager panel, item merge),
  including the review-found gotchas (migration lossless guard, datalist id collisions,
  purchase-only preview gate, setSku same-item collision, mine-delete guard, remove-confirm,
  merge table completeness + archived-survivor guard).
- 2026-07-25 — Feature 6 (invoices show the live item name via a display-time
  `COALESCE(item name, snapshot)` join; keep the snapshot for posting logic + unlinked-line
  fallback).
- 2026-07-25 — Feature 7 (invoice charges & deductions: `kind` column, signed-amount charge
  lines that adjust the total but skip posting + all goods-money reports; gotchas: posted-lock
  guard on `addInvoiceCharge`, skip charges everywhere inventory/reporting sums lines, allow
  negatives / reject zero).
- 2026-07-25 — Feature 8 (total pieces on the invoice PDF: `totalPieces` = Σ quantity over
  `kind='item'` lines, computed from raw lines, rendered near the PDF total).
- 2026-07-27 — Feature 9 (removal of the dead "brother" cost-sharing concept: table dropped,
  helpers deleted, `DeleteImpact`/bulk variant and merge/reset table lists updated, dead UI row
  removed, table dropped from backup `TABLES`; STOP-AND-CHECK guidance since the sibling app's
  brother/cost-share feature may still be live with real data, unlike the source app's already-
  dead one).
- 2026-07-27 — Feature 10 (Whatnot-only inventory mode: a settings toggle that hides the
  Warehouse/Whatnot split behind one "In stock" number, gated on Warehouse being empty
  everywhere to enable, forward-compensated via `settleWhatnotOnly` and reversal-compensated
  via the idempotent `reconcileWhatnotOnly`; gotchas: formulas stay untouched, the sale-post
  compensation must land before the posted-status flip, an absent `whatnotOnly` key must not
  be treated as false, every reversal path — including the easy-to-miss adjustment delete —
  must reconcile, capture item ids before delete, watch the inventory/purchases/adjustments
  import cycle, the gate is point-in-time only, and disabling the mode leaves auto-moves in
  place); STOP-AND-CHECK guidance since this feature only applies if the sibling app has an
  equivalent two-bucket stock model at all.
