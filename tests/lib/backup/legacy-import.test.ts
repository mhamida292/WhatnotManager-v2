import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { createDb } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { TABLES, exportWorkbook, importWorkbook, BackupError } from "@/lib/backup/workbook";

const LEGACY_TABLES = [
  "lots", "inventory_items", "invoices", "invoice_lines", "item_purchases",
  "inventory_adjustments", "product_aliases", "brother_transactions",
  "shows", "show_line_items", "ledger_transactions", "expenses", "expense_items",
  "app_settings", "giveaway_items", "show_giveaway_allocations", "bundle_components",
];

/** A workbook shaped like the old whatnot-business-manager export. `sheets` maps
 *  table name -> [header, ...rows]. Tables omitted from `sheets` get a header-only sheet. */
async function legacyWorkbook(sheets: Record<string, (string | number | null)[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const meta = wb.addWorksheet("_meta");
  meta.addRow(["key", "value"]);
  meta.addRow(["app", "whatnot-business-manager"]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["tables", LEGACY_TABLES.join(",")]);
  for (const t of LEGACY_TABLES) {
    const ws = wb.addWorksheet(t);
    for (const row of sheets[t] ?? [["id"]]) ws.addRow(row);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("legacy import", () => {
  it("imports a legacy backup and converts product_aliases into whatnot identifiers", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [
        ["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"],
        [1, "Blue Widget", 250, 10, null],
        [2, "Red Gadget", 500, 4, null],
      ],
      product_aliases: [
        ["id", "product_name", "item_id"],
        [1, "Blue Widget Squishy", 1],
        [2, "Red Gadget Mini", 2],
      ],
      brother_transactions: [["id", "kind", "qty"], [1, "gave_to_brother", 3]],
    });

    const db = createDb(":memory:");
    const res = await importWorkbook(db, buf);

    expect(res.legacy).toBe(true);
    expect(res.skipped).toContain("brother_transactions");
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(2);

    // aliases became whatnot identifiers
    const whatnot = db.prepare("SELECT code FROM item_identifiers WHERE source = 'whatnot' ORDER BY code").all() as any[];
    expect(whatnot.map((r) => r.code)).toEqual(["Blue Widget Squishy", "Red Gadget Mini"]);

    // every item got a SKU and a 'mine' identifier
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items WHERE sku IS NOT NULL AND sku <> ''").get() as any).c).toBe(2);
    expect((db.prepare("SELECT COUNT(*) c FROM item_identifiers WHERE source = 'mine'").get() as any).c).toBe(2);

    // legacy tables are gone
    const legacyLeft = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('product_aliases','brother_transactions')"
    ).all();
    expect(legacyLeft).toEqual([]);
  });

  it("fills columns this app added since, using their schema defaults", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"], [1, "A", 100, 1, null]],
      invoices: [["id", "supplier", "invoice_date", "status"], [1, "Acme", "2026-01-01", "draft"]],
    });
    const db = createDb(":memory:");
    await importWorkbook(db, buf);
    // `direction` was added later with DEFAULT 'purchase'
    expect((db.prepare("SELECT direction FROM invoices WHERE id = 1").get() as any).direction).toBe("purchase");
  });

  it("rolls back completely when two aliases collide on one code", async () => {
    const buf = await legacyWorkbook({
      inventory_items: [["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"], [1, "A", 100, 1, null], [2, "B", 100, 1, null]],
      product_aliases: [["id", "product_name", "item_id"], [1, "Same Name", 1], [2, "Same Name", 2]],
    });
    const db = createDb(":memory:");
    const before = (db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c;

    await expect(importWorkbook(db, buf)).rejects.toThrow();

    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(before);
  });

  it("rolls back completely when an alias collides with a generated SKU inside migrate()", async () => {
    // migrateItemIdentifiers() assigns item id 1 the SKU "ITEM-00001" and seeds a
    // 'mine' identifier with that code. An alias whose product_name is exactly that
    // string collides on item_identifiers' global UNIQUE(code) index — INSERT OR
    // IGNORE silently drops it, and migrate()'s own count-mismatch guard throws.
    // Unlike the product_aliases.product_name UNIQUE collision above (which fails
    // at insert time, before migrate() ever runs), this failure happens inside
    // migrate() itself, proving the whole transaction — not just the staging
    // insert — rolls back atomically.
    const buf = await legacyWorkbook({
      inventory_items: [["id", "name", "unit_cost_cents", "qty_purchased", "lot_id"], [1, "A", 100, 1, null]],
      product_aliases: [["id", "product_name", "item_id"], [1, "ITEM-00001", 1]],
    });
    const db = createDb(":memory:");
    const itemsBefore = (db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c;
    const identifiersBefore = (db.prepare("SELECT COUNT(*) c FROM item_identifiers").get() as any).c;

    await expect(importWorkbook(db, buf)).rejects.toThrow();

    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(itemsBefore);
    expect((db.prepare("SELECT COUNT(*) c FROM item_identifiers").get() as any).c).toBe(identifiersBefore);
  });

  it("rejects a workbook whose _meta 'tables' value cell is blank, leaving a populated destination unchanged", async () => {
    // Build a workbook with a real _meta sheet and real legacy sheets, but blank
    // out the value cell of the 'tables' row — this is the Critical regression:
    // String(null) === "null" used to make this look like a legacy file naming
    // one (bogus) table, staging nothing, and wiping the destination anyway.
    const wb = new ExcelJS.Workbook();
    const meta = wb.addWorksheet("_meta");
    meta.addRow(["key", "value"]);
    meta.addRow(["app", "whatnot-business-manager"]);
    meta.addRow(["exportedAt", new Date().toISOString()]);
    const tablesRow = meta.addRow(["tables", null]);
    tablesRow.getCell(2).value = null;
    wb.addWorksheet("inventory_items").addRow(["id"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const db = createDb(":memory:");
    insertItem(db, { name: "Keep", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const before = (db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c;

    await expect(importWorkbook(db, buf)).rejects.toBeInstanceOf(BackupError);
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(before);
  });

  it("rejects a workbook whose _meta names only unrecognisable tables, leaving a populated destination unchanged", async () => {
    const wb = new ExcelJS.Workbook();
    const meta = wb.addWorksheet("_meta");
    meta.addRow(["key", "value"]);
    meta.addRow(["app", "whatnot-business-manager"]);
    meta.addRow(["exportedAt", new Date().toISOString()]);
    meta.addRow(["tables", "totally_bogus_table,another_fake_one"]);
    wb.addWorksheet("totally_bogus_table").addRow(["id"]);
    wb.addWorksheet("another_fake_one").addRow(["id"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const db = createDb(":memory:");
    insertItem(db, { name: "Keep", unitCostCents: 100, qtyPurchased: 1, lotId: null });
    const before = (db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c;

    await expect(importWorkbook(db, buf)).rejects.toBeInstanceOf(BackupError);
    expect((db.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(before);
  });

  it("still imports a current-format workbook through the strict path when _meta's tables row is reordered", async () => {
    const db = createDb(":memory:");
    insertItem(db, { name: "Widget", unitCostCents: 250, qtyPurchased: 5, lotId: null });
    const buf = await exportWorkbook(db);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const meta = wb.getWorksheet("_meta")!;
    const reordered = [...TABLES].reverse().join(",");
    meta.eachRow((row) => {
      if (String(row.getCell(1).value) === "tables") row.getCell(2).value = reordered;
    });
    const reorderedBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const target = createDb(":memory:");
    const res = await importWorkbook(target, reorderedBuf);

    expect(res.legacy).toBe(false);
    expect((target.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(1);
    expect((target.prepare("SELECT name FROM inventory_items").get() as any).name).toBe("Widget");
  });
});
