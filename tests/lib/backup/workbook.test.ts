import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { insertExpense } from "@/lib/db/expenses";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { getSettings, updateSettings } from "@/lib/db/settings";
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
  updateSettings(db, { ...getSettings(db), ownerSharePct: 75, giveawayUnitCents: 400, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz" });
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
    const settings = fresh.prepare("SELECT owner_share_pct as p, giveaway_unit_cents as g FROM app_settings WHERE id=1").get() as { p: number; g: number };
    expect(settings).toEqual({ p: 75, g: 400 });
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

describe("TABLES coverage", () => {
  it("covers every user table in the live schema (no silent drift)", () => {
    const live = (createDb(":memory:")
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]).map((r) => r.name);
    expect([...TABLES].sort()).toEqual(live.sort());
  });
});
