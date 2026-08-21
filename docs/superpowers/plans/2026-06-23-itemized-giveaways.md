# Itemized Giveaways Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single flat giveaway cost with a per-item giveaway catalog and per-show allocation, so each show's giveaway cost is the real sum of what was given (stickers, gift cards, squishies).

**Architecture:** A new `giveaway_items` catalog (pack cost + pack qty) and a `show_giveaway_allocations` table (show → item → count). `buildLedgerReport` computes each show's giveaway cost from its allocations (summing float per-unit costs, rounding once); a show with no allocations costs $0 and carries a flag. Catalog CRUD lives in Settings; allocation entry lives on the show detail page. The giveaway catalog is fully separate from inventory — it never reads inventory costs or draws down stock.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest. Money is integer cents everywhere.

## Global Constraints

- Money stored and computed as **integer cents** (the only float allowed is the intermediate per-unit giveaway cost `pack_cost_cents / pack_qty`, which is rounded to cents at the end of a show's sum).
- DB schema applied via the `SCHEMA` string in `src/lib/db/schema.ts`, run on every `createDb` (`db.exec(SCHEMA)` in `src/lib/db/connection.ts`). New tables use `CREATE TABLE IF NOT EXISTS` — additive, never destructive.
- Tests: `npm test` (alias for `vitest run`). In-memory DB via `createDb(":memory:")`, which applies the full schema + migrations. Import paths use the `@/` alias (e.g. `@/lib/db/connection`).
- DB-access functions live in `src/lib/db/*.ts` and take `db: DB` as their first argument. API routes get the shared connection via `getDb()` from `@/lib/db/connection`.
- The giveaway catalog does NOT touch `inventory_items` — no stock draw-down, no inventory cost reads.

---

### Task 1: Add giveaway tables to the schema

**Files:**
- Modify: `src/lib/db/schema.ts` (append two `CREATE TABLE` statements to the `SCHEMA` string)
- Test: `tests/lib/db/giveaway-items.test.ts` (new)

**Interfaces:**
- Produces: tables `giveaway_items(id, name, pack_cost_cents, pack_qty, active)` and `show_giveaway_allocations(id, show_id, giveaway_item_id, count)`, present after `createDb(":memory:")`.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/giveaway-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";

describe("giveaway schema", () => {
  it("creates giveaway_items and show_giveaway_allocations tables", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: { name: string }) => r.name);
    expect(tables).toContain("giveaway_items");
    expect(tables).toContain("show_giveaway_allocations");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- giveaway-items`
Expected: FAIL — `expected [ ... ] to contain 'giveaway_items'`

- [ ] **Step 3: Add the tables to the schema**

In `src/lib/db/schema.ts`, append these two statements inside the `SCHEMA` template string (after the `ledger_transactions` table, before the closing backtick):

```sql
CREATE TABLE IF NOT EXISTS giveaway_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pack_cost_cents INTEGER NOT NULL,
  pack_qty INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS show_giveaway_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  giveaway_item_id INTEGER NOT NULL REFERENCES giveaway_items(id),
  count INTEGER NOT NULL
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- giveaway-items`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.ts tests/lib/db/giveaway-items.test.ts
git commit -m "feat(db): add giveaway_items + show_giveaway_allocations tables"
```

---

### Task 2: Giveaway-items DB module

**Files:**
- Create: `src/lib/db/giveaway-items.ts`
- Test: `tests/lib/db/giveaway-items.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: `DB` from `@/lib/db/connection`.
- Produces:
  - `interface GiveawayItem { id: number; name: string; packCostCents: number; packQty: number; active: boolean; }`
  - `interface Allocation { giveawayItemId: number; count: number; }`
  - `listGiveawayItems(db: DB, opts?: { activeOnly?: boolean }): GiveawayItem[]`
  - `insertGiveawayItem(db: DB, i: { name: string; packCostCents: number; packQty: number }): number`
  - `updateGiveawayItem(db: DB, i: { id: number; name: string; packCostCents: number; packQty: number; active: boolean }): void`
  - `getAllocations(db: DB, showId: number): Allocation[]`
  - `setAllocations(db: DB, showId: number, allocations: Allocation[]): void` — replaces all rows for the show atomically

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/db/giveaway-items.test.ts`:

```ts
import {
  insertGiveawayItem, updateGiveawayItem, listGiveawayItems,
  getAllocations, setAllocations,
} from "@/lib/db/giveaway-items";
import { insertShow } from "@/lib/db/shows";

describe("giveaway-items db module", () => {
  it("inserts and lists items, mapping columns to camelCase", () => {
    const db = createDb(":memory:");
    const id = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const items = listGiveawayItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, name: "Stickers", packCostCents: 999, packQty: 600, active: true });
  });

  it("activeOnly excludes deactivated items", () => {
    const db = createDb(":memory:");
    const id = insertGiveawayItem(db, { name: "Old", packCostCents: 50, packQty: 1 });
    updateGiveawayItem(db, { id, name: "Old", packCostCents: 50, packQty: 1, active: false });
    expect(listGiveawayItems(db, { activeOnly: true })).toHaveLength(0);
    expect(listGiveawayItems(db)).toHaveLength(1);
  });

  it("setAllocations replaces the show's allocation rows", () => {
    const db = createDb(":memory:");
    const showId = insertShow(db, { showDate: "2026-06-21", sourceHash: "ledger" });
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const card = insertGiveawayItem(db, { name: "$5 card", packCostCents: 500, packQty: 1 });
    setAllocations(db, showId, [
      { giveawayItemId: sticker, count: 15 },
      { giveawayItemId: card, count: 2 },
    ]);
    expect(getAllocations(db, showId)).toEqual([
      { giveawayItemId: sticker, count: 15 },
      { giveawayItemId: card, count: 2 },
    ]);
    // replace, not append
    setAllocations(db, showId, [{ giveawayItemId: card, count: 1 }]);
    expect(getAllocations(db, showId)).toEqual([{ giveawayItemId: card, count: 1 }]);
  });
});
```

Note: confirm `insertShow`'s signature in `src/lib/db/shows.ts` before running; if it differs, adjust the test's show-creation call to match (the show just needs to exist with an id).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- giveaway-items`
Expected: FAIL — cannot find module `@/lib/db/giveaway-items`

- [ ] **Step 3: Implement the module**

Create `src/lib/db/giveaway-items.ts`:

```ts
import type { DB } from "./connection";

export interface GiveawayItem {
  id: number;
  name: string;
  packCostCents: number;
  packQty: number;
  active: boolean;
}

export interface Allocation {
  giveawayItemId: number;
  count: number;
}

interface ItemRow {
  id: number; name: string; packCostCents: number; packQty: number; active: number;
}

export function listGiveawayItems(db: DB, opts: { activeOnly?: boolean } = {}): GiveawayItem[] {
  const where = opts.activeOnly ? "WHERE active = 1" : "";
  const rows = db.prepare(
    `SELECT id, name, pack_cost_cents AS packCostCents, pack_qty AS packQty, active
     FROM giveaway_items ${where} ORDER BY name`
  ).all() as ItemRow[];
  return rows.map((r) => ({ ...r, active: r.active === 1 }));
}

export function insertGiveawayItem(
  db: DB,
  i: { name: string; packCostCents: number; packQty: number }
): number {
  const info = db.prepare(
    "INSERT INTO giveaway_items (name, pack_cost_cents, pack_qty) VALUES (?,?,?)"
  ).run(i.name, i.packCostCents, i.packQty);
  return Number(info.lastInsertRowid);
}

export function updateGiveawayItem(
  db: DB,
  i: { id: number; name: string; packCostCents: number; packQty: number; active: boolean }
): void {
  db.prepare(
    "UPDATE giveaway_items SET name = ?, pack_cost_cents = ?, pack_qty = ?, active = ? WHERE id = ?"
  ).run(i.name, i.packCostCents, i.packQty, i.active ? 1 : 0, i.id);
}

export function getAllocations(db: DB, showId: number): Allocation[] {
  return db.prepare(
    `SELECT giveaway_item_id AS giveawayItemId, count
     FROM show_giveaway_allocations WHERE show_id = ? ORDER BY id`
  ).all(showId) as Allocation[];
}

export function setAllocations(db: DB, showId: number, allocations: Allocation[]): void {
  const tx = db.transaction((rows: Allocation[]) => {
    db.prepare("DELETE FROM show_giveaway_allocations WHERE show_id = ?").run(showId);
    const ins = db.prepare(
      "INSERT INTO show_giveaway_allocations (show_id, giveaway_item_id, count) VALUES (?,?,?)"
    );
    for (const r of rows) ins.run(showId, r.giveawayItemId, r.count);
  });
  tx(allocations);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- giveaway-items`
Expected: PASS (all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/giveaway-items.ts tests/lib/db/giveaway-items.test.ts
git commit -m "feat(db): giveaway-items CRUD + per-show allocations"
```

---

### Task 3: Compute giveaway cost from allocations in the report

**Files:**
- Modify: `src/lib/calc/ledger-report.ts` (replace the `giveawayCostCents` computation; add `giveawayUnallocated` to `ReportShow`)
- Test: `tests/lib/calc/ledger-report.test.ts` (add cases)

**Interfaces:**
- Consumes: `getAllocations`, `listGiveawayItems` from `@/lib/db/giveaway-items`.
- Produces: `ReportShow.giveawayUnallocated: boolean`. `giveawayCostCents` now equals `round(Σ count × packCostCents / packQty)` over the show's allocations, or `0` when there are no allocations.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/calc/ledger-report.test.ts`. The existing `CSV` constant has one giveaway on Jun 12; reuse it.

```ts
import { insertGiveawayItem, setAllocations } from "@/lib/db/giveaway-items";

describe("itemized giveaway cost", () => {
  it("costs giveaways from allocations, rounding the summed float once", () => {
    // db/CSV from the file's beforeEach: 1 show on Jun 12 with 1 detected giveaway.
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const card = insertGiveawayItem(db, { name: "$5 card", packCostCents: 500, packQty: 1 });
    const squishy = insertGiveawayItem(db, { name: "Mini squishy", packCostCents: 50, packQty: 1 });
    const showId = buildLedgerReport(db).shows[0].showId;
    setAllocations(db, showId, [
      { giveawayItemId: sticker, count: 15 }, // 15 * 1.665 = 24.975 -> 25 after rounding the sum
      { giveawayItemId: card, count: 2 },     // 1000
      { giveawayItemId: squishy, count: 1 },  // 50
    ]);
    const show = buildLedgerReport(db).shows[0];
    expect(show.giveawayCostCents).toBe(25 + 1000 + 50); // 1075
    expect(show.giveawayUnallocated).toBe(false);
  });

  it("costs 15 stickers as 25c (not 30c), proving end-rounding", () => {
    const sticker = insertGiveawayItem(db, { name: "Stickers", packCostCents: 999, packQty: 600 });
    const showId = buildLedgerReport(db).shows[0].showId;
    setAllocations(db, showId, [{ giveawayItemId: sticker, count: 15 }]);
    expect(buildLedgerReport(db).shows[0].giveawayCostCents).toBe(25);
  });

  it("flags a show with detected giveaways but no allocations as $0 + unallocated", () => {
    const show = buildLedgerReport(db).shows[0];
    expect(show.giveawayCount).toBe(1);
    expect(show.giveawayCostCents).toBe(0);
    expect(show.giveawayUnallocated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ledger-report`
Expected: FAIL — `giveawayUnallocated` is undefined / `giveawayCostCents` is the old flat value.

- [ ] **Step 3: Implement the costing change**

In `src/lib/calc/ledger-report.ts`:

1. Add the import near the top:

```ts
import { getAllocations, listGiveawayItems } from "@/lib/db/giveaway-items";
```

2. Add the field to the `ReportShow` interface (after `giveawayCostCents`):

```ts
  giveawayUnallocated: boolean; // true when the show has detected giveaways but no allocation rows
```

3. Build a unit-cost lookup once, inside `buildLedgerReport` near the other top-level maps (after `const itemCost = ...`):

```ts
  const giveawayUnit = new Map(
    listGiveawayItems(db).map((g) => [g.id, g.packCostCents / g.packQty])
  );
```

4. Replace the flat computation:

```ts
    // OLD:
    // const giveawayCostCents = giveawayCount * settings.giveawayUnitCents;
    const allocs = getAllocations(db, s.id);
    const giveawayCostCents = Math.round(
      allocs.reduce((sum, a) => sum + a.count * (giveawayUnit.get(a.giveawayItemId) ?? 0), 0)
    );
    const giveawayUnallocated = giveawayCount > 0 && allocs.length === 0;
```

5. Add `giveawayUnallocated` to the `shows.push({ ... })` object (next to `giveawayCostCents`):

```ts
      giveawayTotalCents: giveaway, giveawayCount, giveawayCostCents, giveawayUnallocated,
```

The `totals.giveawayCostCents` reducer already sums `s.giveawayCostCents`, so totals update automatically. Leave `LedgerReport.giveawayUnitCents` field as-is for now (removed in Task 5's cleanup if unused; harmless to keep).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ledger-report`
Expected: PASS. Then run the full suite to catch fallout: `npm test`
Expected: PASS (any pre-existing test asserting the old flat giveaway cost must be updated to the new allocation-based value — fix those assertions if they appear).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat(report): cost giveaways from per-show allocations + unallocated flag"
```

---

### Task 4: API routes for giveaway catalog and allocations

**Files:**
- Create: `src/app/api/giveaway-items/route.ts` (GET list, POST create, PUT update)
- Create: `src/app/api/shows/[id]/giveaways/route.ts` (GET allocations + catalog, PUT replace allocations)
- Test: none (thin HTTP wrappers over Task 2's tested functions; verified manually in Step 4)

**Interfaces:**
- Consumes: `listGiveawayItems`, `insertGiveawayItem`, `updateGiveawayItem`, `getAllocations`, `setAllocations`, `getDb`.
- Produces:
  - `GET /api/giveaway-items` → `GiveawayItem[]`
  - `POST /api/giveaway-items` body `{ name, packCostCents, packQty }` → `{ id }`
  - `PUT /api/giveaway-items` body `{ id, name, packCostCents, packQty, active }` → `{ ok: true }`
  - `GET /api/shows/[id]/giveaways` → `{ items: GiveawayItem[], allocations: Allocation[] }`
  - `PUT /api/shows/[id]/giveaways` body `{ allocations: Allocation[] }` → `{ ok: true }`

- [ ] **Step 1: Create the catalog route**

Create `src/app/api/giveaway-items/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import {
  listGiveawayItems, insertGiveawayItem, updateGiveawayItem,
} from "@/lib/db/giveaway-items";

export async function GET() {
  return NextResponse.json(listGiveawayItems(getDb()));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const packCostCents = Number(b.packCostCents);
  const packQty = Number(b.packQty);
  if (!name || !Number.isFinite(packCostCents) || packCostCents < 0 ||
      !Number.isInteger(packQty) || packQty < 1) {
    return NextResponse.json({ error: "Invalid giveaway item" }, { status: 400 });
  }
  const id = insertGiveawayItem(getDb(), { name, packCostCents, packQty });
  return NextResponse.json({ id });
}

export async function PUT(req: NextRequest) {
  const b = await req.json();
  const id = Number(b.id);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const packCostCents = Number(b.packCostCents);
  const packQty = Number(b.packQty);
  if (!Number.isInteger(id) || !name || !Number.isFinite(packCostCents) || packCostCents < 0 ||
      !Number.isInteger(packQty) || packQty < 1) {
    return NextResponse.json({ error: "Invalid giveaway item" }, { status: 400 });
  }
  updateGiveawayItem(getDb(), { id, name, packCostCents, packQty, active: Boolean(b.active) });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create the per-show allocations route**

Create `src/app/api/shows/[id]/giveaways/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import {
  listGiveawayItems, getAllocations, setAllocations, type Allocation,
} from "@/lib/db/giveaway-items";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const db = getDb();
  return NextResponse.json({
    items: listGiveawayItems(db, { activeOnly: true }),
    allocations: getAllocations(db, showId),
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const showId = Number(id);
  const body = await req.json();
  const raw = Array.isArray(body.allocations) ? body.allocations : [];
  const allocations: Allocation[] = [];
  for (const a of raw) {
    const giveawayItemId = Number(a.giveawayItemId);
    const count = Number(a.count);
    if (!Number.isInteger(giveawayItemId) || !Number.isInteger(count) || count < 0) {
      return NextResponse.json({ error: "Invalid allocation" }, { status: 400 });
    }
    if (count > 0) allocations.push({ giveawayItemId, count });
  }
  setAllocations(getDb(), showId, allocations);
  return NextResponse.json({ ok: true });
}
```

Note: this codebase targets Next.js 15, where route-handler `params` is a Promise (awaited above). Confirm against a sibling dynamic route (e.g. any existing `src/app/api/.../[id]/route.ts`) and match its `params` style if it differs.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: build succeeds with both new routes listed. (If `next dev` is running, `rm -rf .next` afterward and restart dev — the two share `.next/`.)

- [ ] **Step 4: Manually smoke-test the endpoints**

Start `npm run dev`, then:

```bash
curl -s localhost:3000/api/giveaway-items
curl -s -X POST localhost:3000/api/giveaway-items \
  -H 'content-type: application/json' \
  -d '{"name":"Stickers","packCostCents":999,"packQty":600}'
curl -s localhost:3000/api/giveaway-items
```

Expected: list starts `[]`, POST returns `{"id":1}`, list then shows the Stickers item.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/giveaway-items/route.ts "src/app/api/shows/[id]/giveaways/route.ts"
git commit -m "feat(api): giveaway catalog + per-show allocation endpoints"
```

---

### Task 5: Settings — manage the giveaway catalog, remove the flat input

**Files:**
- Create: `src/components/GiveawayItemsManager.tsx` (client component)
- Modify: `src/app/settings/page.tsx` (render `<GiveawayItemsManager />`)
- Modify: `src/components/SettingsForm.tsx` (remove the giveaway-unit-cost input)
- Modify: `src/app/api/settings/route.ts` (drop `giveawayUnitCents` from validation/body — keep DB column)

**Interfaces:**
- Consumes: `GET/POST/PUT /api/giveaway-items` from Task 4.
- Produces: a Settings section listing giveaway items with add / edit-cost / activate-deactivate controls.

- [ ] **Step 1: Build the manager component**

Create `src/components/GiveawayItemsManager.tsx`. Match the existing styling conventions in `SettingsForm.tsx` (read it first for class names / dollar-input helpers); the logic below is the contract to implement:

```tsx
"use client";
import { useEffect, useState } from "react";

interface GiveawayItem {
  id: number; name: string; packCostCents: number; packQty: number; active: boolean;
}

export default function GiveawayItemsManager() {
  const [items, setItems] = useState<GiveawayItem[]>([]);
  const [name, setName] = useState("");
  const [packDollars, setPackDollars] = useState("");
  const [packQty, setPackQty] = useState("1");

  async function load() {
    setItems(await fetch("/api/giveaway-items").then((r) => r.json()));
  }
  useEffect(() => { load(); }, []);

  async function add() {
    const packCostCents = Math.round(parseFloat(packDollars) * 100);
    const qty = parseInt(packQty, 10);
    if (!name.trim() || !Number.isFinite(packCostCents) || packCostCents < 0 || !(qty >= 1)) return;
    await fetch("/api/giveaway-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), packCostCents, packQty: qty }),
    });
    setName(""); setPackDollars(""); setPackQty("1");
    load();
  }

  async function save(it: GiveawayItem) {
    await fetch("/api/giveaway-items", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(it),
    });
    load();
  }

  const unit = (it: GiveawayItem) => (it.packCostCents / it.packQty / 100);

  return (
    <section>
      <h2>Giveaway items</h2>
      <p>Each giveaway is costed from this list. For bulk items, enter the pack price and how many are in the pack.</p>
      <table>
        <thead>
          <tr><th>Name</th><th>Pack cost</th><th>Pack qty</th><th>Per unit</th><th></th></tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} style={{ opacity: it.active ? 1 : 0.5 }}>
              <td>{it.name}</td>
              <td>${(it.packCostCents / 100).toFixed(2)}</td>
              <td>{it.packQty}</td>
              <td>${unit(it).toFixed(4)}</td>
              <td>
                <button onClick={() => save({ ...it, active: !it.active })}>
                  {it.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Pack cost $" value={packDollars} onChange={(e) => setPackDollars(e.target.value)} />
        <input placeholder="Pack qty" value={packQty} onChange={(e) => setPackQty(e.target.value)} />
        <button onClick={add}>Add</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Render it in the Settings page**

In `src/app/settings/page.tsx`, import and render the component below the existing settings form:

```tsx
import GiveawayItemsManager from "@/components/GiveawayItemsManager";
// ...inside the returned JSX, after <SettingsForm .../>:
<GiveawayItemsManager />
```

- [ ] **Step 3: Remove the flat giveaway-unit input**

In `src/components/SettingsForm.tsx`, delete the giveaway-unit-cost `<input>` (and its label/state) — search for `giveawayUnit`. Keep the field out of the PUT body. In `src/app/api/settings/route.ts`, remove `giveawayUnitCents` from the parsed body and validation, and stop passing it to `updateSettings`. Because `updateSettings` still expects the field, pass the existing stored value through: read it via `getSettings(getDb()).giveawayUnitCents` and forward it unchanged, OR (simpler) leave `updateSettings`/`Settings` untouched and just hardcode the forwarded value from the current settings. Do not drop the DB column.

- [ ] **Step 4: Verify build + manual check**

Run: `npm run build` → succeeds.
Start `npm run dev`, open `/settings`: the giveaway-unit-cost input is gone; the Giveaway items table renders; adding "Stickers / $9.99 / 600" shows a per-unit of `$0.0167`; Deactivate/Activate toggles the row.

- [ ] **Step 5: Commit**

```bash
git add src/components/GiveawayItemsManager.tsx src/app/settings/page.tsx src/components/SettingsForm.tsx src/app/api/settings/route.ts
git commit -m "feat(settings): manage giveaway catalog, remove flat giveaway unit cost"
```

---

### Task 6: Show detail page — giveaway allocation editor

**Files:**
- Create: `src/components/GiveawayAllocationEditor.tsx` (client component)
- Modify: `src/app/shows/[id]/page.tsx` (render the editor in the giveaway area; surface the unallocated flag)
- Test: none (logic is Task 2/3, already tested; this is UI wiring verified manually)

**Interfaces:**
- Consumes: `GET/PUT /api/shows/[id]/giveaways` (Task 4); `ReportShow.giveawayCount`, `giveawayCostCents`, `giveawayUnallocated` (Task 3).
- Produces: per-show giveaway entry UI; saving persists allocations which re-cost the show on next report build.

- [ ] **Step 1: Build the editor component**

Create `src/components/GiveawayAllocationEditor.tsx`. Read `src/app/shows/[id]/page.tsx` first to match its styling and how it gets the show id; the contract:

```tsx
"use client";
import { useEffect, useState } from "react";

interface Item { id: number; name: string; packCostCents: number; packQty: number; active: boolean; }
interface Row { giveawayItemId: number; count: number; }

export default function GiveawayAllocationEditor({
  showId, detectedCount,
}: { showId: number; detectedCount: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/shows/${showId}/giveaways`).then((r) => r.json()).then((d) => {
      setItems(d.items); setRows(d.allocations);
    });
  }, [showId]);

  const unitOf = (id: number) => {
    const it = items.find((i) => i.id === id);
    return it ? it.packCostCents / it.packQty : 0;
  };
  const allocatedCount = rows.reduce((s, r) => s + r.count, 0);
  const costCents = Math.round(rows.reduce((s, r) => s + r.count * unitOf(r.giveawayItemId), 0));

  function setRow(i: number, patch: Partial<Row>) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setSaved(false);
  }
  function addRow() {
    if (items[0]) setRows([...rows, { giveawayItemId: items[0].id, count: 0 }]);
  }
  function removeRow(i: number) { setRows(rows.filter((_, idx) => idx !== i)); setSaved(false); }

  async function save() {
    await fetch(`/api/shows/${showId}/giveaways`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allocations: rows.filter((r) => r.count > 0) }),
    });
    setSaved(true);
  }

  return (
    <section>
      <h3>Giveaways</h3>
      <p>Ledger detected <strong>{detectedCount}</strong> giveaway{detectedCount === 1 ? "" : "s"} this show.</p>
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select value={r.giveawayItemId} onChange={(e) => setRow(i, { giveawayItemId: Number(e.target.value) })}>
                  {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
              </td>
              <td>
                <input type="number" min={0} value={r.count}
                  onChange={(e) => setRow(i, { count: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
              </td>
              <td>${(r.count * unitOf(r.giveawayItemId) / 100).toFixed(2)}</td>
              <td><button onClick={() => removeRow(i)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addRow} disabled={items.length === 0}>+ Add item</button>
      <p>Allocated {allocatedCount} / {detectedCount} · Cost ${(costCents / 100).toFixed(2)}</p>
      {allocatedCount !== detectedCount && (
        <p style={{ color: "#b45309" }}>⚠ Allocated {allocatedCount} doesn’t match detected {detectedCount}.</p>
      )}
      <button onClick={save}>Save giveaways</button>
      {saved && <span> Saved.</span>}
    </section>
  );
}
```

- [ ] **Step 2: Wire it into the show page**

In `src/app/shows/[id]/page.tsx`, locate where the show's giveaway info is rendered (search for `giveaway`). Render the editor, passing the show id and the report's detected count:

```tsx
import GiveawayAllocationEditor from "@/components/GiveawayAllocationEditor";
// ...where the show (a ReportShow) is in scope:
<GiveawayAllocationEditor showId={show.showId} detectedCount={show.giveawayCount} />
{show.giveawayUnallocated && (
  <p style={{ color: "#b45309" }}>⚠ Giveaways not entered yet — counted as $0.</p>
)}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual end-to-end check**

With `npm run dev` and at least one ledger show that has giveaways:
1. Open the show page → see "Ledger detected N giveaways" and the unallocated warning.
2. Add rows (15 Stickers, 2 $5 card, 1 squishy), Save.
3. Reload → allocations persist; the show's giveaway cost reflects the sum (e.g. `$10.75`); unallocated warning gone.
4. Check `/report` and the dashboard → giveaway cost + net profit + owner/partner split reflect the new cost.

- [ ] **Step 5: Commit**

```bash
git add src/components/GiveawayAllocationEditor.tsx "src/app/shows/[id]/page.tsx"
git commit -m "feat(shows): per-show giveaway allocation editor"
```

---

## Self-Review Notes

- **Spec coverage:** catalog (Task 1–2, 5), per-show allocation (Task 1–2, 6), costing change + unallocated $0 flag (Task 3), settings cleanup (Task 5), additive migration (Task 1), tests for derivation/summation/rounding/unallocated/mismatch (Task 2–3). All spec sections map to a task.
- **Out-of-scope respected:** no inventory draw-down, no change to ledger giveaway detection, no back-fill tooling.
- **Type consistency:** `GiveawayItem` (packCostCents/packQty/active), `Allocation` (giveawayItemId/count), and `ReportShow.giveawayUnallocated` are used consistently across Tasks 2, 3, 4, 5, 6.
- **Confirm-before-coding flags:** `insertShow` signature (Task 2), Next.js 15 `params` Promise shape (Task 4), and existing form/page styling (Tasks 5–6) — each task notes to verify against the real file.
