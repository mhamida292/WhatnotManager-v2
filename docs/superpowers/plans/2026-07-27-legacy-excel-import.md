# Legacy Excel Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Excel backup exported by the older whatnot-business-manager app import into this app, converting its Whatnot name mappings into `item_identifiers` and preserving every row it carries.

**Architecture:** Detection reads the `_meta` sheet's `tables` row. Current-format files keep taking today's strict path untouched. A legacy file takes a new path that wipes the destination, recreates the legacy `product_aliases` table, inserts each sheet's rows using only columns that still exist, then calls the existing `migrate(db)` — which already assigns SKUs, creates `mine` identifiers, converts aliases to `whatnot` identifiers with an abort-on-collision guard, and drops the legacy tables. No new conversion logic is written.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest (node env, no React Testing Library), ExcelJS, Tailwind.

## Global Constraints

- Work on branch `feat/legacy-excel-import`. Never commit to `main`.
- **The current-format path must not change behavior.** `tests/lib/backup/workbook.test.ts` must keep passing unmodified — it is the regression guard for that path.
- Import stays **replace-all**. Do not attempt to merge.
- The whole import runs in **one** `db.transaction` — any failure rolls back and leaves the destination workspace exactly as it was.
- Never weaken `migrateItemIdentifiers`' collision guard (`connection.ts:121-123`). A collision must abort the import, not drop rows.
- Run `npm test` before every commit. Run `npm run build` before the final commit.

---

## File Structure

**Modified:**
- `src/lib/backup/workbook.ts` — legacy detection + legacy import branch
- `src/lib/db/inventory.ts` *or* a small module — `workspaceCounts(db)` for the pre-import warning
- `src/app/api/backup/import/route.ts` — surface the legacy flag and skipped tables
- `src/components/BackupRestore.tsx` — real counts in the confirm, legacy notice in the result

**Created:**
- `src/app/api/backup/summary/route.ts` — GET current workspace row counts
- `tests/lib/backup/legacy-import.test.ts` — the legacy fixture and its cases

---

### Task 1: `workspaceCounts` + summary endpoint

The confirm dialog needs the destination's real counts before anything is deleted.

**Files:**
- Modify: `src/lib/backup/workbook.ts` (add the helper next to `TABLES`, which it iterates)
- Create: `src/app/api/backup/summary/route.ts`
- Test: `tests/lib/backup/workspace-counts.test.ts` (create)

**Interfaces:**
- Produces: `workspaceCounts(db: DB): Record<string, number>` — row count per table in `TABLES`, **omitting tables with zero rows**. Task 3 renders it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";
import { workspaceCounts } from "@/lib/backup/workbook";
import { insertItem } from "@/lib/db/inventory";

describe("workspaceCounts", () => {
  it("is empty for a fresh workspace apart from seeded settings", () => {
    const db = createDb(":memory:");
    const c = workspaceCounts(db);
    expect(c.inventory_items).toBeUndefined();
    expect(c.app_settings).toBe(1); // schema seeds the singleton row
  });

  it("counts rows per table and omits empty tables", () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 3, lotId: null });
    const c = workspaceCounts(db);
    expect(c.inventory_items).toBe(1);
    expect(c.invoices).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/lib/backup/workspace-counts.test.ts`
Expected: FAIL — `workspaceCounts` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/backup/workbook.ts`:

```ts
/** Row count per table, omitting empty ones — used to tell the user exactly what
 *  a replace-all import is about to destroy, before anything is deleted. */
export function workspaceCounts(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const n = (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
    if (n > 0) out[table] = n;
  }
  return out;
}
```

- [ ] **Step 4: Add the endpoint**

Create `src/app/api/backup/summary/route.ts`, mirroring the shape of `src/app/api/backup/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { workspaceCounts } from "@/lib/backup/workbook";

export async function GET() {
  return NextResponse.json({ counts: workspaceCounts(await dbForRequest()) });
}
```

- [ ] **Step 5: Run the tests and commit**

Run: `npm test` — Expected: PASS.

```bash
git add src/lib/backup/workbook.ts src/app/api/backup/summary/route.ts tests/
git commit -m "feat(backup): workspaceCounts + summary endpoint for the import warning"
```

---

### Task 2: Legacy detection and import

The core task. Read `src/lib/backup/workbook.ts` fully before starting.

**Files:**
- Modify: `src/lib/backup/workbook.ts`
- Test: `tests/lib/backup/legacy-import.test.ts` (create)

**Interfaces:**
- Consumes: `TABLES`, `APP_MARKER`, `columns()`, `cellValue()`, `headerOf()` — all already in this file.
- Produces: `importWorkbook` returns `{ counts: Record<string, number>; legacy: boolean; skipped: string[] }`. `skipped` lists sheet names present in the file but not imported (e.g. `brother_transactions`). Task 3 renders both.

- [ ] **Step 1: Write the fixture builder and the failing tests**

Create `tests/lib/backup/legacy-import.test.ts`. Build a workbook in the OLD shape — the legacy table list, a `product_aliases` sheet, a `brother_transactions` sheet, and no `inventory_moves`/`item_identifiers`/`payroll_entries` sheets:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { createDb } from "@/lib/db/connection";
import { importWorkbook, BackupError } from "@/lib/backup/workbook";

const LEGACY_TABLES = [
  "lots", "inventory_items", "invoices", "invoice_lines", "item_purchases",
  "inventory_adjustments", "product_aliases", "brother_transactions",
  "shows", "show_line_items", "ledger_transactions", "expenses", "expense_items",
  "app_settings", "giveaway_items", "show_giveaway_allocations", "bundle_components",
];

/** A workbook shaped like the old whatnot-business-manager export. `sheets` maps
 *  table name -> [header, ...rows]. Tables omitted from `sheets` get a header-only sheet. */
async function legacyWorkbook(sheets: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const meta = wb.addWorksheet("_meta");
  meta.addRow(["key", "value"]);
  meta.addRow(["app", "whatnot-business-manager"]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["tables", LEGACY_TABLES.join(",")]);
  for (const t of LEGACY_TABLES) {
    const ws = wb.addWorksheet(t);
    for (const row of sheets[t] ?? [["id"]]) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("legacy import", () => {
  it("imports a legacy backup and converts product_aliases into whatnot identifiers", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [
        ["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"],
        [1, "Blue Widget", 250, 10, null],
        [2, "Red Gadget", 500, 4, null],
      ],
      product_aliases: [
        ["id", "product_name", "item_id"],
        [1, "Blue Widget Squishy", 1],
        [2, "Red Gadget Mini", 2],
      ],
      brother_transactions: [["id", "kind", "qty"], [1, "gave_to_brother", 3]],
    });

    const db = createDb(":memory:");
    const res = await importWorkbook(db, buf);

    expect(res.legacy).toBe(true);
    expect(res.skipped).toContain("brother_transactions");
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(2);

    // aliases became whatnot identifiers
    const whatnot = db.prepare("SELECT code FROM item_identifiers WHERE source = 'whatnot' ORDER BY code").all() as any[];
    expect(whatnot.map((r) => r.code)).toEqual(["Blue Widget Squishy", "Red Gadget Mini"]);

    // every item got a SKU and a 'mine' identifier
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE sku IS NOT NULL AND sku <> ''").get() as any).c).toBe(2);
    expect((db.prepare("SELECT COUNT(*) c FROM item_identifiers WHERE source = 'mine'").get() as any).c).toBe(2);

    // legacy tables are gone
    const legacyLeft = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('product_aliases','brother_transactions')"
    ).all();
    expect(legacyLeft).toEqual([]);
  });

  it("fills columns this app added since, using their schema defaults", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"], [1, "A", 100, 1, null]],
      invoices: [["id", "supplier", "invoice_date", "status"], [1, "Acme", "2026-01-01", "draft"]],
    });
    const db = createDb(":memory:");
    await importWorkbook(db, buf);
    // `direction` was added later with DEFAULT 'purchase'
    expect((db.prepare("SELECT direction FROM invoices WHERE id = 1").get() as any).direction).toBe("purchase");
  });

  it("rolls back completely when two aliases collide on one code", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"], [1, "A", 100, 1, null], [2, "B", 100, 1, null]],
      product_aliases: [["id", "product_name", "item_id"], [1, "Same Name", 1], [2, "Same Name", 2]],
    });
    const db = createDb(":memory:");
    const before = (db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c;

    await expect(importWorkbook(db, buf)).rejects.toThrow();

    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(before);
  });
});
```

Note on the third case: `product_aliases.product_name` is `UNIQUE` in the legacy schema, so the collision may surface at insert time rather than in `migrateItemIdentifiers`. Either is acceptable — what the test asserts is that it **throws and rolls back**. If you must adjust how the collision is provoked to exercise the guard, keep the rollback assertion intact.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/lib/backup/legacy-import.test.ts`
Expected: FAIL — the current importer throws `Backup is missing the "inventory_moves" sheet.`

- [ ] **Step 3: Add detection**

In `src/lib/backup/workbook.ts`, after the `_meta` marker check, read the file's own table list:

```ts
function metaTables(meta: ExcelJS.Worksheet): string[] {
  let list = "";
  meta.eachRow((row) => { if (String(row.getCell(1).value) === "tables") list = String(row.getCell(2).value); });
  return list ? list.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
```

A file is legacy when its list differs from the current one:

```ts
const fileTables = metaTables(meta);
const isLegacy = fileTables.length > 0 &&
  fileTables.join(",") !== [...TABLES].join(",");
```

- [ ] **Step 4: Implement the legacy branch**

When `isLegacy`, run this instead of the strict loop. Keep the strict path exactly as-is for non-legacy files.

```ts
  // Legacy backup (older whatnot-business-manager schema). Stage the file's own
  // tables, then let migrate() perform the upgrade — the same path a legacy .db
  // file takes when opened by this app, so there is no second conversion to keep
  // in sync. See docs/superpowers/specs/2026-07-27-legacy-excel-import-design.md
  const skipped: string[] = [];
  const staged: { table: string; cols: string[]; rows: (string | number | null)[][] }[] = [];
  for (const table of fileTables) {
    const ws = wb.getWorksheet(table);
    if (!ws) continue;
    const header = headerOf(ws);
    const rows: (string | number | null)[][] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      if (!row.hasValues) continue;
      rows.push(header.map((_, j) => cellValue(row.getCell(j + 1).value)));
    }
    staged.push({ table, cols: header, rows });
  }

  const counts: Record<string, number> = {};
  db.transaction(() => {
    for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
    // Recreate the legacy alias table so migrate() can convert it.
    db.exec(`CREATE TABLE IF NOT EXISTS product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id)
    )`);
    for (const { table, cols, rows } of staged) {
      const live = columns(db, table);
      if (live.length === 0) { skipped.push(table); continue; }   // table no longer exists here
      const keep = cols.map((c, i) => ({ c, i })).filter(({ c }) => live.includes(c));
      if (keep.length === 0) { skipped.push(table); continue; }
      const ins = db.prepare(
        `INSERT INTO ${table} (${keep.map(({ c }) => `"${c}"`).join(", ")}) VALUES (${keep.map(() => "?").join(", ")})`,
      );
      for (const row of rows) ins.run(...keep.map(({ i }) => row[i]));
      counts[table] = rows.length;
    }
    migrate(db);   // assigns SKUs, builds identifiers, converts + drops product_aliases
  })();

  return { counts, legacy: true, skipped };
```

Import `migrate` from `@/lib/db/connection` at the top of the file.

**`brother_transactions` is skipped by the `live.length === 0` branch**, because `migrate()` has already dropped that table from any DB this app opens — `columns()` returns `[]` for it. Do not special-case it by name.

- [ ] **Step 5: Return the new shape from the strict path too**

The strict path must now return `{ counts, legacy: false, skipped: [] }` so callers have one shape. Do not change anything else about it.

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS, **including `tests/lib/backup/workbook.test.ts` unmodified** — that file is the regression guard proving the current-format path still behaves identically.

- [ ] **Step 7: Commit**

```bash
git add src/lib/backup/workbook.ts tests/
git commit -m "feat(backup): import legacy whatnot-finances workbooks via migrate()"
```

---

### Task 3: Surface it in the UI

**Files:**
- Modify: `src/app/api/backup/import/route.ts`, `src/components/BackupRestore.tsx`

**Interfaces:**
- Consumes: `workspaceCounts` via `GET /api/backup/summary` (Task 1); `{ counts, legacy, skipped }` from the import route (Task 2).

- [ ] **Step 1: Pass the new fields through the route**

In `src/app/api/backup/import/route.ts`, change the success response to include them:

```ts
    const { counts, legacy, skipped } = await importWorkbook(await dbForRequest(), buf);
    return NextResponse.json({ ok: true, counts, legacy, skipped });
```

- [ ] **Step 2: Put real counts in the confirm**

`src/components/BackupRestore.tsx` currently confirms with a generic sentence (line 20). Replace that with the destination's actual contents, fetched first:

```ts
    const sum = await fetch("/api/backup/summary").then((r) => r.json()).catch(() => null);
    const counts: Record<string, number> = sum?.counts ?? {};
    const notable = ["inventory_items", "invoices", "ledger_transactions", "shows", "expenses"]
      .filter((t) => counts[t])
      .map((t) => `${counts[t]} ${t.replace(/_/g, " ")}`);
    const what = notable.length ? notable.join(", ") : "the current (empty) workspace";
    if (!confirm(`This REPLACES all current data with the file's contents and can't be undone.\n\nAbout to delete: ${what}.\n\nContinue?`)) return;
```

- [ ] **Step 3: Report a legacy import honestly**

After a successful restore, when `data.legacy` is true, append a note to the success message naming what was skipped, e.g.:

```ts
      const total = Object.values(data.counts as Record<string, number>).reduce((a, b) => a + b, 0);
      let text = `Restored ${total} rows across ${Object.keys(data.counts).length} tables.`;
      if (data.legacy) {
        text += " Imported from an older backup — Whatnot name mappings were converted to identifiers and SKUs were assigned.";
        if (data.skipped?.length) text += ` Not imported: ${data.skipped.join(", ")}.`;
      }
      setMsg(text);
```

- [ ] **Step 4: Build and test**

Run: `npm test` then `npm run build` — Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/backup/import/route.ts src/components/BackupRestore.tsx
git commit -m "feat(backup): show what an import will destroy and flag legacy restores"
```

---

### Task 4: Verify against the real legacy database

This is the task that proves the feature actually solves the owner's problem, using their real data rather than a fixture.

**Files:** none modified — verification only.

- [ ] **Step 1:** Run `npm test` — Expected: PASS, `tests/lib/backup/workbook.test.ts` unmodified.
- [ ] **Step 2:** Run `npm run build` — Expected: succeeds.
- [ ] **Step 3: Produce a real legacy workbook.** The sibling app lives at `/home/mhamida/Desktop/Projects/Software Dev/whatnot app`. Copy `data/ws/1.db` to a scratch directory (never modify the original), and from that repo run its own `exportWorkbook` against the copy to produce a genuine legacy `.xlsx`. If running that app's code is impractical, construct the workbook directly from the copied DB using its `TABLES` list and `PRAGMA table_info`, writing one sheet per table plus the `_meta` sheet — the format is fully specified in that repo's `src/lib/backup/workbook.ts`.
- [ ] **Step 4: Import it here.** Against a scratch copy of this app's data (never `data/` itself), import that workbook and assert against the source DB's own numbers: 68 inventory items, 4,859 ledger transactions, 114 invoice lines, 102 item purchases, 27 shows, 22 expenses, 83 bundle components, and 74 `whatnot` identifiers converted from `product_aliases`, plus 68 `mine` identifiers.
- [ ] **Step 5:** Record the before/after table in the report. Any table whose count does not match is a defect — report it rather than adjusting the expectation.
- [ ] **Step 6: Final commit** only if fixups were needed.

---

## Self-Review

**Spec coverage:** §1 detection → Task 2 Step 3. §2 legacy import → Task 2 Step 4. §3 safety (atomic, informed destruction, honest reporting) → Task 2 Step 4 (single transaction) and Task 3. §4 what doesn't come across → Task 3 Step 3. Testing section → Tasks 2 and 4.

**Spec correction to apply:** the spec says the existing import "warns about nothing". That is wrong — `BackupRestore.tsx:20` already has a generic `confirm()`. The work is adding real counts to it, not adding a missing warning. Fix that sentence in the spec as part of Task 3's commit.

**Known risks:** (1) The legacy `_meta` order is trusted for FK-safe insertion; a violation rolls back rather than corrupting. (2) Every `NOT NULL` column added by `migrate()` was verified to carry a `DEFAULT`, so legacy rows missing them are safe — Task 2's second test pins one such column (`invoices.direction`). (3) The collision test may trip the legacy `UNIQUE(product_name)` constraint before reaching `migrateItemIdentifiers`; the plan accepts either, since the assertion is about rollback.

## Port note (after completion)

This feature is specific to migrating *off* the sibling app, so it does **not** belong in `docs/PORT-TO-WHATNOT-MANAGER.md` as a feature to port. Add nothing there.
