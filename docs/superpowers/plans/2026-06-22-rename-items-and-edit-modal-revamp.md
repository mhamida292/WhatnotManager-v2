# Rename Items + Edit Modal Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename an inventory item without affecting alias mappings or sale counts, and revamp the Edit Item modal so item attributes save with one explicit Save/Cancel and the purchase add-form is hidden by default.

**Architecture:** `product_aliases` keys off `item_id`, so a rename only updates `inventory_items.name` — no alias/COGS impact. A new `renameItem` DB function (with explicit duplicate/empty/not-found handling) is exposed through the existing `PATCH /api/inventory`. The `EditItemModal` is restructured into a "Details" panel (Name/Samples/Remaining, explicit Save/Cancel, one PATCH) and a "Purchase history" panel (add-form revealed on demand).

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, React client components, Vitest, Tailwind.

## Global Constraints

- Money is stored as integer cents everywhere.
- `inventory_items.name` is `TEXT NOT NULL UNIQUE` — a rename must reject a name used by a different item.
- DB layer functions take `db: DB` as the first arg; tests use `createDb(":memory:")`.
- Test runner: `npx vitest run <path>`.
- Follow existing code style (terse, single-line helpers, named exports).

---

### Task 1: `renameItem` DB function

**Files:**
- Modify: `src/lib/db/inventory.ts` (add `renameItem` + `RenameResult` type after `setItemRemaining`, ~line 158)
- Test: `tests/lib/db/inventory.test.ts` (add a `describe("renameItem")` block; import `renameItem`)

**Interfaces:**
- Consumes: `insertItem`, `qtySold`, `setAlias`, `resolveItemId`, `saveLedger`, `parseLedger` (already imported in the test file).
- Produces:
  ```ts
  type RenameResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "not_found" };
  function renameItem(db: DB, id: number, name: string): RenameResult
  ```

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/db/inventory.test.ts`. First add `renameItem` to the existing import from `@/lib/db/inventory` (line 3-6 block). Then append this describe block:

```ts
describe("renameItem", () => {
  it("renames an item on success", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(renameItem(db, id, "Cheddar")).toEqual({ ok: true });
    expect(listItems(db)[0].name).toBe("Cheddar");
  });

  it("trims whitespace from the new name", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(renameItem(db, id, "  Cheddar  ")).toEqual({ ok: true });
    expect(listItems(db)[0].name).toBe("Cheddar");
  });

  it("keeps aliases and qtySold intact across a rename (the core guarantee)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
    setAlias(db, "Cheese Squishy", id);
    expect(qtySold(db, id)).toBe(2);

    expect(renameItem(db, id, "Cheddar")).toEqual({ ok: true });

    expect(resolveItemId(db, "Cheese Squishy")).toBe(id); // mapping untouched
    expect(qtySold(db, id)).toBe(2);                       // sale count untouched
  });

  it("rejects a name already used by a different item", () => {
    const a = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    insertItem(db, { name: "Cheddar", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(renameItem(db, a, "Cheddar")).toEqual({ ok: false, reason: "duplicate" });
    expect(listItems(db).find((i) => i.id === a)!.name).toBe("Cheese"); // unchanged
  });

  it("allows renaming an item to its own current name (no-op success)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(renameItem(db, id, "Cheese")).toEqual({ ok: true });
  });

  it("rejects an empty or whitespace-only name", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(renameItem(db, id, "   ")).toEqual({ ok: false, reason: "empty" });
    expect(listItems(db)[0].name).toBe("Cheese");
  });

  it("returns not_found for an unknown id", () => {
    expect(renameItem(db, 9999, "Whatever")).toEqual({ ok: false, reason: "not_found" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/db/inventory.test.ts -t renameItem`
Expected: FAIL — `renameItem is not a function` / not exported.

- [ ] **Step 3: Implement `renameItem`**

Append to `src/lib/db/inventory.ts` (after `setItemRemaining`):

```ts
export type RenameResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "not_found" };

/** Rename an inventory item. Aliases key off item_id, so this never affects
 *  mappings, sale counts, or COGS. Rejects empty names and names already used
 *  by a *different* item (the UNIQUE constraint), surfacing a reason instead of
 *  letting SQLite throw. Renaming an item to its own current name is a no-op. */
export function renameItem(db: DB, id: number, name: string): RenameResult {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  const item = db.prepare("SELECT name FROM inventory_items WHERE id = ?").get(id) as { name: string } | undefined;
  if (!item) return { ok: false, reason: "not_found" };
  if (item.name === trimmed) return { ok: true };
  const clash = db.prepare("SELECT 1 FROM inventory_items WHERE name = ? AND id <> ?").get(trimmed, id);
  if (clash) return { ok: false, reason: "duplicate" };
  db.prepare("UPDATE inventory_items SET name = ? WHERE id = ?").run(trimmed, id);
  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/db/inventory.test.ts -t renameItem`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat(inventory): renameItem db fn (alias-safe, dup/empty guarded)"
```

---

### Task 2: Accept `name` in `PATCH /api/inventory`

**Files:**
- Modify: `src/app/api/inventory/route.ts` (the `PATCH` handler, lines 24-43)

**Interfaces:**
- Consumes: `renameItem` from Task 1, plus existing `updateItemSamples`, `setItemRemaining`.
- Produces: `PATCH /api/inventory` now also accepts `{ id, name }`. Validation order: `name` first
  (so a bad name short-circuits before samples/remaining are applied). Responses:
  `409 { error: "An item with that name already exists" }` (duplicate),
  `400 { error: "Name cannot be empty" }` (empty), `404 { error: "Not found" }` (unknown id),
  `400 { error: "Invalid name" }` (non-string).

**No unit test:** the codebase has no route-handler tests and no `getDb` mocking pattern; introducing
one would be novel and fragile. The real logic lives in `renameItem` (fully tested in Task 1); this
route is thin glue mapping reasons → status codes. It is verified by `npm run build` (type-check)
here and exercised end-to-end by the Task 3 manual smoke check (rename + duplicate via the UI).

- [ ] **Step 1: Implement the route change**

In `src/app/api/inventory/route.ts`, add `renameItem` to the import from `@/lib/db/inventory` (line 3). Then, inside `PATCH`, immediately after the `const db = getDb();` line and before the `qtySamples` block, insert:

```ts
  if (body.name !== undefined) {
    if (typeof body.name !== "string") return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    const r = renameItem(db, id, body.name);
    if (!r.ok) {
      if (r.reason === "duplicate") return NextResponse.json({ error: "An item with that name already exists" }, { status: 409 });
      if (r.reason === "empty") return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
```

(The existing `qtySamples` and `targetRemaining` blocks stay unchanged below it.)

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors in `route.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/route.ts
git commit -m "feat(api): accept name in PATCH /api/inventory (rename)"
```

---

### Task 3: Revamp `EditItemModal` (Details panel + collapsed purchase form)

**Files:**
- Modify: `src/components/EditItemModal.tsx` (full restructure of the component body)

**Interfaces:**
- Consumes: `PATCH /api/inventory` with `{ id, name, qtySamples, targetRemaining }`; existing
  `/api/purchases` POST/PATCH/DELETE; `PurchaseList`, `Modal`, `Button`, `INPUT_CLASS`,
  `toCents`, `toDollars`.
- Produces: restructured modal. No prop signature change (still
  `{ itemId, name, initialPurchases, initialSamples, initialRemaining, onClose }`).

This task is UI; it has no unit test. Verify by `npm run build` (type-check) plus a manual smoke
check listed in Step 4.

- [ ] **Step 1: Rewrite the component**

Replace the body of `src/components/EditItemModal.tsx` with the version below. Key changes:
(a) a **Details** panel holding Name/Samples/Remaining in local pending state with explicit
**Save/Cancel** doing one PATCH; (b) an "Unsaved changes" hint when any of the three differs from
its loaded value; (c) the purchase add/edit form **hidden** behind a "+ Add purchase" button
(revealed by `showForm`, also opened when editing a row).

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { PurchaseList, type PurchaseRow } from "@/components/PurchaseList";
import { Button } from "@/components/ui/Button";
import { INPUT_CLASS } from "@/lib/ui/inputs";
import { toCents, toDollars } from "@/lib/money";

const today = () => new Date().toISOString().slice(0, 10);

export function EditItemModal({ itemId, name, initialPurchases, initialSamples, initialRemaining, onClose }: {
  itemId: number; name: string; initialPurchases: PurchaseRow[]; initialSamples: number; initialRemaining: number; onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PurchaseRow[]>(initialPurchases);

  // Details panel — pending until Save.
  const [dName, setDName] = useState(name);
  const [dSamples, setDSamples] = useState(String(initialSamples));
  const [dRemaining, setDRemaining] = useState(String(initialRemaining));
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const dirty = dName !== name || dSamples !== String(initialSamples) || dRemaining !== String(initialRemaining);

  // Purchase form — hidden until +Add or editing a row.
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: today(), qty: "", cost: "" });
  const [editing, setEditing] = useState<number | null>(null);
  const [purchaseError, setPurchaseError] = useState(false);

  function close() { router.refresh(); onClose(); }

  async function saveDetails() {
    const samples = Math.trunc(Number(dSamples));
    const remaining = Math.trunc(Number(dRemaining));
    if (dName.trim() === "" || !(samples >= 0) || !(remaining >= 0)) { setDetailsError("Check the values and try again."); return; }
    const res = await fetch("/api/inventory", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: itemId, name: dName.trim(), qtySamples: samples, targetRemaining: remaining }),
    });
    if (!res.ok) {
      const msg = res.status === 409 ? "An item with that name already exists." : "Could not save — check the values.";
      setDetailsError(msg); return;
    }
    setDetailsError(null);
    router.refresh();
  }

  function cancelDetails() {
    setDName(name); setDSamples(String(initialSamples)); setDRemaining(String(initialRemaining));
    setDetailsError(null);
  }

  function openAdd() { setEditing(null); setForm({ date: today(), qty: "", cost: "" }); setShowForm(true); }
  function startEdit(p: PurchaseRow) {
    setEditing(p.id);
    setForm({ date: p.purchasedOn ?? "", qty: String(p.quantity), cost: toDollars(p.unitCostCents).toFixed(2) });
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditing(null); setForm({ date: today(), qty: "", cost: "" }); }

  async function addOrSave() {
    const qty = Math.trunc(Number(form.qty));
    const cents = toCents(Number(form.cost));
    if (!(qty >= 1) || !(cents >= 0)) { setPurchaseError(true); return; }
    setPurchaseError(false);
    const body = { id: editing, itemId, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents };
    const res = await fetch("/api/purchases", {
      method: editing == null ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { setPurchaseError(true); return; }
    if (editing == null) {
      const { id } = await res.json();
      setRows([...rows, { id, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents }]);
    } else {
      setRows(rows.map((r) => r.id === editing ? { ...r, purchasedOn: form.date || null, quantity: qty, unitCostCents: cents } : r));
    }
    closeForm();
  }

  async function remove(id: number) {
    const res = await fetch("/api/purchases", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (!res.ok) { setPurchaseError(true); return; }
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <Modal title="Edit item" onClose={close}>
      <div className="space-y-4">
        <div className="rounded-xl border border-line p-3">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Details</p>
          <label className="mb-2 block text-sm">
            <span className="text-slate-500">Name</span>
            <input type="text" className={`mt-1 w-full ${INPUT_CLASS}`} value={dName} onChange={(e) => setDName(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Samples (kept, not for sale)</span>
              <input type="number" min="0" className={`w-24 ${INPUT_CLASS}`} value={dSamples} onChange={(e) => setDSamples(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Remaining (manual count)</span>
              <input type="number" min="0" className={`w-24 ${INPUT_CLASS}`} value={dRemaining} onChange={(e) => setDRemaining(e.target.value)} />
            </label>
            {dirty && <span className="ml-auto self-center text-xs font-medium text-amber-600">Unsaved changes</span>}
          </div>
          {detailsError && <p className="mt-2 text-sm text-red-600">{detailsError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" onClick={cancelDetails} disabled={!dirty}>Cancel</Button>
            <Button onClick={saveDetails} disabled={!dirty}>Save</Button>
          </div>
        </div>

        <div className="rounded-xl border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-slate-500">Purchase history</p>
            {!showForm && <Button variant="secondary" onClick={openAdd}>+ Add purchase</Button>}
          </div>
          <PurchaseList purchases={rows} onEdit={startEdit} onDelete={remove} />

          {showForm && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">{editing == null ? "Add a purchase" : "Edit purchase"}</p>
              <div className="flex flex-wrap items-end gap-2">
                <input type="date" className={INPUT_CLASS} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                <input type="number" min="1" placeholder="Qty" className={`w-20 ${INPUT_CLASS}`} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                <input type="number" step="0.01" min="0" placeholder="Unit cost $" className={`w-28 ${INPUT_CLASS}`} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
                <Button onClick={addOrSave}>{editing == null ? "Add" : "Save"}</Button>
                <Button variant="secondary" onClick={closeForm}>Cancel</Button>
              </div>
              {purchaseError && <p className="mt-2 text-sm text-red-600">Something went wrong — check the values and try again.</p>}
            </div>
          )}
        </div>

        <div className="flex justify-end"><Button variant="secondary" onClick={close}>Done</Button></div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check / build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors in `EditItemModal.tsx`.

(If `Button` does not accept a `disabled` prop, check `src/components/ui/Button.tsx`; if it
spreads `...props` to the underlying `<button>`, `disabled` already works. If it does not, drop the
`disabled={!dirty}` attributes — the Cancel/Save buttons stay always-enabled, which is acceptable.)

- [ ] **Step 3: Run the full test suite (no regressions)**

Run: `npx vitest run`
Expected: all tests pass (the prior suite plus Tasks 1-2 additions).

- [ ] **Step 4: Manual smoke check**

Run: `rm -rf .next && npm run dev`, open `/inventory`, click **Edit** on an item:
- Change the Name → "Unsaved changes" appears → **Save** persists it (table updates); reopen shows the new name.
- Rename to an existing item's name → inline "An item with that name already exists." and the name does not change.
- **Cancel** reverts pending Name/Samples/Remaining edits.
- Purchase form is hidden until **+ Add purchase**; adding/editing/deleting a purchase still works; **Cancel** hides the form.

- [ ] **Step 5: Commit**

```bash
git add src/components/EditItemModal.tsx
git commit -m "feat(inventory): revamp Edit modal — Details Save/Cancel + rename, collapsed purchase form"
```

---

## Self-Review notes

- **Spec coverage:** rename DB fn (Task 1), PATCH name + 409/400/404 (Task 2), Details panel explicit Save/Cancel + Unsaved-changes hint + rename field (Task 3), purchase form hidden behind +Add / Layout A (Task 3), core-guarantee test that aliases+qtySold survive (Task 1). All spec sections covered.
- **No schema migration** — confirmed, `name` column already exists and is UNIQUE.
- **Type consistency:** `RenameResult` reasons (`empty`/`duplicate`/`not_found`) used identically in Tasks 1 and 2; `renameItem(db, id, name)` signature matches across tasks.
