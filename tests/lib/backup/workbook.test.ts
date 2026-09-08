import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { insertExpense } from "@/lib/db/expenses";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { insertPayroll } from "@/lib/db/payroll";
import { dismissProductName } from "@/lib/db/dismissed-names";
import { TABLES, exportWorkbook, importWorkbook, BackupError } from "@/lib/backup/workbook";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("exportWorkbook", () => {
  it("writes a _meta marker and one sheet per table with headers", async () => {
    insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 7, lotId: null });
    const buf = await exportWorkbook(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);

    const meta = wb.getWorksheet("_meta");
    expect(meta).toBeTruthy();
    const metaPairs = new Map<string, string>();
    meta!.eachRow((row) => metaPairs.set(String(row.getCell(1).value), String(row.getCell(2).value)));
    expect(metaPairs.get("app")).toBe("whatnot-business-manager");

    for (const t of TABLES) expect(wb.getWorksheet(t), `sheet ${t}`).toBeTruthy();

    const inv = wb.getWorksheet("inventory_items")!;
    const header = (inv.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header).toContain("qty_adjustment");
    const firstData = (inv.getRow(2).values as unknown[]).slice(1);
    expect(firstData).toContain("Cheese");
  });
});

// Dump a table's rows as plain objects, ordered by first column, for comparison.
function dump(db: DB, table: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  return db.prepare(`SELECT ${quoted} FROM ${table} ORDER BY "${cols[0]}"`).all();
}

function seed(db: DB) {
  insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 7, lotId: null });
  insertItem(db, { name: "Mango", unitCostCents: 90, qtyPurchased: 3, lotId: null });
  insertExpense(db, { description: "Mailers", type: "one_time", amountCents: 1200, incurredOn: "2026-06-01" });
  saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank","completed","PAYOUT","b"`));
  updateSettings(db, { ...getSettings(db), giveawayUnitCents: 400, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz" });
  // Payroll and dismissals too, or the round-trip below compares two empty
  // tables and proves nothing about the newest columns.
  insertPayroll(db, {
    person: "Sam", workDate: "2026-06-14", startTime: "20:00", endTime: "01:00",
    hours: 5, rateCents: 1500, amountCents: 7500, note: null,
  });
  dismissProductName(db, "BUNDLE ON SCREEN");
}

describe("importWorkbook", () => {
  it("round-trips: export then import into a fresh db reproduces every table exactly", async () => {
    seed(db);
    const buf = await exportWorkbook(db);

    const fresh = createDb(":memory:");
    const { counts } = await importWorkbook(fresh, buf);

    for (const t of TABLES) {
      expect(dump(fresh, t), `table ${t}`).toEqual(dump(db, t));
    }
    expect(counts.inventory_items).toBe(2);
    // money/integer fields must survive as numbers, not stringified
    const settings = fresh.prepare("SELECT giveaway_unit_cents as g, default_shipping_supplies_cents as s FROM app_settings WHERE id=1").get() as { g: number; s: number };
    expect(settings).toEqual({ g: 400, s: 0 });
    const wage = fresh.prepare("SELECT amount_cents AS a, hours AS h FROM payroll_entries LIMIT 1").get() as { a: number; h: number };
    expect(wage).toEqual({ a: 7500, h: 5 });
  });

  it("rejects a workbook missing a required sheet and leaves the db unchanged", async () => {
    seed(db);
    const buf = await exportWorkbook(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    wb.removeWorksheet(wb.getWorksheet("shows")!.id);
    const broken = Buffer.from(await wb.xlsx.writeBuffer());

    const target = createDb(":memory:");
    insertItem(target, { name: "Keep", unitCostCents: 1, qtyPurchased: 1, lotId: null });
    await expect(importWorkbook(target, broken)).rejects.toBeInstanceOf(BackupError);
    expect((target.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(1);
  });

  it("rejects a file that isn't a whatnot backup", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("random").addRow(["hello"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(importWorkbook(createDb(":memory:"), buf)).rejects.toBeInstanceOf(BackupError);
  });

  it("rejects a file that isn't even a valid .xlsx", async () => {
    const garbage = Buffer.from("not a spreadsheet");
    await expect(importWorkbook(createDb(":memory:"), garbage)).rejects.toBeInstanceOf(BackupError);
  });
});

describe("importWorkbook — same-app column drift (older or newer export of this app)", () => {
  // Rebuild a table's sheet with a different column set, keeping its _meta
  // table list and every other sheet untouched — simulates a real export
  // taken before/after a schema change, without going through a full legacy
  // fixture (the table SET here still matches TABLES exactly).
  async function withRebuiltSheet(
    buf: Buffer,
    table: string,
    newHeader: string[],
    newRow: (string | number | null)[],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    wb.removeWorksheet(wb.getWorksheet(table)!.id);
    const ws = wb.addWorksheet(table);
    ws.addRow(newHeader);
    ws.addRow(newRow);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it("imports an older export missing columns this version added, filling them from schema defaults", async () => {
    seed(db);
    const buf = await exportWorkbook(db);
    // Simulate a pre-pooled-costing export: app_settings sheet without costing_mode/avg_method.
    const olderBuf = await withRebuiltSheet(
      buf,
      "app_settings",
      ["id", "owner_share_pct", "giveaway_unit_cents", "default_shipping_supplies_cents", "business_name",
        "invoice_phone", "invoice_address", "invoice_email", "invoice_show_phone", "invoice_show_address",
        "invoice_show_email", "whatnot_only"],
      [1, 75, 400, 0, "DirectDealzz", null, null, null, 1, 1, 1, 0],
    );

    const target = createDb(":memory:");
    const res = await importWorkbook(target, olderBuf);

    expect(res.legacy).toBe(false);
    const settings = target.prepare(
      "SELECT costing_mode AS cm, avg_method AS am, owner_share_pct AS p FROM app_settings WHERE id = 1"
    ).get() as { cm: string; am: string; p: number };
    expect(settings).toEqual({ cm: "per_sku", am: "moving", p: 75 }); // new columns defaulted, old data preserved
    expect(res.columnDrift).toContainEqual({ table: "app_settings", added: ["costing_mode", "avg_method"], dropped: [] });
  });

  it("drops a column the file has that this version's schema no longer has, and reports it", async () => {
    seed(db);
    const buf = await exportWorkbook(db);
    const newerBuf = await withRebuiltSheet(
      buf,
      "app_settings",
      ["id", "owner_share_pct", "giveaway_unit_cents", "default_shipping_supplies_cents", "business_name",
        "invoice_phone", "invoice_address", "invoice_email", "invoice_show_phone", "invoice_show_address",
        "invoice_show_email", "whatnot_only", "costing_mode", "avg_method", "since_removed_column"],
      [1, 75, 400, 0, "DirectDealzz", null, null, null, 1, 1, 1, 0, "per_sku", "moving", "leftover"],
    );

    const target = createDb(":memory:");
    const res = await importWorkbook(target, newerBuf);

    expect(res.legacy).toBe(false);
    expect(res.columnDrift).toContainEqual({ table: "app_settings", added: [], dropped: ["since_removed_column"] });
    const settings = target.prepare("SELECT owner_share_pct AS p FROM app_settings WHERE id = 1").get() as { p: number };
    expect(settings.p).toBe(75); // rest of the row still imports fine
  });

  it("reports no drift for a table whose columns match exactly", async () => {
    seed(db);
    const buf = await exportWorkbook(db);
    const target = createDb(":memory:");
    const res = await importWorkbook(target, buf);
    expect(res.columnDrift).toEqual([]);
  });
});

describe("TABLES coverage", () => {
  it("covers every user table in the live schema (no silent drift)", () => {
    const live = (createDb(":memory:")
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map((r) => r.name);
    expect([...TABLES].sort()).toEqual(live.sort());
  });
});
