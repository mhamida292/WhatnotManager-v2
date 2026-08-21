import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, resolveItemId } from "@/lib/db/aliases";
import { saveShow, getShowWithLines, listShows, deleteShow, showDeleteImpact } from "@/lib/db/shows";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("aliases", () => {
  it("maps a product base name to an item and resolves it", () => {
    const item = insertItem(db, { name: "Pushy Squishy Ice Cream", unitCostCents: 200, qtyPurchased: 0, lotId: null });
    setAlias(db, "Nice-Sicle Ice Cream", item);
    expect(resolveItemId(db, "Nice-Sicle Ice Cream")).toBe(item);
    expect(resolveItemId(db, "Unknown Thing")).toBeNull();
  });
});

describe("shows", () => {
  it("saves a show with lines and reads it back", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", item);
    const showId = saveShow(db, {
      showDate: "2026-06-11", payoutCents: 20000, shippingSuppliesCents: 1000,
      giveawayCount: 7, giveawayUnitCents: 500, sourceHash: "h1",
      lines: [
        { buyerUsername: "bob", productName: "Cheese Squishy", quantity: 1, revenueCents: 300, status: "confirmed" },
        { buyerUsername: "x", productName: "AMAZON $5 GIFTCARD GIVVY", quantity: 1, revenueCents: 0, status: "giveaway" },
      ],
    });
    const show = getShowWithLines(db, showId);
    expect(show.payoutCents).toBe(20000);
    expect(show.lines).toHaveLength(2);
    expect(show.lines[0].itemId).toBe(item);
    expect(listShows(db)).toHaveLength(1);
  });

  it("throws when getShowWithLines is called with an unknown id", () => {
    expect(() => getShowWithLines(db, 9999)).toThrow();
  });

  it("re-saving the same sourceHash replaces the prior show (no duplicate)", () => {
    const base = { showDate: "2026-06-11", payoutCents: 1, shippingSuppliesCents: 0,
      giveawayCount: 0, giveawayUnitCents: 500, sourceHash: "same", lines: [] as any[] };
    saveShow(db, base);
    saveShow(db, { ...base, payoutCents: 999 });
    const shows = listShows(db);
    expect(shows).toHaveLength(1);
    expect(shows[0].payoutCents).toBe(999);
  });
});

describe("deleteShow", () => {
  const LEDGER_CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 09:01:00 AM","-$0.78","L2","O2","Charged deduction for giveaway order","completed","SALES","b"`;

  it("deletes a ledger show and cascades its ledger_transactions", () => {
    saveLedger(db, parseLedger(LEDGER_CSV));
    const show = listShows(db).find((s) => s.showDate === "2026-06-14")!;
    expect(db.prepare("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id=?").get(show.id) as any).toMatchObject({ c: 2 });

    deleteShow(db, show.id);

    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(show.id) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM ledger_transactions WHERE show_id=?").get(show.id) as any).toMatchObject({ c: 0 });
  });

  it("deletes a manual show and cascades its show_line_items, leaving other shows intact", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", item);
    const keepId = saveShow(db, {
      showDate: "2026-06-10", payoutCents: 100, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "keep", lines: [],
    });
    const delId = saveShow(db, {
      showDate: "2026-06-11", payoutCents: 200, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "del",
      lines: [{ buyerUsername: "bob", productName: "Cheese Squishy", quantity: 1, revenueCents: 300, status: "confirmed" }],
    });
    expect(db.prepare("SELECT COUNT(*) c FROM show_line_items WHERE show_id=?").get(delId) as any).toMatchObject({ c: 1 });

    deleteShow(db, delId);

    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(delId) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM show_line_items WHERE show_id=?").get(delId) as any).toMatchObject({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM shows WHERE id=?").get(keepId) as any).toMatchObject({ c: 1 });
  });

  it("showDeleteImpact reports ledger and line-item counts", () => {
    saveLedger(db, parseLedger(LEDGER_CSV));
    const ledgerShow = listShows(db).find((s) => s.showDate === "2026-06-14")!;
    expect(showDeleteImpact(db, ledgerShow.id)).toEqual({ ledgerTxns: 2, ledgerSales: 1, lineItems: 0 });

    const manualId = saveShow(db, {
      showDate: "2026-06-12", payoutCents: 0, shippingSuppliesCents: 0, giveawayCount: 0,
      giveawayUnitCents: 500, sourceHash: "m",
      lines: [{ buyerUsername: "bob", productName: "X", quantity: 1, revenueCents: 0, status: "confirmed" }],
    });
    expect(showDeleteImpact(db, manualId)).toEqual({ ledgerTxns: 0, ledgerSales: 0, lineItems: 1 });
  });
});

describe("listShows sessionSeq", () => {
  it("returns session_seq and orders by date desc then session asc", () => {
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-12','ledger',1)").run();
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-12','ledger',0)").run();
    db.prepare("INSERT INTO shows (show_date, source_hash, session_seq) VALUES ('2026-06-13','ledger',0)").run();
    const rows = listShows(db);
    expect(rows.map((r) => [r.showDate, r.sessionSeq])).toEqual([
      ["2026-06-13", 0], ["2026-06-12", 0], ["2026-06-12", 1],
    ]);
  });
});
