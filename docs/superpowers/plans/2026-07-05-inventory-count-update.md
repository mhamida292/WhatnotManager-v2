# Inventory Count Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make counting merchandise easy — a dated absolute-count history, a quick single-item recount, and a full count-mode page — while cleaning up the now-dead `qty_samples` code (keeping "sample" as an adjustment reason).

**Architecture:** Extend the existing `inventory_adjustments` log with a nullable `counted` column so a recount stores both the delta (for the running total) and the absolute count the user wrote down (for history). Business logic stays in `src/lib/db/*` pure functions taking a `db` handle (Vitest-tested). The existing `AdjustmentsLog` client component gains a "Counted" column; a new `QuickRecount` component and a `/inventory/count` page drive counting. Reuses existing UI primitives.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, TypeScript, Vitest, Tailwind.

## Current-state reconciliation (verified 2026-07-05)

The spec predates some prior work; reality differs, so this plan adapts:
- **Samples display is already gone.** Prior features removed the Samples column from the inventory list table and the edit modal. What remains is *dead code*: `updateItemSamples` (no live call site — only a stale import in `tests/lib/db/inventory.test.ts`) and `ItemRow.qtySamples` (carried through `listItems` but rendered nowhere). This plan removes that dead code. The `qty_samples` DB column and its migration stay (deferred, per spec).
- **"sample" reason already exists** in the `inventory_adjustments` CHECK and in `AdjustmentsLog`'s add form — kept as-is.
- **`AdjustmentsLog` already exists** with add/delete + a signed-qty column. It becomes the "count history": we add a Counted column that shows the absolute count when present.
- **`setItemRemaining(db, id, target)` exists** but writes no reason/note/counted. The count feature (counted column, quick recount, `/inventory/count`, `applyCount`) does not exist yet.

## Global Constraints

- Every db function takes a `db: DB` handle as its first argument (multi-workspace: never call `getDb` in business logic).
- Server components call `await dbForRequest()`; API routes call `await dbForRequest()`.
- Route params are async: `{ params }: { params: Promise<{ id: string }> }`, read via `await params`.
- `qtyRemaining` math is `qty_purchased − qtySold + Σ adjustments.qty`. The new `counted` column is **display/audit only** — it must NOT change `qtyRemaining` (which still sums `qty` deltas).
- Counts are whole units (INTEGER). Reasons are the existing set: `sample | damage_loss | recount | other`.
- Adding a column to an existing table needs a guarded `ALTER TABLE ... ADD COLUMN` in `migrate()` (SQLite has no `ADD COLUMN IF NOT EXISTS`); also add it to `SCHEMA` for fresh DBs.
- Follow existing file style (semicolons, `@/` alias, small focused modules).

---

### Task 1: `counted` column on `inventory_adjustments`

**Files:**
- Modify: `src/lib/db/schema.ts` (the `inventory_adjustments` CREATE, ~line 42-49 — add `counted` column)
- Modify: `src/lib/db/connection.ts` (`migrate()` — guarded ALTER; and the `CREATE TABLE IF NOT EXISTS inventory_adjustments` string at ~line 55-57 add `counted INTEGER`)
- Modify: `src/lib/db/adjustments.ts` (type + add + list)
- Modify: `tests/lib/db/adjustments.test.ts` (new cases; create the file if it doesn't exist)

**Interfaces:**
- Produces:
  - `interface Adjustment { id; itemId; adjustedOn; reason; qty; note; counted: number | null }`
  - `addAdjustment(db, a: { itemId; adjustedOn; reason; qty; note; counted?: number | null }): number`
  - `listAdjustments(db, itemId): Adjustment[]` (now includes `counted`)

- [ ] **Step 1: Add the column to both schema locations**

In `src/lib/db/schema.ts`, add `counted` to the `inventory_adjustments` table so it reads:

```sql
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')),
  qty INTEGER NOT NULL,
  note TEXT,
  counted INTEGER
);
```

In `src/lib/db/connection.ts`, the `migrate()` function has a dense `CREATE TABLE IF NOT EXISTS inventory_adjustments (...)` one-liner (~line 55-57). Add `, counted INTEGER` to the end of its column list (before the closing `)`), matching the schema. Then, immediately AFTER that `db.exec(...CREATE...)` and before `migrateAdjustments(db);`, add the guarded ALTER for already-existing DBs:

```typescript
const acols = (db.prepare("PRAGMA table_info(inventory_adjustments)").all() as { name: string }[]).map((c) => c.name);
if (!acols.includes("counted")) db.exec("ALTER TABLE inventory_adjustments ADD COLUMN counted INTEGER");
```

- [ ] **Step 2: Write the failing test**

In `tests/lib/db/adjustments.test.ts` (create if missing) add:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addAdjustment, listAdjustments, sumAdjustments } from "@/lib/db/adjustments";

let db: DB;
let itemId: number;
beforeEach(() => {
  db = createDb(":memory:");
  itemId = insertItem(db, { name: "Widget", unitCostCents: 100, qtyPurchased: 50, lotId: null });
});

describe("adjustments counted column", () => {
  it("stores and returns counted alongside the delta", () => {
    addAdjustment(db, { itemId, adjustedOn: "2026-07-04", reason: "recount", qty: -3, note: null, counted: 40 });
    const rows = listAdjustments(db, itemId);
    expect(rows[0]).toMatchObject({ qty: -3, counted: 40, reason: "recount" });
  });
  it("defaults counted to null when omitted, and does not affect sumAdjustments", () => {
    addAdjustment(db, { itemId, adjustedOn: "2026-07-04", reason: "damage_loss", qty: -2, note: null });
    const rows = listAdjustments(db, itemId);
    expect(rows[0].counted).toBeNull();
    expect(sumAdjustments(db, itemId)).toBe(-2);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- adjustments`
Expected: FAIL — `counted` missing from the returned row / not accepted by `addAdjustment`.

- [ ] **Step 4: Implement**

In `src/lib/db/adjustments.ts`:

Update the interface:
```typescript
export interface Adjustment { id: number; itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted: number | null; }
```

Update `listAdjustments` SELECT to include `counted`:
```typescript
export function listAdjustments(db: DB, itemId: number): Adjustment[] {
  return db.prepare(
    "SELECT id, item_id AS itemId, adjusted_on AS adjustedOn, reason, qty, note, counted FROM inventory_adjustments WHERE item_id = ? ORDER BY adjusted_on, id"
  ).all(itemId) as Adjustment[];
}
```

Update `addAdjustment` to accept and write optional `counted`:
```typescript
export function addAdjustment(db: DB, a: { itemId: number; adjustedOn: string | null; reason: AdjustReason; qty: number; note: string | null; counted?: number | null }): number {
  const info = db.prepare(
    "INSERT INTO inventory_adjustments (item_id, adjusted_on, reason, qty, note, counted) VALUES (?,?,?,?,?,?)"
  ).run(a.itemId, a.adjustedOn, a.reason, a.qty, a.note, a.counted ?? null);
  return Number(info.lastInsertRowid);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- adjustments`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/connection.ts src/lib/db/adjustments.ts tests/lib/db/adjustments.test.ts
git commit -m "feat(inventory): counted column on inventory_adjustments"
```

---

### Task 2: `setItemRemaining` records the count; `applyCount` batch

**Files:**
- Modify: `src/lib/db/inventory.ts` (`setItemRemaining` signature; new `applyCount`)
- Modify: `tests/lib/db/inventory.test.ts` (new cases)

**Interfaces:**
- Consumes: `qtyRemaining` (existing), `addAdjustment` (Task 1).
- Produces:
  - `setItemRemaining(db, id, target, opts?: { reason?: AdjustReason; note?: string | null; on?: string }): void` — appends ONE adjustment dated `on` (default today) with `qty = target − currentRemaining`, `counted = target`, `reason` (default `"recount"`), `note` (default null). A zero delta still records the count (confirms "counted N, no change").
  - `applyCount(db, on: string, rows: { itemId: number; counted: number; reason?: AdjustReason }[]): void` — transactional; for each row appends one adjustment dated `on` with `qty = counted − qtyRemaining(itemId)`, `counted`, `reason` (default `"recount"`). Caller is responsible for omitting skipped items.

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/inventory.test.ts` (import `setItemRemaining, applyCount, qtyRemaining, insertItem` and `listAdjustments` from adjustments as needed):

```typescript
describe("count recording", () => {
  it("setItemRemaining records counted + reason + zero-delta count", () => {
    const id = insertItem(db, { name: "Cat", unitCostCents: 100, qtyPurchased: 43, lotId: null });
    setItemRemaining(db, id, 40, { reason: "sample", note: "gave 3 away", on: "2026-07-04" });
    let log = listAdjustments(db, id);
    expect(log.at(-1)).toMatchObject({ qty: -3, counted: 40, reason: "sample", note: "gave 3 away" });
    expect(qtyRemaining(db, id)).toBe(40);
    // zero-delta count still logs
    setItemRemaining(db, id, 40, { on: "2026-07-05" });
    log = listAdjustments(db, id);
    expect(log.at(-1)).toMatchObject({ qty: 0, counted: 40, reason: "recount" });
  });

  it("applyCount writes one dated adjustment per row", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    applyCount(db, "2026-07-04", [{ itemId: a, counted: 8 }, { itemId: b, counted: 5, reason: "recount" }]);
    expect(qtyRemaining(db, a)).toBe(8);   // 10 → 8 (delta -2)
    expect(qtyRemaining(db, b)).toBe(5);   // unchanged, delta 0 still logged
    expect(listAdjustments(db, a).at(-1)).toMatchObject({ qty: -2, counted: 8, adjustedOn: "2026-07-04" });
    expect(listAdjustments(db, b).at(-1)).toMatchObject({ qty: 0, counted: 5, adjustedOn: "2026-07-04" });
  });
});
```

(If `tests/lib/db/inventory.test.ts` doesn't already import `listAdjustments`, add `import { listAdjustments } from "@/lib/db/adjustments";`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: FAIL — `applyCount` not exported; `setItemRemaining` ignores opts / writes no `counted`.

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts`, ensure `AdjustReason` is imported from `./adjustments` (it already imports `addAdjustment`; extend to `import { sumAdjustments, addAdjustment, type AdjustReason } from "./adjustments";`). Replace the existing `setItemRemaining` and add `applyCount`:

```typescript
export function setItemRemaining(db: DB, id: number, target: number, opts?: { reason?: AdjustReason; note?: string | null; on?: string }): void {
  const on = opts?.on ?? new Date().toISOString().slice(0, 10);
  const delta = target - qtyRemaining(db, id);
  addAdjustment(db, { itemId: id, adjustedOn: on, reason: opts?.reason ?? "recount", qty: delta, note: opts?.note ?? null, counted: target });
}

export function applyCount(db: DB, on: string, rows: { itemId: number; counted: number; reason?: AdjustReason }[]): void {
  const tx = db.transaction(() => {
    for (const r of rows) {
      const delta = r.counted - qtyRemaining(db, r.itemId);
      addAdjustment(db, { itemId: r.itemId, adjustedOn: on, reason: r.reason ?? "recount", qty: delta, note: null, counted: r.counted });
    }
  });
  tx();
}
```

Note: the old `setItemRemaining` skipped a zero delta; the new one always records (so a confirmed "counted N, no change" appears in history). This is intended per the spec.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- "tests/lib/db/inventory"`
Expected: PASS. (If any pre-existing `setItemRemaining` test asserted "no row on zero delta", update it to expect a recorded zero-delta count — that behavior change is intended.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): setItemRemaining records counted+reason; applyCount batch"
```

---

### Task 3: Remove dead `qty_samples` code

**Files:**
- Modify: `src/lib/db/inventory.ts` (remove `updateItemSamples`; drop `qtySamples` from `ItemRow` and `listItems`)
- Modify: `tests/lib/db/inventory.test.ts` (remove the stale `updateItemSamples` import)

**Interfaces:**
- Produces: `interface ItemRow { id; name; unitCostCents; qtyPurchased; lotId }` (no `qtySamples`).

- [ ] **Step 1: Confirm nothing renders `qtySamples`**

Run: `grep -rn "qtySamples" src --include=*.tsx`
Expected: no output (the display was removed by prior work). If any output appears, STOP and report — this task assumes no live consumer.

- [ ] **Step 2: Remove the dead code**

In `src/lib/db/inventory.ts`:
- Delete the `updateItemSamples` function and its `@deprecated` doc comment (the block around lines 35-40).
- Change `ItemRow` to drop `qtySamples`:
  ```typescript
  export interface ItemRow { id: number; name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null; }
  ```
- Change `listItems` to stop selecting the samples column:
  ```typescript
  export function listItems(db: DB): ItemRow[] {
    return db.prepare("SELECT id, name, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, lot_id as lotId FROM inventory_items ORDER BY name").all() as ItemRow[];
  }
  ```

In `tests/lib/db/inventory.test.ts`: remove `updateItemSamples` from the import list at the top (it is imported but never called — a stale reference).

- [ ] **Step 3: Verify tests + types**

Run: `npm test -- "tests/lib/db/inventory" && npx tsc --noEmit 2>&1 | grep -E "inventory|ItemRow" | grep -v "giveaway-items.test.ts" || echo "clean"`
Expected: tests PASS; `clean` (the only tolerated pre-existing tsc error is `tests/lib/db/giveaway-items.test.ts`, unrelated).

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "chore(inventory): remove dead qty_samples code (display already gone)"
```

---

### Task 4: API — recount endpoint + batch count endpoint

**Files:**
- Modify: `src/app/api/inventory/[id]/adjustments/route.ts` (accept optional `counted` on POST — keeps the manual signed-qty add able to carry a count if ever needed; primarily future-proofing)
- Create: `src/app/api/inventory/[id]/recount/route.ts` (POST — quick single-item recount)
- Create: `src/app/api/inventory/count/route.ts` (POST — batch count)

**Interfaces:**
- Consumes: `setItemRemaining`, `applyCount` (Task 2); `addAdjustment` (Task 1); `AdjustReason` + `VALID_REASONS` pattern from the existing adjustments route.
- Produces:
  - `POST /api/inventory/:id/recount` body `{ counted: number; reason?: AdjustReason; note?: string; on?: string }` → `{ ok: true }` (400 on non-integer/negative counted or invalid reason).
  - `POST /api/inventory/count` body `{ on: string; rows: { itemId: number; counted: number; reason?: AdjustReason }[] }` → `{ ok: true }` (skips nothing — caller pre-filters; validates each counted is a non-negative integer).

- [ ] **Step 1: Recount route**

Create `src/app/api/inventory/[id]/recount/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { setItemRemaining } from "@/lib/db/inventory";
import type { AdjustReason } from "@/lib/db/adjustments";

const VALID_REASONS: AdjustReason[] = ["sample", "damage_loss", "recount", "other"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const itemId = Number((await params).id);
  const b = await req.json();
  const counted = Number(b.counted);
  if (!Number.isInteger(counted) || counted < 0) return NextResponse.json({ error: "counted must be a non-negative integer" }, { status: 400 });
  const reason: AdjustReason = VALID_REASONS.includes(b.reason) ? b.reason : "recount";
  const on = typeof b.on === "string" && b.on ? b.on : undefined;
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  setItemRemaining(await dbForRequest(), itemId, counted, { reason, note, on });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Batch count route**

Create `src/app/api/inventory/count/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { applyCount } from "@/lib/db/inventory";
import type { AdjustReason } from "@/lib/db/adjustments";

const VALID_REASONS: AdjustReason[] = ["sample", "damage_loss", "recount", "other"];

export async function POST(req: NextRequest) {
  const b = await req.json();
  const on = typeof b.on === "string" && b.on ? b.on : new Date().toISOString().slice(0, 10);
  const rawRows: unknown[] = Array.isArray(b.rows) ? b.rows : [];
  const rows: { itemId: number; counted: number; reason?: AdjustReason }[] = [];
  for (const rr of rawRows) {
    const r = rr as { itemId?: unknown; counted?: unknown; reason?: unknown };
    const itemId = Number(r.itemId);
    const counted = Number(r.counted);
    if (!Number.isInteger(itemId) || !Number.isInteger(counted) || counted < 0) {
      return NextResponse.json({ error: "each row needs an integer itemId and a non-negative integer counted" }, { status: 400 });
    }
    const reason = VALID_REASONS.includes(r.reason as AdjustReason) ? (r.reason as AdjustReason) : "recount";
    rows.push({ itemId, counted, reason });
  }
  applyCount(await dbForRequest(), on, rows);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Optional `counted` on the existing adjustments POST**

In `src/app/api/inventory/[id]/adjustments/route.ts`, in the POST handler, thread an optional `counted` into the `addAdjustment` call (leave all existing validation unchanged):

```typescript
  const id = addAdjustment(db, {
    itemId,
    adjustedOn: typeof body.adjustedOn === "string" && body.adjustedOn ? body.adjustedOn : null,
    reason,
    qty,
    note: typeof body.note === "string" && body.note ? body.note : null,
    counted: Number.isInteger(Number(body.counted)) ? Number(body.counted) : null,
  });
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/(count|\[id\]/recount|\[id\]/adjustments)" || echo "routes clean"`
Expected: `routes clean`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/inventory/[id]/recount" "src/app/api/inventory/count" "src/app/api/inventory/[id]/adjustments/route.ts"
git commit -m "feat(inventory): recount + batch count API endpoints"
```

---

### Task 5: Count history column + Quick recount on the item page

**Files:**
- Modify: `src/components/AdjustmentsLog.tsx` (add a "Counted" column)
- Create: `src/components/inventory/QuickRecount.tsx`
- Modify: `src/app/inventory/[id]/page.tsx` (render `QuickRecount`; retitle the card)

**Interfaces:**
- Consumes: `Adjustment.counted` (Task 1); `POST /api/inventory/:id/recount` (Task 4).

- [ ] **Step 1: Counted column in `AdjustmentsLog`**

In `src/components/AdjustmentsLog.tsx`:
- Add a header cell after the "Reason" `<th>`:
  ```tsx
  <th className="pb-1 pr-4 text-right font-medium">Counted</th>
  ```
- Add the matching body cell after the Reason `<td>` (before the Qty cell):
  ```tsx
  <td className="py-2 pr-4 text-right tabular-nums text-slate-600">{r.counted ?? "—"}</td>
  ```
- The locally-constructed `newRow` object (in `handleAdd`) must satisfy the `Adjustment` type, which now has `counted`. Add `counted: null,` to that object literal so it type-checks (manual adds carry no absolute count).

- [ ] **Step 2: QuickRecount component**

Create `src/components/inventory/QuickRecount.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function QuickRecount({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("recount");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const n = Number(counted);
    if (!Number.isInteger(n) || n < 0) { setErr("Enter a whole number (0 or more)."); return; }
    setErr(null); setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${itemId}/recount`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counted: n, reason }),
      });
      if (!res.ok) { setErr("Save failed."); return; }
      setCounted("");
      router.refresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-500">I counted
        <input type="number" className={`w-24 ${INPUT_CLASS}`} value={counted} onChange={(e) => { setCounted(e.target.value); setErr(null); }} placeholder="e.g. 40" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">Reason
        <select className={INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="recount">Recount</option>
          <option value="sample">Sample</option>
          <option value="damage_loss">Damage / Loss</option>
          <option value="other">Other</option>
        </select>
      </label>
      <Button onClick={submit} disabled={saving}>Set count</Button>
      {err && <p className="w-full text-sm text-red-600">{err}</p>}
      <p className="w-full text-xs text-slate-400">Records today&apos;s date + the number you counted, and adjusts remaining. Never touches cost.</p>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the item page**

In `src/app/inventory/[id]/page.tsx`:
- Add the import: `import { QuickRecount } from "@/components/inventory/QuickRecount";`
- Change the existing `<Card title="Adjustments">` that wraps `<AdjustmentsLog .../>` to title `"Count & adjustments"`, and render `QuickRecount` above the log inside that card:
  ```tsx
  <Card title="Count & adjustments">
    <div className="mb-4 rounded-xl border border-line p-3">
      <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Quick recount</p>
      <QuickRecount itemId={itemId} />
    </div>
    <AdjustmentsLog itemId={itemId} initial={initialAdjustments} />
  </Card>
  ```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "AdjustmentsLog|QuickRecount|inventory/\[id\]" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | tail -3`
Expected: `clean`; build completes.

- [ ] **Step 5: Commit**

```bash
git add src/components/AdjustmentsLog.tsx src/components/inventory/QuickRecount.tsx "src/app/inventory/[id]/page.tsx"
git commit -m "feat(inventory): quick recount control + counted column in history"
```

---

### Task 6: Full count-mode page

**Files:**
- Create: `src/app/inventory/count/page.tsx` (server: lists items with expected remaining)
- Create: `src/components/inventory/CountSheet.tsx` (client: counted inputs + diff + save)
- Modify: `src/app/inventory/page.tsx` (add a "Count merchandise" link in the header)

**Interfaces:**
- Consumes: `listItems`, `qtyRemaining` (existing); `POST /api/inventory/count` (Task 4).

- [ ] **Step 1: Count page (server)**

Create `src/app/inventory/count/page.tsx`:

```tsx
import { dbForRequest } from "@/lib/auth/request";
import { listItems, qtyRemaining } from "@/lib/db/inventory";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { CountSheet } from "@/components/inventory/CountSheet";

export const dynamic = "force-dynamic";

export default async function CountPage() {
  const db = await dbForRequest();
  const items = listItems(db).map((i) => ({ id: i.id, name: i.name, expected: qtyRemaining(db, i.id) }));
  return (
    <div className="space-y-6">
      <PageHeader title="Count merchandise" subtitle="Enter what you counted; blank rows are skipped"
        action={<Button variant="secondary" href="/inventory">← Inventory</Button>} />
      <CountSheet items={items} />
    </div>
  );
}
```

- [ ] **Step 2: CountSheet (client)**

Create `src/components/inventory/CountSheet.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";

type Item = { id: number; name: string; expected: number };
const today = () => new Date().toISOString().slice(0, 10);

export function CountSheet({ items }: { items: Item[] }) {
  const router = useRouter();
  const [on, setOn] = useState(today());
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const diff = (it: Item) => counts[it.id]?.trim() ? Number(counts[it.id]) - it.expected : null;

  async function save() {
    const rows = items
      .filter((it) => counts[it.id]?.trim() !== undefined && counts[it.id]?.trim() !== "")
      .map((it) => ({ itemId: it.id, counted: Number(counts[it.id]), reason: reasons[it.id] || "recount" }));
    if (rows.some((r) => !Number.isInteger(r.counted) || r.counted < 0)) { setErr("Counts must be whole numbers (0 or more)."); return; }
    setErr(null); setSaving(true);
    try {
      const res = await fetch("/api/inventory/count", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on, rows }),
      });
      if (!res.ok) { setErr("Save failed."); return; }
      router.push("/inventory");
      router.refresh();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">Count date
          <input type="date" className={INPUT_CLASS} value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
        <Button onClick={save} disabled={saving}>Save count</Button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-center">Counted</th><th className="px-3 py-2 text-right">Diff</th>
              <th className="px-3 py-2">Reason (if off)</th></tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const d = diff(it);
              return (
                <tr key={it.id} className="border-t border-line">
                  <td className="px-3 py-2">{it.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{it.expected}</td>
                  <td className="px-3 py-2 text-center">
                    <input type="number" className={`w-20 text-center ${INPUT_CLASS}`} value={counts[it.id] ?? ""}
                      onChange={(e) => setCounts((c) => ({ ...c, [it.id]: e.target.value }))} placeholder="—" />
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${d == null ? "text-slate-300" : d === 0 ? "text-emerald-700" : "text-red-600"}`}>
                    {d == null ? "—" : d === 0 ? "0 ✓" : d > 0 ? `+${d}` : d}
                  </td>
                  <td className="px-3 py-2">
                    {d != null && d !== 0 ? (
                      <select className={INPUT_CLASS} value={reasons[it.id] ?? "recount"} onChange={(e) => setReasons((r) => ({ ...r, [it.id]: e.target.value }))}>
                        <option value="recount">Recount</option><option value="sample">Sample</option>
                        <option value="damage_loss">Damage / Loss</option><option value="other">Other</option>
                      </select>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link from the inventory page**

In `src/app/inventory/page.tsx`: add the import `import { Button } from "@/components/ui/Button";` and give the `PageHeader` an action:
```tsx
<PageHeader title="Inventory" subtitle="Items, costs, and what's left to sell"
  action={<Button href="/inventory/count">Count merchandise</Button>} />
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit 2>&1 | grep -E "inventory/count|CountSheet" | grep -v "giveaway-items.test.ts" || echo "clean"` then `npm run build 2>&1 | grep "/inventory/count"`
Expected: `clean`; the build output lists the `/inventory/count` route.

- [ ] **Step 5: Commit**

```bash
git add "src/app/inventory/count" src/components/inventory/CountSheet.tsx src/app/inventory/page.tsx
git commit -m "feat(inventory): full count-mode page + link from inventory"
```

---

### Task 7: Full-suite verification

- [ ] **Step 1: Suite + build + backup drift-guard**

Run: `npm test && npm run build 2>&1 | tail -3`
Expected: all Vitest tests PASS (the backup drift-guard test still passes — `inventory_adjustments` was already in the workbook `TABLES`; the new `counted` column is inside that already-covered table, so no `TABLES` change is needed, but confirm the workbook test is green). Build completes. Note: `tests/lib/db/giveaway-items.test.ts` has a pre-existing tsc error unrelated to this work — tsc is not a clean gate on its own; confirm no NEW errors reference inventory/count files.

- [ ] **Step 2: Manual smoke (live dev)**

Run `npm run dev`, log in. On an item page: enter "I counted N" → the count history shows a dated row with the Counted value and the correct ± change; remaining updates. Open `/inventory/count`, fill a few Counted boxes (leave some blank), pick reasons on off rows, Save → returns to inventory with updated remaining; blank rows untouched; each counted item's history shows the dated count. Stop the dev server.

---

## Self-Review

**Spec coverage:**
- Remove samples display, keep "sample" reason → Task 3 (dead-code removal; display already gone) + reason retained everywhere. ✓
- `counted` column, history reads as absolute counts → Task 1 (column) + Task 5 (Counted column in log). ✓
- Quick single-item recount → Task 4 (recount API) + Task 5 (QuickRecount). ✓
- Full count mode, blank = skip, batch dated as one session → Task 4 (`/api/inventory/count` + `applyCount`) + Task 6 (CountSheet filters blanks, single `on` date). ✓
- No change to `qtyRemaining` / cost → Task 2 (`counted` is audit-only; `applyCount`/`setItemRemaining` only append `qty` deltas, never touch cost). ✓
- Whole-unit integer counts, non-negative → validated in Task 4 routes + Task 5/6 client guards. ✓

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `Adjustment.counted` (Task 1) consumed in Tasks 4–5; `setItemRemaining` opts + `applyCount` signatures (Task 2) match the route calls (Task 4); `ItemRow` without `qtySamples` (Task 3) matches `listItems` consumers (inventory pages spread the row and never read `qtySamples`). `AdjustReason` imported consistently. ✓
