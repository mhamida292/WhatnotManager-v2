import { createDb, workspacePath } from "../src/lib/db/connection";
import { insertLot, insertItem } from "../src/lib/db/inventory";
import { setAlias } from "../src/lib/db/aliases";
import { toCents } from "../src/lib/money";

// Seeds the first account's workspace (data/ws/1.db) — i.e. the workspace of
// whichever user gets id 1 (normally the admin created via /setup, since ids
// are assigned in creation order and never reused). The app derives per-user
// paths from DATA_DIR at runtime, so this script targets that same path
// directly rather than a separate legacy file.
const db = createDb(workspacePath(1));

const already = db.prepare("SELECT COUNT(*) AS c FROM inventory_items").get() as { c: number };
if (already.c > 0) {
  console.log("Already seeded; nothing to do.");
  process.exit(0);
}

// Lot 1
const lot1 = insertLot(db, { name: "Lot 1", totalCostCents: toCents(732), purchasedOn: "2026-06-01" });

// Per-item costs (qty_purchased left 0 — fill in real counts as known)
const costs: [string, number][] = [
  ["Axolotl", 2], ["Pushy Squishy Ice Cream", 2], ["Rainbow Dumpling", 2.5],
  ["Orbeez Stuffed", 2.5], ["Viral Mystery", 2.5], ["Mini Squish", 1.5],
  ["Butter", 1.5], ["Strawberry", 1.5], ["Pink Strawberry", 1.5], ["Tie Dye Butter", 1.5],
  ["Jumbo Butter", 4], ["Gummy Bear", 1.5], ["Cheese", 2.5], ["Highland Cow", 2.5],
];
const ids: Record<string, number> = {};
for (const [name, dollars] of costs) {
  ids[name] = insertItem(db, { name, unitCostCents: toCents(dollars), qtyPurchased: 0, lotId: lot1 });
}

// Aliases: map observed Whatnot CSV product names to items
const aliases: [string, string][] = [
  ["Cheese Squishy", "Cheese"],
  ["Highland Cow Squishy (Assorted Colors)", "Highland Cow"],
  ["Viral Mystery Dumpling (Assorted Colors)", "Viral Mystery"],
  ["Orbeez Stuffed Glitter Dumpling", "Orbeez Stuffed"],
  ["Nice-Sicle Ice Cream", "Pushy Squishy Ice Cream"],
  ["Rainbow Squishy Dumpling", "Rainbow Dumpling"],
  ["Mini Squish Dumplings (Assorted Colors)", "Mini Squish"],
  ["Mystery Mini Dumpling", "Mini Squish"],
];
for (const [whatnotName, itemName] of aliases) {
  if (ids[itemName]) setAlias(db, whatnotName, ids[itemName]);
}

// The $400 New Seller Sales Match Bonus now comes from the imported ledger
// (kind = "bonus"), so it is NOT seeded as a negative expense here — that would double-count it.

console.log("Seed complete.");
