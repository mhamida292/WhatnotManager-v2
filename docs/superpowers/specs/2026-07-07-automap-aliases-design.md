# Automap aliases — design spec

**Date:** 2026-07-07
**Status:** Approved (brainstorming), pending implementation plan

## Problem

Mapping a Whatnot CSV product name to an inventory item (`product_aliases`) is
entirely manual today: `seenProductNames(db)` lists distinct names seen in
ledger sales / legacy show lines and flags which are unmapped; the user
hand-picks an item for each via the inventory "Map Whatnot name → item" form
(`setAlias`). Unmapped names count at **$0 COGS**, so profit is overstated until
every name is mapped. Whatnot names deliberately don't match inventory names
(e.g. `"Highland Cow Squishy (Assorted Colors)"` → item `"Highland Cow"`), which
is the whole reason aliases exist — and why bulk-mapping is tedious by hand.

## Goal

A **one-time CLI script** that fuzzy-matches each *unmapped* Whatnot product name
against inventory item names and proposes `WhatnotName → Item` aliases for a
given workspace. Dry-run by default; writes aliases only with an explicit
`--apply` flag, and only for matches at/above a confidence threshold.

Explicitly **not** a UI feature, not history-based learning, not auto-apply
without the flag. No stock/COGS side effects beyond writing `product_aliases`
rows (which is exactly what manual mapping already does).

## Invocation

```
npm run automap -- --user <username>            # dry-run: print suggestions only
npm run automap -- --user <username> --apply    # write above-threshold aliases
```

- `--user <username>` is **required**. The script resolves it to a workspace:
  `getUsersDb()` → `SELECT id FROM users WHERE username = ?` → `getDb(id)`
  (same pattern as `scripts/seed-demo.ts`). If the user does not exist, print a
  clear error and exit non-zero.
- `--apply` is optional; absence = dry-run.
- Add a `"automap"` script to `package.json` mirroring how `seed`/`seed:demo`
  are wired (tsx/ts-node runner already used by existing scripts).

## Behavior

1. **Collect unmapped names.** Call `seenProductNames(db)` and keep entries with
   `mapped === false`. These are already base-normalized via `baseProductName`.
2. **Load inventory.** `SELECT id, name FROM inventory_items` excluding archived
   items (match whatever "archived" predicate the current schema uses; verify at
   implementation time). Empty inventory → print a notice and exit 0.
3. **Score each unmapped name** against every item; keep the single best match
   and its score (`0..1`). Ties broken by shortest item name then id (stable).
4. **Print results** grouped:
   - **Suggestions** (best score ≥ threshold): a table
     `Whatnot name → item  (score)`, sorted **worst-score-first** so shaky
     guesses are easiest to eyeball.
   - **No confident match** (best score < threshold): listed separately as
     "map manually".
   Always print a summary line: N suggested, M unmatched, and — in dry-run — a
   reminder to re-run with `--apply`.
5. **Apply (only with `--apply`).** For every suggestion **at/above the
   threshold**, call `setAlias(db, whatnotName, itemId)`. Below-threshold guesses
   are never written (only printed). `setAlias` is idempotent (upsert on
   `product_name`), so re-running is safe. Print a confirmation count of aliases
   written.

## Matching logic

A small **pure, unit-tested** helper module (e.g.
`src/lib/calc/name-match.ts`), independent of the DB and the script so it can be
tested in isolation:

- **Normalize** each side to a token set: lowercase; strip punctuation/parens;
  drop noise tokens that add no discriminating signal in this catalog
  (`squishy`, `assorted`, `colors`, `color`, `glitter`, size words like `mini` /
  `jumbo` handled carefully — verify against real names before finalizing the
  stop-list). Keep the raw normalized string too for the edit-distance fallback.
- **Score** = a blend of:
  - token containment / Jaccard overlap of the two token sets, and
  - a normalized edit-distance similarity on the joined normalized strings as a
    fallback for single-token or reworded names.
  Combined into a single `0..1` score (exact normalized match = `1`).
- **Threshold** default `0.5`, defined as a named constant in the helper so it's
  easy to tune. Gates `--apply` only; dry-run prints everything.

The exact blend weights are an implementation detail to be tuned against the
truth set below; the interface is `bestMatch(name, items) → { itemId, score } |
null` plus the underlying `score(a, b) → number`.

## Testing

Vitest unit tests for the scorer using the existing seed aliases as a ready-made
truth set (from `scripts/seed.ts`), e.g.:

- `"Cheese Squishy"` → `Cheese`
- `"Highland Cow Squishy (Assorted Colors)"` → `Highland Cow`
- `"Viral Mystery Dumpling (Assorted Colors)"` → `Viral Mystery`
- `"Orbeez Stuffed Glitter Dumpling"` → `Orbeez Stuffed`
- `"Nice-Sicle Ice Cream"` → `Pushy Squishy Ice Cream` (harder — no shared
  tokens; documents a known weak case, may fall below threshold and that's
  acceptable, it just gets listed for manual mapping)

Tests assert: correct item chosen for each easy case; score ordering
(better matches score higher); and that a clearly-unrelated name scores below
threshold. The script's I/O (arg parsing, DB resolution, apply loop) is thin and
not unit-tested beyond the pure helper.

## Files touched

- **New:** `scripts/automap.ts` — arg parse, resolve workspace, run helper,
  print, optional apply.
- **New:** `src/lib/calc/name-match.ts` — pure scorer + `bestMatch`.
- **New:** `tests/lib/calc/name-match.test.ts` — scorer truth-set tests.
- **Edit:** `package.json` — add `"automap"` script.
- **Reuses unchanged:** `seenProductNames` / `setAlias` (`src/lib/db/aliases.ts`),
  `getDb` (`src/lib/db/connection.ts`), `getUsersDb` (`src/lib/auth/users-db.ts`).

## Out of scope

- No web UI, no post-import review step.
- No history/ML-based matching (fuzzy name similarity only).
- No auto-apply without `--apply`; no writing below-threshold guesses.
- No stock, remaining, or COGS mutation beyond `product_aliases` rows.
