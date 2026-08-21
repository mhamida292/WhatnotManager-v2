# On-Screen Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user record the component items of an on-screen bundle on the show it sold in, so the bundle's profit (ledger revenue − summed component cost) shows on the show page and the profit report.

**Architecture:** A bundle is an individual ledger sale line (`ledger_transactions` row, kind `sale`) that has component rows attached. A new `bundle_components` table links a sale line to inventory items + quantities. The report builder detects sale lines with components and emits a dedicated, component-costed product row for each, independent of product-name grouping. A per-show editor on the show page (mirroring the existing Giveaway Allocations editor) manages them.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest. Money is integer cents everywhere.

## Global Constraints

- Money is stored and computed as **integer cents** (never floats for storage).
- SQLite has `PRAGMA foreign_keys = ON` (set in `createDb`), so `ON DELETE CASCADE` fires.
- **No stock drawdown:** bundle components must NOT affect any item's `remaining`/`sold`/`qty_*`. Bundles affect profit only.
- **No catalog / no reusable recipes:** bundles are defined ad-hoc per show.
- Follow existing patterns: DB access in `src/lib/db/*.ts`, calc in `src/lib/calc/*.ts`, API in `src/app/api/...`, client components in `src/components/*.tsx`.
- Tests use `createDb(":memory:")` in `beforeEach`.

---

## File Structure

- **Create** `src/lib/db/bundles.ts` — all DB access for bundles (sale lines, get/set bundles, report helper).
- **Modify** `src/lib/db/schema.ts` — add `bundle_components` table.
- **Modify** `src/lib/db/admin.ts` — wipe `bundle_components` on factory reset.
- **Modify** `src/lib/calc/ledger-report.ts` — emit bundle product lines.
- **Create** `src/app/api/shows/[id]/bundles/route.ts` — GET/PUT per-show bundles.
- **Create** `src/components/ItemCombobox.tsx` — shared type-to-filter item picker (native `<datalist>`).
- **Modify** `src/components/InventoryForms.tsx` — use `ItemCombobox` in the Map form.
- **Create** `src/components/BundleEditor.tsx` — per-show bundle editor (client), item rows use `ItemCombobox`.
- **Modify** `src/app/shows/[id]/page.tsx` — render `BundleEditor` + bundle indicator in Products table.
- **Create** `tests/lib/db/bundles.test.ts` — DB module tests.
- **Modify** `tests/lib/calc/ledger-report.test.ts` — bundle report behavior tests.

---

## Task 1: Schema + bundles DB module

**Files:**
- Modify: `src/lib/db/schema.ts` (append table to `SCHEMA` template string, after `show_giveaway_allocations`)
- Modify: `src/lib/db/admin.ts:9-18` (add wipe line)
- Create: `src/lib/db/bundles.ts`
- Test: `tests/lib/db/bundles.test.ts`

**Interfaces:**
- Consumes: `DB` from `@/lib/db/connection`; `ledger_transactions` and `inventory_items` tables.
- Produces:
  - `interface BundleComponentInput { itemId: number; qty: number }`
  - `interface ShowSaleLine { id: number; productName: string | null; amountCents: number }`
  - `interface ShowBundle { ledgerTxnId: number; productName: string | null; amountCents: number; components: BundleComponentInput[] }`
  - `interface BundleInput { ledgerTxnId: number; components: BundleComponentInput[] }`
  - `listShowSaleLines(db: DB, showId: number): ShowSaleLine[]`
  - `getShowBundles(db: DB, showId: number): ShowBundle[]`
  - `setShowBundles(db: DB, showId: number, bundles: BundleInput[]): void`
  - `getBundleComponentsByTxn(db: DB, showId: number): Map<number, BundleComponentInput[]>`

- [ ] **Step 1: Add the table to the schema**

In `src/lib/db/schema.ts`, append this block at the end of the `SCHEMA` template literal (just before the closing `` ` ``, after the `show_giveaway_allocations` table):

```sql
CREATE TABLE IF NOT EXISTS bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_txn_id INTEGER NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty INTEGER NOT NULL
);
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/db/bundles.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import {
  listShowSaleLines, getShowBundles, setShowBundles, getBundleComponentsByTxn,
} from "@/lib/db/bundles";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

// Two sales on the same date => one ledger show with two sale lines.
const LEDGER = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 23, 2026, 10:00:00 AM","$45.00","L1","O1","Earnings for selling a Mega Bundle #1","processing","SALES",""
"Jun 23, 2026, 10:05:00 AM","$22.00","L2","O2","Earnings for selling a Tiny Bundle #1","processing","SALES",""`;

function seed() {
  const a = insertItem(db, { name: "Squish A", unitCostCents: 200, qtyPurchased: 0, lotId: null });
  const b = insertItem(db, { name: "Squish B", unitCostCents: 640, qtyPurchased: 0, lotId: null });
  saveLedger(db, parseLedger(LEDGER));
  const showId = (db.prepare("SELECT id FROM shows LIMIT 1").get() as { id: number }).id;
  const lines = listShowSaleLines(db, showId);
  return { a, b, showId, lines };
}

describe("bundles db", () => {
  it("lists the show's sale lines", () => {
    const { lines } = seed();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.amountCents).sort((x, y) => x - y)).toEqual([2200, 4500]);
  });

  it("set then get round-trips bundle components", () => {
    const { a, b, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [
      { ledgerTxnId: mega.id, components: [{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }] },
    ]);
    const bundles = getShowBundles(db, showId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].ledgerTxnId).toBe(mega.id);
    expect(bundles[0].amountCents).toBe(4500);
    expect(bundles[0].components).toEqual([{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }]);
  });

  it("setShowBundles replaces all bundles for the show", () => {
    const { a, b, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    const tiny = lines.find((l) => l.amountCents === 2200)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 5 }] }]);
    setShowBundles(db, showId, [{ ledgerTxnId: tiny.id, components: [{ itemId: b, qty: 1 }] }]);
    const bundles = getShowBundles(db, showId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].ledgerTxnId).toBe(tiny.id);
  });

  it("getBundleComponentsByTxn keys by ledger txn id", () => {
    const { a, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 3 }] }]);
    const map = getBundleComponentsByTxn(db, showId);
    expect(map.get(mega.id)).toEqual([{ itemId: a, qty: 3 }]);
  });

  it("deleting the show cascades bundle components away", () => {
    const { a, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 1 }] }]);
    db.prepare("DELETE FROM shows WHERE id = ?").run(showId);
    expect((db.prepare("SELECT COUNT(*) c FROM bundle_components").get() as { c: number }).c).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/bundles.test.ts`
Expected: FAIL — cannot resolve `@/lib/db/bundles` (module not created yet).

- [ ] **Step 4: Implement the bundles DB module**

Create `src/lib/db/bundles.ts`:

```typescript
import type { DB } from "./connection";

export interface BundleComponentInput { itemId: number; qty: number; }
export interface ShowSaleLine { id: number; productName: string | null; amountCents: number; }
export interface ShowBundle {
  ledgerTxnId: number;
  productName: string | null;
  amountCents: number;
  components: BundleComponentInput[];
}
export interface BundleInput { ledgerTxnId: number; components: BundleComponentInput[]; }

/** Sale-kind ledger lines for a show — the candidates that can be marked as bundles. */
export function listShowSaleLines(db: DB, showId: number): ShowSaleLine[] {
  return db.prepare(
    `SELECT id, product_name AS productName, amount_cents AS amountCents
     FROM ledger_transactions
     WHERE show_id = ? AND kind = 'sale'
     ORDER BY created_at`
  ).all(showId) as ShowSaleLine[];
}

/** All bundles for a show, grouped by sale line (only lines that have components). */
export function getShowBundles(db: DB, showId: number): ShowBundle[] {
  const rows = db.prepare(
    `SELECT bc.ledger_txn_id AS ledgerTxnId, t.product_name AS productName,
            t.amount_cents AS amountCents, bc.item_id AS itemId, bc.qty AS qty
     FROM bundle_components bc
     JOIN ledger_transactions t ON t.id = bc.ledger_txn_id
     WHERE t.show_id = ?
     ORDER BY bc.ledger_txn_id, bc.id`
  ).all(showId) as {
    ledgerTxnId: number; productName: string | null; amountCents: number; itemId: number; qty: number;
  }[];

  const byTxn = new Map<number, ShowBundle>();
  for (const r of rows) {
    let b = byTxn.get(r.ledgerTxnId);
    if (!b) {
      b = { ledgerTxnId: r.ledgerTxnId, productName: r.productName, amountCents: r.amountCents, components: [] };
      byTxn.set(r.ledgerTxnId, b);
    }
    b.components.push({ itemId: r.itemId, qty: r.qty });
  }
  return [...byTxn.values()];
}

/** Replace-all: clear the show's bundle components, then insert the supplied ones.
 *  Empty-component bundles are skipped. Mirrors setAllocations in giveaway-items.ts. */
export function setShowBundles(db: DB, showId: number, bundles: BundleInput[]): void {
  const tx = db.transaction((bundles: BundleInput[]) => {
    db.prepare(
      `DELETE FROM bundle_components
       WHERE ledger_txn_id IN (SELECT id FROM ledger_transactions WHERE show_id = ?)`
    ).run(showId);
    const ins = db.prepare(
      "INSERT INTO bundle_components (ledger_txn_id, item_id, qty) VALUES (?,?,?)"
    );
    for (const b of bundles) {
      for (const c of b.components) {
        if (c.qty > 0) ins.run(b.ledgerTxnId, c.itemId, c.qty);
      }
    }
  });
  tx(bundles);
}

/** Map of ledger sale-line id -> its components, for the report builder. */
export function getBundleComponentsByTxn(db: DB, showId: number): Map<number, BundleComponentInput[]> {
  const rows = db.prepare(
    `SELECT bc.ledger_txn_id AS ledgerTxnId, bc.item_id AS itemId, bc.qty AS qty
     FROM bundle_components bc
     JOIN ledger_transactions t ON t.id = bc.ledger_txn_id
     WHERE t.show_id = ?
     ORDER BY bc.id`
  ).all(showId) as { ledgerTxnId: number; itemId: number; qty: number }[];
  const map = new Map<number, BundleComponentInput[]>();
  for (const r of rows) {
    if (!map.has(r.ledgerTxnId)) map.set(r.ledgerTxnId, []);
    map.get(r.ledgerTxnId)!.push({ itemId: r.itemId, qty: r.qty });
  }
  return map;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/bundles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Add bundle_components to factory reset**

In `src/lib/db/admin.ts`, add `DELETE FROM bundle_components;` as the FIRST delete inside the `db.exec` block (child-before-parent ordering), so the reset stays explicit even though the cascade would also handle it:

```typescript
    db.exec(`
      DELETE FROM bundle_components;
      DELETE FROM ledger_transactions;
      DELETE FROM show_line_items;
      DELETE FROM shows;
      DELETE FROM expenses;
      DELETE FROM brother_transactions;
      DELETE FROM product_aliases;
      DELETE FROM inventory_items;
      DELETE FROM lots;
    `);
```

- [ ] **Step 7: Run the full suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS (all existing tests + the 5 new ones).

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/bundles.ts src/lib/db/admin.ts tests/lib/db/bundles.test.ts
git commit -m "feat(bundles): bundle_components table + db module"
```

---

## Task 2: Report builder emits bundle lines

**Files:**
- Modify: `src/lib/calc/ledger-report.ts`
- Test: `tests/lib/calc/ledger-report.test.ts` (append cases)

**Interfaces:**
- Consumes: `getBundleComponentsByTxn` from `@/lib/db/bundles` (Task 1).
- Produces: `ReportProductLine` gains optional `isBundle?: boolean` and `components?: ReportBundleComponent[]`, where
  `interface ReportBundleComponent { name: string; qty: number; unitCostCents: number; costCents: number }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calc/ledger-report.test.ts` (inside the existing top-level `describe`, or add a new `describe`). If the file lacks these imports at the top, add them: `insertItem` from `@/lib/db/inventory`, `parseLedger` from `@/lib/csv/ledger`, `saveLedger` from `@/lib/db/ledger`, `setShowBundles`/`listShowSaleLines` from `@/lib/db/bundles`, and `buildLedgerReport` from `@/lib/calc/ledger-report`.

```typescript
describe("buildLedgerReport — bundles", () => {
  const LEDGER = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 23, 2026, 10:00:00 AM","$45.00","L1","O1","Earnings for selling a Mega Bundle #1","processing","SALES",""
"Jun 23, 2026, 10:05:00 AM","$22.00","L2","O2","Earnings for selling a Mega Bundle #1","processing","SALES",""`;

  it("costs a bundle from its components, as its own row, independent of identical names", () => {
    const a = insertItem(db, { name: "Squish A", unitCostCents: 200, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "Squish B", unitCostCents: 640, qtyPurchased: 0, lotId: null });
    saveLedger(db, parseLedger(LEDGER));
    const showId = (db.prepare("SELECT id FROM shows LIMIT 1").get() as { id: number }).id;
    const lines = listShowSaleLines(db, showId);
    const first = lines.find((l) => l.amountCents === 4500)!;   // both lines share the name "Mega Bundle"
    setShowBundles(db, showId, [
      { ledgerTxnId: first.id, components: [{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }] },
    ]);

    const rep = buildLedgerReport(db);
    const show = rep.shows.find((s) => s.showId === showId)!;
    const bundleLine = show.products.find((p) => p.isBundle)!;
    expect(bundleLine.costCents).toBe(1040);              // 2*200 + 1*640
    expect(bundleLine.revenueCents).toBe(4500);
    expect(bundleLine.profitCents).toBe(3460);
    expect(bundleLine.components).toEqual([
      { name: "Squish A", qty: 2, unitCostCents: 200, costCents: 400 },
      { name: "Squish B", qty: 1, unitCostCents: 640, costCents: 640 },
    ]);
    // The second identically-named sale line is NOT merged into the bundle line.
    const nonBundle = show.products.filter((p) => !p.isBundle && p.productName === "Mega Bundle");
    expect(nonBundle).toHaveLength(1);
    expect(nonBundle[0].revenueCents).toBe(2200);
    // Show COGS includes the bundle's component cost.
    expect(show.cogsCents).toBe(1040 + nonBundle[0].costCents);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts -t "bundles"`
Expected: FAIL — `p.isBundle` is undefined / no bundle line found.

- [ ] **Step 3: Extend the report types**

In `src/lib/calc/ledger-report.ts`, add the component interface above `ReportProductLine` and two optional fields to it:

```typescript
export interface ReportBundleComponent {
  name: string;
  qty: number;
  unitCostCents: number;
  costCents: number;
}

export interface ReportProductLine {
  productName: string;
  itemId: number | null;
  mapped: boolean;
  qty: number;
  unitCostCents: number | null;
  costCents: number;
  revenueCents: number;
  profitCents: number;
  isBundle?: boolean;
  components?: ReportBundleComponent[];
}
```

- [ ] **Step 4: Build item maps and the per-show component map**

In `src/lib/calc/ledger-report.ts`, add the import at the top:

```typescript
import { getBundleComponentsByTxn } from "@/lib/db/bundles";
```

Replace the existing `itemCost` setup near the top of `buildLedgerReport`:

```typescript
  const itemCost = new Map(listItems(db).map((i) => [i.id, i.unitCostCents]));
```

with both a cost map and a name map (reuse one `listItems` call):

```typescript
  const items = listItems(db);
  const itemCost = new Map(items.map((i) => [i.id, i.unitCostCents]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
```

- [ ] **Step 5: Emit bundle lines inside the per-show loop**

In `buildLedgerReport`, inside the `for (const s of listShows(db))` loop, immediately after `const productMap = new Map<string, ReportProductLine>();`, add:

```typescript
    const bundleLines: ReportProductLine[] = [];
    const componentsByTxn = getBundleComponentsByTxn(db, s.id);
```

Then, in the transaction loop, change the sale branch. Replace this existing block:

```typescript
      if (t.kind === "sale" && t.productName) {
```

with a bundle check that runs first (the `payout += t.amountCents;` line just above it stays unchanged, so bundle revenue still counts toward payout):

```typescript
      if (t.kind === "sale" && componentsByTxn.has(t.id)) {
        const comps = componentsByTxn.get(t.id)!;
        const components = comps.map((c) => {
          const unitCostCents = itemCost.get(c.itemId) ?? 0;
          return { name: itemName.get(c.itemId) ?? "?", qty: c.qty, unitCostCents, costCents: unitCostCents * c.qty };
        });
        const costCents = components.reduce((sum, c) => sum + c.costCents, 0);
        bundleLines.push({
          productName: t.productName ?? "Bundle", itemId: null, mapped: true,
          unitCostCents: null, qty: 1, costCents, revenueCents: t.amountCents,
          profitCents: t.amountCents - costCents, isBundle: true, components,
        });
      } else if (t.kind === "sale" && t.productName) {
```

(The rest of the original sale-branch body and the `else if (t.kind === "giveaway")` … chain stay exactly as they are.)

- [ ] **Step 6: Include bundle lines in the show's products**

In the same loop, replace this line:

```typescript
    const products = [...productMap.values()].sort((a, b) => a.productName.localeCompare(b.productName));
```

with:

```typescript
    const products = [...productMap.values(), ...bundleLines].sort((a, b) => a.productName.localeCompare(b.productName));
```

(`cogsCents` is computed right below as `products.reduce((sum, p) => sum + p.costCents, 0)`, so it now includes bundle cost automatically. No other change needed.)

- [ ] **Step 7: Run the bundle test to verify it passes**

Run: `npx vitest run tests/lib/calc/ledger-report.test.ts -t "bundles"`
Expected: PASS.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS (all tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat(bundles): report builder emits component-costed bundle lines"
```

---

## Task 3: Per-show bundles API route

**Files:**
- Create: `src/app/api/shows/[id]/bundles/route.ts`

**Interfaces:**
- Consumes: `getDb` from `@/lib/db/connection`; `listShowSaleLines`, `getShowBundles`, `setShowBundles`, `type BundleInput` from `@/lib/db/bundles`; `listItems` from `@/lib/db/inventory`.
- Produces: HTTP contract used by `BundleEditor` (Task 4):
  - `GET` → `{ saleLines: ShowSaleLine[], items: { id, name, unitCostCents }[], bundles: ShowBundle[] }`
  - `PUT` body `{ bundles: { ledgerTxnId: number, components: { itemId: number, qty: number }[] }[] }` → `{ ok: true }` or `400 { error }`.

- [ ] **Step 1: Implement the route**

Create `src/app/api/shows/[id]/bundles/route.ts` (mirrors `src/app/api/shows/[id]/giveaways/route.ts`):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { listItems } from "@/lib/db/inventory";
import {
  listShowSaleLines, getShowBundles, setShowBundles, type BundleInput,
} from "@/lib/db/bundles";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const db = getDb();
  return NextResponse.json({
    saleLines: listShowSaleLines(db, showId),
    items: listItems(db).map((i) => ({ id: i.id, name: i.name, unitCostCents: i.unitCostCents })),
    bundles: getShowBundles(db, showId),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const body = await req.json();
  const raw = Array.isArray(body.bundles) ? body.bundles : [];
  const bundles: BundleInput[] = [];
  for (const b of raw) {
    const ledgerTxnId = Number(b.ledgerTxnId);
    if (!Number.isInteger(ledgerTxnId)) {
      return NextResponse.json({ error: "Invalid bundle" }, { status: 400 });
    }
    const rawComps = Array.isArray(b.components) ? b.components : [];
    const components = [];
    for (const c of rawComps) {
      const itemId = Number(c.itemId);
      const qty = Number(c.qty);
      if (!Number.isInteger(itemId) || !Number.isInteger(qty) || qty < 0) {
        return NextResponse.json({ error: "Invalid component" }, { status: 400 });
      }
      if (qty > 0) components.push({ itemId, qty });
    }
    if (components.length > 0) bundles.push({ ledgerTxnId, components });
  }
  setShowBundles(getDb(), showId, bundles);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/shows/[id]/bundles/route.ts"
git commit -m "feat(bundles): per-show bundles API route"
```

---

## Task 4: Shared searchable item picker + Map form

This task is independent of Tasks 1–3 and can be implemented in any order relative to them, but must
land before Task 5 (the bundle editor consumes `ItemCombobox`).

**Files:**
- Create: `src/components/ItemCombobox.tsx`
- Modify: `src/components/InventoryForms.tsx`

**Interfaces:**
- Consumes: `INPUT_CLASS` from `@/lib/ui/inputs`.
- Produces:
  - `export function ItemCombobox(props: { items: { id: number; name: string }[]; value: number | null; onChange: (id: number | null) => void; listId?: string; placeholder?: string }): JSX.Element`

- [ ] **Step 1: Implement the shared combobox**

Create `src/components/ItemCombobox.tsx`. It renders a text input bound to a native `<datalist>` of
item names (type to filter). It keeps its own text state so partial typing isn't clobbered, and
reports the matched item id — or `null` when the current text matches no item. Item names are
`UNIQUE`, so name→id resolution is unambiguous.

```tsx
"use client";
import { useState } from "react";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ItemCombobox({
  items, value, onChange, listId = "item-combobox-list", placeholder = "Search item…",
}: {
  items: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  listId?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(items.find((i) => i.id === value)?.name ?? "");
  return (
    <>
      <input
        className={`w-full ${INPUT_CLASS}`}
        list={listId}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const match = items.find((i) => i.name === v);
          onChange(match ? match.id : null);
        }}
      />
      <datalist id={listId}>
        {items.map((i) => <option key={i.id} value={i.name} />)}
      </datalist>
    </>
  );
}
```

- [ ] **Step 2: Use it in the Map form**

In `src/components/InventoryForms.tsx`, add the import:

```tsx
import { ItemCombobox } from "@/components/ItemCombobox";
```

Change the alias state initializer so `itemId` can be null (line 13):

```tsx
  const [alias, setAlias] = useState<{ productName: string; itemId: number | null }>({ productName: "", itemId: items[0]?.id ?? null });
```

Replace the `<select>` block (lines 25-27) with the combobox + a disabled-when-unresolved Map button:

```tsx
          <ItemCombobox
            items={items}
            value={alias.itemId}
            onChange={(id) => setAlias({ ...alias, itemId: id })}
            listId="map-item-names"
            placeholder="Search inventory item…"
          />
          <Button type="submit" disabled={alias.itemId == null}>Map</Button>
```

(Remove the original `<select>…</select>` and the original standalone `<Button type="submit">Map</Button>`.)

- [ ] **Step 3: Guard the submit against a null item**

In the same file, update the `onSubmit` so it no-ops when no item is resolved (replace the existing `onSubmit` handler body):

```tsx
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault();
          if (alias.itemId == null) return;
          post("/api/aliases", { productName: alias.productName, itemId: alias.itemId }); }}>
```

- [ ] **Step 4: Confirm the `Button` component supports `disabled`**

Run: `grep -n "disabled" src/components/ui/Button.tsx`
Expected: the prop is spread/forwarded (e.g. `{...props}`). If it is NOT forwarded, add `disabled` passthrough to `Button` so the attribute reaches the underlying `<button>`.

- [ ] **Step 5: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual check**

Start dev server, open `/inventory`. In "Map Whatnot name → item", click the item box and type part of an item name — the list filters. Pick one; Map enables. Clear it; Map disables.

- [ ] **Step 7: Commit**

```bash
git add src/components/ItemCombobox.tsx src/components/InventoryForms.tsx
git commit -m "feat(inventory): searchable item picker on the Map form"
```

---

## Task 5: Bundle editor UI + show page wiring

**Files:**
- Create: `src/components/BundleEditor.tsx`
- Modify: `src/app/shows/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET`/`PUT /api/shows/[id]/bundles` (Task 3); `ReportProductLine.isBundle` / `.components` (Task 2); `ItemCombobox` (Task 4).
- Produces: `export default function BundleEditor({ showId }: { showId: number })`.

- [ ] **Step 1: Implement the editor component**

Create `src/components/BundleEditor.tsx` (mirrors `GiveawayAllocationEditor.tsx` styling/flow):

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { ItemCombobox } from "@/components/ItemCombobox";

interface SaleLine { id: number; productName: string | null; amountCents: number; }
interface Item { id: number; name: string; unitCostCents: number; }
// `cid` is a stable client-only key so React never reuses a row's <ItemCombobox>
// for a different logical row (which would leave its local text stale).
interface Component { cid: number; itemId: number | null; qty: number; }
interface Bundle { cid: number; ledgerTxnId: number; components: Component[]; }

export default function BundleEditor({ showId }: { showId: number }) {
  const [saleLines, setSaleLines] = useState<SaleLine[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [saved, setSaved] = useState(false);
  const cidRef = useRef(0);
  const mint = () => cidRef.current++;

  useEffect(() => {
    fetch(`/api/shows/${showId}/bundles`).then((r) => r.json()).then((d) => {
      setSaleLines(d.saleLines);
      setItems(d.items);
      setBundles(d.bundles.map((b: any) => ({
        cid: mint(), ledgerTxnId: b.ledgerTxnId,
        components: b.components.map((c: any) => ({ cid: mint(), itemId: c.itemId, qty: c.qty })),
      })));
    });
  }, [showId]);

  const unitOf = (id: number | null) => items.find((i) => i.id === id)?.unitCostCents ?? 0;
  const lineOf = (txnId: number) => saleLines.find((l) => l.id === txnId);
  const usedLineIds = new Set(bundles.map((b) => b.ledgerTxnId));
  const dirty = () => setSaved(false);

  function setBundle(bi: number, patch: Partial<Bundle>) {
    setBundles(bundles.map((b, i) => (i === bi ? { ...b, ...patch } : b))); dirty();
  }
  function addBundle() {
    const free = saleLines.find((l) => !usedLineIds.has(l.id));
    if (free) { setBundles([...bundles, { cid: mint(), ledgerTxnId: free.id, components: [] }]); dirty(); }
  }
  function removeBundle(bi: number) { setBundles(bundles.filter((_, i) => i !== bi)); dirty(); }
  function addComponent(bi: number) {
    if (items[0]) setBundle(bi, { components: [...bundles[bi].components, { cid: mint(), itemId: items[0].id, qty: 1 }] });
  }
  function setComponent(bi: number, ci: number, patch: Partial<Component>) {
    setBundle(bi, { components: bundles[bi].components.map((c, i) => (i === ci ? { ...c, ...patch } : c)) });
  }
  function removeComponent(bi: number, ci: number) {
    setBundle(bi, { components: bundles[bi].components.filter((_, i) => i !== ci) });
  }
  const costOf = (b: Bundle) => b.components.reduce((s, c) => s + c.qty * unitOf(c.itemId), 0);

  async function save() {
    await fetch(`/api/shows/${showId}/bundles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundles: bundles.map((b) => ({ ledgerTxnId: b.ledgerTxnId, components: b.components.filter((c) => c.qty > 0 && c.itemId != null) })) }),
    });
    setSaved(true);
  }

  if (saleLines.length === 0) {
    return <p className="text-sm text-slate-500">No sale lines on this show yet. Import the ledger first.</p>;
  }

  return (
    <section className="space-y-4">
      {bundles.map((b, bi) => {
        const line = lineOf(b.ledgerTxnId);
        const revenue = line?.amountCents ?? 0;
        const cost = costOf(b);
        return (
          <div key={b.cid} className="rounded-lg border border-line bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <select
                value={b.ledgerTxnId}
                onChange={(e) => setBundle(bi, { ledgerTxnId: Number(e.target.value) })}
                className="rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {saleLines.map((l) => (
                  <option key={l.id} value={l.id} disabled={l.id !== b.ledgerTxnId && usedLineIds.has(l.id)}>
                    {(l.productName ?? "Sale")} — ${(l.amountCents / 100).toFixed(2)}
                  </option>
                ))}
              </select>
              <button onClick={() => removeBundle(bi)} className="text-sm text-red-600 hover:underline">Remove bundle</button>
            </div>

            {b.components.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="border-b border-line text-left text-slate-500">
                  <th className="py-1 pr-4 font-medium">Item</th>
                  <th className="py-1 pr-4 font-medium">Qty</th>
                  <th className="py-1 pr-4 font-medium">Cost</th>
                  <th className="py-1 font-medium"></th>
                </tr></thead>
                <tbody>
                  {b.components.map((c, ci) => (
                    <tr key={c.cid} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4">
                        <ItemCombobox
                          items={items}
                          value={c.itemId}
                          onChange={(id) => setComponent(bi, ci, { itemId: id })}
                          listId="bundle-item-names"
                          placeholder="Search item…"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number" min={0} value={c.qty}
                          onChange={(e) => setComponent(bi, ci, { qty: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                          className="w-20 rounded border border-line bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="py-2 pr-4 text-slate-600">${(c.qty * unitOf(c.itemId) / 100).toFixed(2)}</td>
                      <td className="py-2"><button onClick={() => removeComponent(bi, ci)} className="text-sm text-red-600 hover:underline">Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="mt-2 flex items-center gap-4">
              <button onClick={() => addComponent(bi)} disabled={items.length === 0} className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50">+ Add component</button>
              <span className="text-sm text-slate-500">
                Cost ${(cost / 100).toFixed(2)} · Revenue ${(revenue / 100).toFixed(2)} · Profit ${((revenue - cost) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button onClick={addBundle} disabled={usedLineIds.size >= saleLines.length} className="text-sm font-medium text-blue-600 hover:underline disabled:opacity-50">+ Add another bundle</button>
        <button onClick={save} className="rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save bundles</button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Wire the editor into the show page**

In `src/app/shows/[id]/page.tsx`, add the import near the other component imports:

```tsx
import BundleEditor from "@/components/BundleEditor";
```

Then add a Bundles card immediately after the closing `</Card>` of the "Giveaway Allocations" card (after line ~83):

```tsx
      <Card title="Bundles">
        <p className="mb-3 text-sm text-slate-600">
          Combined an on-screen bundle from several items? Pick its sale line and list what went into it — profit = revenue − component cost.
        </p>
        <BundleEditor showId={show.showId} />
      </Card>
```

- [ ] **Step 3: Show a bundle indicator + breakdown in the Products table**

In `src/app/shows/[id]/page.tsx`, in the Products table body, replace the product-name cell:

```tsx
                <td className="px-3 py-2">{p.productName}{!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}</td>
```

with one that flags bundles and lists their components:

```tsx
                <td className="px-3 py-2">
                  {p.productName}
                  {!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}
                  {p.isBundle && (
                    <span className="ml-1 text-blue-700">
                      ▸ bundle ({p.components?.length ?? 0} item{(p.components?.length ?? 0) === 1 ? "" : "s"})
                    </span>
                  )}
                  {p.isBundle && p.components && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {p.components.map((c) => `${c.qty}× ${c.name}`).join(", ")}
                    </div>
                  )}
                </td>
```

- [ ] **Step 4: Build to verify types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`), then:
1. Open a show that has imported ledger sales (`/shows/<id>`).
2. In the **Bundles** card, click **+ Add another bundle**, pick a sale line, add 2 component items with quantities, and click **Save bundles**.
3. Reload the page — the bundle persists; the **Products** table shows that row tagged `▸ bundle (N items)` with the component breakdown, and its Cost/Profit reflect the component sum.
4. Confirm `/report` shows the same bundle row and that the show's Net and totals moved by the bundle cost.
5. Add a SECOND bundle on the same show with a different sale line — confirm both stay independent.

Expected: all of the above hold.

- [ ] **Step 6: Commit**

```bash
git add src/components/BundleEditor.tsx "src/app/shows/[id]/page.tsx"
git commit -m "feat(bundles): per-show bundle editor + report indicator"
```

---

## Self-Review Notes

- **Spec coverage:** table (T1), no-drawdown (components never alias-mapped; T1 constraint), per-show ad-hoc editor (T5), keyed to individual sale line so identical names don't merge (T2 test), component cost overrides alias for bundle lines (T2 — bundle branch runs before alias resolution), revenue from ledger (T2/T3), API mirrors giveaways (T3), searchable item picker shared across Map form + bundle editor (T4/T5), report + show-page display (T2/T5), cascade on show delete + factory reset (T1). All covered.
- **Type consistency:** `BundleInput`/`BundleComponentInput`/`ShowSaleLine`/`ShowBundle` defined in T1 and reused verbatim in T3; `ReportBundleComponent`/`isBundle`/`components` defined in T2 and consumed in T5; `ItemCombobox` defined in T4, consumed in T4 (Map form) and T5 (bundle rows); `Component.itemId` is `number | null` in T5, and the save filter + API guard reject null ids before they reach the DB.
- **No placeholders:** every code/test step contains full content.
```
