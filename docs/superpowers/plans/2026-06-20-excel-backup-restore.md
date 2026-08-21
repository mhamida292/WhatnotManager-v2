# Excel Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the entire SQLite database to one `.xlsx` workbook and restore it from such a workbook (replace-all, validated, transactional).

**Architecture:** A pure `workbook.ts` module does DB↔xlsx using ExcelJS: `exportWorkbook(db)` writes one sheet per table (plus a `_meta` marker) with raw values; `importWorkbook(db, buffer)` validates strictly then replaces all data in a single transaction. Two API routes expose download/upload; a Settings "Backup" card drives them.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, ExcelJS, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-excel-backup-restore-design.md`

---

## File structure

- `src/lib/backup/workbook.ts` — new; `TABLES`, `exportWorkbook`, `importWorkbook`, `BackupError`.
- `src/app/api/backup/export/route.ts` — new; GET download.
- `src/app/api/backup/import/route.ts` — new; POST upload.
- `src/components/BackupRestore.tsx` — new client component.
- `src/app/settings/page.tsx` — render the component.
- `tests/lib/backup/workbook.test.ts` — round-trip + validation + transactional tests.

**Table order (insert order; FK-verified against schema):** `lots, inventory_items, invoices, invoice_lines, item_purchases, product_aliases, brother_transactions, shows, show_line_items, ledger_transactions, expenses, app_settings`. Deletes run in reverse.

---

## Task 1: Add ExcelJS dependency

**Files:** `package.json`

- [ ] **Step 1: Install**

Run: `npm install exceljs`
Expected: `exceljs` added to `dependencies`; `package-lock.json` updated; install succeeds.

- [ ] **Step 2: Sanity-check it imports**

Run: `node -e "const E=require('exceljs'); console.log(typeof E.Workbook)"`
Expected: prints `function`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add exceljs for backup/restore"
```

---

## Task 2: exportWorkbook + TABLES

**Files:**
- Create: `src/lib/backup/workbook.ts`
- Test: `tests/lib/backup/workbook.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/lib/backup/workbook.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { TABLES, exportWorkbook } from "@/lib/backup/workbook";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("exportWorkbook", () => {
  it("writes a _meta marker and one sheet per table with headers", async () => {
    insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 7, lotId: null });
    const buf = await exportWorkbook(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const meta = wb.getWorksheet("_meta");
    expect(meta).toBeTruthy();
    const metaPairs = new Map<string, string>();
    meta!.eachRow((row) => metaPairs.set(String(row.getCell(1).value), String(row.getCell(2).value)));
    expect(metaPairs.get("app")).toBe("whatnot-business-manager");

    for (const t of TABLES) expect(wb.getWorksheet(t), `sheet ${t}`).toBeTruthy();

    const inv = wb.getWorksheet("inventory_items")!;
    const header = (inv.getRow(1).values as unknown[]).slice(1).map(String);
    expect(header).toContain("qty_adjustment");
    // one data row for the Cheese item
    const firstData = (inv.getRow(2).values as unknown[]).slice(1);
    expect(firstData).toContain("Cheese");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/backup/workbook.test.ts`
Expected: FAIL — module `@/lib/backup/workbook` not found.

- [ ] **Step 3: Implement** — create `src/lib/backup/workbook.ts`:

```ts
import ExcelJS from "exceljs";
import type { DB } from "@/lib/db/connection";

/** All tables, in FK-safe insert order (parents before children). Deletes use
 *  the reverse. Derived column lists keep this in sync with the live schema. */
export const TABLES = [
  "lots", "inventory_items", "invoices", "invoice_lines", "item_purchases",
  "product_aliases", "brother_transactions", "shows", "show_line_items",
  "ledger_transactions", "expenses", "app_settings",
] as const;

const APP_MARKER = "whatnot-business-manager";

export class BackupError extends Error {}

function columns(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

export async function exportWorkbook(db: DB): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const meta = wb.addWorksheet("_meta");
  meta.addRow(["key", "value"]);
  meta.addRow(["app", APP_MARKER]);
  meta.addRow(["exportedAt", new Date().toISOString()]);
  meta.addRow(["tables", TABLES.join(",")]);

  for (const table of TABLES) {
    const cols = columns(db, table);
    const ws = wb.addWorksheet(table);
    ws.addRow(cols);
    const quoted = cols.map((c) => `"${c}"`).join(", ");
    const rows = db.prepare(`SELECT ${quoted} FROM ${table}`).all() as Record<string, unknown>[];
    for (const r of rows) ws.addRow(cols.map((c) => (r[c] ?? null)));
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/backup/workbook.test.ts`
Expected: PASS. (If ExcelJS's `getRow().values` indexing differs, adjust the test's `.slice(1)` — ExcelJS row.values is 1-based with an empty index 0.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup/workbook.ts tests/lib/backup/workbook.test.ts
git commit -m "feat(backup): exportWorkbook writes one sheet per table + _meta"
```

---

## Task 3: importWorkbook + round-trip/validation/transactional tests

**Files:**
- Modify: `src/lib/backup/workbook.ts`
- Test: `tests/lib/backup/workbook.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `tests/lib/backup/workbook.test.ts`. Extend the import to add `importWorkbook, BackupError`, and add these imports for seeding: `import { insertExpense } from "@/lib/db/expenses";`, `import { parseLedger } from "@/lib/csv/ledger";`, `import { saveLedger } from "@/lib/db/ledger";`, `import { updateSettings } from "@/lib/db/settings";`. Then:

```ts
// Dump a table's rows as plain objects, ordered by first column, for comparison.
function dump(db: DB, table: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const quoted = cols.map((c) => `"${c}"`).join(", ");
  return db.prepare(`SELECT ${quoted} FROM ${table} ORDER BY "${cols[0]}"`).all();
}

function seed(db: DB) {
  insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 7, lotId: null });
  insertItem(db, { name: "Mango", unitCostCents: 90, qtyPurchased: 3, lotId: null });
  insertExpense(db, { label: "Mailers", amountCents: 1200, incurredOn: "2026-06-01" } as any);
  saveLedger(db, parseLedger(`"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 14, 2026, 09:00:00 AM","$100.00","L1","O1","Earnings for selling a Cheese Squishy #3","completed","SALES","a"
"Jun 14, 2026, 05:00:00 PM","-$534.39","","","Payout to bank","completed","PAYOUT","b"`));
  updateSettings(db, { ownerSharePct: 75, giveawayUnitCents: 400, defaultShippingSuppliesCents: 0, businessName: "DirectDealzz" } as any);
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
  });

  it("rejects a workbook missing a required sheet and leaves the db unchanged", async () => {
    seed(db);
    const buf = await exportWorkbook(db);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    wb.removeWorksheet(wb.getWorksheet("shows")!.id);
    const broken = Buffer.from(await wb.xlsx.writeBuffer());

    const target = createDb(":memory:");
    insertItem(target, { name: "Keep", unitCostCents: 1, qtyPurchased: 1, lotId: null });
    await expect(importWorkbook(target, broken)).rejects.toBeInstanceOf(BackupError);
    expect((target.prepare("SELECT COUNT(*) c FROM inventory_items").get() as any).c).toBe(1); // unchanged
  });

  it("rejects a file that isn't a whatnot backup", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("random").addRow(["hello"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(importWorkbook(createDb(":memory:"), buf)).rejects.toBeInstanceOf(BackupError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/backup/workbook.test.ts -t "importWorkbook"`
Expected: FAIL — `importWorkbook` not exported.

- [ ] **Step 3: Implement** — append to `src/lib/backup/workbook.ts`:

```ts
/** ExcelJS cell value → a plain SQLite-bindable value. Our data is text/number/
 *  null only (dates are stored as TEXT), so pass primitives through and coerce
 *  any rich object to its text. */
function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  if (typeof v === "object" && "result" in v) return (v as { result: unknown }).result as string | number;
  return String(v);
}

function headerOf(ws: ExcelJS.Worksheet): string[] {
  return (ws.getRow(1).values as unknown[]).slice(1).map((c) => String(c));
}

export async function importWorkbook(db: DB, buffer: Buffer): Promise<{ counts: Record<string, number> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // 1) validate _meta marker
  const meta = wb.getWorksheet("_meta");
  if (!meta) throw new BackupError("Not a valid backup file (missing _meta sheet).");
  let app = "";
  meta.eachRow((row) => { if (String(row.getCell(1).value) === "app") app = String(row.getCell(2).value); });
  if (app !== APP_MARKER) throw new BackupError("This file is not a Whatnot backup.");

  // 2) validate every table sheet + columns; collect rows
  const staged: Record<string, { cols: string[]; rows: (string | number | null)[][] }> = {};
  for (const table of TABLES) {
    const ws = wb.getWorksheet(table);
    if (!ws) throw new BackupError(`Backup is missing the "${table}" sheet.`);
    const header = headerOf(ws);
    const liveCols = columns(db, table);
    if ([...header].sort().join(",") !== [...liveCols].sort().join(",")) {
      throw new BackupError(`Columns for "${table}" don't match the current schema.`);
    }
    const rows: (string | number | null)[][] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      if (!row.hasValues) continue;
      rows.push(header.map((_, j) => cellValue(row.getCell(j + 1).value)));
    }
    staged[table] = { cols: header, rows };
  }

  // 3) replace-all in a single transaction (all-or-nothing)
  const counts: Record<string, number> = {};
  db.transaction(() => {
    for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
    for (const table of TABLES) {
      const { cols, rows } = staged[table];
      const ins = db.prepare(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      );
      for (const row of rows) ins.run(...row);
      counts[table] = rows.length;
    }
  })();

  return { counts };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/backup/workbook.test.ts`
Expected: PASS (export + import suites). Then `npm test` — full suite green. If the round-trip comparison fails on a specific column, inspect the ExcelJS read of that value and adjust `cellValue` (this is the integration point library quirks surface).

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup/workbook.ts tests/lib/backup/workbook.test.ts
git commit -m "feat(backup): importWorkbook validates and restores in one transaction"
```

---

## Task 4: Export API route

**Files:**
- Create: `src/app/api/backup/export/route.ts`

- [ ] **Step 1: Implement** — create `src/app/api/backup/export/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { exportWorkbook } from "@/lib/backup/workbook";

export async function GET() {
  const buf = await exportWorkbook(getDb());
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="whatnot-backup-${date}.xlsx"`,
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/backup/export/route.ts
git commit -m "feat(api): GET /api/backup/export downloads the workbook"
```

---

## Task 5: Import API route

**Files:**
- Create: `src/app/api/backup/import/route.ts`

- [ ] **Step 1: Implement** — create `src/app/api/backup/import/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { importWorkbook, BackupError } from "@/lib/backup/workbook";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const { counts } = await importWorkbook(getDb(), buf);
    return NextResponse.json({ ok: true, counts });
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `Restore failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/backup/import/route.ts
git commit -m "feat(api): POST /api/backup/import validates and restores"
```

---

## Task 6: Backup UI on Settings

**Files:**
- Create: `src/components/BackupRestore.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Create the component** — `src/components/BackupRestore.tsx`:

```tsx
"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Export the whole database to Excel, or restore it from a backup workbook
 *  (replace-all, behind a confirm). */
export function BackupRestore() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function restore() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErr("Choose a .xlsx backup file first."); return; }
    if (!confirm("Restore from this file? This REPLACES all current data with the file's contents and can't be undone.")) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/backup/import", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) { setErr(data.error ?? `Restore failed (${res.status}).`); return; }
      const total = Object.values(data.counts as Record<string, number>).reduce((a, b) => a + b, 0);
      setMsg(`Restored ${total} rows across ${Object.keys(data.counts).length} tables.`);
      router.refresh();
    } catch (e) {
      setErr(`Restore failed: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line p-5">
      <h2 className="font-semibold text-slate-800">Backup</h2>
      <p className="mt-1 text-sm text-slate-600">
        Export your entire database to an Excel file, or restore it from one. Restoring replaces all current data.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a href="/api/backup/export"
          className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          Export to Excel
        </a>
        <input ref={fileRef} type="file" accept=".xlsx" className="text-sm" />
        <Button variant="secondary" onClick={restore} disabled={busy}>
          {busy ? "Restoring…" : "Import / Restore"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Wire into Settings** — in `src/app/settings/page.tsx`, import and render it above `<DangerZone />`:
```tsx
import { BackupRestore } from "@/components/BackupRestore";
```
and inside the returned `<div className="space-y-6">`, add `<BackupRestore />` between `<SettingsForm ... />` and `<DangerZone />`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/BackupRestore.tsx src/app/settings/page.tsx
git commit -m "feat(settings): Backup card with export + restore"
```

---

## Task 7: Final verification

**Files:** none

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Production build**

Run: `npx tsc --noEmit && rm -rf .next && npx next build`
Expected: clean typecheck; build succeeds (`/api/backup/export` and `/api/backup/import` listed as routes).

- [ ] **Step 3: End-to-end on a throwaway DB**

Copy the real DB to a scratch path and run dev against it so the real data is untouched:
```bash
cp data/whatnot.db /tmp/bkp.db; rm -f /tmp/bkp.db-wal /tmp/bkp.db-shm
DB_PATH=/tmp/bkp.db npm run dev > /tmp/bkp-dev.log 2>&1 &
```
Wait for ready, then (replace PORT with the started port):
```bash
# Export
curl -s -o /tmp/backup.xlsx http://localhost:PORT/api/backup/export
ls -l /tmp/backup.xlsx   # non-empty .xlsx
# Mutate: delete an item count, then restore and confirm it returns
before=$(curl -s http://localhost:PORT/api/inventory | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
curl -s -X POST http://localhost:PORT/api/backup/import -F "file=@/tmp/backup.xlsx"
after=$(curl -s http://localhost:PORT/api/inventory | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).length))")
echo "items before=$before after=$after (should match)"
# Bad file rejected
echo "not a backup" > /tmp/bad.xlsx
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:PORT/api/backup/import -F "file=@/tmp/bad.xlsx"  # expect 400
```
Expected: export writes a non-empty file; import returns `{ok:true,counts}` and item count matches; the bad file returns 400. Then stop the dev server and remove `/tmp/bkp.db*`, `/tmp/backup.xlsx`, `/tmp/bad.xlsx`.

---

## Notes for the executor

- The round-trip test in Task 3 is the contract. ExcelJS read/write quirks (row.values 1-based indexing, empty-cell→null) surface there — adjust `cellValue`/`headerOf` until the round-trip is exact; do not weaken the test.
- Columns are always derived from `PRAGMA table_info`, never hardcoded, so the backup tracks schema changes automatically.
- `app_settings` is a single fixed-id row; the reverse-delete + re-insert restores it (no reliance on reset defaults).
- Do not push; the controller handles branch finishing.
```
