# Remove Brother-Txn UI + Owner-Share Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the brother-transaction entry UI (form + API route) and the dashboard "Your N%" owner-share card, leaving the data model, calcs, backup, and reset intact (reversible, no financial change).

**Architecture:** Pure deletion of user-facing entry points. The dashboard drops one Stat and its now-unused settings lookup; `InventoryForms` drops its second card and the `bro` state; the brother API route file is deleted. No data-layer, calc, backup, or test logic changes.

**Tech Stack:** Next.js 15 (App Router), React client component, TypeScript, Tailwind, Vitest.

## Global Constraints

- This is **UI-only, reversible** removal: do NOT touch `brother_transactions` schema/table,
  `insertBrotherTxn`, `qtyGivenToBrother`, the `netInventorySpend` brother handling, Excel
  backup/restore, factory reset, or any test of those functions.
- Do NOT alter `dashboardSummary`; `d.ownerShareCents` simply becomes unused at the call site.
- Leave the read-only "Sold — gave to brother" row on the item detail page and the delete-impact
  `brotherTxns` count as-is.
- Follow existing terse code style. No new tests (deletions only).

---

### Task 1: Remove the brother-transaction UI and the owner-share card

**Files:**
- Modify: `src/app/page.tsx` (remove the owner-share Stat + the unused `getSettings` import and lookup)
- Modify: `src/components/InventoryForms.tsx` (remove the "Brother transaction" card + `bro` state; full-width the remaining card)
- Delete: `src/app/api/inventory/brother/route.ts` (and its now-empty `brother/` directory)

**Interfaces:**
- Consumes: nothing new.
- Produces: UI/route removal only. `InventoryForms` keeps the same prop signature
  `{ items: { id: number; name: string }[]; seenNames?: { productName: string; mapped: boolean }[] }`.

- [ ] **Step 1: Dashboard — remove the owner-share card and its unused settings lookup**

In `src/app/page.tsx`:

Remove the `getSettings` import line:

```tsx
import { getSettings } from "@/lib/db/settings";
```

Remove the settings lookup line in the component body:

```tsx
  const { ownerSharePct } = getSettings(db);
```

Remove this Stat from the stat grid (the first child of the `grid grid-cols-2 … lg:grid-cols-6` div):

```tsx
        <Stat label={`Your ${ownerSharePct}%`} value={<Money cents={d.ownerShareCents} />} />
```

Leave the other six `Stat` cards (Gross sales, Total payout, Paid to bank, Inventory spend, Expenses,
Units on hand) and everything else in the file unchanged.

- [ ] **Step 2: Inventory forms — remove the Brother transaction card and `bro` state**

In `src/components/InventoryForms.tsx`:

Remove the `bro` state line:

```tsx
  const [bro, setBro] = useState({ kind: "split_shipment", label: "", full: "", share: "", amount: "", itemId: items[0]?.id ?? 0, qty: "" });
```

Replace the component's returned JSX so only the Map card remains and it is full-width (the outer
wrapper drops the two-column grid). Replace this opening wrapper:

```tsx
    <div className="grid gap-6 sm:grid-cols-2 text-sm">
```

with:

```tsx
    <div className="text-sm">
```

and delete the entire second card block — from:

```tsx
      <Card title="Brother transaction">
```

through its closing:

```tsx
      </Card>
```

(i.e. lines 33–65: the whole `<Card title="Brother transaction">…</Card>`). Keep the `post` helper,
the `alias` state, the `<Card title="Map Whatnot name → item">` card, and the closing `</div>`
exactly as they are.

After this step the file imports `useState` (still used by `alias`), `Button`, `Card`, and
`INPUT_CLASS` — all still used. Do not remove any import.

- [ ] **Step 3: Delete the brother API route**

```bash
git rm "src/app/api/inventory/brother/route.ts"
rmdir "src/app/api/inventory/brother" 2>/dev/null || true
```

- [ ] **Step 4: Type-check / build**

Run: `npm run build`
Expected: build succeeds; no TypeScript errors. In particular, no "unused variable" or "cannot find
name `ownerSharePct` / `getSettings` / `bro` / `setBro`" errors (all references removed).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: all tests pass. The brother calc/db tests still exist and pass (those functions are
untouched); nothing referenced the deleted route.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/components/InventoryForms.tsx
git commit -m "feat: remove brother-transaction entry UI + dashboard owner-share card"
```

(The `git rm` from Step 3 is already staged; this commit includes it.)

---

## Self-Review notes

- **Spec coverage:** dashboard card removed + unused settings lookup cleaned (Step 1); brother form
  card + `bro` state removed, remaining card full-width (Step 2); API route deleted (Step 3); build +
  full suite verified (Steps 4–5). All spec "Changes" items covered.
- **Reversibility honored:** no edits to schema, data-layer functions, calcs, backup, reset, or the
  read-only item-page brother row — matches the spec's "left intentionally intact" list.
- **No placeholders; deletions only, no new types or tests.**
