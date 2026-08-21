import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { createDb } from "@/lib/db/connection";
import { exportWorkbook, importWorkbook } from "@/lib/backup/workbook";

describe("restoring an older backup", () => {
  it("ignores a leftover brother_transactions sheet", async () => {
    const db = createDb(":memory:");
    const buf = await exportWorkbook(db);

    // Simulate a backup taken before the concept was removed.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.addWorksheet("brother_transactions");
    ws.addRow(["id", "kind", "qty"]);
    ws.addRow([1, "gave_to_brother", 3]);
    const legacy = Buffer.from(await wb.xlsx.writeBuffer());

    const target = createDb(":memory:");
    await expect(importWorkbook(target, legacy)).resolves.not.toThrow();

    const t = target.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='brother_transactions'"
    ).get();
    expect(t).toBeUndefined();
  });
});
