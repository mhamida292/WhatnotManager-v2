import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { createDb } from "@/lib/db/connection";
import { importWorkbook, TABLES } from "@/lib/backup/workbook";
import { listPayroll } from "@/lib/db/payroll";

/** The table list and payroll columns as they were BEFORE the shift reshape and
 *  before dismissed_product_names existed — i.e. what a backup taken from the
 *  currently-deployed app actually contains. */
const OLD_TABLES = TABLES.filter((t) => t !== "dismissed_product_names");
const OLD_PAYROLL_COLS = ["id", "person", "period_start", "period_end", "hours", "rate_cents", "amount_cents", "note"];
/** payroll_entries as it was AFTER the shift reshape but BEFORE pay bases. */
const HOURLY_PAYROLL_COLS = ["id", "person", "work_date", "start_time", "end_time", "hours", "rate_cents", "amount_cents", "note"];

async function oldBackup(payrollRows: (string | number | null)[][], payrollCols = OLD_PAYROLL_COLS): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const meta = wb.addWorksheet("_meta");
  meta.addRow(["key", "value"]);
  meta.addRow(["app", "whatnot-business-manager"]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["tables", OLD_TABLES.join(",")]);

  for (const t of OLD_TABLES) {
    const ws = wb.addWorksheet(t);
    if (t === "payroll_entries") {
      ws.addRow(payrollCols);
      for (const r of payrollRows) ws.addRow(r);
    } else if (t === "inventory_items") {
      // One ordinary row, so the import has something real to restore.
      ws.addRow(["id", "name", "sku", "unit_cost_cents", "qty_purchased"]);
      ws.addRow([1, "Cheese Squishy", "ITEM-00001", 250, 10]);
    } else {
      ws.addRow(["id"]);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("restoring a backup taken by the OLD app", () => {
  it("restores a pay-period payroll row without losing the wage", async () => {
    const db = createDb(":memory:");
    // Exactly the row sitting in the live ws/0.db today.
    const buf = await oldBackup([[1, "Maria", "2026-07-18", "2026-07-18", 4, 2000, 8000, null]]);

    const res = await importWorkbook(db, buf);

    expect(res.counts["inventory_items"]).toBe(1);
    const rows = listPayroll(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(8000);   // the money survives
    expect(rows[0].person).toBe("Maria");
    expect(rows[0].workDate).toBe("2026-07-18"); // period_start becomes the work date
  });

  it("survives an old row whose nullable hours/rate were never filled in", async () => {
    const db = createDb(":memory:");
    const buf = await oldBackup([[1, "Sam", null, null, null, null, 5000, "flat"]]);

    const res = await importWorkbook(db, buf);

    expect(res.counts["inventory_items"]).toBe(1);
    expect(listPayroll(db)[0].amountCents).toBe(5000);
  });

  it("restores everything else when there is no payroll at all", async () => {
    const db = createDb(":memory:");
    const res = await importWorkbook(db, await oldBackup([]));
    expect(res.counts["inventory_items"]).toBe(1);
  });

  it("carries an hourly backup's hours across as qty", async () => {
    const buf = await oldBackup(
      [[1, "Maria", "2026-07-18", "18:00", "23:00", 5, 1500, 7500, "evening"]],
      HOURLY_PAYROLL_COLS,
    );
    const db = createDb(":memory:");
    await importWorkbook(db, buf);

    const [row] = listPayroll(db);
    expect(row).toMatchObject({
      person: "Maria", workDate: "2026-07-18", basis: "hour", qty: 5,
      startTime: "18:00", endTime: "23:00", rateCents: 1500,
      amountCents: 7500, paidOn: null,
    });
  });
});
