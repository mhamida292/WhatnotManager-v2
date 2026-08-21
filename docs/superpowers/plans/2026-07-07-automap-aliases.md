# Automap Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time CLI script that fuzzy-matches unmapped Whatnot product names to inventory items and proposes/writes `product_aliases`, dry-run by default.

**Architecture:** A pure, unit-tested scorer (`src/lib/calc/name-match.ts`) does the matching; a thin script (`scripts/automap.ts`) resolves a workspace by username, feeds unmapped names + inventory items through the scorer, prints suggestions, and (with `--apply`) writes above-threshold aliases via the existing `setAlias`.

**Tech Stack:** TypeScript, better-sqlite3, tsx (script runner), Vitest (tests). No new dependencies.

## Global Constraints

- No new npm dependencies (pure TS scorer, no fuzzy-match library).
- Money/COGS untouched — the only DB mutation is `product_aliases` rows via `setAlias`.
- Workspace resolution mirrors `scripts/seed-demo.ts`: `getUsersDb()` → user id → `getDb(id)`.
- Archived inventory items (`archived_at IS NOT NULL`) are excluded from match candidates.
- Confidence threshold is a named constant, default `0.5`; gates `--apply` only, never dry-run output.
- `--user <username>` is required; `--apply` is optional (absent = dry-run).
- Reuse `seenProductNames` and `setAlias` from `src/lib/db/aliases.ts` unchanged.

---

### Task 1: Pure name-match scorer

**Files:**
- Create: `src/lib/calc/name-match.ts`
- Test: `tests/lib/calc/name-match.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no DB).
- Produces:
  - `MATCH_THRESHOLD: number` (= `0.5`)
  - `score(a: string, b: string): number` — normalized similarity in `0..1`, `1` for exact normalized match.
  - `bestMatch(name: string, items: { id: number; name: string }[]): { itemId: number; score: number } | null` — best-scoring item, `null` if `items` is empty. Ties broken by shortest item name, then smallest id.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { score, bestMatch, MATCH_THRESHOLD } from "@/lib/calc/name-match";

const items = [
  { id: 1, name: "Cheese" },
  { id: 2, name: "Highland Cow" },
  { id: 3, name: "Viral Mystery" },
  { id: 4, name: "Orbeez Stuffed" },
  { id: 5, name: "Pushy Squishy Ice Cream" },
];

describe("score", () => {
  it("scores an exact normalized match as 1", () => {
    expect(score("Cheese", "cheese")).toBe(1);
  });

  it("scores a noise-word variant highly", () => {
    expect(score("Cheese Squishy", "Cheese")).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("scores unrelated names below threshold", () => {
    expect(score("Highland Cow", "Cheese")).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("bestMatch", () => {
  it("returns null for empty item list", () => {
    expect(bestMatch("Cheese Squishy", [])).toBeNull();
  });

  it("picks the right item for noise-laden Whatnot names", () => {
    expect(bestMatch("Cheese Squishy", items)?.itemId).toBe(1);
    expect(bestMatch("Highland Cow Squishy (Assorted Colors)", items)?.itemId).toBe(2);
    expect(bestMatch("Viral Mystery Dumpling (Assorted Colors)", items)?.itemId).toBe(3);
    expect(bestMatch("Orbeez Stuffed Glitter Dumpling", items)?.itemId).toBe(4);
  });

  it("ranks the correct item above the others", () => {
    const m = bestMatch("Highland Cow Squishy (Assorted Colors)", items)!;
    const cheese = score("Highland Cow Squishy (Assorted Colors)", "Cheese");
    expect(m.score).toBeGreaterThan(cheese);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/name-match.test.ts`
Expected: FAIL — module `@/lib/calc/name-match` not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
export const MATCH_THRESHOLD = 0.5;

// Tokens that carry no discriminating signal in this squishy-toy catalog.
const NOISE = new Set([
  "squishy", "squishies", "assorted", "color", "colors", "glitter",
  "the", "and", "with", "a",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t));
}

function normalized(s: string): string {
  return tokens(s).join(" ");
}

// Levenshtein edit distance on two strings.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Token-set containment: fraction of the shorter side's tokens present in the other.
function tokenContainment(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const bSet = new Set(bTokens);
  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const longerSet = aTokens.length <= bTokens.length ? bSet : new Set(aTokens);
  let hit = 0;
  for (const t of shorter) if (longerSet.has(t)) hit++;
  return hit / shorter.length;
}

/** Normalized similarity in 0..1; 1 for an exact normalized match. */
export function score(a: string, b: string): number {
  const na = normalized(a);
  const nb = normalized(b);
  if (na === nb && na.length > 0) return 1;
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  const containment = tokenContainment(aTokens, bTokens);
  const maxLen = Math.max(na.length, nb.length) || 1;
  const editSim = 1 - editDistance(na, nb) / maxLen;
  // Token containment carries most of the weight; edit distance is the fallback.
  return 0.7 * containment + 0.3 * editSim;
}

export function bestMatch(
  name: string,
  items: { id: number; name: string }[],
): { itemId: number; score: number } | null {
  if (items.length === 0) return null;
  let best: { itemId: number; score: number; itemName: string } | null = null;
  for (const it of items) {
    const s = score(name, it.name);
    if (
      best === null ||
      s > best.score ||
      (s === best.score &&
        (it.name.length < best.itemName.length ||
          (it.name.length === best.itemName.length && it.id < best.itemId)))
    ) {
      best = { itemId: it.id, score: s, itemName: it.name };
    }
  }
  return best ? { itemId: best.itemId, score: best.score } : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/name-match.test.ts`
Expected: PASS (all cases). If a `bestMatch` case fails, tune the NOISE set or the `0.7/0.3` blend weights — do NOT lower assertions.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/name-match.ts tests/lib/calc/name-match.test.ts
git commit -m "feat(automap): pure fuzzy name-match scorer for aliases"
```

---

### Task 2: automap script + package.json wiring

**Files:**
- Create: `scripts/automap.ts`
- Modify: `package.json` (scripts block)

**Interfaces:**
- Consumes:
  - `bestMatch`, `MATCH_THRESHOLD` from `src/lib/calc/name-match.ts`.
  - `getUsersDb` from `src/lib/auth/users-db.ts`.
  - `getDb` from `src/lib/db/connection.ts`.
  - `seenProductNames`, `setAlias` from `src/lib/db/aliases.ts`.
- Produces: CLI only — no exported interface consumed by other tasks.

- [ ] **Step 1: Add the npm script**

In `package.json`, add to the `"scripts"` block (after `"seed:demo"`):

```json
    "seed:demo": "tsx scripts/seed-demo.ts",
    "automap": "tsx scripts/automap.ts"
```

- [ ] **Step 2: Write the script**

Create `scripts/automap.ts`:

```typescript
/**
 * One-time alias automapper. Fuzzy-matches unmapped Whatnot product names to
 * inventory items for a workspace. Dry-run by default; writes above-threshold
 * aliases only with --apply.
 *
 * Usage:
 *   npm run automap -- --user <username>            # dry-run: print suggestions
 *   npm run automap -- --user <username> --apply    # write above-threshold aliases
 */
import { getUsersDb } from "../src/lib/auth/users-db";
import { getDb } from "../src/lib/db/connection";
import { seenProductNames, setAlias } from "../src/lib/db/aliases";
import { bestMatch, MATCH_THRESHOLD } from "../src/lib/calc/name-match";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const username = arg("--user");
const apply = process.argv.includes("--apply");

if (!username) {
  console.error("Error: --user <username> is required.\n" +
    "Usage: npm run automap -- --user <username> [--apply]");
  process.exit(1);
}

const reg = getUsersDb();
const user = reg.prepare("SELECT id FROM users WHERE username = ?").get(username) as
  | { id: number }
  | undefined;
if (!user) {
  console.error(`Error: no user named "${username}".`);
  process.exit(1);
}

const db = getDb(user.id);

const items = db
  .prepare("SELECT id, name FROM inventory_items WHERE archived_at IS NULL")
  .all() as { id: number; name: string }[];
if (items.length === 0) {
  console.log("No (non-archived) inventory items to match against. Nothing to do.");
  process.exit(0);
}

const unmapped = seenProductNames(db)
  .filter((n) => !n.mapped)
  .map((n) => n.productName);
if (unmapped.length === 0) {
  console.log("No unmapped Whatnot product names. Nothing to do.");
  process.exit(0);
}

const itemName = new Map(items.map((i) => [i.id, i.name]));

type Row = { name: string; itemId: number; itemName: string; score: number };
const suggestions: Row[] = [];
const unmatched: string[] = [];

for (const name of unmapped) {
  const m = bestMatch(name, items);
  if (m && m.score >= MATCH_THRESHOLD) {
    suggestions.push({ name, itemId: m.itemId, itemName: itemName.get(m.itemId)!, score: m.score });
  } else {
    unmatched.push(name);
  }
}

// Worst-score-first so shaky guesses are easiest to eyeball.
suggestions.sort((a, b) => a.score - b.score);

console.log(`\nWorkspace: ${username}  (${apply ? "APPLY" : "dry-run"})`);
console.log(`Unmapped names: ${unmapped.length}  |  Threshold: ${MATCH_THRESHOLD}\n`);

if (suggestions.length > 0) {
  console.log(`Suggestions (${suggestions.length}) — worst score first:`);
  for (const s of suggestions) {
    console.log(`  ${s.score.toFixed(2)}  ${s.name}  ->  ${s.itemName}`);
  }
} else {
  console.log("No above-threshold suggestions.");
}

if (unmatched.length > 0) {
  console.log(`\nNo confident match (${unmatched.length}) — map manually:`);
  for (const n of unmatched) console.log(`  ${n}`);
}

if (apply) {
  for (const s of suggestions) setAlias(db, s.name, s.itemId);
  console.log(`\nApplied ${suggestions.length} alias${suggestions.length === 1 ? "" : "es"}.`);
} else {
  console.log(`\nDry-run only. Re-run with --apply to write the ${suggestions.length} suggestion(s).`);
}
```

- [ ] **Step 3: Verify the script runs (dry-run) against the demo workspace**

Run:
```bash
npm run seed:demo && npm run automap -- --user demo
```
Expected: prints a "Workspace: demo (dry-run)" header, a suggestions list (or "No unmapped..." / "No above-threshold..."), and ends with the "Dry-run only" line. Exit code 0. No aliases written (dry-run).

- [ ] **Step 4: Verify error handling**

Run: `npm run automap -- --user nope`
Expected: `Error: no user named "nope".` and non-zero exit.

Run: `npm run automap`
Expected: `Error: --user <username> is required.` and non-zero exit.

- [ ] **Step 5: Verify --apply writes aliases idempotently**

Run:
```bash
npm run automap -- --user demo --apply
npm run automap -- --user demo
```
Expected: first run ends with "Applied N aliases."; second run shows fewer (or zero) unmapped names because the applied ones are now mapped. Re-running `--apply` is safe (setAlias upserts).

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (existing suite + new name-match tests). Note the known pre-existing `tests/lib/db/giveaway-items.test.ts` tsc quirk does not affect vitest.

- [ ] **Step 7: Commit**

```bash
git add scripts/automap.ts package.json
git commit -m "feat(automap): CLI script to suggest/apply fuzzy aliases per workspace"
```

---

## Self-Review

**Spec coverage:**
- Invocation `--user` required, `--apply` optional → Task 2 arg parsing + Step 4 verification. ✓
- Workspace resolution via users registry → Task 2 script. ✓
- Collect unmapped via `seenProductNames`, exclude archived items → Task 2 queries. ✓
- Fuzzy scorer, pure + unit-tested, threshold constant → Task 1. ✓
- Dry-run prints worst-first, separate unmatched list, summary line → Task 2. ✓
- `--apply` writes only above-threshold via `setAlias`, idempotent → Task 2 Steps 2/5. ✓
- Truth-set tests from seed aliases → Task 1 test. ✓
- Out of scope items (no UI, no learning, no COGS mutation) → honored; nothing added. ✓

**Placeholder scan:** No TBD/TODO/placeholder steps; all code shown in full. ✓

**Type consistency:** `bestMatch` returns `{ itemId, score } | null` and `MATCH_THRESHOLD` is a number in both Task 1 (definition) and Task 2 (consumption); `seenProductNames` entries use `{ productName, mapped }` matching `src/lib/db/aliases.ts`. ✓
