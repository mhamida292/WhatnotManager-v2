# Remove the Brother Concept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unreachable `brother_transactions` concept end to end — table, DB functions, calc inputs, UI strings, and backup sheet — without changing any number the app displays.

**Architecture:** Pure deletion, bottom-up. Tests are ported before code is removed so stock-math coverage survives. `qtyGivenToBrother` is dropped from `qtySold`, which is the concept's only path into real numbers; `warehouseQty` is derived (`qtyRemaining − whatnotQty`) and needs no edit. The Excel backup drops one entry from `TABLES`; `importWorkbook` fetches sheets by name from that list, so older backups containing a brother sheet restore cleanly with no import change.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest (node env, no React Testing Library), ExcelJS.

## Global Constraints

- Work on branch `feat/whatnot-only-inventory`. Never commit to `main`.
- **No displayed number may change.** Every brother contribution is already 0 in live data (one inert row: `bought_from_brother`, `qty: 0`, `amount_cents: 0`, NULL costs).
- Schema changes go in the `SCHEMA` string **and** in `migrate(db)` in `src/lib/db/connection.ts`, guarded to be idempotent (SQLite has no `ADD COLUMN IF NOT EXISTS`; follow the existing `PRAGMA table_info` pattern).
- Do not delete a test to make it pass. Tests that used brother rows as a "sold" source must be **ported** to another sale path.
- Run `npm test` before every commit. Run `npm run build` before the final commit.

---

## File Structure

**Modified:**
- `src/lib/db/schema.ts` — drop the `brother_transactions` CREATE TABLE
- `src/lib/db/connection.ts` — add the idempotent DROP TABLE to `migrate`
- `src/lib/db/inventory.ts` — remove `insertBrotherTxn`, `qtyGivenToBrother`, the `qtySold` term, the `deleteItem` detach, the `DeleteImpact.brotherTxns` field, and the table-list entry at line 309
- `src/lib/calc/inventory-spend.ts` — remove `brotherShipmentOwnerCost`, `BrotherTxnKind`, `BrotherTxnForSpend`; narrow `netInventorySpend`
- `src/lib/calc/dashboard.ts` — drop the brother query and argument
- `src/app/inventory/page.tsx` — drop the brother query and argument
- `src/app/inventory/[id]/page.tsx` — drop the "Sold — gave to brother" row
- `src/components/DeleteItemButton.tsx`, `src/lib/ui/bulk-delete-message.ts` — drop the message branches
- `src/lib/db/admin.ts` — drop the reset DELETE
- `src/lib/backup/workbook.ts` — drop `"brother_transactions"` from `TABLES`

**Tests modified:** `tests/lib/db/inventory.test.ts` (ported), `tests/lib/calc/inventory-spend.test.ts`, `tests/lib/db/admin.test.ts`, `tests/lib/db/connection.test.ts`, `tests/lib/db/merge-items.test.ts`, `tests/lib/ui/bulk-delete-message.test.ts`

**Tests created:** a case in `tests/lib/backup/` proving an old workbook with a brother sheet restores cleanly.

---

### Task 1: Port the stock-math tests off brother rows

`tests/lib/db/inventory.test.ts` uses `insertBrotherTxn` at five sites purely as a convenient source of "sold" units. This task rewrites them to use a confirmed `show_line_items` row instead — same arithmetic, a sale path that still exists. The production code is untouched here, so **the suite must stay green throughout this task**.

**Files:**
- Modify: `tests/lib/db/inventory.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an `inventory.test.ts` with zero `insertBrotherTxn` references, so Task 3 can delete the function safely.

- [ ] **Step 1: Add a local helper at the top of the `describe` block**

```ts
/** Records `qty` confirmed legacy show sales for an item — a sale path that
 *  counts toward qtySold, replacing the retired brother rows. */
function sellOnShow(db: any, itemId: number, qty: number, date = "2026-06-10") {
  db.prepare("INSERT INTO shows (show_date) VALUES (?)").run(date);
  const showId = (db.prepare("SELECT id FROM shows ORDER BY id DESC LIMIT 1").get() as any).id;
  db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
              VALUES (?, 'Ported Sale', ?, 'confirmed', ?)`).run(showId, qty, itemId);
}
```

- [ ] **Step 2: Port the `qtyRemaining` case (around line 30)**

Rename it and swap the brother row for a second confirmed show line. The item already has a 5-unit confirmed sale and a 2-unit cancelled one; add 3 more sold units so the expected total is unchanged:

```ts
  it("computes qty remaining = purchased - confirmed sold", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = db.prepare("SELECT id FROM shows").get() as any;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId.id, id);
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 2, 'cancelled', ?)`).run(showId.id, id);
    sellOnShow(db, id, 3);
    expect(qtySoldByItem(db, id)).toBe(8);
    expect(qtyRemaining(db, id)).toBe(20 - 8);
  });
```

- [ ] **Step 3: Port the `deleteItem` case (around line 93)**

Brother is one of two things this asserts gets detached. Drop the brother half; keep the show-line half, which is the behavior that still exists:

```ts
  it("deleteItem nulls item_id on referencing legacy show rows (keeps the rows)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = (db.prepare("SELECT id FROM shows").get() as any).id;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId, id);

    deleteItem(db, id);

    expect(db.prepare("SELECT COUNT(*) n FROM show_line_items").get()).toMatchObject({ n: 1 });
    expect(db.prepare("SELECT item_id FROM show_line_items").get()).toMatchObject({ item_id: null });
  });
```

- [ ] **Step 4: Port the two `deleteImpact` cases (around line 135)**

Remove the `insertBrotherTxn` line from the first, and drop `brotherTxns` from both expected objects:

```ts
    expect(deleteImpact(db, id)).toEqual({ mappings: 1, ledgerSales: 2, showLineSales: 1 });
```
```ts
    expect(deleteImpact(db, id)).toEqual({ mappings: 0, ledgerSales: 0, showLineSales: 0 });
```

Also rename the first: `"deleteImpact reports mappings, ledger sales, and legacy show sales"`.

- [ ] **Step 5: Port the two `setItemRemaining` cases (around lines 147 and 159)**

```ts
  it("setItemRemaining stores a delta so remaining equals the target", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    sellOnShow(db, item, 3); // sold = 3
    expect(qtyRemaining(db, item)).toBe(7);

    setItemRemaining(db, item, 4);
    expect(qtyRemaining(db, item)).toBe(4);
  });

  it("the remaining adjustment is a persistent delta, not a freeze", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setItemRemaining(db, item, 8); // base 10 -> adjustment -2
    expect(qtyRemaining(db, item)).toBe(8);
    sellOnShow(db, item, 1); // one more sold
    expect(qtyRemaining(db, item)).toBe(7); // dropped from the corrected baseline
  });
```

- [ ] **Step 6: Remove `insertBrotherTxn` from the import list at the top of the file**

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS. Nothing in production code changed yet, so a failure here means a port is wrong — fix it before continuing.

- [ ] **Step 8: Verify no references remain**

Run: `grep -in brother tests/lib/db/inventory.test.ts`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add tests/lib/db/inventory.test.ts
git commit -m "test(inventory): port stock-math cases off brother rows to show sales"
```

---

### Task 2: Narrow `netInventorySpend` to item costs only

**Files:**
- Modify: `src/lib/calc/inventory-spend.ts`
- Modify: `src/lib/calc/dashboard.ts:24-25`, `src/app/inventory/page.tsx:36-37`
- Test: `tests/lib/calc/inventory-spend.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `netInventorySpend(input: { itemCostsCents: number[] }): number` — Task 3 does not use it, but no other call site may pass `brotherTxns` after this task.

- [ ] **Step 1: Rewrite the test file to the new signature**

```ts
import { describe, it, expect } from "vitest";
import { netInventorySpend } from "@/lib/calc/inventory-spend";

describe("netInventorySpend", () => {
  it("sums item costs", () => {
    expect(netInventorySpend({ itemCostsCents: [1000, 250, 5] })).toBe(1255);
  });

  it("is zero for no items", () => {
    expect(netInventorySpend({ itemCostsCents: [] })).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/calc/inventory-spend.test.ts`
Expected: FAIL — TypeScript complains that `brotherTxns` is missing.

- [ ] **Step 3: Replace `src/lib/calc/inventory-spend.ts` entirely**

```ts
export function netInventorySpend(input: { itemCostsCents: number[] }): number {
  return input.itemCostsCents.reduce((a, b) => a + b, 0);
}
```

- [ ] **Step 4: Update both call sites**

In `src/lib/calc/dashboard.ts`, delete the `const brother = ...` query line and change the call to:

```ts
  const netInventorySpendCents = netInventorySpend({ itemCostsCents: itemCosts });
```

In `src/app/inventory/page.tsx`, delete the `const brother = ...` query line and change the call to:

```ts
  const spend = netInventorySpend({ itemCostsCents: itemCosts });
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/inventory-spend.ts src/lib/calc/dashboard.ts src/app/inventory/page.tsx tests/lib/calc/inventory-spend.test.ts
git commit -m "refactor(spend): netInventorySpend takes item costs only"
```

---

### Task 3: Remove the DB layer and the `DeleteImpact` field

**Files:**
- Modify: `src/lib/db/inventory.ts` (lines 47-53, 63, 74, 78-96, 102-106, 130, 309)
- Modify: `src/lib/db/admin.ts:15`
- Modify: `src/components/DeleteItemButton.tsx:21`, `src/lib/ui/bulk-delete-message.ts:12`
- Modify: `src/app/inventory/[id]/page.tsx:4,44,58,65`
- Test: `tests/lib/ui/bulk-delete-message.test.ts`, `tests/lib/db/admin.test.ts`, `tests/lib/db/merge-items.test.ts`

**Interfaces:**
- Consumes: `inventory.test.ts` free of `insertBrotherTxn` (Task 1).
- Produces: `DeleteImpact { mappings: number; ledgerSales: number; showLineSales: number }` — no `brotherTxns`.

- [ ] **Step 1: Update `bulk-delete-message.test.ts` and `admin.test.ts` first**

In `tests/lib/ui/bulk-delete-message.test.ts`, remove `brotherTxns` from every impact object literal and delete any case asserting brother copy. In `tests/lib/db/admin.test.ts` and `tests/lib/db/merge-items.test.ts`, remove brother inserts and assertions.

- [ ] **Step 2: Run to confirm the expected failure**

Run: `npm test`
Expected: FAIL — TypeScript reports `brotherTxns` missing from object literals that still declare it in the interface. This confirms the tests drive the change.

- [ ] **Step 3: Edit `src/lib/db/inventory.ts`**

Delete `insertBrotherTxn` (lines 78-96) and `qtyGivenToBrother` (lines 102-106) entirely. Then:

```ts
export interface DeleteImpact { mappings: number; ledgerSales: number; showLineSales: number; }
```

Remove the `brotherTxns:` line from the `deleteImpact` return object. Remove this line from `deleteItem`:

```ts
    db.prepare("UPDATE brother_transactions SET item_id = NULL WHERE item_id = ?").run(itemId);
```

Change `qtySold` (line 130) to:

```ts
/** Total units sold: ledger sales + confirmed legacy show sales + wholesale invoices. */
export function qtySold(db: DB, itemId: number): number {
  return qtySoldFromLedger(db, itemId) + qtySoldByItem(db, itemId) + qtySoldWholesale(db, itemId);
}
```

Remove `"brother_transactions"` from the table list at line 309, remove the `brotherShipmentOwnerCost` import at line 3, and update the `deleteItem` doc comment (line 47) to drop the words "and brother".

Leave `warehouseQty` alone — it is `qtyRemaining − whatnotQty` and never referenced brother directly.

- [ ] **Step 4: Edit the remaining consumers**

`src/lib/db/admin.ts`: delete the `DELETE FROM brother_transactions;` line.

`src/components/DeleteItemButton.tsx`: delete the line beginning `if (impact.brotherTxns > 0)`, and drop "brother" from the doc comment on line 7.

`src/lib/ui/bulk-delete-message.ts`: delete the line beginning `if (impact.brotherTxns > 0)`.

`src/app/inventory/[id]/page.tsx`: remove `qtyGivenToBrother` from the import (line 4), delete `const brother = qtyGivenToBrother(db, itemId);` (line 44), change line 58 to `const totalSold = ledgerSold + legacySold + wholesale;`, and delete the `["Sold — gave to brother", brother],` breakdown row (line 65).

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Verify the source is clean**

Run: `grep -rin brother src/ tests/`
Expected: no output. (Docs under `docs/` keep their historical references — do not edit them.)

- [ ] **Step 7: Commit**

```bash
git add src/ tests/
git commit -m "refactor(inventory): remove the brother concept from the DB and UI layers"
```

---

### Task 4: Drop the table and the backup sheet

**Files:**
- Modify: `src/lib/db/schema.ts:75-87`
- Modify: `src/lib/db/connection.ts` (inside `migrate`)
- Modify: `src/lib/backup/workbook.ts:12`
- Test: `tests/lib/db/connection.test.ts`, and a new case in `tests/lib/backup/`

**Interfaces:**
- Consumes: a codebase with no brother references (Task 3).
- Produces: databases without a `brother_transactions` table; workbooks without that sheet.

- [ ] **Step 1: Write the failing migration test**

Add to `tests/lib/db/connection.test.ts`:

```ts
  it("migrate drops a legacy brother_transactions table and is idempotent", () => {
    const db = createDb(":memory:");
    db.prepare(`CREATE TABLE IF NOT EXISTS brother_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, qty INTEGER)`).run();
    db.prepare("INSERT INTO brother_transactions (kind, qty) VALUES ('gave_to_brother', 3)").run();

    migrate(db);
    migrate(db); // idempotent

    const t = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='brother_transactions'"
    ).get();
    expect(t).toBeUndefined();
  });
```

Make sure `migrate` is imported in that file; add it to the existing import if absent.

- [ ] **Step 2: Write the failing backup test**

Create `tests/lib/backup/legacy-brother-sheet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { createDb } from "@/lib/db/connection";
import { exportWorkbook, importWorkbook } from "@/lib/backup/workbook";

describe("restoring an older backup", () => {
  it("ignores a leftover brother_transactions sheet", async () => {
    const db = createDb(":memory:");
    const buf = await exportWorkbook(db);

    // Simulate a backup taken before the concept was removed.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.addWorksheet("brother_transactions");
    ws.addRow(["id", "kind", "qty"]);
    ws.addRow([1, "gave_to_brother", 3]);
    const legacy = Buffer.from(await wb.xlsx.writeBuffer());

    const target = createDb(":memory:");
    await expect(importWorkbook(target, legacy)).resolves.not.toThrow();

    const t = target.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='brother_transactions'"
    ).get();
    expect(t).toBeUndefined();
  });
});
```

If `importWorkbook` has a different signature or argument order, match the existing call in the sibling backup tests rather than this sketch.

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run tests/lib/db/connection.test.ts tests/lib/backup/legacy-brother-sheet.test.ts`
Expected: FAIL — the table still exists after `migrate`, and the export still lists the sheet.

- [ ] **Step 4: Implement**

In `src/lib/db/schema.ts`, delete the whole `CREATE TABLE IF NOT EXISTS brother_transactions (...)` block (lines 75-87).

In `src/lib/db/connection.ts`, inside `migrate(db)`, alongside the other guarded migrations:

```ts
  // Retired 2026-07-27: the brother cost-sharing concept was removed. The table
  // was unreachable (no writer) and its rows contributed 0 to every calculation.
  db.prepare("DROP TABLE IF EXISTS brother_transactions").run();
```

In `src/lib/backup/workbook.ts`, remove `"brother_transactions"` from the `TABLES` array so line 12 reads:

```ts
  "item_identifiers", "shows", "show_line_items",
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS, including the existing backup round-trip test.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/backup/workbook.ts tests/
git commit -m "feat(db): drop the brother_transactions table and backup sheet"
```

---

### Task 5: Full verification and smoke

- [ ] **Step 1:** Run `npm test` — Expected: PASS, with no fewer tests than before this plan started (ports, not deletions).
- [ ] **Step 2:** Run `npm run build` — Expected: succeeds.
- [ ] **Step 3:** Run `grep -rin brother src/ tests/` — Expected: no output.
- [ ] **Step 4: Smoke on a dev copy.** Copy `data/` to a scratch directory and run `DATA_DIR=<copy> npx next dev -p 3010`. Confirm: the Inventory page loads and its spend figure is unchanged; an item detail page loads with no "gave to brother" row in the sold breakdown; deleting an item shows a warning without brother wording; Settings → export produces a workbook that re-imports cleanly. Confirm no dev-server console errors.
- [ ] **Step 5: Final commit** only if fixups were needed.

---

## Self-Review

**Spec coverage:** Schema/migration → Task 4. DB layer → Task 3. Calc layer → Task 2. UI → Task 3. Admin → Task 3. Backup → Task 4. Test porting → Task 1. Old-backup restore → Task 4. Migration idempotence → Task 4. All spec sections are covered.

**Ordering rationale:** Tests are ported first (Task 1) so the suite stays green and coverage loss is impossible; the table is dropped last (Task 4) so every reader is gone before the data is.

**Known risk:** `importWorkbook`'s exact signature was not read while writing this plan. Task 4 Step 2 instructs the implementer to match the sibling backup tests if the sketch differs.

## Port note (after completion)

Add this removal to `docs/PORT-TO-WHATNOT-MANAGER.md` as a feature entry, noting that the sibling app may still have a live brother UI and must check before deleting.
