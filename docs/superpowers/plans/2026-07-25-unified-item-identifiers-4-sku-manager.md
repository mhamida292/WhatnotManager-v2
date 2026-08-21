# Unified Item Identifiers — Plan 4: SKU-Manager Identifiers Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an item's detail page, replace the Whatnot-only mappings card with a unified **Identifiers** panel that shows every identifier for the item grouped by source (mine / supplier / whatnot), lets the user add a supplier or Whatnot identifier, remove any non-identity identifier, and edit the item's own SKU.

**Architecture:** Three small DB functions (`identifiersForItem`, `addIdentifier`, `setSku`) on top of the existing `item_identifiers` table, exposed via a new `/api/identifiers` route (add/remove) plus an extension of the existing `/api/inventory` PATCH (sku). A client component `ItemIdentifiers` on the item detail page reads the list and drives add/remove/sku-edit, refreshing on change. Removal reuses the existing `removeAlias` (deletes any identifier row by id); the `mine` identifier (the SKU) is never removable — it is edited via `setSku`, which keeps `inventory_items.sku` and the `mine` identifier's `code` in lockstep.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- Identity is the `mine` identifier: it always exists, its `code` equals `inventory_items.sku`, and it is NOT removable in the UI. Changing the SKU updates BOTH `inventory_items.sku` and the `mine` identifier's `code` atomically.
- `item_identifiers.code` has a GLOBAL `UNIQUE(code)`. Every add/sku-edit must be collision-guarded: reject (surface a clear error) when the (base-normalized) code is already owned by a DIFFERENT item; never steal it (consistent with Plan 3's `recordSupplierIdentifier`).
- Codes are stored base-normalized via `baseProductName` (`@/lib/csv/classify`), matching how `resolveItemId`/`setAlias` write and look up.
- Manual add applies to `source` ∈ {`supplier`, `whatnot`} only. `mine` is created at item creation and edited via `setSku`, never added manually.
- Removal reuses `removeAlias(db, aliasId)` (already `DELETE FROM item_identifiers WHERE id = ?`). The UI must not offer remove for the `mine` row; the API DELETE must also refuse to delete a `mine` identifier (defense in depth).
- Test env is node (`vitest.config.ts`), NO React Testing Library. The client component (Task 5) has NO unit test — verified by `npm run build` + controller live smoke. Do NOT add a test that renders a React component.
- Client "refresh after write" uses `router.refresh()` (the item detail page is a server component, `export const dynamic = "force-dynamic"`), matching `UnmapButton.tsx`.

---

### Task 1: `identifiersForItem` — list all identifiers for an item

**Files:**
- Modify: `src/lib/db/inventory.ts` (add function + interface; keep existing exports)
- Test: `tests/lib/db/identifiers-for-item.test.ts` (create)

**Interfaces:**
- Produces:
  ```typescript
  export interface ItemIdentifier {
    id: number; source: "mine" | "supplier" | "whatnot";
    code: string; supplierLabel: string | null; saleCount: number;
  }
  /** All identifiers for an item, ordered by source then code. saleCount is the
   *  number of ledger sales whose product_name matches the code (only nonzero for
   *  whatnot identifiers). */
  export function identifiersForItem(db: DB, itemId: number): ItemIdentifier[];
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/identifiers-for-item.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, identifiersForItem } from "@/lib/db/inventory";
import { setAlias, recordSupplierIdentifier } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

function addLedgerSale(db: DB, name: string) {
  db.prepare(`INSERT INTO ledger_transactions (created_at, show_date, amount_cents, kind, product_name, dedup_key)
    VALUES ('2026-01-01','2026-01-01',500,'sale',?,?)`).run(name, `k-${name}-${Math.random()}`);
}

describe("identifiersForItem", () => {
  it("lists mine + supplier + whatnot identifiers ordered by source then code", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    recordSupplierIdentifier(db, "ACME-1", id);
    setAlias(db, "Highland Cow Squishy", id);
    const rows = identifiersForItem(db, id);
    // mine (the sku ITEM-00001), supplier (ACME-1), whatnot (Highland Cow Squishy)
    expect(rows.map((r) => r.source)).toEqual(["mine", "supplier", "whatnot"]);
    expect(rows.find((r) => r.source === "mine")!.code).toBe("ITEM-00001");
  });

  it("reports saleCount for a whatnot identifier and 0 for others", () => {
    const id = insertItem(db, { name: "Cow", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Highland Cow Squishy", id);
    recordSupplierIdentifier(db, "ACME-1", id);
    addLedgerSale(db, "Highland Cow Squishy");
    addLedgerSale(db, "Highland Cow Squishy");
    const rows = identifiersForItem(db, id);
    expect(rows.find((r) => r.source === "whatnot")!.saleCount).toBe(2);
    expect(rows.find((r) => r.source === "supplier")!.saleCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- identifiers-for-item`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts`, add:

```typescript
export interface ItemIdentifier {
  id: number; source: "mine" | "supplier" | "whatnot";
  code: string; supplierLabel: string | null; saleCount: number;
}

export function identifiersForItem(db: DB, itemId: number): ItemIdentifier[] {
  return db.prepare(`
    SELECT ii.id, ii.source, ii.code, ii.supplier_label AS supplierLabel,
      (SELECT COUNT(*) FROM ledger_transactions lt
        WHERE lt.product_name = ii.code AND lt.kind = 'sale' AND ii.source = 'whatnot') AS saleCount
    FROM item_identifiers ii
    WHERE ii.item_id = ?
    ORDER BY CASE ii.source WHEN 'mine' THEN 0 WHEN 'supplier' THEN 1 ELSE 2 END, ii.code
  `).all(itemId) as ItemIdentifier[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- identifiers-for-item`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/identifiers-for-item.test.ts
git commit -m "feat(db): identifiersForItem lists all identifiers by source"
```

---

### Task 2: `addIdentifier` — collision-guarded manual add

**Files:**
- Modify: `src/lib/db/aliases.ts` (add function; keep existing exports)
- Test: `tests/lib/db/add-identifier.test.ts` (create)

**Interfaces:**
- Consumes: `baseProductName` (already imported).
- Produces:
  ```typescript
  export type AddIdentifierResult = { ok: true; id: number } | { ok: false; reason: "empty" | "duplicate" };
  /** Manually add a supplier/whatnot identifier. Collision-guarded on the global
   *  UNIQUE(code): a code already owned by a DIFFERENT item is rejected as duplicate;
   *  a code already on THIS item is a no-op success. */
  export function addIdentifier(
    db: DB,
    p: { itemId: number; source: "supplier" | "whatnot"; code: string; supplierLabel?: string | null },
  ): AddIdentifierResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/add-identifier.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { addIdentifier, resolveItemId, setAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("addIdentifier", () => {
  it("adds a supplier identifier that resolves to the item", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const r = addIdentifier(db, { itemId: id, source: "supplier", code: "ACME-9", supplierLabel: "Acme" });
    expect(r.ok).toBe(true);
    expect(resolveItemId(db, "ACME-9")).toBe(id);
  });

  it("rejects a code already owned by a different item as duplicate", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null });
    setAlias(db, "Taken", a);
    const r = addIdentifier(db, { itemId: b, source: "whatnot", code: "Taken" });
    expect(r).toEqual({ ok: false, reason: "duplicate" });
    expect(resolveItemId(db, "Taken")).toBe(a); // unchanged
  });

  it("rejects an empty code", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(addIdentifier(db, { itemId: id, source: "supplier", code: "   " })).toEqual({ ok: false, reason: "empty" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- add-identifier`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement**

In `src/lib/db/aliases.ts`, add:

```typescript
export type AddIdentifierResult = { ok: true; id: number } | { ok: false; reason: "empty" | "duplicate" };

export function addIdentifier(
  db: DB,
  p: { itemId: number; source: "supplier" | "whatnot"; code: string; supplierLabel?: string | null },
): AddIdentifierResult {
  const base = baseProductName(p.code);
  if (base === "") return { ok: false, reason: "empty" };
  const existing = db.prepare("SELECT item_id AS itemId, id FROM item_identifiers WHERE code = ?").get(base) as { itemId: number; id: number } | undefined;
  if (existing) {
    return Number(existing.itemId) === p.itemId ? { ok: true, id: existing.id } : { ok: false, reason: "duplicate" };
  }
  const info = db.prepare("INSERT INTO item_identifiers (item_id, source, code, supplier_label) VALUES (?,?,?,?)")
    .run(p.itemId, p.source, base, p.supplierLabel ?? null);
  return { ok: true, id: Number(info.lastInsertRowid) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- add-identifier`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/aliases.ts tests/lib/db/add-identifier.test.ts
git commit -m "feat(db): addIdentifier (collision-guarded manual identifier add)"
```

---

### Task 3: `setSku` — edit the item's SKU (keeps mine identifier in sync)

**Files:**
- Modify: `src/lib/db/inventory.ts` (add function; keep existing exports)
- Test: `tests/lib/db/set-sku.test.ts` (create)

**Interfaces:**
- Consumes: `baseProductName` (import from `@/lib/csv/classify` if not already imported in inventory.ts).
- Produces:
  ```typescript
  export type SetSkuResult = { ok: true } | { ok: false; reason: "empty" | "not_found" | "duplicate" };
  /** Change an item's SKU. Updates inventory_items.sku AND the item's 'mine'
   *  identifier code together (atomic). Collision-guarded against both the sku
   *  UNIQUE column and the item_identifiers UNIQUE(code). */
  export function setSku(db: DB, itemId: number, sku: string): SetSkuResult;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/set-sku.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, setSku } from "@/lib/db/inventory";
import { resolveItemId } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("setSku", () => {
  it("updates the sku column and the mine identifier together", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(setSku(db, id, "POK-BOOST-01")).toEqual({ ok: true });
    const row = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(id) as { sku: string };
    expect(row.sku).toBe("POK-BOOST-01");
    expect(resolveItemId(db, "POK-BOOST-01")).toBe(id);      // mine identifier updated
    expect(resolveItemId(db, "ITEM-00001")).toBeNull();       // old code no longer resolves
    const mineCount = db.prepare("SELECT COUNT(*) n FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(id) as { n: number };
    expect(mineCount.n).toBe(1);                              // still exactly one mine row
  });

  it("rejects a duplicate sku owned by another item", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 0, lotId: null }); // ITEM-00001
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 0, lotId: null }); // ITEM-00002
    expect(setSku(db, b, "ITEM-00001")).toEqual({ ok: false, reason: "duplicate" });
    const bRow = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(b) as { sku: string };
    expect(bRow.sku).toBe("ITEM-00002"); // unchanged
  });

  it("rejects empty and unknown item", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    expect(setSku(db, id, "  ")).toEqual({ ok: false, reason: "empty" });
    expect(setSku(db, 9999, "X")).toEqual({ ok: false, reason: "not_found" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- set-sku`
Expected: FAIL (function missing).

- [ ] **Step 3: Implement**

In `src/lib/db/inventory.ts`, add (import `baseProductName` from `@/lib/csv/classify` at the top if absent):

```typescript
export type SetSkuResult = { ok: true } | { ok: false; reason: "empty" | "not_found" | "duplicate" };

export function setSku(db: DB, itemId: number, sku: string): SetSkuResult {
  const base = baseProductName(sku);
  if (base === "") return { ok: false, reason: "empty" };
  const item = db.prepare("SELECT sku FROM inventory_items WHERE id = ?").get(itemId) as { sku: string | null } | undefined;
  if (!item) return { ok: false, reason: "not_found" };
  if (item.sku === base) return { ok: true };
  // collide against another item's sku column OR any other identifier owning this code
  const skuClash = db.prepare("SELECT 1 FROM inventory_items WHERE sku = ? AND id <> ?").get(base, itemId);
  const codeClash = db.prepare("SELECT 1 FROM item_identifiers WHERE code = ? AND item_id <> ?").get(base, itemId);
  if (skuClash || codeClash) return { ok: false, reason: "duplicate" };
  const tx = db.transaction(() => {
    db.prepare("UPDATE inventory_items SET sku = ? WHERE id = ?").run(base, itemId);
    // keep the mine identifier's code in lockstep (upsert if somehow missing)
    const mine = db.prepare("SELECT id FROM item_identifiers WHERE item_id = ? AND source = 'mine'").get(itemId) as { id: number } | undefined;
    if (mine) db.prepare("UPDATE item_identifiers SET code = ? WHERE id = ?").run(base, mine.id);
    else db.prepare("INSERT INTO item_identifiers (item_id, source, code) VALUES (?, 'mine', ?)").run(itemId, base);
  });
  tx();
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- set-sku`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/set-sku.test.ts
git commit -m "feat(db): setSku edits sku + mine identifier atomically"
```

---

### Task 4: API — `/api/identifiers` (add/remove) + sku in `/api/inventory` PATCH

**Files:**
- Create: `src/app/api/identifiers/route.ts`
- Modify: `src/app/api/inventory/route.ts` (PATCH accepts `sku`)
- Test: `tests/api/identifiers-api.test.ts` (create)

**Interfaces:**
- Consumes: `addIdentifier`, `removeAlias` (`@/lib/db/aliases`), `setSku` (`@/lib/db/inventory`).
- Produces:
  - `POST /api/identifiers` body `{ itemId, source, code, supplierLabel? }` → `{ ok: true, id }` or 400 `{ error }` (duplicate/empty).
  - `DELETE /api/identifiers` body `{ id }` → deletes the identifier, but 400 if it is a `mine` identifier.
  - `PATCH /api/inventory` additionally accepts `sku` → calls `setSku`, 409 on duplicate.

- [ ] **Step 1: Write the failing test**

Create `tests/api/identifiers-api.test.ts` following the repo's db-function test style (like other `tests/api/*`). Assert the underlying functions behave (the routes are thin wrappers):

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, identifiersForItem, setSku } from "@/lib/db/inventory";
import { addIdentifier, removeAlias } from "@/lib/db/aliases";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("identifiers api (data layer)", () => {
  it("add then remove a supplier identifier", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const r = addIdentifier(db, { itemId: id, source: "supplier", code: "ACME-2" });
    expect(r.ok).toBe(true);
    const before = identifiersForItem(db, id).length;
    removeAlias(db, (r as { ok: true; id: number }).id);
    expect(identifiersForItem(db, id).length).toBe(before - 1);
  });

  it("mine identifier is identifiable so the route can refuse to delete it", () => {
    const id = insertItem(db, { name: "Box", unitCostCents: 400, qtyPurchased: 0, lotId: null });
    const mine = identifiersForItem(db, id).find((r) => r.source === "mine")!;
    expect(mine.source).toBe("mine"); // route checks this before removeAlias
  });
});
```

> If the repo's `tests/api/*` call route handlers directly, match that; otherwise data-layer assertions (as above) are acceptable, consistent with the majority style.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- identifiers-api`
Expected: FAIL until the functions/routes exist (Tasks 1–3 provide the functions; this task adds the routes — the test above exercises the data layer that the routes wrap, so it should pass once Tasks 1–3 are in; if it already passes, still add the routes below and keep the test as a guard).

- [ ] **Step 3: Implement the routes**

Create `src/app/api/identifiers/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addIdentifier, removeAlias } from "@/lib/db/aliases";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const itemId = Number(b.itemId);
  const source = b.source === "supplier" || b.source === "whatnot" ? b.source : null;
  if (!Number.isInteger(itemId) || !source || typeof b.code !== "string")
    return NextResponse.json({ error: "Invalid identifier" }, { status: 400 });
  const r = addIdentifier(await dbForRequest(), {
    itemId, source, code: b.code,
    supplierLabel: typeof b.supplierLabel === "string" ? b.supplierLabel : null,
  });
  if (!r.ok) {
    const msg = r.reason === "duplicate" ? "That code is already used by another item" : "Enter a code";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const db = await dbForRequest();
  const row = db.prepare("SELECT source FROM item_identifiers WHERE id = ?").get(id) as { source: string } | undefined;
  if (row?.source === "mine") return NextResponse.json({ error: "Cannot remove the item's own SKU" }, { status: 400 });
  removeAlias(db, id);
  return NextResponse.json({ ok: true });
}
```

Modify `src/app/api/inventory/route.ts` PATCH to handle `sku` (add alongside the existing `name` branch; read the file to place it correctly and import `setSku`):

```typescript
  if (body.sku !== undefined) {
    if (typeof body.sku !== "string") return NextResponse.json({ error: "Invalid sku" }, { status: 400 });
    const r = setSku(db, id, body.sku);
    if (!r.ok) {
      if (r.reason === "duplicate") return NextResponse.json({ error: "That SKU is already used by another item" }, { status: 409 });
      if (r.reason === "not_found") return NextResponse.json({ error: "Item not found" }, { status: 404 });
      return NextResponse.json({ error: "Enter a SKU" }, { status: 400 });
    }
  }
```

- [ ] **Step 4: Run the test + build**

Run: `npm test -- identifiers-api` then `npm run build`
Expected: test PASS; build succeeds (new route registered).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/identifiers/route.ts src/app/api/inventory/route.ts tests/api/identifiers-api.test.ts
git commit -m "feat(api): /api/identifiers add/remove + sku in inventory PATCH"
```

---

### Task 5: UI — `ItemIdentifiers` panel on the item detail page

**Files:**
- Create: `src/components/inventory/ItemIdentifiers.tsx`
- Modify: `src/app/inventory/[id]/page.tsx` (replace the "Whatnot name mappings" card with the panel; compute `identifiersForItem`)
- Test: none new (no RTL — build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `ItemIdentifier` + `identifiersForItem` (Task 1); `POST/DELETE /api/identifiers`; `PATCH /api/inventory` (sku); existing `Card`, `Button`, `INPUT_CLASS` (`@/lib/ui/inputs`).
- Produces: a client panel showing SKU (editable), all identifiers grouped by source with Remove (non-mine), and an add form.

- [ ] **Step 1: Create the component**

Create `src/components/inventory/ItemIdentifiers.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import type { ItemIdentifier } from "@/lib/db/inventory";

const SOURCE_LABEL: Record<ItemIdentifier["source"], string> = {
  mine: "SKU", supplier: "Supplier", whatnot: "Whatnot name",
};

export function ItemIdentifiers({ itemId, sku, identifiers }: {
  itemId: number; sku: string | null; identifiers: ItemIdentifier[];
}) {
  const router = useRouter();
  const [skuVal, setSkuVal] = useState(sku ?? "");
  const [addSource, setAddSource] = useState<"supplier" | "whatnot">("supplier");
  const [addCode, setAddCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveSku() {
    if (skuVal.trim() === "" || skuVal.trim() === (sku ?? "")) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/inventory", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: itemId, sku: skuVal.trim() }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setSkuVal(sku ?? ""); }
    else router.refresh();
    setBusy(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (addCode.trim() === "") return;
    setBusy(true); setError(null);
    const res = await fetch("/api/identifiers", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, source: addSource, code: addCode.trim() }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
    setAddCode(""); router.refresh(); setBusy(false);
  }

  async function remove(id: number) {
    setBusy(true); setError(null);
    const res = await fetch("/api/identifiers", { method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }) });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed"); setBusy(false); return; }
    router.refresh(); setBusy(false);
  }

  return (
    <Card title={`Identifiers (${identifiers.length})`}>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-slate-500">SKU (item identity)</span>
          <input className={`font-mono ${INPUT_CLASS}`} value={skuVal} onChange={(e) => setSkuVal(e.target.value)} onBlur={saveSku} />
        </label>
      </div>

      <table className="w-full text-sm">
        <tbody>{identifiers.map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0">
            <td className="py-2 pr-3 text-xs uppercase text-slate-400">{SOURCE_LABEL[r.source]}</td>
            <td className="py-2 pr-3 font-mono">{r.code}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{r.source === "whatnot" ? `${r.saleCount} ${r.saleCount === 1 ? "sale" : "sales"}` : ""}</td>
            <td className="py-2 text-right">
              {r.source !== "mine" && (
                <button onClick={() => remove(r.id)} disabled={busy} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">Remove</button>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select className={INPUT_CLASS} value={addSource} onChange={(e) => setAddSource(e.target.value as "supplier" | "whatnot")}>
          <option value="supplier">Supplier code</option>
          <option value="whatnot">Whatnot name</option>
        </select>
        <input className={`flex-1 ${INPUT_CLASS}`} placeholder="Code or name" value={addCode} onChange={(e) => setAddCode(e.target.value)} />
        <Button type="submit" disabled={busy || addCode.trim() === ""}>Add</Button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Card>
  );
}
```

- [ ] **Step 2: Wire into the item detail page**

In `src/app/inventory/[id]/page.tsx`:
- Import: `import { identifiersForItem } from "@/lib/db/inventory";` (add to the existing `@/lib/db/inventory` import) and `import { ItemIdentifiers } from "@/components/inventory/ItemIdentifiers";`.
- Compute near the other reads: `const identifiers = identifiersForItem(db, itemId);`
- Replace the entire `<Card title={`Whatnot name mappings (${aliases.length})`}>…</Card>` block with:

```tsx
        <ItemIdentifiers itemId={item.id} sku={item.sku} identifiers={identifiers} />
```

(The `aliases`/`aliasesForItem` usage elsewhere on the page — the "Ledger sales" table uses `sales`, not `aliases` — so once the card is replaced, remove the now-unused `aliases` const and its `aliasesForItem` import if nothing else references them. Verify with a grep before deleting.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; no unused-import/type errors.

- [ ] **Step 4: Manual smoke on the dev copy**

On the item detail page of an item with a Whatnot mapping:
- The **Identifiers** card lists the `SKU` (mine, no Remove), plus any supplier/whatnot rows with Remove.
- Edit the SKU field + blur → it saves; the page shows the new SKU (and the item still resolves by it).
- Add a Supplier code → it appears; a Whatnot sale under that name would count (not required to verify here).
- Remove a non-mine identifier → it disappears.
- Try setting the SKU to another item's SKU → inline error "already used by another item", value reverts.

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/ItemIdentifiers.tsx src/app/inventory/[id]/page.tsx
git commit -m "feat(inventory): unified Identifiers panel on item detail page"
```

---

### Task 6: Full-suite green + build + end-to-end smoke

**Files:** none (verification only)

- [ ] **Step 1: Full suite** — Run: `npm test` — Expected: PASS (prior count + the new identifiers-for-item, add-identifier, set-sku, identifiers-api tests).
- [ ] **Step 2: Build** — Run: `npm run build` — Expected: succeeds.
- [ ] **Step 3: End-to-end smoke** — On the dev copy: open an item, edit its SKU, add a supplier code, remove it, and confirm the Whatnot rows still show sale counts. Confirm no dev-server console errors. Confirm the Inventory list and an item page still render (the removed `aliasesForItem` usage didn't break anything).
- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A && git commit -m "chore: finalize SKU-manager identifiers panel"
```

---

## Self-Review

**Spec coverage (design spec "SKU-manager UI" — panel portion):**
- Per-item view of all identifiers grouped by source → Tasks 1 + 5. ✓
- Add / remove / edit the item's SKU → Tasks 2 (add), removal via `removeAlias` (Task 4 route), 3 (setSku). ✓
- Collision-guarded so nothing steals a code → Tasks 2 + 3 (and Plan 3's `recordSupplierIdentifier` already). ✓
- **Deferred to Plan 5 (its own plan):** merging two items (re-pointing `item_id` across history tables). Explicitly out of scope here — it is the risky, money-row-rewriting operation and gets a dedicated plan.

**Placeholder scan:** none. Task 4/5 contain read-then-place instructions against existing files (the inventory PATCH `name` branch, the detail page's card block) — genuine adapt-to-existing steps, with the exact code to insert given. Task 5 has no automated test by the node-env/no-RTL constraint.

**Type consistency:** `ItemIdentifier` (Task 1) is the panel's prop type (Task 5). `addIdentifier`'s `AddIdentifierResult`/`setSku`'s `SetSkuResult` are consumed by the routes (Task 4). `/api/identifiers` bodies (`{itemId,source,code}` / `{id}`) and `/api/inventory` PATCH `{id,sku}` match the client calls in Task 5.
