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
  const val = i >= 0 ? process.argv[i + 1] : undefined;
  // Treat a following flag (e.g. `--user --apply`) as a missing value.
  return val && !val.startsWith("--") ? val : undefined;
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
