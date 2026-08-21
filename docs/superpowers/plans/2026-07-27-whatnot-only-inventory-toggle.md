# Whatnot-Only Inventory Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings toggle that hides the Warehouse/Whatnot stock split behind one "In stock" number, gated so it can only be enabled when every Warehouse bucket is empty, and self-maintaining so the buckets stay literally true while it is on.

**Architecture:** The bucket formulas in `inventory.ts` are never modified. A new `settleWhatnotOnly` helper writes a compensating `inventory_moves` row at the three flows that would otherwise touch the Warehouse bucket, keeping Warehouse pinned at 0 while the mode is on. The mode is stored as one boolean column on `app_settings`, and the settings route refuses to enable it while any item still holds Warehouse stock.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest (node env, no React Testing Library), Tailwind.

## Global Constraints

- Work on branch `feat/whatnot-only-inventory`. Never commit to `main`.
- **Never modify `warehouseQty` or `whatnotQty`.** `warehouseQty` is `qtyRemaining − whatnotQty` (`src/lib/db/inventory.ts:178`); the partition invariant `warehouseQty + whatnotQty === qtyRemaining` must keep holding, and `tests/lib/db/buckets.test.ts` must keep passing unmodified.
- **No money math changes.** `qtyRemaining` is what reports, COGS, and profit use; this feature must not alter it.
- Schema changes go in the `SCHEMA` string **and** in `migrate(db)` in `src/lib/db/connection.ts`, guarded by the existing `PRAGMA table_info` pattern (see the `scols` block at `connection.ts:57-66`).
- Default is **off** (`0`), so existing behavior is unchanged until deliberately enabled.
- Wholesale posting is **never blocked** while the mode is on — it draws from the single pool. The mode is a display preference, not a business rule.
- Run `npm test` before every commit. Run `npm run build` before the final commit.

---

## File Structure

**Modified:**
- `src/lib/db/schema.ts` — add `whatnot_only` to the `app_settings` DDL
- `src/lib/db/connection.ts` — guarded `ALTER TABLE` in `migrate`
- `src/lib/db/settings.ts` — `whatnotOnly` in the `Settings` interface, `getSettings`, `updateSettings`
- `src/lib/db/moves.ts` — new `settleWhatnotOnly` helper
- `src/lib/db/inventory.ts` — new `itemsWithWarehouseStock` query
- `src/lib/db/purchases.ts` — compensation in `addPurchase`
- `src/lib/db/invoices.ts` — compensation in the `postInvoice` sale branch
- `src/lib/db/adjustments.ts` — force `channel: 'whatnot'` while on
- `src/app/api/settings/route.ts` — accept `whatnotOnly`, 409 gate
- `src/app/api/inventory/move/route.ts` — 409 while on
- `src/components/SettingsForm.tsx` — checkbox + gate error
- `src/components/InventoryTable.tsx` — collapse columns, hide Move
- `src/components/AdjustmentsLog.tsx` — hide channel picker
- `src/app/inventory/page.tsx` — pass the flag down

---

### Task 1: The `whatnotOnly` setting

**Files:**
- Modify: `src/lib/db/schema.ts:141-156`, `src/lib/db/connection.ts` (the `scols` block, ~line 57-66), `src/lib/db/settings.ts`
- Test: `tests/lib/db/settings-whatnot-only.test.ts` (create)

**Interfaces:**
- Produces: `Settings.whatnotOnly: boolean`, defaulting to `false`. Every later task reads it via `getSettings(db).whatnotOnly`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/settings-whatnot-only.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb, migrate } from "@/lib/db/connection";
import { getSettings, updateSettings } from "@/lib/db/settings";

describe("whatnotOnly setting", () => {
  it("defaults to false on a fresh db", () => {
    const db = createDb(":memory:");
    expect(getSettings(db).whatnotOnly).toBe(false);
  });

  it("round-trips through updateSettings", () => {
    const db = createDb(":memory:");
    updateSettings(db, { ...getSettings(db), whatnotOnly: true });
    expect(getSettings(db).whatnotOnly).toBe(true);
    updateSettings(db, { ...getSettings(db), whatnotOnly: false });
    expect(getSettings(db).whatnotOnly).toBe(false);
  });

  it("migrate adds the column to a legacy app_settings table and is idempotent", () => {
    const db = createDb(":memory:");
    db.exec("ALTER TABLE app_settings DROP COLUMN whatnot_only");
    migrate(db);
    migrate(db);
    expect(getSettings(db).whatnotOnly).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/settings-whatnot-only.test.ts`
Expected: FAIL — `whatnotOnly` is undefined, not `false`.

- [ ] **Step 3: Add the column to the schema**

In `src/lib/db/schema.ts`, inside `CREATE TABLE IF NOT EXISTS app_settings`, add as the last column (after `invoice_show_email`):

```sql
  whatnot_only INTEGER NOT NULL DEFAULT 0
```

- [ ] **Step 4: Add the guarded migration**

In `src/lib/db/connection.ts`, in the `scols` block alongside the other `app_settings` columns:

```ts
  if (!scols.includes("whatnot_only")) db.exec("ALTER TABLE app_settings ADD COLUMN whatnot_only INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 5: Thread it through `settings.ts`**

Add `whatnotOnly: boolean;` to the `Settings` interface. In `getSettings`, add `whatnot_only as whatnotOnly` to the SELECT, include `whatnotOnly` in the numeric-to-boolean cast group alongside `invoiceShowPhone`/`invoiceShowAddress`/`invoiceShowEmail`, and return `whatnotOnly: !!r.whatnotOnly`. In `updateSettings`, add `whatnot_only = ?` to the UPDATE and pass `s.whatnotOnly ? 1 : 0` in the matching position.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS. If other tests construct a `Settings` literal, add `whatnotOnly: false` to them.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/settings.ts tests/
git commit -m "feat(settings): whatnotOnly flag with guarded migration"
```

---

### Task 2: The empty-Warehouse gate

**Files:**
- Modify: `src/lib/db/inventory.ts` (add near `warehouseQty`, ~line 180)
- Modify: `src/app/api/settings/route.ts`
- Test: `tests/lib/db/warehouse-stock-gate.test.ts` (create)

**Interfaces:**
- Consumes: `Settings.whatnotOnly` (Task 1).
- Produces: `itemsWithWarehouseStock(db: DB): { id: number; name: string; qty: number }[]` — every item whose `warehouseQty !== 0`, archived included.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/warehouse-stock-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { insertItem, itemsWithWarehouseStock } from "@/lib/db/inventory";
import { addMove } from "@/lib/db/moves";

describe("itemsWithWarehouseStock", () => {
  it("is empty when every item has zero warehouse stock", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "Empty", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    expect(itemsWithWarehouseStock(db)).toEqual([]);
  });

  it("lists items holding warehouse stock, with name and qty", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Blue Widget", unitCostCents: 100, qtyPurchased: 12, lotId: null });
    expect(itemsWithWarehouseStock(db)).toEqual([{ id, name: "Blue Widget", qty: 12 }]);
  });

  it("catches a negative warehouse bucket too", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Oversold", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    addMove(db, { itemId: id, qty: 2, direction: "to_whatnot" });
    expect(itemsWithWarehouseStock(db)).toEqual([{ id, name: "Oversold", qty: -2 }]);
  });

  it("includes archived items", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "Old Stock", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    db.prepare("UPDATE inventory_items SET archived_at = '2026-01-01' WHERE id = ?").run(id);
    expect(itemsWithWarehouseStock(db).map((r) => r.id)).toContain(id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/warehouse-stock-gate.test.ts`
Expected: FAIL — `itemsWithWarehouseStock` is not exported.

- [ ] **Step 3: Implement the query**

In `src/lib/db/inventory.ts`, after `warehouseQty`:

```ts
/** Every item whose Warehouse bucket is non-zero, archived included. A negative
 *  bucket counts: it is as broken a starting point for Whatnot-only mode as a
 *  positive one. Used to gate turning Whatnot-only mode on. */
export function itemsWithWarehouseStock(db: DB): { id: number; name: string; qty: number }[] {
  const rows = db.prepare("SELECT id, name FROM inventory_items ORDER BY name").all() as { id: number; name: string }[];
  return rows
    .map((r) => ({ id: r.id, name: r.name, qty: warehouseQty(db, r.id) }))
    .filter((r) => r.qty !== 0);
}
```

- [ ] **Step 4: Add the 409 gate to the settings route**

In `src/app/api/settings/route.ts`, import `getSettings, updateSettings` (already imported) plus `itemsWithWarehouseStock` from `@/lib/db/inventory`. After `const db = await dbForRequest();` and before `updateSettings`, add:

```ts
  const whatnotOnly = body.whatnotOnly === true;
  const wasWhatnotOnly = getSettings(db).whatnotOnly;
  if (whatnotOnly && !wasWhatnotOnly) {
    const blockers = itemsWithWarehouseStock(db);
    if (blockers.length > 0) {
      return NextResponse.json({ error: "Warehouse stock remains", items: blockers }, { status: 409 });
    }
  }
```

Then add `whatnotOnly,` to the object passed to `updateSettings`.

Note: the existing `const { giveawayUnitCents } = getSettings(db);` line already fetches settings — reuse that call rather than calling `getSettings` twice if it reads cleanly.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/inventory.ts src/app/api/settings/route.ts tests/
git commit -m "feat(settings): gate whatnot-only mode on an empty warehouse"
```

---

### Task 3: Compensating moves keep Warehouse at 0

**Files:**
- Modify: `src/lib/db/moves.ts`, `src/lib/db/purchases.ts:63-80`, `src/lib/db/invoices.ts:123-155`, `src/lib/db/adjustments.ts:12-17`
- Test: `tests/lib/db/whatnot-only-settle.test.ts` (create)

**Interfaces:**
- Consumes: `getSettings(db).whatnotOnly` (Task 1).
- Produces: `settleWhatnotOnly(db: DB, itemId: number, qty: number, direction: MoveDirection): void` — a no-op when the mode is off; otherwise writes one `inventory_moves` row noted `auto (Whatnot-only)`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/whatnot-only-settle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { insertItem, qtyRemaining, warehouseQty, whatnotQty } from "@/lib/db/inventory";
import { addPurchase } from "@/lib/db/purchases";
import { addAdjustment } from "@/lib/db/adjustments";
import { getSettings, updateSettings } from "@/lib/db/settings";

function enable(db: any) {
  updateSettings(db, { ...getSettings(db), whatnotOnly: true });
}

describe("whatnot-only compensation", () => {
  it("receiving lands in Whatnot, leaving Warehouse at 0", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(10);
    expect(warehouseQty(db, id) + whatnotQty(db, id)).toBe(qtyRemaining(db, id));
  });

  it("receiving while OFF still lands in Warehouse (unchanged behavior)", () => {
    const db = createDb(":memory:");
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });

    expect(warehouseQty(db, id)).toBe(10);
    expect(whatnotQty(db, id)).toBe(0);
  });

  it("adjustments record on the whatnot channel while ON", () => {
    const db = createDb(":memory:");
    enable(db);
    const id = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: id, purchasedOn: null, quantity: 10, unitCostCents: 50 });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -2, note: null });

    const row = db.prepare("SELECT channel FROM inventory_adjustments WHERE item_id = ?").get(id) as { channel: string };
    expect(row.channel).toBe("whatnot");
    expect(warehouseQty(db, id)).toBe(0);
    expect(whatnotQty(db, id)).toBe(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/db/whatnot-only-settle.test.ts`
Expected: FAIL — receiving still lands in Warehouse while the mode is on.

- [ ] **Step 3: Add the helper to `moves.ts`**

Append to `src/lib/db/moves.ts` (it already imports `DB` and defines `addMove`/`MoveDirection`):

```ts
import { getSettings } from "./settings";

/** While Whatnot-only mode is on, keep the Warehouse bucket pinned at 0 by
 *  writing a compensating move. A no-op when the mode is off, so every call
 *  site can call it unconditionally. */
export function settleWhatnotOnly(db: DB, itemId: number, qty: number, direction: MoveDirection): void {
  if (qty <= 0) return;
  if (!getSettings(db).whatnotOnly) return;
  addMove(db, { itemId, qty, direction, note: "auto (Whatnot-only)" });
}
```

Put the `import { getSettings }` line at the top of the file with the other imports, not inline.

- [ ] **Step 4: Compensate at the three call sites**

`src/lib/db/purchases.ts` — inside the `addPurchase` transaction, after `recomputeItemTotals(db, p.itemId);`:

```ts
      settleWhatnotOnly(db, p.itemId, p.quantity, "to_whatnot");
```

Import it: `import { settleWhatnotOnly } from "./moves";`

`src/lib/db/invoices.ts` — in the `postInvoice` sale branch, in the loop that already iterates `qtyByItem` for the oversell check, after the check passes (or in a second loop over `qtyByItem` immediately after it), before the `UPDATE invoices SET status = 'posted'` line:

```ts
      for (const [itemId, totalQty] of qtyByItem) {
        settleWhatnotOnly(db, itemId, totalQty, "to_warehouse");
      }
```

Import it alongside the existing `@/lib/db/moves` imports if any, otherwise add `import { settleWhatnotOnly } from "./moves";`.

`src/lib/db/adjustments.ts` — in `addAdjustment`, replace the channel argument so the mode forces it:

```ts
export function addAdjustment(db: DB, a: { itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted?: number | null; channel?: "warehouse" | "whatnot" | null }): number {
  const channel = getSettings(db).whatnotOnly ? "whatnot" : (a.channel ?? null);
  const info = db.prepare(
    "INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note, counted, channel) VALUES (?,?,?,?,?,?,?)"
  ).run(a.itemId, a.adjustedOn, a.reason, a.qty, a.note, a.counted ?? null, channel);
  return Number(info.lastInsertRowid);
}
```

Import `getSettings` from `./settings` at the top.

**Watch for import cycles.** `settings.ts` imports only `./connection`, so `moves.ts → settings.ts` and `adjustments.ts → settings.ts` are safe. If the build reports a cycle, stop and report it rather than restructuring `inventory.ts`.

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, including `tests/lib/db/buckets.test.ts` **unmodified** — if that invariant test fails, the compensation direction is wrong; fix the compensation, never the invariant test.

- [ ] **Step 6: Add the wholesale-post case**

Append to `tests/lib/db/whatnot-only-settle.test.ts` a case that: enables the mode, creates an item, receives 10, creates a `sale` invoice with a line of 3 for that item, posts it, and asserts `warehouseQty === 0`, `whatnotQty === 7`, and `warehouseQty + whatnotQty === qtyRemaining`. Match the invoice-building helpers used by the existing `tests/lib/db/` invoice tests rather than inventing new ones.

- [ ] **Step 7: Run the tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/lib/db/ tests/
git commit -m "feat(inventory): compensating moves pin Warehouse at 0 in whatnot-only mode"
```

---

### Task 4: The UI

**Files:**
- Modify: `src/components/SettingsForm.tsx`, `src/components/InventoryTable.tsx:39-40,139,147`, `src/components/AdjustmentsLog.tsx:35,53,159`, `src/app/inventory/page.tsx:25`, `src/app/api/inventory/move/route.ts`
- Test: `tests/api/move-blocked-whatnot-only.test.ts` (create)

**Interfaces:**
- Consumes: `Settings.whatnotOnly` (Task 1), the 409 gate (Task 2).

- [ ] **Step 1: Write the failing API test**

Create `tests/api/move-blocked-whatnot-only.test.ts` asserting that `POST /api/inventory/move` returns 409 while the mode is on. Match the harness the sibling test `tests/api/move-stock.test.ts` uses — read it first and copy its setup exactly.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/api/move-blocked-whatnot-only.test.ts`
Expected: FAIL — the route returns 200.

- [ ] **Step 3: Guard the move route**

In `src/app/api/inventory/move/route.ts`, after `const db = await dbForRequest();`:

```ts
  if (getSettings(db).whatnotOnly) {
    return NextResponse.json({ error: "Whatnot-only mode is on — turn it off in Settings to move stock." }, { status: 409 });
  }
```

Import `getSettings` from `@/lib/db/settings`.

- [ ] **Step 4: Settings UI**

In `src/components/SettingsForm.tsx`: add `const [whatnotOnly, setWhatnotOnly] = useState(initial.whatnotOnly);` and `const [gateError, setGateError] = useState<string | null>(null);`. Include `whatnotOnly,` in the PUT body. Replace the failure branch of `save` so a 409 renders the blocking items instead of a bare alert:

```ts
    if (res.status === 409) {
      const j = await res.json();
      const list = (j.items ?? []).map((i: { name: string; qty: number }) => `${i.name} (${i.qty})`).join(", ");
      setGateError(`${(j.items ?? []).length} item(s) still have Warehouse stock: ${list}. Move them to Whatnot or adjust them out first.`);
      setWhatnotOnly(false);
      return;
    }
    if (!res.ok) { alert(`Save failed (${res.status}). ${await res.text()}`); return; }
    setGateError(null);
    setSaved(true);
```

Render a checkbox labelled **"Whatnot-only mode — hide Warehouse stock and the Move action"**, and render `gateError` beneath it in red when set. Match the existing checkbox markup used by the contacts rows.

- [ ] **Step 5: Inventory table**

`src/app/inventory/page.tsx`: read `const { whatnotOnly } = getSettings(db);` and pass `whatnotOnly={whatnotOnly}` to `InventoryTable`.

`src/components/InventoryTable.tsx`: accept `whatnotOnly?: boolean`. When true, build the column list without the `warehouse` and `whatnot` entries and instead show a single column keyed `remaining` labelled **"In stock"**; do not render the `MoveStock` button in the row actions. When false, everything renders exactly as today.

- [ ] **Step 6: Adjustments form**

`src/components/AdjustmentsLog.tsx`: accept `whatnotOnly?: boolean` from its parent. When true, do not render the channel `<select>` (line ~159) and post `channel: "whatnot"`. The server also forces this (Task 3), so the UI change is cosmetic — do not rely on it alone.

- [ ] **Step 7: Build and test**

Run: `npm test` then `npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/ tests/
git commit -m "feat(inventory): whatnot-only mode hides the split, Move, and channel picker"
```

---

### Task 5: Full verification and smoke

- [ ] **Step 1:** Run `npm test` — Expected: PASS, `tests/lib/db/buckets.test.ts` unmodified and green.
- [ ] **Step 2:** Run `npm run build` — Expected: succeeds.
- [ ] **Step 3:** Confirm `warehouseQty` and `whatnotQty` are untouched: `git diff main -- src/lib/db/inventory.ts | grep -A5 'function warehouseQty'` should show no changes to their bodies.
- [ ] **Step 4: Smoke on a dev copy.** Copy `data/` to a scratch directory and run `DATA_DIR=<copy> npx next dev -p 3010`. Then: (a) with stock present, try enabling the mode in Settings and confirm the blocking error names the items; (b) move all stock to Whatnot, enable the mode, and confirm the Inventory page shows one "In stock" column with no Move button; (c) receive stock and confirm it lands in Whatnot with Warehouse still 0 after turning the mode back off; (d) confirm no dev-server console errors.
- [ ] **Step 5: Final commit** only if fixups were needed.

---

## Self-Review

**Spec coverage:** §1 the setting → Task 1. §2 the gate → Task 2. §3 compensation → Task 3. §4 UI → Task 4. Testing section → Tasks 1-5.

**Ordering rationale:** The flag exists before anything reads it; the gate before the UI that surfaces its error; compensation before the UI hides the controls, so the server is authoritative and the UI is only cosmetic.

**Known risks:** (1) Import cycles from `moves.ts`/`adjustments.ts` importing `settings.ts` — Task 3 Step 4 tells the implementer to stop and report rather than restructure. (2) The `postInvoice` compensation must land before the status flip, since `qtySoldWholesale` counts posted lines. (3) Task 4's test harness was not verified against `tests/api/move-stock.test.ts` — the implementer is told to read and copy it.

## Port note (after completion)

Add this toggle to `docs/PORT-TO-WHATNOT-MANAGER.md` as Feature 10, including the gate rule and the compensating-move technique.
