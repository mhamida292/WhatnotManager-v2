import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import {
  insertItem, listItems, insertLot, qtySoldByItem, qtySold, qtyRemaining,
  aliasesForItem, ledgerSalesForItem, deleteItem, deleteImpact, setItemRemaining, renameItem,
  qtySoldWholesale, applyCount, archiveItem, unarchiveItem, archiveItems, unarchiveItems, deleteItems, bulkDeleteImpact,
} from "@/lib/db/inventory";
import { addAdjustment, listAdjustments, sumWhatnotAdjustments, sumAdjustments } from "@/lib/db/adjustments";
import { addPurchase } from "@/lib/db/purchases";
import { setAlias, resolveItemId } from "@/lib/db/aliases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory repo", () => {
  /** Records `qty` confirmed legacy show sales for an item — a sale path that
   *  counts toward qtySold. */
  function sellOnShow(db: any, itemId: number, qty: number, date = "2026-06-10") {
    db.prepare("INSERT INTO shows (show_date) VALUES (?)").run(date);
    const showId = (db.prepare("SELECT id FROM shows ORDER BY id DESC LIMIT 1").get() as any).id;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Ported Sale', ?, 'confirmed', ?)`).run(showId, qty, itemId);
  }

  it("inserts and lists items", () => {
    const lot = insertLot(db, { name: "Lot 1", totalCostCents: 73200, purchasedOn: "2026-06-01" });
    insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: lot });
    const items = listItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Cheese", unitCostCents: 250, qtyPurchased: 20 });
  });

  it("returns 0 for qtyRemaining when item id is unknown", () => {
    expect(qtyRemaining(db, 9999)).toBe(0);
  });

  it("computes qty remaining = purchased - confirmed sold", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = db.prepare("SELECT id FROM shows").get() as any;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId.id, id);
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 2, 'cancelled', ?)`).run(showId.id, id);
    sellOnShow(db, id, 3);
    expect(qtySoldByItem(db, id)).toBe(8);
    expect(qtyRemaining(db, id)).toBe(20 - 8);
  });

  it("counts imported ledger sales toward sold, live via the alias map", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    // Two Cheese Squishy sales in the ledger.
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));

    // Not mapped yet -> 0 sold.
    expect(qtySold(db, id)).toBe(0);
    expect(qtyRemaining(db, id)).toBe(10);

    // Map the Whatnot name AFTER import -> sales count immediately (live resolution).
    setAlias(db, "Cheese Squishy", id);
    expect(qtySold(db, id)).toBe(2);
    expect(qtyRemaining(db, id)).toBe(8);
  });

  it("samples reduce remaining but NOT purchased (still a cost)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 36, lotId: null });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "sample", qty: -4, note: null }); // pulled 4 as samples
    const item = listItems(db)[0];
    expect(item.qtyPurchased).toBe(36);   // still purchased -> still counts toward spend
    expect(qtyRemaining(db, id)).toBe(32); // 36 - 0 sold + (-4)
  });

  it("deleteItem removes the item and frees its mapped names (ledger sales survive)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
    setAlias(db, "Cheese Squishy", id);
    expect(qtySold(db, id)).toBe(2);

    deleteItem(db, id);

    expect(listItems(db)).toHaveLength(0);                 // item gone
    expect(resolveItemId(db, "Cheese Squishy")).toBeNull(); // alias gone -> name unmapped
    // Ledger rows survive: re-adding + re-mapping re-counts them.
    const id2 = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", id2);
    expect(qtySold(db, id2)).toBe(2);
  });

  it("deleteItem nulls item_id on referencing legacy show rows (keeps the rows)", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = (db.prepare("SELECT id FROM shows").get() as any).id;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId, id);

    deleteItem(db, id);

    expect(db.prepare("SELECT COUNT(*) n FROM show_line_items").get()).toMatchObject({ n: 1 });
    expect(db.prepare("SELECT item_id FROM show_line_items").get()).toMatchObject({ item_id: null });
  });

  it("deleteItem on an item with no references just removes the row", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
    deleteItem(db, id);
    expect(listItems(db)).toHaveLength(0);
  });

  it("deleteItem succeeds when ledger rows were imported AFTER mapping (cached item_id FK)", () => {
    // Mapping first means saveLedger caches the resolved item_id on each ledger row
    // (a FK). Deleting must clear it or the item delete hits a FOREIGN KEY error.
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", id);
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`));
    expect(qtySold(db, id)).toBe(1); // cached item_id populated at import

    expect(() => deleteItem(db, id)).not.toThrow();

    expect(listItems(db)).toHaveLength(0);
    expect(db.prepare("SELECT COUNT(*) n FROM ledger_transactions").get()).toMatchObject({ n: 1 }); // row kept
    expect(db.prepare("SELECT item_id FROM ledger_transactions").get()).toMatchObject({ item_id: null });
  });

  it("deleteImpact reports mappings, ledger sales, and legacy show sales", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""`));
    setAlias(db, "Cheese Squishy", id);
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = (db.prepare("SELECT id FROM shows").get() as any).id;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId, id);

    expect(deleteImpact(db, id)).toEqual({ mappings: 1, ledgerSales: 2, showLineSales: 1 });
  });

  it("deleteImpact is all zeros for a fresh item", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
    expect(deleteImpact(db, id)).toEqual({ mappings: 0, ledgerSales: 0, showLineSales: 0 });
  });

  it("setItemRemaining stores a delta so remaining equals the target", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    sellOnShow(db, item, 3); // sold = 3
    expect(qtyRemaining(db, item)).toBe(7);

    setItemRemaining(db, item, 4);
    expect(qtyRemaining(db, item)).toBe(4);
  });

  it("the remaining adjustment is a persistent delta, not a freeze", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setItemRemaining(db, item, 8); // base 10 -> adjustment -2
    expect(qtyRemaining(db, item)).toBe(8);
    sellOnShow(db, item, 1); // one more sold
    expect(qtyRemaining(db, item)).toBe(7); // dropped from the corrected baseline
  });

  it("wholesale: a posted sale invoice line counts as sold", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
    // raw sale invoice (Task 4 adds the typed helper; here exercise the column contract)
    const invId = Number(db.prepare("INSERT INTO invoices (direction, customer, invoice_date, status) VALUES ('sale','Joe','2026-06-27','posted')").run().lastInsertRowid);
    db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents) VALUES (?,?,?,?,?,?)")
      .run(invId, a, "A", 24, 0, 300);
    expect(qtySoldWholesale(db, a)).toBe(24);
    expect(qtyRemaining(db, a)).toBe(76);          // 100 - 24
  });

  it("wholesale: a DRAFT sale invoice line does not count", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 50, qtyPurchased: 0, lotId: null });
    addPurchase(db, { itemId: a, purchasedOn: null, quantity: 100, unitCostCents: 50 });
    const invId = Number(db.prepare("INSERT INTO invoices (direction, status) VALUES ('sale','draft')").run().lastInsertRowid);
    db.prepare("INSERT INTO invoice_lines (invoice_id, item_id, product_name, quantity, unit_cost_cents, unit_price_cents) VALUES (?,?,?,?,?,?)").run(invId, a, "A", 5, 0, 100);
    expect(qtySoldWholesale(db, a)).toBe(0);
    expect(qtyRemaining(db, a)).toBe(100);
  });
});

describe("count recording", () => {
  it("setItemRemaining records counted + reason + zero-delta count", () => {
    const id = insertItem(db, { name: "Cat", unitCostCents: 100, qtyPurchased: 43, lotId: null });
    setItemRemaining(db, id, 40, { reason: "sample", note: "gave 3 away", on: "2026-07-04" });
    let log = listAdjustments(db, id);
    expect(log.at(-1)).toMatchObject({ qty: -3, counted: 40, reason: "sample", note: "gave 3 away" });
    expect(qtyRemaining(db, id)).toBe(40);
    // zero-delta count still logs
    setItemRemaining(db, id, 40, { on: "2026-07-05" });
    log = listAdjustments(db, id);
    expect(log.at(-1)).toMatchObject({ qty: 0, counted: 40, reason: "recount" });
  });

  it("applyCount writes one dated adjustment per row", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 10, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    applyCount(db, "2026-07-04", [{ itemId: a, counted: 8 }, { itemId: b, counted: 5, reason: "recount" }]);
    expect(qtyRemaining(db, a)).toBe(8);   // 10 → 8 (delta -2)
    expect(qtyRemaining(db, b)).toBe(5);   // unchanged, delta 0 still logged
    expect(listAdjustments(db, a).at(-1)).toMatchObject({ qty: -2, counted: 8, adjustedOn: "2026-07-04" });
    expect(listAdjustments(db, b).at(-1)).toMatchObject({ qty: 0, counted: 5, adjustedOn: "2026-07-04" });
  });
});

describe("adjustment channel", () => {
  it("channels: whatnot adjustments sum separately; total sum includes both", () => {
    const id = insertItem(db, { name: "W", unitCostCents: 1, qtyPurchased: 10, lotId: null });
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -2, note: null }); // warehouse (null)
    addAdjustment(db, { itemId: id, adjustedOn: null, reason: "damage_loss", qty: -3, note: null, channel: "whatnot" });
    expect(sumWhatnotAdjustments(db, id)).toBe(-3);
    expect(sumAdjustments(db, id)).toBe(-5); // both channels
  });
});

const TWO_NAMES_CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 11, 2026, 10:13:00 AM","$1.00","L2","O2","Earnings for selling a Cheese Squishy #9","processing","SALES",""
"Jun 12, 2026, 10:12:00 AM","$2.00","L3","O3","Earnings for selling a Cheddar Block #1","processing","SALES",""
"Jun 12, 2026, 10:11:00 AM","$3.00","L4","O4","Earnings for selling a Zebra Squishy #1","processing","SALES",""`;

describe("aliasesForItem", () => {
  it("lists each Whatnot name mapped to the item with its ledger sale count", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    const other = insertItem(db, { name: "Other", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);  // 2 sales
    setAlias(db, "Cheddar Block", cheese);   // 1 sale
    setAlias(db, "Zebra Squishy", other);    // belongs to a different item
    saveLedger(db, parseLedger(TWO_NAMES_CSV));

    const aliases = aliasesForItem(db, cheese);
    expect(aliases).toEqual([
      { id: expect.any(Number), productName: "Cheddar Block", saleCount: 1 },
      { id: expect.any(Number), productName: "Cheese Squishy", saleCount: 2 },
    ]);
  });

  it("includes a mapped name with zero sales", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Never Sold", cheese);
    expect(aliasesForItem(db, cheese)).toEqual([
      { id: expect.any(Number), productName: "Never Sold", saleCount: 0 },
    ]);
  });
});

describe("ledgerSalesForItem", () => {
  it("returns one row per mapped ledger sale, ordered by show date", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    const other = insertItem(db, { name: "Other", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    setAlias(db, "Cheddar Block", cheese);
    setAlias(db, "Zebra Squishy", other);
    saveLedger(db, parseLedger(TWO_NAMES_CSV));

    const sales = ledgerSalesForItem(db, cheese);
    expect(sales).toEqual([
      { showDate: "2026-06-11", productName: "Cheese Squishy", amountCents: 100 },
      { showDate: "2026-06-12", productName: "Cheese Squishy", amountCents: 49 },
      { showDate: "2026-06-12", productName: "Cheddar Block", amountCents: 200 },
    ]);
  });

  it("returns nothing for an item with no mapped sales", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    expect(ledgerSalesForItem(db, id)).toEqual([]);
  });
});

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

describe("archive", () => {
  it("archiveItem sets archived_at, unarchiveItem clears it; listItems surfaces it", () => {
    const id = insertItem(db, { name: "Retired", unitCostCents: 100, qtyPurchased: 5, lotId: null });
    expect(listItems(db).find((i) => i.id === id)!.archivedAt).toBeNull();
    archiveItem(db, id);
    const archived = listItems(db).find((i) => i.id === id)!;
    expect(archived.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    unarchiveItem(db, id);
    expect(listItems(db).find((i) => i.id === id)!.archivedAt).toBeNull();
  });

  it("INVARIANT: archiving does not change qtyRemaining, qtySold, or the ledger report", () => {
    const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(CSV));

    const remBefore = qtyRemaining(db, cheese);
    const soldBefore = qtySold(db, cheese);
    const repBefore = JSON.stringify(buildLedgerReport(db));

    archiveItem(db, cheese);

    expect(qtyRemaining(db, cheese)).toBe(remBefore);
    expect(qtySold(db, cheese)).toBe(soldBefore);
    expect(JSON.stringify(buildLedgerReport(db))).toBe(repBefore);
  });
});

describe("bulk inventory actions", () => {
  it("archiveItems / unarchiveItems set/clear archived_at on all given ids only", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const c = insertItem(db, { name: "C", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    archiveItems(db, [a, b]);
    const byId = () => Object.fromEntries(listItems(db).map((i) => [i.id, i.archivedAt]));
    let m = byId();
    expect(m[a]).not.toBeNull();
    expect(m[b]).not.toBeNull();
    expect(m[c]).toBeNull();
    unarchiveItems(db, [a, b]);
    m = byId();
    expect(m[a]).toBeNull();
    expect(m[b]).toBeNull();
  });

  it("deleteItems removes all given ids atomically", () => {
    const a = insertItem(db, { name: "A", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const b = insertItem(db, { name: "B", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const c = insertItem(db, { name: "C", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    deleteItems(db, [a, b]);
    const ids = listItems(db).map((i) => i.id);
    expect(ids).toEqual([c]);
  });

  it("bulkDeleteImpact sums per-item deleteImpact and counts items", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 5, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(csv));
    const plain = insertItem(db, { name: "Plain", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const agg = bulkDeleteImpact(db, [cheese, plain]);
    expect(agg.items).toBe(2);
    expect(agg.mappings).toBe(1);      // only cheese has an alias
    expect(agg.ledgerSales).toBe(1);   // one Cheese Squishy sale
  });

  it("INVARIANT: archiveItems leaves buildLedgerReport unchanged", () => {
    const csv = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""`;
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 10, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(csv));
    const before = JSON.stringify(buildLedgerReport(db));
    archiveItems(db, [cheese]);
    expect(JSON.stringify(buildLedgerReport(db))).toBe(before);
  });
});
