# Remove brother-transaction UI + "Your N%" dashboard card — design

Date: 2026-06-22

## Goal

Remove the brother-transaction **entry feature** from the UI (the user doesn't need it), and remove
the "Your N%" owner-share card from the dashboard. Reversible: the underlying data model, calc
integration, backup/restore, and factory reset stay intact so the feature can be revived later and no
financial numbers move.

## Context

- The single existing `brother_transactions` row is empty (`amount 0, qty 0`), so removing the UI
  changes no totals.
- "Brother" is referenced across 15 files; this change touches only the **user-facing entry points**.
  The data-layer functions (`insertBrotherTxn`, `qtyGivenToBrother`), the `netInventorySpend` calc,
  the Excel backup/restore sheet, factory reset, and the read-only item-page display stay as-is.

## Changes

### 1. Dashboard — `src/app/page.tsx`

- Remove the owner-share `Stat`: `<Stat label={\`Your ${ownerSharePct}%\`} value={<Money cents={d.ownerShareCents} />} />`.
  Six stat cards remain, which still fill the existing `lg:grid-cols-6` row.
- Remove the now-unused `getSettings` import and the `const { ownerSharePct } = getSettings(db);`
  line (no other use of `ownerSharePct` in this file). `d.ownerShareCents` simply goes unused — that
  is fine; do not alter `dashboardSummary`.

### 2. Inventory page — `src/components/InventoryForms.tsx`

- Remove the entire `<Card title="Brother transaction">…</Card>` block (the second card) and the
  `bro` state (`const [bro, setBro] = useState({...})`).
- The component now renders only the "Map Whatnot name → item" card. Drop the
  `grid gap-6 sm:grid-cols-2` wrapper so the remaining card is full-width (a single block, still
  inside the component's root element).
- Keep the `post` helper, the `alias` state, the `items`/`seenNames` props, and the Map card exactly
  as they are.

### 3. API route — delete `src/app/api/inventory/brother/route.ts`

Only the removed form posted to it. Delete the file (and its now-empty `brother/` directory).

## Left intentionally intact (dormant)

- `brother_transactions` table + schema, `insertBrotherTxn`, `qtyGivenToBrother`, and the
  `qtySold` integration (gave-to-brother still counts as sold for any legacy rows).
- `netInventorySpend` brother handling, Excel backup/restore brother sheet, factory reset.
- The read-only "Sold — gave to brother" row on the item detail page (shows 0; harmless) and the
  delete-impact `brotherTxns` count. These stay for reversibility.

## Testing

- No new tests; these are UI + route deletions.
- The existing brother **calc/db** tests still pass because those functions are untouched.
- Verify `npm run build` succeeds and `npx vitest run` (full suite) passes.

## Out of scope

- No schema/data migration, no change to backup/restore, reset, or any calc.
- Not a "full removal" — chosen UI-only for reversibility and zero financial impact.
