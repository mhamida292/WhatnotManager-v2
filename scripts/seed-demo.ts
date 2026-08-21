/**
 * Seeds a rich, self-contained DEMO account so someone can log in and see the
 * whole app populated: Dashboard profit, Report per-product P&L, multiple Shows
 * (including a same-day two-session split), Inventory with stock, an itemized
 * giveaway allocation, an on-screen bundle, and expenses.
 *
 * Creates a non-admin user `demo` / `demo` in the registry (data/users.db) and
 * fills ITS OWN isolated workspace (data/ws/<demoId>.db) — never touches other
 * users' data. Re-running REBUILDS the demo workspace from scratch (idempotent
 * result), so you always get the latest demo content.
 *
 * Run locally:           npm run seed:demo
 * Run on the server:     docker compose exec whatnot npm run seed:demo
 *   (or `docker exec whatnot npm run seed:demo`) — needs the same DATA_DIR the
 *   app uses so it writes into the live data volume.
 */
import { getUsersDb } from "../src/lib/auth/users-db";
import { createUser } from "../src/lib/auth/users";
import { getDb } from "../src/lib/db/connection";
import { resetApp } from "../src/lib/db/admin";
import { insertLot, insertItem } from "../src/lib/db/inventory";
import { setAlias } from "../src/lib/db/aliases";
import { insertExpense } from "../src/lib/db/expenses";
import { insertGiveawayItem, setAllocations } from "../src/lib/db/giveaway-items";
import { listShowSaleLines, setShowBundles } from "../src/lib/db/bundles";
import { updateSettings } from "../src/lib/db/settings";
import { parseLedger } from "../src/lib/csv/ledger";
import { saveLedger } from "../src/lib/db/ledger";
import { toCents } from "../src/lib/money";

// 1) Ensure the demo user exists (non-admin). Reuse if already there.
const reg = getUsersDb();
let demo = reg.prepare("SELECT id FROM users WHERE username = 'demo'").get() as { id: number } | undefined;
if (!demo) {
  const id = createUser(reg, { username: "demo", password: "demo", isAdmin: false });
  demo = { id };
  console.log(`Created demo user (id=${id}), login: demo / demo`);
} else {
  console.log(`Demo user already exists (id=${demo.id}) — rebuilding its workspace`);
}

// 2) Open the demo's isolated workspace and wipe it clean so re-runs are stable.
const db = getDb(demo.id);
resetApp(db);                                   // clears shows/ledger/inventory/expenses/bundles/aliases
db.exec("DELETE FROM show_giveaway_allocations; DELETE FROM giveaway_items;"); // resetApp skips these

// 3) Business identity (shows on invoices) + keep default 80/20 split.
updateSettings(db, {
  ownerSharePct: 80,
  giveawayUnitCents: 500,
  defaultShippingSuppliesCents: 0,
  businessName: "Demo Squish Co.",
  invoicePhone: null,
  invoiceAddress: null,
  invoiceEmail: null,
  invoiceShowPhone: true,
  invoiceShowAddress: true,
  invoiceShowEmail: true,
  whatnotOnly: false,
});

// 4) Inventory: a lot, per-item costs, and real purchased counts so Remaining shows.
const lot = insertLot(db, { name: "Demo Lot 1", totalCostCents: toCents(732), purchasedOn: "2026-05-20" });
const items: [name: string, costDollars: number, purchased: number][] = [
  ["Cheese", 2.5, 40], ["Highland Cow", 2.5, 40], ["Viral Mystery", 2.5, 30],
  ["Rainbow Dumpling", 2.5, 30], ["Mini Squish", 1.5, 60], ["Pushy Squishy Ice Cream", 2, 30],
  ["Orbeez Stuffed", 2.5, 25], ["Axolotl", 2, 25], ["Butter", 1.5, 40],
  ["Strawberry", 1.5, 40], ["Jumbo Butter", 4, 15], ["Gummy Bear", 1.5, 40],
];
const id: Record<string, number> = {};
for (const [name, cost, purchased] of items) {
  id[name] = insertItem(db, { name, unitCostCents: toCents(cost), qtyPurchased: purchased, lotId: lot });
}

// 5) Aliases: map the Whatnot CSV product names to our items so COGS resolves.
const aliases: [whatnotName: string, item: string][] = [
  ["Cheese Squishy", "Cheese"],
  ["Highland Cow Squishy (Assorted Colors)", "Highland Cow"],
  ["Viral Mystery Dumpling (Assorted Colors)", "Viral Mystery"],
  ["Rainbow Squishy Dumpling", "Rainbow Dumpling"],
  ["Mini Squish Dumplings (Assorted Colors)", "Mini Squish"],
  ["Nice-Sicle Ice Cream", "Pushy Squishy Ice Cream"],
  ["Orbeez Stuffed Glitter Dumpling", "Orbeez Stuffed"],
  ["Axolotl Squishy", "Axolotl"],
  ["Butter Squishy", "Butter"],
  ["Strawberry Squishy", "Strawberry"],
  ["Jumbo Butter Squishy", "Jumbo Butter"],
  ["Gummy Bear Squishy", "Gummy Bear"],
];
for (const [whatnotName, item] of aliases) setAlias(db, whatnotName, id[item]);

// 6) Giveaway-item catalog (cost per pack ÷ pack qty → per-unit cost).
const stickers = insertGiveawayItem(db, { name: "Sticker Sheets", packCostCents: toCents(12), packQty: 50 });
const keychains = insertGiveawayItem(db, { name: "Mini Keychains", packCostCents: toCents(18), packQty: 25 });

// 7) Six shows across June via the real parser. Jun 12 has a >60-min gap → two
//    sessions. Jun 5 carries the $400 New Seller Sales Match Bonus. Jun 19
//    includes a $18 "combo" line we'll turn into an on-screen bundle below.
let n = 0;
function sale(date: string, time: string, amount: string, whatnotName: string) {
  n++;
  return `"${date}, ${time}",${amount},L${n},O${n},"Earnings for selling a ${whatnotName}  #${n}",Completed,SALES,"${date}"`;
}
function tip(date: string, time: string, amount: string) {
  return `"${date}, ${time}",${amount},,,"Tip from a viewer",Completed,TIP,"${date}"`;
}
function giveawayFee(date: string, time: string, amount: string) {
  return `"${date}, ${time}",${amount},,,"Fee for a giveaway",Completed,SALES,"${date}"`;
}
const rows: string[] = [
  // Jun 5 — first show, with the $400 new-seller bonus
  sale("Jun 5, 2026", "6:01:00 PM", "$9.00", "Cheese Squishy"),
  sale("Jun 5, 2026", "6:12:00 PM", "$8.50", "Highland Cow Squishy (Assorted Colors)"),
  sale("Jun 5, 2026", "6:28:00 PM", "$7.75", "Mini Squish Dumplings (Assorted Colors)"),
  sale("Jun 5, 2026", "6:44:00 PM", "$11.00", "Jumbo Butter Squishy"),
  tip("Jun 5, 2026", "6:45:00 PM", "$4.00"),
  `"Jun 5, 2026, 6:50:00 PM",$400.00,,,"New Seller Sales Match Bonus",Completed,ADJUSTMENT,"Jun 5, 2026"`,
  // Jun 8
  sale("Jun 8, 2026", "7:02:00 PM", "$8.25", "Axolotl Squishy"),
  sale("Jun 8, 2026", "7:15:00 PM", "$9.50", "Viral Mystery Dumpling (Assorted Colors)"),
  sale("Jun 8, 2026", "7:31:00 PM", "$8.00", "Strawberry Squishy"),
  giveawayFee("Jun 8, 2026", "7:40:00 PM", "-$0.78"),
  // Jun 12 — morning session
  sale("Jun 12, 2026", "5:02:00 PM", "$9.00", "Cheese Squishy"),
  sale("Jun 12, 2026", "5:18:00 PM", "$8.50", "Highland Cow Squishy (Assorted Colors)"),
  sale("Jun 12, 2026", "5:34:00 PM", "$7.75", "Mini Squish Dumplings (Assorted Colors)"),
  tip("Jun 12, 2026", "5:35:00 PM", "$3.00"),
  // Jun 12 — afternoon session (>60-min gap → second show that day)
  sale("Jun 12, 2026", "7:30:00 PM", "$8.00", "Rainbow Squishy Dumpling"),
  sale("Jun 12, 2026", "7:46:00 PM", "$9.50", "Nice-Sicle Ice Cream"),
  sale("Jun 12, 2026", "7:59:00 PM", "$8.25", "Cheese Squishy"),
  // Jun 15 — this show gets a giveaway allocation below
  sale("Jun 15, 2026", "6:05:00 PM", "$8.50", "Gummy Bear Squishy"),
  sale("Jun 15, 2026", "6:20:00 PM", "$9.25", "Viral Mystery Dumpling (Assorted Colors)"),
  sale("Jun 15, 2026", "6:38:00 PM", "$7.75", "Butter Squishy"),
  sale("Jun 15, 2026", "6:55:00 PM", "$8.00", "Orbeez Stuffed Glitter Dumpling"),
  // Jun 19 — includes the $18 combo line we turn into a bundle below
  sale("Jun 19, 2026", "6:10:00 PM", "$18.00", "Cheese and Cow Combo"),
  sale("Jun 19, 2026", "6:26:00 PM", "$9.00", "Highland Cow Squishy (Assorted Colors)"),
  sale("Jun 19, 2026", "6:41:00 PM", "$7.75", "Mini Squish Dumplings (Assorted Colors)"),
  // Jun 22
  sale("Jun 22, 2026", "6:03:00 PM", "$8.50", "Axolotl Squishy"),
  sale("Jun 22, 2026", "6:19:00 PM", "$9.50", "Rainbow Squishy Dumpling"),
  sale("Jun 22, 2026", "6:36:00 PM", "$8.25", "Strawberry Squishy"),
  tip("Jun 22, 2026", "6:40:00 PM", "$5.00"),
];
const csv =
  "Created Date,Amount,Listing ID,Order ID,Message,Status,Transaction Type,Completed Date\n" +
  rows.join("\n") + "\n";
const result = saveLedger(db, parseLedger(csv));
console.log(`Imported ledger: ${JSON.stringify(result)}`);

// 8) Itemized giveaway allocation on the Jun 15 show.
const jun15 = db.prepare("SELECT id FROM shows WHERE show_date = '2026-06-15' ORDER BY session_seq LIMIT 1").get() as { id: number } | undefined;
if (jun15) {
  setAllocations(db, jun15.id, [
    { giveawayItemId: stickers, count: 15 },
    { giveawayItemId: keychains, count: 3 },
  ]);
  console.log(`Allocated giveaways to show ${jun15.id} (Jun 15)`);
}

// 9) On-screen bundle on Jun 19: turn the $18 "combo" sale line into a bundle of
//    1 Cheese + 1 Highland Cow (cost = $5, so the bundle's true profit shows).
const jun19 = db.prepare("SELECT id FROM shows WHERE show_date = '2026-06-19' ORDER BY session_seq LIMIT 1").get() as { id: number } | undefined;
if (jun19) {
  const comboLine = listShowSaleLines(db, jun19.id).find((l) => l.amountCents === 1800);
  if (comboLine) {
    setShowBundles(db, jun19.id, [
      { ledgerTxnId: comboLine.id, components: [{ itemId: id["Cheese"], qty: 1 }, { itemId: id["Highland Cow"], qty: 1 }] },
    ]);
    console.log(`Created a 2-item bundle on show ${jun19.id} (Jun 19)`);
  }
}

// 10) Operating expenses (one-time + a recurring one, to show the type field).
insertExpense(db, { description: "Bubble mailers & poly bags", type: "one_time", category: "Shipping supplies", amountCents: toCents(34.99), incurredOn: "2026-05-25" });
insertExpense(db, { description: "Thermal label printer", type: "one_time", category: "Equipment", amountCents: toCents(89.0), incurredOn: "2026-05-18" });
insertExpense(db, { description: "Storage bins & display shelf", type: "one_time", category: "Supplies", amountCents: toCents(45.0), incurredOn: "2026-05-30" });
insertExpense(db, { description: "Packing tape (monthly restock)", type: "recurring", category: "Shipping supplies", amountCents: toCents(12.5), incurredOn: "2026-06-01" });

console.log("Demo seed complete. Log in as demo / demo to explore.");
