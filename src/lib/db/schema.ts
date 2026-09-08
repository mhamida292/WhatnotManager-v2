/** Split out of SCHEMA so migratePayrollShifts recreates the table from the very
 *  same DDL a fresh database gets, instead of a copy that could drift from it. */
export const PAYROLL_SCHEMA = `
CREATE TABLE IF NOT EXISTS payroll_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person TEXT NOT NULL,
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  hours REAL NOT NULL,
  rate_cents INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_work_date ON payroll_entries(work_date);
`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  purchased_on TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sku TEXT UNIQUE,
  unit_cost_cents INTEGER NOT NULL,
  qty_purchased INTEGER NOT NULL DEFAULT 0,
  qty_samples INTEGER NOT NULL DEFAULT 0,
  qty_adjustment INTEGER NOT NULL DEFAULT 0,
  lot_id INTEGER REFERENCES lots(id),
  archived_at TEXT,
  location TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT,
  invoice_date TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  posted_at TEXT,
  direction TEXT NOT NULL DEFAULT 'purchase' CHECK (direction IN ('purchase','sale')),
  customer TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_on TEXT
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  unit_price_cents INTEGER,
  kind TEXT NOT NULL DEFAULT 'item' CHECK (kind IN ('item','charge'))
);

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  adjusted_on TEXT,
  reason TEXT NOT NULL CHECK (reason IN ('sample','damage_loss','recount','other')),
  qty INTEGER NOT NULL,
  note TEXT,
  counted INTEGER,
  channel TEXT
);

CREATE TABLE IF NOT EXISTS inventory_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  moved_on TEXT,
  qty INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('to_whatnot','to_warehouse')),
  note TEXT
);

CREATE TABLE IF NOT EXISTS item_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  purchased_on TEXT,
  quantity INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_date TEXT NOT NULL,
  payout_cents INTEGER NOT NULL DEFAULT 0,
  shipping_supplies_cents INTEGER NOT NULL DEFAULT 0,
  giveaway_count INTEGER NOT NULL DEFAULT 0,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  source_hash TEXT,
  session_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS show_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  buyer_username TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  item_id INTEGER REFERENCES inventory_items(id)
);

CREATE TABLE IF NOT EXISTS item_identifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('mine','supplier','whatnot')),
  code TEXT NOT NULL,
  supplier_label TEXT,
  UNIQUE(code)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('one_time','recurring')),
  category TEXT,
  amount_cents INTEGER NOT NULL,
  incurred_on TEXT,
  paid_by TEXT,
  reimbursable INTEGER NOT NULL DEFAULT 0,
  reimbursed_on TEXT
);

CREATE TABLE IF NOT EXISTS expense_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  qty REAL,
  unit_cents INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_share_pct INTEGER NOT NULL DEFAULT 80,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  default_shipping_supplies_cents INTEGER NOT NULL DEFAULT 0,
  business_name TEXT,
  invoice_phone TEXT,
  invoice_address TEXT,
  invoice_email TEXT,
  invoice_show_phone INTEGER NOT NULL DEFAULT 1,
  invoice_show_address INTEGER NOT NULL DEFAULT 1,
  invoice_show_email INTEGER NOT NULL DEFAULT 1,
  whatnot_only INTEGER NOT NULL DEFAULT 0,
  costing_mode TEXT NOT NULL DEFAULT 'per_sku' CHECK (costing_mode IN ('per_sku','pooled')),
  avg_method TEXT NOT NULL DEFAULT 'moving' CHECK (avg_method IN ('moving','live'))
);

INSERT OR IGNORE INTO app_settings (id, owner_share_pct, giveaway_unit_cents, default_shipping_supplies_cents)
VALUES (1, 80, 500, 0);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER REFERENCES shows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  show_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale','giveaway','bonus','tip','other','payout','refund')),
  product_name TEXT,
  item_id INTEGER REFERENCES inventory_items(id),
  listing_id TEXT,
  order_id TEXT,
  message TEXT,
  status TEXT,
  txn_type TEXT,
  dedup_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS giveaway_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pack_cost_cents INTEGER NOT NULL,
  pack_qty INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS show_giveaway_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  giveaway_item_id INTEGER NOT NULL REFERENCES giveaway_items(id),
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bundle_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_txn_id INTEGER NOT NULL REFERENCES ledger_transactions(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty INTEGER NOT NULL
);

${PAYROLL_SCHEMA}
`;
