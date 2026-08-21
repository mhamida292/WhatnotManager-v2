# Unified Item Identifiers — Plan 2: Whatnot Suggest-and-Confirm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Inventory page, turn the passive "these Whatnot names aren't mapped" banner into an active suggest-and-confirm list — each unmapped name is pre-matched to its best-guess inventory item, and the user confirms with one click (or overrides).

**Architecture:** A pure function `buildMapSuggestions` pairs each unmapped Whatnot product name with its best-match item using the EXISTING (already-tested, currently-unused) scorer in `src/lib/calc/name-match.ts` (`bestMatch`, `MATCH_THRESHOLD`). The Inventory server page computes the suggestion list and passes it to a new client component `UnmappedSuggestions`, which renders one row per name with a Confirm button (persists via the existing `POST /api/aliases`) and a "Change" item picker. Nothing is ever auto-applied — high-confidence matches are pre-selected but still require a click ("always ask").

**Tech Stack:** Next.js (App Router, server + client components), TypeScript, better-sqlite3, Vitest (node env — no React Testing Library).

## Global Constraints

- **Always ask:** a match at any score is only ever *pre-selected*; the alias is written only when the user clicks Confirm. Never auto-write an identifier from a score.
- Persisting a confirmed mapping uses the existing endpoint `POST /api/aliases` with body `{ productName, itemId }` (writes a `source='whatnot'` identifier via `setAlias`). Do not add a new write path.
- The scorer is `src/lib/calc/name-match.ts`: `score(a,b) → 0..1`, `bestMatch(name, items) → { itemId, score } | null`, and `MATCH_THRESHOLD = 0.5`. Reuse it; do not write new scoring logic.
- Whatnot product names are base-normalized (`baseProductName`). `buildLedgerReport(db).unmappedNames` and `seenProductNames(db)` already return base names.
- Test env is node (`vitest.config.ts` → `environment: "node"`). There is NO React Testing Library — component behavior is verified by extracting logic into pure tested functions plus a build + manual smoke. Do NOT add a test that renders a React component.
- Client-side "reload after write" follows the existing pattern in `src/components/InventoryForms.tsx` (`fetch(...)` then `location.reload()`).
- Suggestions are sorted **worst-score-first** so shaky guesses are easiest to eyeball (matches the automap design's stated ordering).

---

### Task 1: `buildMapSuggestions` pure function + tests

**Files:**
- Create: `src/lib/calc/map-suggestions.ts`
- Test: `tests/lib/calc/map-suggestions.test.ts`

**Interfaces:**
- Consumes: `bestMatch`, `MATCH_THRESHOLD` from `@/lib/calc/name-match`.
- Produces:
  ```typescript
  export interface MapSuggestion {
    productName: string;
    suggestedItemId: number | null;
    suggestedItemName: string | null;
    score: number;            // 0..1; 0 when no items
    confident: boolean;       // score >= MATCH_THRESHOLD
  }
  export function buildMapSuggestions(
    unmappedNames: string[],
    items: { id: number; name: string }[],
  ): MapSuggestion[];
  ```
  One entry per input name, sorted ascending by `score` (worst first), ties broken by `productName` ascending.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/map-suggestions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildMapSuggestions } from "@/lib/calc/map-suggestions";

const ITEMS = [
  { id: 1, name: "Highland Cow" },
  { id: 2, name: "Cheese Block" },
  { id: 3, name: "Axolotl" },
];

describe("buildMapSuggestions", () => {
  it("suggests the best-match item for each unmapped name", () => {
    const out = buildMapSuggestions(["Highland Cow Squishy (Assorted Colors)"], ITEMS);
    expect(out).toHaveLength(1);
    expect(out[0].suggestedItemId).toBe(1);
    expect(out[0].suggestedItemName).toBe("Highland Cow");
    expect(out[0].score).toBeGreaterThan(0.5);
    expect(out[0].confident).toBe(true);
  });

  it("flags a weak match as not confident but still suggests the closest item", () => {
    const out = buildMapSuggestions(["Completely Unrelated Widget"], ITEMS);
    expect(out[0].suggestedItemId).not.toBeNull();
    expect(out[0].confident).toBe(false);
  });

  it("returns a null suggestion with score 0 when there are no items", () => {
    const out = buildMapSuggestions(["Anything"], []);
    expect(out[0]).toEqual({
      productName: "Anything",
      suggestedItemId: null,
      suggestedItemName: null,
      score: 0,
      confident: false,
    });
  });

  it("sorts worst-score-first, ties broken by product name", () => {
    const out = buildMapSuggestions(
      ["Highland Cow Squishy", "Zzz No Match Here", "Aaa No Match Either"],
      ITEMS,
    );
    // The two non-matches score low and sort before the strong Highland Cow match;
    // between the two low scorers, name ascending puts "Aaa..." before "Zzz...".
    expect(out.map((s) => s.productName)).toEqual([
      "Aaa No Match Either",
      "Zzz No Match Here",
      "Highland Cow Squishy",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- map-suggestions`
Expected: FAIL ("buildMapSuggestions is not a function" / module not found).

- [ ] **Step 3: Implement**

Create `src/lib/calc/map-suggestions.ts`:

```typescript
import { bestMatch, MATCH_THRESHOLD } from "@/lib/calc/name-match";

export interface MapSuggestion {
  productName: string;
  suggestedItemId: number | null;
  suggestedItemName: string | null;
  score: number;
  confident: boolean;
}

/** Pair each unmapped Whatnot name with its best-match inventory item.
 *  Pure: no DB. Sorted worst-score-first so shaky guesses are easiest to review. */
export function buildMapSuggestions(
  unmappedNames: string[],
  items: { id: number; name: string }[],
): MapSuggestion[] {
  const byId = new Map(items.map((i) => [i.id, i.name]));
  const out: MapSuggestion[] = unmappedNames.map((productName) => {
    const m = bestMatch(productName, items);
    return {
      productName,
      suggestedItemId: m ? m.itemId : null,
      suggestedItemName: m ? byId.get(m.itemId) ?? null : null,
      score: m ? m.score : 0,
      confident: m ? m.score >= MATCH_THRESHOLD : false,
    };
  });
  out.sort((a, b) => (a.score === b.score ? a.productName.localeCompare(b.productName) : a.score - b.score));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- map-suggestions`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/map-suggestions.ts tests/lib/calc/map-suggestions.test.ts
git commit -m "feat(inventory): buildMapSuggestions pairs unmapped names with best-match items"
```

---

### Task 2: `UnmappedSuggestions` client component + wire into Inventory page

**Files:**
- Create: `src/components/inventory/UnmappedSuggestions.tsx`
- Modify: `src/app/inventory/page.tsx` (compute suggestions; render the component)
- Test: none new (component has no extractable logic beyond Task 1; verified by build + smoke per Global Constraints)

**Interfaces:**
- Consumes: `MapSuggestion` + `buildMapSuggestions` (Task 1); existing `ItemCombobox` (`src/components/ItemCombobox.tsx`, props `{ items, value, onChange, listId?, placeholder? }`); existing `POST /api/aliases`.
- Produces: a client component `UnmappedSuggestions({ suggestions, items })` rendering one Confirm-able row per suggestion.

- [ ] **Step 1: Create the client component**

Create `src/components/inventory/UnmappedSuggestions.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ItemCombobox } from "@/components/ItemCombobox";
import type { MapSuggestion } from "@/lib/calc/map-suggestions";

async function confirmAlias(productName: string, itemId: number) {
  await fetch("/api/aliases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName, itemId }),
  });
  location.reload();
}

function Row({ s, items }: { s: MapSuggestion; items: { id: number; name: string }[] }) {
  // Pre-select the suggestion, but never auto-apply — the user must click Confirm.
  const [itemId, setItemId] = useState<number | null>(s.suggestedItemId);
  const pct = Math.round(s.score * 100);

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="font-medium">{s.productName}</div>
      <div className="mt-1 text-xs text-slate-500">
        {s.suggestedItemName
          ? <>Best match: <span className="font-mono">{s.suggestedItemName}</span> ({pct}%){!s.confident && " — low confidence, please review"}</>
          : "No inventory items to match against"}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1">
          <ItemCombobox
            items={items}
            value={itemId}
            onChange={setItemId}
            listId={`map-${s.productName.replace(/\W+/g, "-")}`}
            placeholder="Search inventory item…"
          />
        </div>
        <Button
          onClick={() => { if (itemId != null) confirmAlias(s.productName, itemId); }}
          disabled={itemId == null}
        >
          {itemId === s.suggestedItemId && s.confident ? "Confirm" : "Map"}
        </Button>
      </div>
    </div>
  );
}

export function UnmappedSuggestions({
  suggestions,
  items,
}: {
  suggestions: MapSuggestion[];
  items: { id: number; name: string }[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <Card title={`Unmapped Whatnot names (${suggestions.length}) — confirm a match`}>
      <div className="space-y-2 text-sm">
        {suggestions.map((s) => <Row key={s.productName} s={s} items={items} />)}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into the Inventory page**

In `src/app/inventory/page.tsx`:

Add imports near the other imports:

```typescript
import { buildMapSuggestions } from "@/lib/calc/map-suggestions";
import { UnmappedSuggestions } from "@/components/inventory/UnmappedSuggestions";
```

After the existing `const { unmappedCount, unmappedNames } = buildLedgerReport(db);` line, add:

```typescript
  const mapSuggestions = buildMapSuggestions(unmappedNames, active.map((i) => ({ id: i.id, name: i.name })));
```

Then render the component. Replace the existing amber banner block:

```tsx
      {unmappedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {unmappedCount} Whatnot product name(s) aren&apos;t mapped to any item — their sales count at $0 profit: {unmappedNames.join(", ")}. <a href="#mapping" className="underline font-medium">Map them below.</a>
        </div>
      )}
```

with:

```tsx
      {unmappedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {unmappedCount} Whatnot product name(s) aren&apos;t mapped — their sales count at $0 profit. Confirm each below.
        </div>
      )}

      {mapSuggestions.length > 0 && (
        <UnmappedSuggestions suggestions={mapSuggestions} items={active.map((i) => ({ id: i.id, name: i.name }))} />
      )}
```

Leave the existing `InventoryForms` "Map Whatnot name → item" manual form in the `#mapping` grid as-is — it remains the way to map a name that isn't in the unmapped-sales list (e.g. a name the user knows will appear).

- [ ] **Step 3: Typecheck / build**

Run: `npm run build`
Expected: succeeds, no TypeScript errors. (Confirms the server/client component boundary and props line up — `MapSuggestion` import in a client component is type-only, fine.)

- [ ] **Step 4: Manual smoke on the dev copy**

With the dev server running against the throwaway copy (isolated `DATA_DIR`, never real `data/`):
- Log in, open **Inventory**.
- Confirm the new **"Unmapped Whatnot names — confirm a match"** card appears listing names, each with a suggested item + score and a Confirm/Map button.
- Click **Confirm** on one high-confidence row → page reloads → that name drops off the unmapped list and the item's sold/remaining reflects the newly counted sales.
- On a low-confidence row, verify it reads "low confidence, please review" and the button says "Map" (not the emphasized "Confirm"), and that using the picker to choose a different item then mapping works.

- [ ] **Step 5: Commit**

```bash
git add src/components/inventory/UnmappedSuggestions.tsx src/app/inventory/page.tsx
git commit -m "feat(inventory): suggest-and-confirm card for unmapped Whatnot names"
```

---

### Task 3: Full-suite green + build + final smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: PASS (Plan-1 count + the 4 new `map-suggestions` tests).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds, no TypeScript errors.

- [ ] **Step 3: End-to-end smoke**

On the dev copy: import is not required — existing ledger data already has unmapped names. Verify the full loop once more: Inventory → Unmapped card → Confirm a suggestion → it persists (the name no longer appears after reload; re-opening the item detail page shows the mapped Whatnot name under its aliases). Confirm no console errors in the dev server log.

- [ ] **Step 4: Final commit (only if fixups were needed)**

```bash
git add -A
git commit -m "chore: finalize whatnot suggest-and-confirm"
```

---

## Self-Review

**Spec coverage (Plan 2 portion of the design spec's "Suggest-and-confirm" section):**
- Reusable fuzzy scorer proposing best match per unknown → Task 1 reuses `name-match.ts`. ✓
- High confidence pre-selected / one-click confirm; low confidence flagged for review → Task 2 (`confident` flag drives label + review hint). ✓
- Always an option to pick a different item / never auto-apply → Task 2 (ItemCombobox override; Confirm is always a click). ✓
- Confirm writes one `source='whatnot'` identifier, remembered permanently → via existing `POST /api/aliases` → `setAlias`. ✓
- **Deferred to later plans (not this one):** the invoice/supplier-code path and the `UNIQUE(code)` collision hardening for supplier writes (design spec Open Questions), and the SKU-manager/merge UI. Out of scope here by design.

**Placeholder scan:** none. Task 2 has no new automated test by explicit Global Constraint (node test env, no RTL); its logic lives in Task 1's tested pure function, and it is verified by build + manual smoke.

**Type consistency:** `MapSuggestion` (Task 1) is the exact prop type consumed in Task 2. `buildMapSuggestions(names, items)` is called with `active.map(i => ({id, name}))` matching its `{id:number; name:string}[]` param. `POST /api/aliases` body `{ productName, itemId }` matches the existing route handler.
