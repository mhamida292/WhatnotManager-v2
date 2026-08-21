# Unified Item Identifiers — Plan 1: Data Backbone — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Whatnot-only `product_aliases` mapping with a unified `item_identifiers` table and give every inventory item a stable auto-generated `sku`, cutting the whole app over to the new table with identical runtime behavior.

**Architecture:** Add `inventory_items.sku` (auto-generated, unique) as each item's identity, and a single `item_identifiers(item_id, source, code)` table that supersedes `product_aliases`. An automatic, idempotent migration in `createDb`'s `migrate()` back-fills SKUs, seeds one `source='mine'` identifier per item, and copies existing aliases in as `source='whatnot'`. The resolver (`resolveItemId`) and every SQL join that referenced `product_aliases` are re-pointed at `item_identifiers`. No sales/invoice/purchase `item_id` is rewritten, so no stock or profit number changes.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest.

## Global Constraints

- SQLite via better-sqlite3; DB opened with `PRAGMA foreign_keys = ON` (`src/lib/db/connection.ts:15`). Cascades are live.
- Schema is applied fresh via `SCHEMA` then patched for existing DBs in `migrate(db)` — SQLite has no `ADD COLUMN IF NOT EXISTS`, so column adds are guarded by `PRAGMA table_info` checks (existing pattern in `connection.ts`).
- Whatnot product names are stored **base-normalized** (`baseProductName` strips a trailing ` #N`) — every `code` written for a `source='whatnot'` identifier MUST pass through `baseProductName`, exactly as `setAlias` does today.
- Tests build an in-memory DB with `createDb(":memory:")` (pattern: `tests/api/move-stock.test.ts:7`). Run the suite with `npm test`.
- Every schema-carrying table must appear in the backup `TABLES` list (`src/lib/backup/workbook.ts:8`) or backup/restore silently drops it (regression guarded historically — commit `7f1cacb`).

**Scope note — deliberate deferral:** The design spec calls for dropping the `UNIQUE` constraint on `inventory_items.name`. That requires a full SQLite table rebuild (SQLite can't drop a column constraint in place) with all inbound FKs preserved — disproportionate risk for this plan, and **not required** for the user's two-supplier / two-Whatnot-name scenarios, because matching keys off `sku`/identifiers, never the name. Renaming to any *non-colliding* name already works today. This plan keeps `name UNIQUE`. If same-name items are ever needed, do the rebuild as its own focused change.

---

### Task 1: Schema + automatic migration for `sku` and `item_identifiers`

**Files:**
- Modify: `src/lib/db/schema.ts` (add `sku` to `inventory_items`; add `item_identifiers`; remove `product_aliases`)
- Modify: `src/lib/db/connection.ts` (migration inside `migrate()`; add `migrateItemIdentifiers` helper)
- Test: `tests/lib/db/item-identifiers-migration.test.ts` (create)

**Interfaces:**
- Produces: table `item_identifiers(id, item_id, source IN ('mine','supplier','whatnot'), code, supplier_label)` with `UNIQUE(code)`; column `inventory_items.sku TEXT UNIQUE`. Every existing item ends with a non-null unique `sku` and a `source='mine'` identifier whose `code = sku`; every former `product_aliases` row becomes a `source='whatnot'` identifier; `product_aliases` no longer exists.

- [ ] **Step 1: Write the failing migration test**

Create `tests/lib/db/item-identifiers-migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createDb } from "@/lib/db/connection";

/** Build a DB shaped like the OLD schema (product_aliases, no sku/identifiers),
 *  seed an item + alias, then reopen through createDb to trigger migration. */
function legacyDbFile(): string {
  const path = `/tmp/uii-mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const raw = new Database(path);
  raw.exec(`
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
      unit_cost_cents INTEGER NOT NULL, qty_purchased INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL UNIQUE,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id));
    INSERT INTO inventory_items (id, name, unit_cost_cents, qty_purchased) VALUES (1,'Highland Cow',200,10);
    INSERT INTO product_aliases (product_name, item_id) VALUES ('Highland Cow Squishy',1);
    INSERT INTO product_aliases (product_name, item_id) VALUES ('Cow Plush',1);
  `);
  raw.close();
  return path;
}

describe("item_identifiers migration", () => {
  it("adds sku, seeds a 'mine' identifier, and copies aliases to 'whatnot'", () => {
    const db = createDb(legacyDbFile());

    const item = db.prepare("SELECT sku FROM inventory_items WHERE id = 1").get() as { sku: string };
    expect(item.sku).toBeTruthy();

    const rows = db.prepare(
      "SELECT source, code FROM item_identifiers WHERE item_id = 1 ORDER BY source, code"
    ).all() as { source: string; code: string }[];
    expect(rows).toEqual([
      { source: "mine", code: item.sku },
      { source: "whatnot", code: "Cow Plush" },
      { source: "whatnot", code: "Highland Cow Squishy" },
    ]);

    const hasOld = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='product_aliases'"
    ).get();
    expect(hasOld).toBeUndefined();
  });

  it("is idempotent (re-opening the same file does not duplicate identifiers)", () => {
    const path = legacyDbFile();
    createDb(path).close();
    const db2 = createDb(path);
    const n = db2.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = 1").get() as { n: number };
    expect(n.n).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- item-identifiers-migration`
Expected: FAIL (no `sku` column / no `item_identifiers` table).

- [ ] **Step 3: Update `schema.ts`**

In `src/lib/db/schema.ts`, add `sku TEXT UNIQUE` to `inventory_items` (after the `name` line):

```sql
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sku TEXT UNIQUE,
  unit_cost_cents INTEGER NOT NULL,
  qty_purchased INTEGER NOT NULL DEFAULT 0,
  qty_samples INTEGER NOT NULL DEFAULT 0,
  qty_adjustment INTEGER NOT NULL DEFAULT 0,
  lot_id INTEGER REFERENCES lots(id),
  archived_at TEXT,
  location TEXT
);
```

Delete the `product_aliases` `CREATE TABLE` block (lines 109–113) and replace it with:

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

- [ ] **Step 4: Add the migration to `connection.ts`**

In `src/lib/db/connection.ts`, inside `migrate(db)` (after the existing `inventory_items` column guards, near line 37), add:

```typescript
  if (!cols.includes("sku")) {
    db.exec("ALTER TABLE inventory_items ADD COLUMN sku TEXT");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS item_identifiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('mine','supplier','whatnot')),
    code TEXT NOT NULL, supplier_label TEXT)`);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_item_identifiers_code ON item_identifiers(code)");
  migrateItemIdentifiers(db);
```

Then add this helper function at the bottom of `connection.ts` (module scope, alongside the other `migrate*` helpers):

```typescript
/** Back-fill SKUs, seed one 'mine' identifier per item, and fold any legacy
 *  product_aliases rows into item_identifiers as 'whatnot'. Idempotent. */
function migrateItemIdentifiers(db: DB): void {
  const needSku = db.prepare("SELECT id FROM inventory_items WHERE sku IS NULL OR sku = ''").all() as { id: number }[];
  for (const { id } of needSku) {
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(`ITEM-${String(id).padStart(5, "0")}`, id);
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku)");

  db.exec(`INSERT OR IGNORE INTO item_identifiers (item_id, source, code)
    SELECT i.id, 'mine', i.sku FROM inventory_items i
    WHERE NOT EXISTS (SELECT 1 FROM item_identifiers ii WHERE ii.item_id = i.id AND ii.source = 'mine')`);

  const hasAliases = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_aliases'").get();
  if (hasAliases) {
    db.exec(`INSERT OR IGNORE INTO item_identifiers (item_id, source, code)
      SELECT item_id, 'whatnot', product_name FROM product_aliases`);
    db.exec("DROP TABLE product_aliases");
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- item-identifiers-migration`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts tests/lib/db/item-identifiers-migration.test.ts
git commit -m "feat(db): item_identifiers table + sku column with auto-migration"
```

---

### Task 2: `insertItem` generates a SKU + seeds a 'mine' identifier

**Files:**
- Modify: `src/lib/db/inventory.ts:15-19` (`insertItem`)
- Test: `tests/lib/db/insert-item-sku.test.ts` (create)

**Interfaces:**
- Consumes: `item_identifiers`, `inventory_items.sku` (Task 1).
- Produces: `insertItem(db, {name, unitCostCents, qtyPurchased, lotId})` still returns the new `id`, and now also sets a unique `sku = ITEM-<zero-padded id>` and inserts a `source='mine'` identifier with `code = sku`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/insert-item-sku.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("insertItem sku", () => {
  it("assigns a unique sku and a 'mine' identifier", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const row = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string };
    expect(row.sku).toBe(`ITEM-${String(id).padStart(5, "0")}`);
    const mine = db.prepare("SELECT code FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(id) as { code: string };
    expect(mine.code).toBe(row.sku);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- insert-item-sku`
Expected: FAIL (`sku` is null; no identifier row).

- [ ] **Step 3: Implement**

Replace `insertItem` in `src/lib/db/inventory.ts` with:

```typescript
export function insertItem(db: DB, i: { name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null }): number {
  const tx = db.transaction(() => {
    const info = db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased, lot_id) VALUES (?,?,?,?)")
      .run(i.name, i.unitCostCents, i.qtyPurchased, i.lotId);
    const id = Number(info.lastInsertRowid);
    const sku = `ITEM-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(sku, id);
    db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'mine', ?)").run(id, sku);
    return id;
  });
  return tx();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- insert-item-sku`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/insert-item-sku.test.ts
git commit -m "feat(db): insertItem auto-assigns sku + 'mine' identifier"
```

---

### Task 3: Re-point the resolver (`aliases.ts`) at `item_identifiers`

**Files:**
- Modify: `src/lib/db/aliases.ts` (all functions; keep exported names)
- Test: `tests/lib/db/aliases.test.ts` (create)

**Interfaces:**
- Consumes: `item_identifiers`, `insertItem` (Tasks 1–2).
- Produces (unchanged signatures, new backing table):
  - `setAlias(db, productName, itemId)` → upserts a `source='whatnot'` identifier keyed on base-normalized `code`.
  - `removeAlias(db, id)` → deletes the identifier row by `id`.
  - `resolveItemId(db, code) → number | null` → matches `item_identifiers.code` (any source), base-normalized.
  - `seenProductNames(db)` and `unmappedNames(db, names)` → unchanged behavior (both delegate to `resolveItemId`).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/aliases.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, removeAlias, resolveItemId } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("alias resolver over item_identifiers", () => {
  it("setAlias stores a whatnot identifier resolvable by base name", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Highland Cow Squishy #3", id); // trailing #N stripped
    expect(resolveItemId(db, "Highland Cow Squishy")).toBe(id);
    const row = db.prepare("SELECT source, code FROM item_identifiers WHERE item_id = ? AND source = 'whatnot'").get(id);
    expect(row).toEqual({ source: "whatnot", code: "Highland Cow Squishy" });
  });

  it("resolveItemId also matches the item's own sku ('mine')", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const sku = (db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string }).sku;
    expect(resolveItemId(db, sku)).toBe(id);
  });

  it("setAlias re-points an existing name to a new item; removeAlias deletes it", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Shared", a);
    setAlias(db, "Shared", b);
    expect(resolveItemId(db, "Shared")).toBe(b);
    const rowId = (db.prepare("SELECT id FROM item_identifiers WHERE code = 'Shared'").get() as { id: number }).id;
    removeAlias(db, rowId);
    expect(resolveItemId(db, "Shared")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- db/aliases`
Expected: FAIL (functions still query `product_aliases`, which no longer exists).

- [ ] **Step 3: Rewrite `aliases.ts`**

Replace the bodies in `src/lib/db/aliases.ts` (keep imports of `baseProductName`):

```typescript
export function setAlias(db: DB, productName: string, itemId: number): void {
  const base = baseProductName(productName);
  db.prepare(`INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'whatnot', ?)
    ON CONFLICT(code) DO UPDATE SET item_id = excluded.item_id, source = 'whatnot'`).run(itemId, base);
}

/** Remove a single identifier by its id. The name's sales stop counting toward
 *  the item (remaining rises; their COGS drops to $0 until re-mapped). */
export function removeAlias(db: DB, aliasId: number): void {
  db.prepare("DELETE FROM item_identifiers WHERE id = ?").run(aliasId);
}

export function resolveItemId(db: DB, productName: string): number | null {
  const base = baseProductName(productName);
  const r = db.prepare("SELECT item_id AS id FROM item_identifiers WHERE code = ?").get(base) as any;
  return r ? Number(r.id) : null;
}
```

Leave `seenProductNames` and `unmappedNames` as-is — they call `resolveItemId` and need no change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- db/aliases`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/aliases.ts tests/lib/db/aliases.test.ts
git commit -m "feat(db): resolver reads/writes item_identifiers (whatnot source)"
```

---

### Task 4: Re-point `inventory.ts` joins and delete paths at `item_identifiers`

**Files:**
- Modify: `src/lib/db/inventory.ts` — `deleteItem` (43), `deleteImpact` (61,63), `qtySoldFromLedger` (105), `aliasesForItem` (129-137), `ledgerSalesForItem` (147)
- Test: `tests/lib/db/inventory-ledger-join.test.ts` (create)

**Interfaces:**
- Consumes: `item_identifiers`, `setAlias`, `insertItem` (Tasks 1–3).
- Produces: `qtySoldFromLedger`, `aliasesForItem`, `ledgerSalesForItem`, `deleteImpact` all resolve Whatnot sales through `item_identifiers` (`source='whatnot'`) with identical results to the old `product_aliases` joins. `deleteItem` removes the item's identifiers (or relies on cascade) without referencing `product_aliases`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/inventory-ledger-join.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, qtySoldFromLedger, aliasesForItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, productName: string): void {
  db.prepare(`INSERT INTO ledger_transactions
    (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES ('2026-01-01','2026-01-01',500,'sale',?,?)`).run(productName, `k-${productName}-${Math.random()}`);
}

describe("ledger joins over item_identifiers", () => {
  it("qtySoldFromLedger counts sales whose base name maps to the item", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    addLedgerSale(db, "Highland Cow Squishy #1");
    addLedgerSale(db, "Highland Cow Squishy #2");
    expect(qtySoldFromLedger(db, id)).toBe(2);
  });

  it("aliasesForItem lists the mapped whatnot names with sale counts", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    addLedgerSale(db, "Highland Cow Squishy");
    const rows = aliasesForItem(db, id);
    expect(rows).toEqual([{ id: expect.any(Number), productName: "Highland Cow Squishy", saleCount: 1 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- inventory-ledger-join`
Expected: FAIL (`no such table: product_aliases`).

- [ ] **Step 3: Rewrite the joins in `inventory.ts`**

In `deleteItem`, replace the first statement (line 43):

```typescript
    db.prepare("DELETE FROM item_identifiers WHERE item_id = ?").run(itemId);
```

In `deleteImpact`, replace the `mappings` and `ledgerSales` computations (lines 61–65):

```typescript
    mappings: one("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = ? AND source = 'whatnot'"),
    ledgerSales: Number((db.prepare(`SELECT COUNT(*) n FROM ledger_transactions lt
        JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
        WHERE lt.kind = 'sale' AND pa.item_id = ?`).get(itemId) as any).n),
```

In `qtySoldFromLedger` (line ~103):

```typescript
export function qtySoldFromLedger(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COUNT(*) as q FROM ledger_transactions lt
    JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
    WHERE lt.kind = 'sale' AND pa.item_id = ?`).get(itemId) as any;
  return Number(r.q);
}
```

In `aliasesForItem` (line ~127):

```typescript
export function aliasesForItem(db: DB, itemId: number): ItemAlias[] {
  return db.prepare(`SELECT pa.id, pa.code AS productName,
      COUNT(lt.id) AS saleCount
    FROM item_identifiers pa
    LEFT JOIN ledger_transactions lt
      ON lt.product_name = pa.code AND lt.kind = 'sale'
    WHERE pa.item_id = ? AND pa.source = 'whatnot'
    GROUP BY pa.id, pa.code
    ORDER BY pa.code`).all(itemId) as ItemAlias[];
}
```

In `ledgerSalesForItem` (line ~145):

```typescript
export function ledgerSalesForItem(db: DB, itemId: number): ItemSale[] {
  return db.prepare(`SELECT lt.show_date AS showDate, lt.product_name AS productName,
      lt.amount_cents AS amountCents
    FROM ledger_transactions lt
    JOIN item_identifiers pa ON pa.code = lt.product_name AND pa.source = 'whatnot'
    WHERE lt.kind = 'sale' AND pa.item_id = ?
    ORDER BY lt.show_date, lt.id`).all(itemId) as ItemSale[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- inventory-ledger-join`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory-ledger-join.test.ts
git commit -m "feat(db): inventory ledger joins + delete use item_identifiers"
```

---

### Task 5: Wire `admin` reset and Excel backup to the new table

**Files:**
- Modify: `src/lib/db/admin.ts:16` (reset)
- Modify: `src/lib/backup/workbook.ts:12` (`TABLES`)
- Test: `tests/lib/backup/item-identifiers-backup.test.ts` (create)

**Interfaces:**
- Consumes: `item_identifiers`, `setAlias`, `insertItem` (Tasks 1–3).
- Produces: `resetApp` clears `item_identifiers`; backup `TABLES` exports/imports `item_identifiers` instead of `product_aliases`, round-tripping identifiers losslessly.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/backup/item-identifiers-backup.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { exportWorkbook, importWorkbook } from "@/lib/backup/workbook";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("item_identifiers backup round-trip", () => {
  it("exports and re-imports whatnot identifiers", async () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    const buf = await exportWorkbook(db);

    const db2 = createDb(":memory:");
    await importWorkbook(db2, buf);
    const rows = db2.prepare("SELECT source, code FROM item_identifiers WHERE code = 'Highland Cow Squishy'").all();
    expect(rows).toEqual([{ source: "whatnot", code: "Highland Cow Squishy" }]);
  });
});
```

> Verify the exact export/import function names in `src/lib/backup/workbook.ts` and adjust the import line to match (they may be named differently, e.g. `buildWorkbook`/`restoreWorkbook`). Use whatever the module exports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- item-identifiers-backup`
Expected: FAIL (`TABLES` still lists `product_aliases`; `item_identifiers` not round-tripped).

- [ ] **Step 3: Implement**

In `src/lib/backup/workbook.ts`, in the `TABLES` array, replace `"product_aliases"` with `"item_identifiers"` (keep its position — after `inventory_items`, which it FK-references):

```typescript
  "item_identifiers", "brother_transactions", "shows", "show_line_items",
```

In `src/lib/db/admin.ts`, in `resetApp`'s `db.exec` block, replace `DELETE FROM product_aliases;` with:

```sql
      DELETE FROM item_identifiers;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- item-identifiers-backup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/admin.ts src/lib/backup/workbook.ts tests/lib/backup/item-identifiers-backup.test.ts
git commit -m "feat(backup): reset + Excel backup use item_identifiers"
```

---

### Task 6: Surface `sku` in `listItems` and on the item detail page

**Files:**
- Modify: `src/lib/db/inventory.ts` — `ItemRow` interface (line 7) and `listItems` (line 33)
- Modify: `src/app/inventory/[id]/page.tsx` (display the SKU)
- Test: `tests/lib/db/list-items-sku.test.ts` (create)

**Interfaces:**
- Consumes: `inventory_items.sku` (Task 1).
- Produces: `ItemRow` gains `sku: string | null`; `listItems` selects it. The item detail page renders the SKU.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/list-items-sku.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, listItems } from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("listItems sku", () => {
  it("includes each item's sku", () => {
    const id = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const row = listItems(db).find((r) => r.id === id)!;
    expect(row.sku).toBe(`ITEM-${String(id).padStart(5, "0")}`);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- list-items-sku`
Expected: FAIL (`sku` undefined on `ItemRow`).

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts`, add `sku` to `ItemRow`:

```typescript
export interface ItemRow { id: number; name: string; sku: string | null; unitCostCents: number; qtyPurchased: number; lotId: number | null; archivedAt: string | null; location: string | null; }
```

and to `listItems`' SELECT:

```typescript
export function listItems(db: DB): ItemRow[] {
  return db.prepare("SELECT id, name, sku, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, lot_id as lotId, archived_at as archivedAt, location FROM inventory_items ORDER BY name").all() as ItemRow[];
}
```

- [ ] **Step 4: Display the SKU on the detail page**

In `src/app/inventory/[id]/page.tsx`, locate where the item name is rendered in the header and add a SKU line beneath it. Read the file first to match its exact JSX/styling; add markup equivalent to:

```tsx
{item.sku && <div className="text-sm text-gray-500 font-mono">SKU: {item.sku}</div>}
```

(Ensure the query feeding this page selects `sku` — if it uses `listItems`/`ItemRow`, it now carries `sku`; if it has its own SELECT, add `sku` to it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- list-items-sku`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/inventory.ts src/app/inventory/[id]/page.tsx tests/lib/db/list-items-sku.test.ts
git commit -m "feat(inventory): expose sku in listItems + item detail page"
```

---

### Task 7: Full-suite green + build + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS. If any pre-existing test referenced `product_aliases` directly, update it to `item_identifiers` (search: `git grep -n product_aliases -- tests`).

- [ ] **Step 2: Typecheck / build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. Investigate any remaining `product_aliases` reference (`git grep -n product_aliases -- src`) — there should be none.

- [ ] **Step 3: Manual smoke on a real DB copy**

```bash
# From a COPY of a real workspace so live data is never at risk:
cp data/ws/0.db /tmp/uii-smoke.db 2>/dev/null || echo "no live db; use demo seed"
```

Start dev (`npm run dev`), then on `feat/unified-item-identifiers`:
- Open Inventory → confirm the app loads and existing mapped Whatnot names still count (sold/remaining unchanged vs. `main`).
- Open an item detail page → confirm a `SKU: ITEM-#####` shows.
- Map a Whatnot name to an item (existing form) → confirm it resolves (sale count updates).
Expected: identical numbers to `main`, plus visible SKUs.

- [ ] **Step 4: Final commit (if any test/doc fixups were needed)**

```bash
git add -A
git commit -m "test/chore: finalize item_identifiers backbone cutover"
```

---

## Self-Review

**Spec coverage (Plan 1 portion):**
- Data model — `sku` column + `item_identifiers` → Task 1. ✓ (name-UNIQUE drop deliberately deferred; see Global Constraints.)
- Migration (back-fill sku, seed 'mine', copy aliases→whatnot, drop product_aliases, leave item_ids untouched) → Task 1. ✓
- Shared resolver → Task 3; consumers via joins → Task 4. ✓
- Backup registration of new table → Task 5. ✓
- Suggest-and-confirm + SKU manager/merge → **Plans 2 and 3** (out of scope here, by design).

**Placeholder scan:** none. Task 5 and Task 6 contain one "verify exact export/import names / match page JSX" instruction each — these are genuine read-then-match steps against existing code, with concrete fallbacks, not deferred work.

**Type consistency:** `setAlias`/`removeAlias`/`resolveItemId` keep their existing signatures (bodies only change). `ItemRow.sku: string | null` matches `listItems`' added `sku` column and Task 6's display guard. `item_identifiers(source, code)` column names are used identically across Tasks 1–5.
