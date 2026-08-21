import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import {
  listShowSaleLines, getShowBundles, setShowBundles, getBundleComponentsByTxn,
} from "@/lib/db/bundles";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

// Two sales on the same date => one ledger show with two sale lines.
const LEDGER = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 23, 2026, 10:00:00 AM","$45.00","L1","O1","Earnings for selling a Mega Bundle #9","processing","SALES",""
"Jun 23, 2026, 10:05:00 AM","$22.00","L2","O2","Earnings for selling a Tiny Bundle #10","processing","SALES",""`;

function seed() {
  const a = insertItem(db, { name: "Squish A", unitCostCents: 200, qtyPurchased: 0, lotId: null });
  const b = insertItem(db, { name: "Squish B", unitCostCents: 640, qtyPurchased: 0, lotId: null });
  saveLedger(db, parseLedger(LEDGER));
  const showId = (db.prepare("SELECT id FROM shows LIMIT 1").get() as { id: number }).id;
  const lines = listShowSaleLines(db, showId);
  return { a, b, showId, lines };
}

describe("bundles db", () => {
  it("lists the show's sale lines", () => {
    const { lines } = seed();
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.amountCents).sort((x, y) => x - y)).toEqual([2200, 4500]);
  });

  it("includes the Whatnot sale number (#N from the message) on each sale line", () => {
    const { lines } = seed();
    expect(lines.map((l) => l.saleNumber).sort()).toEqual(["10", "9"]);
  });

  it("set then get round-trips bundle components", () => {
    const { a, b, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [
      { ledgerTxnId: mega.id, components: [{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }] },
    ]);
    const bundles = getShowBundles(db, showId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].ledgerTxnId).toBe(mega.id);
    expect(bundles[0].amountCents).toBe(4500);
    expect(bundles[0].components).toEqual([{ itemId: a, qty: 2 }, { itemId: b, qty: 1 }]);
  });

  it("setShowBundles replaces all bundles for the show", () => {
    const { a, b, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    const tiny = lines.find((l) => l.amountCents === 2200)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 5 }] }]);
    setShowBundles(db, showId, [{ ledgerTxnId: tiny.id, components: [{ itemId: b, qty: 1 }] }]);
    const bundles = getShowBundles(db, showId);
    expect(bundles).toHaveLength(1);
    expect(bundles[0].ledgerTxnId).toBe(tiny.id);
  });

  it("getBundleComponentsByTxn keys by ledger txn id", () => {
    const { a, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 3 }] }]);
    const map = getBundleComponentsByTxn(db, showId);
    expect(map.get(mega.id)).toEqual([{ itemId: a, qty: 3 }]);
  });

  it("deleting the show cascades bundle components away", () => {
    const { a, showId, lines } = seed();
    const mega = lines.find((l) => l.amountCents === 4500)!;
    setShowBundles(db, showId, [{ ledgerTxnId: mega.id, components: [{ itemId: a, qty: 1 }] }]);
    db.prepare("DELETE FROM shows WHERE id = ?").run(showId);
    expect((db.prepare("SELECT COUNT(*) c FROM bundle_components").get() as { c: number }).c).toBe(0);
  });
});
