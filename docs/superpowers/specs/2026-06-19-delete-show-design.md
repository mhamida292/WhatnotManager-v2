# Delete a show — design

**Date:** 2026-06-19

## Problem / use case

A show can get created from a wrong or test CSV import. There is currently no
way to remove a single show — the only delete is the full factory reset
(`/settings` Danger zone), which wipes everything. The user wants to delete one
bad/test show without touching the rest of their data.

## Goal

Hard-delete a single show and the rows that belong to it, triggered from the
show detail page, behind a confirm that spells out exactly what will be removed.

## Non-goals

- No soft-delete / undo / trash.
- No tombstone to block re-import. Re-importing the same CSV recreating the
  show is acceptable and expected (called out in the confirm text).
- No per-row delete on the shows list (decided 2026-06-19: detail page only,
  matching the existing inventory-item delete).

## Design

Mirror the established inventory-item delete (`DeleteItemButton` +
`/api/inventory` DELETE + `deleteItem`).

### DB layer — `src/lib/db/shows.ts`

**`deleteShow(db, id)`** — deletes the show inside a transaction:
```ts
db.prepare("DELETE FROM shows WHERE id = ?").run(id);
```
`show_line_items.show_id` and `ledger_transactions.show_id` are both declared
`REFERENCES shows(id) ON DELETE CASCADE`, and `createDb` runs
`PRAGMA foreign_keys = ON`, so this single delete cascades to remove the show's
line items and ledger transactions. Returns `void`.

**`showDeleteImpact(db, id): ShowDeleteImpact`** — counts for the confirm
dialog. Returns:
```ts
interface ShowDeleteImpact {
  ledgerTxns: number;   // rows in ledger_transactions for this show
  ledgerSales: number;  // of those, kind='sale'
  lineItems: number;    // rows in show_line_items (legacy manual shows)
}
```
Computed with three `COUNT(*)` queries scoped to `show_id = ?`.

### API — `src/app/api/shows/route.ts`

Add a `DELETE` handler matching the inventory pattern:
```ts
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM shows WHERE id = ?").get(id);
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  deleteShow(db, id);
  return NextResponse.json({ ok: true });
}
```

### UI

**`src/components/DeleteShowButton.tsx`** (client component) — mirrors
`DeleteItemButton`:
- Props: `{ id: number; showDate: string; impact: ShowDeleteImpact }`.
- A red "Delete show" button → `confirm(message())` → `DELETE /api/shows` with
  `{ id }` → on success `router.push("/shows")`; on failure show a "Retry
  delete" state.
- `message()` example: `Delete show 2026-06-14? This permanently removes the
  show and its 185 transactions (147 sales). This can't be undone — re-importing
  the same CSV would recreate it.` When the show has legacy line items instead
  of ledger transactions, phrase the count from `lineItems`. When a show has no
  child rows, omit the parenthetical.

**`src/app/shows/[id]/page.tsx`** — at the bottom of the P&L, add a small
danger-zone footer: compute `showDeleteImpact(db, Number(id))` and render
`<DeleteShowButton id={show.showId} showDate={show.showDate} impact={impact} />`.

### Behavior notes

- The dashboard and `/report` derive from the remaining shows/transactions
  (`buildLedgerReport` reads live), so totals correct themselves after a delete
  with no extra recompute.
- Deleting a ledger show removes its `ledger_transactions`; their unique
  `dedup_key` rows are gone, so re-importing the same CSV re-inserts them and
  the show returns. Intended.

## Testing (Vitest)

- `deleteShow` removes the show **and** cascades: after deleting a show that has
  ledger transactions and (separately) one with show_line_items, assert the
  `shows`, `ledger_transactions`, and `show_line_items` rows for that id are all
  gone, while a second show's rows are untouched. This proves the FK cascade
  fires under `foreign_keys = ON`.
- `showDeleteImpact` returns correct `ledgerTxns` / `ledgerSales` / `lineItems`
  for a show containing a mix of sale/giveaway/other ledger rows; returns zeros
  for a show with no children.
- API DELETE: `400` for a non-integer id, `404` for a missing id, `{ ok: true }`
  for an existing one (and the show is actually gone afterward).

## Risks

- FK cascade depends on `foreign_keys = ON`. `createDb` already sets it; the
  cascade test guards against regression.
