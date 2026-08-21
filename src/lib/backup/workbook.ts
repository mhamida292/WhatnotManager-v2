import ExcelJS from "exceljs";
import { migrate, type DB } from "@/lib/db/connection";

/** All tables, in FK-safe insert order (parents before children). Deletes use
 *  the reverse. Derived column lists keep this in sync with the live schema. */
// INVARIANT: each table must appear after every table it FK-references, so
// inserts (forward) and deletes (reverse) never violate a foreign key.
export const TABLES = [
  "lots", "inventory_items", "invoices", "invoice_lines", "item_purchases",
  // inventory_adjustments and inventory_moves FK-reference inventory_items (must come after)
  "inventory_adjustments", "inventory_moves",
  "item_identifiers", "shows", "show_line_items",
  // expense_items FK-references expenses (must come after)
  "ledger_transactions", "expenses", "expense_items", "app_settings",
  // giveaway_items before show_giveaway_allocations (FK); bundle_components
  // after shows/ledger_transactions/inventory_items (all FK parents above).
  "giveaway_items", "show_giveaway_allocations", "bundle_components",
  "payroll_entries",
] as const;

const APP_MARKER = "whatnot-business-manager";

export class BackupError extends Error {}

/** Table identifiers from workbook content (_meta/sheet names) end up unquoted
 *  in PRAGMA/INSERT statements. Only allow identifier-safe names through. */
function isValidTableName(table: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table);
}

function columns(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/** Row count per table, omitting empty ones — used to tell the user exactly what
 *  a replace-all import is about to destroy, before anything is deleted. */
export function workspaceCounts(db: DB): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    const n = (db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }).c;
    if (n > 0) out[table] = n;
  }
  return out;
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

/** ExcelJS cell value → a plain SQLite-bindable value. Our data is text/number/
 *  null only (dates are stored as TEXT), so pass primitives through and coerce
 *  any rich object to its text/result. */
function cellValue(v: ExcelJS.CellValue): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text);
  if (typeof v === "object" && "result" in v) return cellValue((v as { result: ExcelJS.CellValue }).result);
  return String(v);
}

function headerOf(ws: ExcelJS.Worksheet): string[] {
  return (ws.getRow(1).values as unknown[]).slice(1).map((c) => String(c));
}

function metaTables(meta: ExcelJS.Worksheet): string[] {
  let list = "";
  meta.eachRow((row) => {
    if (String(row.getCell(1).value) === "tables") {
      const raw = row.getCell(2).value;
      list = raw == null ? "" : String(raw);
    }
  });
  return list ? list.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

export async function importWorkbook(
  db: DB,
  buffer: Buffer,
): Promise<{ counts: Record<string, number>; legacy: boolean; skipped: string[] }> {
  const wb = new ExcelJS.Workbook();
  // @types/node Buffer-generic friction with exceljs's load() param type;
  // runtime-identical. Cast to exactly the type load expects.
  try {
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new BackupError("Couldn't read that file — choose a valid .xlsx backup.");
  }

  // 1) validate _meta marker
  const meta = wb.getWorksheet("_meta");
  if (!meta) throw new BackupError("Not a valid backup file (missing _meta sheet).");
  let app = "";
  meta.eachRow((row) => { if (String(row.getCell(1).value) === "app") app = String(row.getCell(2).value); });
  if (app !== APP_MARKER) throw new BackupError("This file is not a Whatnot backup.");

  const fileTables = metaTables(meta);
  const cur = new Set<string>(TABLES);
  const isLegacy = fileTables.length > 0 &&
    (fileTables.length !== cur.size || fileTables.some((t) => !cur.has(t)));

  if (isLegacy) {
    // Legacy backup (older whatnot-business-manager schema). Stage the file's own
    // tables, then let migrate() perform the upgrade — the same path a legacy .db
    // file takes when opened by this app, so there is no second conversion to keep
    // in sync. See docs/superpowers/specs/2026-07-27-legacy-excel-import-design.md
    const skipped: string[] = [];
    const staged: { table: string; cols: string[]; rows: (string | number | null)[][] }[] = [];
    for (const table of fileTables) {
      if (!isValidTableName(table)) { skipped.push(table); continue; }
      const ws = wb.getWorksheet(table);
      if (!ws) { skipped.push(table); continue; }
      const header = headerOf(ws);
      const rows: (string | number | null)[][] = [];
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        if (!row.hasValues) continue;
        rows.push(header.map((_, j) => cellValue(row.getCell(j + 1).value)));
      }
      staged.push({ table, cols: header, rows });
    }

    // Guard against a _meta "tables" cell that names nothing real (blank cell,
    // garbage names, etc.) — without this, the wipe below runs unconditionally
    // and reports success having staged nothing.
    if (!staged.some(({ table }) => (TABLES as readonly string[]).includes(table))) {
      throw new BackupError("That backup contains no recognisable tables — nothing was changed.");
    }

    const counts: Record<string, number> = {};
    db.transaction(() => {
      for (const table of [...TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
      // Recreate the legacy alias table so migrate() can convert it.
      db.exec(`CREATE TABLE IF NOT EXISTS product_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_name TEXT NOT NULL UNIQUE,
        item_id INTEGER NOT NULL REFERENCES inventory_items(id)
      )`);
      // Inserts follow the FILE's table order (fileTables), not TABLES' FK-safe
      // order — this relies on the legacy export having listed its tables in an
      // FK-safe order already, same as the strict path relies on it for TABLES.
      for (const { table, cols, rows } of staged) {
        if (!isValidTableName(table)) { skipped.push(table); continue; }
        const live = columns(db, table);
        if (live.length === 0) { skipped.push(table); continue; }   // table no longer exists here
        const keep = cols.map((c, i) => ({ c, i })).filter(({ c }) => live.includes(c));
        if (keep.length === 0) { skipped.push(table); continue; }
        const ins = db.prepare(
          `INSERT INTO ${table} (${keep.map(({ c }) => `"${c}"`).join(", ")}) VALUES (${keep.map(() => "?").join(", ")})`,
        );
        for (const row of rows) ins.run(...keep.map(({ i }) => row[i]));
        // Only report counts for tables that survive the import — product_aliases
        // (and any other legacy-only table) is staged here so migrate() can read it,
        // but migrate() drops it, so reporting its count would mislead the user.
        if ((TABLES as readonly string[]).includes(table)) counts[table] = rows.length;
      }
      migrate(db);   // assigns SKUs, builds identifiers, converts + drops product_aliases
    })();

    return { counts, legacy: true, skipped };
  }

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

  return { counts, legacy: false, skipped: [] };
}
