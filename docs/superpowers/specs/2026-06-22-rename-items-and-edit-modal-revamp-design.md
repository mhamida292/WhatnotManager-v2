# Rename inventory items + Edit modal revamp — design

Date: 2026-06-22

## Goal

1. Let the user rename an inventory item **without affecting its alias mappings**, sale counts, or COGS.
2. Revamp the Edit Item modal to fix two specific complaints: **inconsistent saving** (some
   fields save on blur, purchases via buttons, no clear commit) and a **cluttered/cramped layout**.

## Why renaming is safe

`product_aliases` maps a Whatnot product name → `item_id` (a foreign key), **never** the item's
display name. Ledger sale counts and COGS resolve live through `item_id`. Therefore changing
`inventory_items.name` touches nothing else — no data migration, no alias updates.

The only constraint: `inventory_items.name` is `UNIQUE`, so a rename must reject a name already
used by a *different* item.

## Changes

### 1. DB layer — `src/lib/db/inventory.ts`

New function:

```ts
type RenameResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "not_found" };
renameItem(db: DB, id: number, name: string): RenameResult
```

- Trim `name`; if empty → `{ ok: false, reason: "empty" }`.
- If no item with `id` → `{ ok: false, reason: "not_found" }`.
- Renaming an item to **its own current name** is a no-op success (`{ ok: true }`).
- If another item already has that (trimmed) name → `{ ok: false, reason: "duplicate" }`
  (checked explicitly so SQLite's UNIQUE error never surfaces as a 500).
- Otherwise `UPDATE inventory_items SET name = ? WHERE id = ?` → `{ ok: true }`.

### 2. API — `PATCH /api/inventory`

Extend the existing PATCH (which already handles `qtySamples` and `targetRemaining`) to accept an
optional `name` field, so the modal's Details panel can commit name + samples + remaining in one request:

- If `name !== undefined`: must be a string; call `renameItem`.
- On `reason: "duplicate"` → respond `409 { error: "An item with that name already exists" }`.
- On `reason: "empty"` → respond `400 { error: "Name cannot be empty" }`.
- On `reason: "not_found"` → respond `404 { error: "Not found" }`.
- `name`, `qtySamples`, and `targetRemaining` may all be present in one PATCH; apply each that is
  present. If `name` fails, return its error and do not silently partially-apply (validate name first).

### 3. UI — `EditItemModal` (`src/components/EditItemModal.tsx`)

Restructure into two visually separated panels (Layout A from the visual companion):

**Panel 1 — "Details"** (item attributes):
- Fields: **Name** (text), **Samples** (number), **Remaining** (number).
- **No save-on-blur.** Edits stay in local component state (pending) until the user clicks **Save**.
- A subtle **"Unsaved changes"** indicator appears once any of the three fields differs from its
  loaded value.
- **Save** sends one `PATCH /api/inventory` with `{ id, name, qtySamples, targetRemaining }`,
  then `router.refresh()`. **Cancel** resets the three fields to their loaded values (discard).
- Duplicate-name / validation errors from the API surface inline within this panel.

**Panel 2 — "Purchase history"** (the batch records):
- The list of purchases stays (each is a real DB row with its own add/edit/delete — they act
  immediately, since they are discrete records).
- The add/edit-purchase form is **hidden by default** behind a **"+ Add purchase"** button; clicking
  reveals the inline form. Editing an existing purchase row also reveals it pre-filled.
- Purchase add/edit/delete continue to call `/api/purchases` as today.

The two panels stack with clear headings and breathing room so the modal scans top-to-bottom instead
of feeling crammed. Errors surface inline per panel.

### 4. Tests — `tests/lib/db/inventory.test.ts`

- `renameItem` changes the name on success.
- **Core guarantee:** after renaming an item that has aliases + ledger sales, its aliases are intact
  and `qtySold` is unchanged.
- Duplicate name (another item) → `{ ok: false, reason: "duplicate" }`, name unchanged.
- Empty/whitespace name → `{ ok: false, reason: "empty" }`.
- Unknown id → `{ ok: false, reason: "not_found" }`.
- Renaming to own current name → `{ ok: true }`, no error.

(API-level duplicate→409 may be covered by an existing API test file if one exists for inventory;
otherwise the DB tests above are the priority.)

## Out of scope

- No schema migration (name column already exists and is UNIQUE).
- No change to alias resolution, COGS, or the report — those are unaffected by definition.
- No inline rename in the inventory table (decided: Edit modal only).
