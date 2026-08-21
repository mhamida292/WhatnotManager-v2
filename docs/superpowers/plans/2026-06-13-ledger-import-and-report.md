# Ledger Import & Profit Report Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the Whatnot account ledger CSV as the source of truth for shows, and produce a per-product/per-show profit report with a configurable owner/partner split.

**Architecture:** A new ledger parser/classifier feeds a new `ledger_transactions` table (idempotent via a `dedup_key`), grouping rows into shows by calendar date and computing each show's payout. A pure report calc joins those transactions to inventory costs and an `app_settings` row to produce the report. New Settings and Report pages, plus an alias-name dropdown, round out Phase 1.

**Tech Stack:** Next.js 15 (App Router), better-sqlite3, papaparse, Vitest. Money is integer cents everywhere. Path alias `@/` → `src/`. Tests live under `tests/**/*.test.ts`; DBs in tests use `createDb(":memory:")`.

---

## File Structure

**New files:**
- `src/lib/db/settings.ts` — read/update the single-row app settings.
- `src/lib/csv/ledger.ts` — parse + classify ledger CSV rows (pure).
- `src/lib/db/ledger.ts` — persist ledger rows; group into shows; idempotent import.
- `src/lib/csv/ledger-preview.ts` — build grouped preview + unmapped list.
- `src/lib/calc/ledger-report.ts` — pure report calc from db + settings.
- `src/app/api/settings/route.ts` — GET/PUT settings.
- `src/app/settings/page.tsx` + `src/components/SettingsForm.tsx` — settings UI.
- `src/app/api/ledger/preview/route.ts` + `src/app/api/ledger/route.ts` — preview + import.
- `src/components/LedgerUpload.tsx` — import UI on Shows page.
- `src/app/api/report/route.ts` + `src/app/report/page.tsx` — report UI.
- `src/app/api/aliases/seen/route.ts` — distinct seen product names for the dropdown.
- Test files mirroring each module under `tests/`.

**Modified files:**
- `src/lib/db/schema.ts` — add `ledger_transactions` + `app_settings` (with default row).
- `src/lib/calc/show-pnl.ts` — extract `splitProfit()`; make split percentage configurable.
- `src/lib/calc/dashboard.ts` — pass the configured split to `showPnl`.
- `src/lib/db/aliases.ts` — add `seenProductNames()`.
- `src/components/InventoryForms.tsx` — alias product-name field → combobox (datalist).
- `src/components/Nav.tsx` — add Report + Settings links.
- `src/app/shows/page.tsx` — render `<LedgerUpload />`.
- `scripts/seed.ts` — stop seeding the $400 incentive expense.

---

## Task 1: Settings table + db module

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/db/settings.ts`
- Test: `tests/lib/db/settings.test.ts`

- [ ] **Step 1: Add the schema**

In `src/lib/db/schema.ts`, append these two statements inside the `SCHEMA` template string, after the `expenses` table:

```sql
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner_share_pct INTEGER NOT NULL DEFAULT 80,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  default_shipping_supplies_cents INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO app_settings (id, owner_share_pct, giveaway_unit_cents, default_shipping_supplies_cents)
VALUES (1, 80, 500, 0);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER REFERENCES shows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  show_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  kind TEXT NOT NULL,
  product_name TEXT,
  item_id INTEGER REFERENCES inventory_items(id),
  listing_id TEXT,
  order_id TEXT,
  message TEXT,
  status TEXT,
  txn_type TEXT,
  dedup_key TEXT NOT NULL UNIQUE
);
```

(Both new tables are added here so later tasks don't need to touch the schema again.)

- [ ] **Step 2: Write the failing test**

Create `tests/lib/db/settings.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { getSettings, updateSettings } from "@/lib/db/settings";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("settings", () => {
  it("returns the seeded defaults", () => {
    expect(getSettings(db)).toEqual({
      ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0,
    });
  });

  it("updates and reads back", () => {
    updateSettings(db, { ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250 });
    expect(getSettings(db)).toEqual({
      ownerSharePct: 70, giveawayUnitCents: 400, defaultShippingSuppliesCents: 250,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/lib/db/settings.test.ts`
Expected: FAIL — cannot find module `@/lib/db/settings`.

- [ ] **Step 4: Implement the module**

Create `src/lib/db/settings.ts`:

```typescript
import type { DB } from "./connection";

export interface Settings {
  ownerSharePct: number;
  giveawayUnitCents: number;
  defaultShippingSuppliesCents: number;
}

export function getSettings(db: DB): Settings {
  const r = db.prepare(`SELECT owner_share_pct as ownerSharePct,
    giveaway_unit_cents as giveawayUnitCents,
    default_shipping_supplies_cents as defaultShippingSuppliesCents
    FROM app_settings WHERE id = 1`).get() as Settings;
  return r;
}

export function updateSettings(db: DB, s: Settings): void {
  db.prepare(`UPDATE app_settings SET owner_share_pct = ?,
    giveaway_unit_cents = ?, default_shipping_supplies_cents = ? WHERE id = 1`)
    .run(s.ownerSharePct, s.giveawayUnitCents, s.defaultShippingSuppliesCents);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/db/settings.test.ts`
Expected: PASS (2 tests). Also run `npm test -- tests/lib/db/connection.test.ts` — still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/settings.ts tests/lib/db/settings.test.ts
git commit -m "feat: app_settings + ledger_transactions schema and settings db module"
```

---

## Task 2: Configurable profit split (`splitProfit`)

**Files:**
- Modify: `src/lib/calc/show-pnl.ts`
- Modify: `src/lib/calc/dashboard.ts:1-45`
- Test: `tests/lib/calc/show-pnl.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/calc/show-pnl.test.ts`:

```typescript
import { splitProfit } from "@/lib/calc/show-pnl";

describe("splitProfit", () => {
  it("defaults to 80/20 with owner absorbing the remainder", () => {
    expect(splitProfit(10000, 80)).toEqual({ ownerShareCents: 8000, partnerShareCents: 2000 });
  });
  it("respects a custom owner percentage", () => {
    expect(splitProfit(10000, 70)).toEqual({ ownerShareCents: 7000, partnerShareCents: 3000 });
  });
  it("owner absorbs the rounding remainder", () => {
    // partner = floor(101 * 0.2) = 20; owner = 81
    expect(splitProfit(101, 80)).toEqual({ ownerShareCents: 81, partnerShareCents: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/calc/show-pnl.test.ts`
Expected: FAIL — `splitProfit` is not exported.

- [ ] **Step 3: Implement**

Edit `src/lib/calc/show-pnl.ts` to add the export and reuse it, and make the split percentage an optional input defaulting to 80 (so existing callers/tests keep working):

```typescript
export interface ShowPnlInput {
  payoutCents: number;
  cogsCents: number;
  giveawayCount: number;
  giveawayUnitCents: number;
  shippingSuppliesCents: number;
  ownerSharePct?: number;
}

export interface ShowPnl {
  giveawayTotalCents: number;
  netProfitCents: number;
  ownerShareCents: number;
  partnerShareCents: number;
}

export function splitProfit(netProfitCents: number, ownerSharePct: number): {
  ownerShareCents: number; partnerShareCents: number;
} {
  const partnerShareCents = Math.floor((netProfitCents * (100 - ownerSharePct)) / 100);
  const ownerShareCents = netProfitCents - partnerShareCents;
  return { ownerShareCents, partnerShareCents };
}

export function showPnl(i: ShowPnlInput): ShowPnl {
  const giveawayTotalCents = i.giveawayCount * i.giveawayUnitCents;
  const netProfitCents = i.payoutCents - i.cogsCents - giveawayTotalCents - i.shippingSuppliesCents;
  const { ownerShareCents, partnerShareCents } = splitProfit(netProfitCents, i.ownerSharePct ?? 80);
  return { giveawayTotalCents, netProfitCents, ownerShareCents, partnerShareCents };
}
```

- [ ] **Step 4: Wire the dashboard to settings**

In `src/lib/calc/dashboard.ts`, import settings and pass the configured split. Add the import at the top:

```typescript
import { getSettings } from "@/lib/db/settings";
```

Inside `dashboardSummary`, before the `for` loop add:

```typescript
  const ownerSharePct = getSettings(db).ownerSharePct;
```

And in the `showPnl({ ... })` call add `ownerSharePct,` to the object.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/lib/calc/show-pnl.test.ts tests/lib/calc/dashboard.test.ts`
Expected: PASS. The dashboard test uses `createDb(":memory:")`, which seeds `owner_share_pct = 80`, so existing expectations are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/show-pnl.ts src/lib/calc/dashboard.ts tests/lib/calc/show-pnl.test.ts
git commit -m "feat: configurable owner/partner split via splitProfit + settings"
```

---

## Task 3: Settings API + page

**Files:**
- Create: `src/app/api/settings/route.ts`
- Create: `src/components/SettingsForm.tsx`
- Create: `src/app/settings/page.tsx`
- Modify: `src/components/Nav.tsx`

- [ ] **Step 1: Create the API route**

Create `src/app/api/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { getSettings, updateSettings } from "@/lib/db/settings";

export async function GET() {
  return NextResponse.json(getSettings(getDb()));
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  updateSettings(getDb(), {
    ownerSharePct: Number(body.ownerSharePct),
    giveawayUnitCents: Number(body.giveawayUnitCents),
    defaultShippingSuppliesCents: Number(body.defaultShippingSuppliesCents),
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create the form component**

Create `src/components/SettingsForm.tsx`:

```tsx
"use client";
import { useState } from "react";
import type { Settings } from "@/lib/db/settings";

export function SettingsForm({ initial }: { initial: Settings }) {
  const [ownerPct, setOwnerPct] = useState(String(initial.ownerSharePct));
  const [giveaway, setGiveaway] = useState((initial.giveawayUnitCents / 100).toFixed(2));
  const [shipping, setShipping] = useState((initial.defaultShippingSuppliesCents / 100).toFixed(2));
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ownerSharePct: Number(ownerPct),
        giveawayUnitCents: Math.round(Number(giveaway) * 100),
        defaultShippingSuppliesCents: Math.round(Number(shipping) * 100),
      }),
    });
    setSaved(true);
  }

  return (
    <form className="max-w-sm space-y-3 rounded-lg border bg-white p-4 text-sm" onSubmit={save}>
      <label className="block">Owner share %
        <input className="mt-1 w-full border p-1" value={ownerPct} onChange={(e) => { setOwnerPct(e.target.value); setSaved(false); }} />
        <span className="text-xs text-gray-500">Partner gets {100 - (Number(ownerPct) || 0)}%</span>
      </label>
      <label className="block">Giveaway unit cost $
        <input className="mt-1 w-full border p-1" value={giveaway} onChange={(e) => { setGiveaway(e.target.value); setSaved(false); }} />
      </label>
      <label className="block">Default shipping supplies $
        <input className="mt-1 w-full border p-1" value={shipping} onChange={(e) => { setShipping(e.target.value); setSaved(false); }} />
      </label>
      <button className="rounded bg-blue-600 px-3 py-1 text-white">Save</button>
      {saved && <span className="ml-2 text-green-700">Saved ✓</span>}
    </form>
  );
}
```

- [ ] **Step 3: Create the page**

Create `src/app/settings/page.tsx`:

```tsx
import { getDb } from "@/lib/db/connection";
import { getSettings } from "@/lib/db/settings";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <SettingsForm initial={getSettings(getDb())} />
    </div>
  );
}
```

- [ ] **Step 4: Add nav links**

In `src/components/Nav.tsx`, change the `links` array to:

```tsx
const links = [["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"], ["/expenses", "Expenses"], ["/report", "Report"], ["/settings", "Settings"]];
```

- [ ] **Step 5: Verify it builds and renders**

Run: `npm run build`
Expected: Build succeeds with `/settings` in the route list. (`/report` will 404 until Task 9 — that's fine; the link is harmless.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/settings/route.ts src/components/SettingsForm.tsx src/app/settings/page.tsx src/components/Nav.tsx
git commit -m "feat: settings page and API"
```

---

## Task 4: Ledger parser & classifier

**Files:**
- Create: `src/lib/csv/ledger.ts`
- Test: `tests/lib/csv/ledger.test.ts`
- Test fixture: `tests/fixtures/sample-ledger.csv`

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/sample-ledger.csv` (real-shaped rows covering every kind):

```csv
"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","1924736723","1107752563","Earnings for selling a Highland Cow Squishy (Assorted Colors)  #3","processing","SALES",""
"Jun 12, 2026, 10:14:33 AM","$1.44","1924735189","1107751490","Earnings for selling a Highland Cow Squishy (Assorted Colors)  #2","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","1924736803","1107752614","Charged deduction of $0.78 for giveaway order fySiGffLWeRVZJ5qzfus7T","completed","SALES","Jun 12, 2026, 10:14:56 AM"
"Jun 10, 2026, 12:00:41 AM","$400.00","","","New Seller Sales Match Bonus","completed","ADJUSTMENT","Jun 10, 2026, 12:00:41 AM"
"Jun 8, 2026, 10:55:32 PM","$1.00","","","Received a tip from snorke","completed","TIP","Jun 11, 2026, 11:20:45 PM"
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/csv/ledger.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLedger } from "@/lib/csv/ledger";

const csv = readFileSync(resolve(__dirname, "../../fixtures/sample-ledger.csv"), "utf8");

describe("parseLedger", () => {
  const rows = parseLedger(csv);

  it("parses every row", () => {
    expect(rows).toHaveLength(5);
  });

  it("parses signed amounts to cents", () => {
    expect(rows[0].amountCents).toBe(49);
    expect(rows[2].amountCents).toBe(-78);
    expect(rows[3].amountCents).toBe(40000);
  });

  it("derives a timezone-safe calendar show date from the created date", () => {
    expect(rows[0].showDate).toBe("2026-06-12");
    expect(rows[3].showDate).toBe("2026-06-10");
    expect(rows[4].showDate).toBe("2026-06-08");
  });

  it("classifies kinds", () => {
    expect(rows[0].kind).toBe("sale");
    expect(rows[2].kind).toBe("giveaway");
    expect(rows[3].kind).toBe("bonus");
    expect(rows[4].kind).toBe("tip");
  });

  it("extracts the base product name for sales only", () => {
    expect(rows[0].productName).toBe("Highland Cow Squishy (Assorted Colors)");
    expect(rows[3].productName).toBeNull();
  });

  it("builds a stable dedup key", () => {
    const again = parseLedger(csv);
    expect(again[0].dedupKey).toBe(rows[0].dedupKey);
    expect(new Set(rows.map((r) => r.dedupKey)).size).toBe(5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/lib/csv/ledger.test.ts`
Expected: FAIL — cannot find module `@/lib/csv/ledger`.

- [ ] **Step 4: Implement the parser**

Create `src/lib/csv/ledger.ts`:

```typescript
import Papa from "papaparse";
import { toCents } from "@/lib/money";
import { baseProductName } from "@/lib/csv/classify";

export type LedgerKind = "sale" | "giveaway" | "bonus" | "tip" | "other";

export interface LedgerRow {
  createdAt: string;        // raw "Created Date" string
  showDate: string;         // YYYY-MM-DD
  amountCents: number;      // signed
  kind: LedgerKind;
  productName: string | null;
  listingId: string;
  orderId: string;
  message: string;
  status: string;
  txnType: string;
  dedupKey: string;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "Jun 12, 2026, 10:14:57 AM" -> "2026-06-12" without timezone drift. */
export function ledgerShowDate(createdDate: string): string {
  const m = createdDate.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const [, mon, day, year] = m;
  return `${year}-${MONTHS[mon] ?? "00"}-${day.padStart(2, "0")}`;
}

/** "$0.49" / "-$0.78" / "$400.00" -> signed integer cents. */
export function parseAmountCents(amount: string): number {
  const neg = amount.trim().startsWith("-");
  const num = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  return toCents(num) * (neg ? -1 : 1);
}

function classify(txnType: string, message: string): LedgerKind {
  if (txnType === "TIP") return "tip";
  if (txnType === "ADJUSTMENT") return /Sales Match Bonus/i.test(message) ? "bonus" : "other";
  if (txnType === "SALES") {
    if (/giveaway/i.test(message)) return "giveaway";
    if (/Earnings for selling/i.test(message)) return "sale";
  }
  return "other";
}

/** "Earnings for selling a Highland Cow Squishy (Assorted Colors)  #3" -> base product name. */
function extractProductName(message: string): string | null {
  const m = message.match(/Earnings for selling an?\s+(.*)$/i);
  if (!m) return null;
  return baseProductName(m[1]);
}

export function parseLedger(text: string): LedgerRow[] {
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return data.map((r) => {
    const createdAt = (r["Created Date"] ?? "").trim();
    const amountCents = parseAmountCents(r["Amount"] ?? "");
    const message = (r["Message"] ?? "").trim();
    const txnType = (r["Transaction Type"] ?? "").trim();
    const kind = classify(txnType, message);
    const orderId = (r["Order ID"] ?? "").trim();
    const listingId = (r["Listing ID"] ?? "").trim();
    return {
      createdAt,
      showDate: ledgerShowDate(createdAt),
      amountCents,
      kind,
      productName: kind === "sale" ? extractProductName(message) : null,
      listingId,
      orderId,
      message,
      status: (r["Status"] ?? "").trim(),
      txnType,
      dedupKey: `${createdAt}|${amountCents}|${orderId}|${listingId}|${message}`,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/csv/ledger.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv/ledger.ts tests/lib/csv/ledger.test.ts tests/fixtures/sample-ledger.csv
git commit -m "feat: ledger CSV parser and classifier"
```

---

## Task 5: Persist ledger → shows (idempotent import)

**Files:**
- Create: `src/lib/db/ledger.ts`
- Test: `tests/lib/db/ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/ledger.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger, listLedgerTransactions } from "@/lib/db/ledger";
import { listShows } from "@/lib/db/shows";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"
"Jun 8, 2026, 10:55:32 PM","$1.00","","","Received a tip from snorke","completed","TIP","y"`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("saveLedger", () => {
  it("creates one show per date and stores transactions", () => {
    const res = saveLedger(db, parseLedger(CSV));
    expect(res.inserted).toBe(3);
    const shows = listShows(db);
    expect(shows.map((s) => s.showDate).sort()).toEqual(["2026-06-08", "2026-06-12"]);
  });

  it("computes each show's payout as the sum of its transaction amounts", () => {
    saveLedger(db, parseLedger(CSV));
    const shows = listShows(db);
    const jun12 = shows.find((s) => s.showDate === "2026-06-12")!;
    expect(jun12.payoutCents).toBe(49 - 78); // -29
    const jun8 = shows.find((s) => s.showDate === "2026-06-08")!;
    expect(jun8.payoutCents).toBe(100);
  });

  it("is idempotent: re-importing the same file inserts nothing new", () => {
    saveLedger(db, parseLedger(CSV));
    const res2 = saveLedger(db, parseLedger(CSV));
    expect(res2.inserted).toBe(0);
    expect(res2.skipped).toBe(3);
    expect(listLedgerTransactions(db)).toHaveLength(3);
    expect(listShows(db)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/db/ledger.test.ts`
Expected: FAIL — cannot find module `@/lib/db/ledger`.

- [ ] **Step 3: Implement**

Create `src/lib/db/ledger.ts`:

```typescript
import type { DB } from "./connection";
import { resolveItemId } from "./aliases";
import type { LedgerRow } from "@/lib/csv/ledger";

export interface LedgerTxnRow extends LedgerRow {
  id: number;
  showId: number;
  itemId: number | null;
}

export interface SaveLedgerResult {
  inserted: number;
  skipped: number;
  showsTouched: number;
}

function findOrCreateShow(db: DB, showDate: string): number {
  const existing = db.prepare("SELECT id FROM shows WHERE show_date = ?").get(showDate) as { id: number } | undefined;
  if (existing) return existing.id;
  const info = db.prepare(
    "INSERT INTO shows (show_date, payout_cents, shipping_supplies_cents, giveaway_count, giveaway_unit_cents) VALUES (?,0,0,0,500)"
  ).run(showDate);
  return Number(info.lastInsertRowid);
}

export function saveLedger(db: DB, rows: LedgerRow[]): SaveLedgerResult {
  const tx = db.transaction((rows: LedgerRow[]): SaveLedgerResult => {
    const ins = db.prepare(`INSERT OR IGNORE INTO ledger_transactions
      (show_id, created_at, show_date, amount_cents, kind, product_name, item_id,
       listing_id, order_id, message, status, txn_type, dedup_key)
      VALUES (@showId,@createdAt,@showDate,@amountCents,@kind,@productName,@itemId,
       @listingId,@orderId,@message,@status,@txnType,@dedupKey)`);
    const touched = new Set<number>();
    let inserted = 0;
    for (const r of rows) {
      const showId = findOrCreateShow(db, r.showDate);
      touched.add(showId);
      const info = ins.run({
        showId, createdAt: r.createdAt, showDate: r.showDate, amountCents: r.amountCents,
        kind: r.kind, productName: r.productName,
        itemId: r.productName ? resolveItemId(db, r.productName) : null,
        listingId: r.listingId, orderId: r.orderId, message: r.message,
        status: r.status, txnType: r.txnType, dedupKey: r.dedupKey,
      });
      if (info.changes > 0) inserted++;
    }
    // Recompute each touched show's payout from its transactions.
    const recompute = db.prepare(
      "UPDATE shows SET payout_cents = (SELECT COALESCE(SUM(amount_cents),0) FROM ledger_transactions WHERE show_id = ?) WHERE id = ?"
    );
    for (const id of touched) recompute.run(id, id);
    return { inserted, skipped: rows.length - inserted, showsTouched: touched.size };
  });
  return tx(rows);
}

export function listLedgerTransactions(db: DB): LedgerTxnRow[] {
  return db.prepare(`SELECT id, show_id as showId, created_at as createdAt, show_date as showDate,
    amount_cents as amountCents, kind, product_name as productName, item_id as itemId,
    listing_id as listingId, order_id as orderId, message, status, txn_type as txnType,
    dedup_key as dedupKey FROM ledger_transactions ORDER BY created_at`).all() as LedgerTxnRow[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/db/ledger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/ledger.ts tests/lib/db/ledger.test.ts
git commit -m "feat: idempotent ledger import grouping transactions into shows by date"
```

---

## Task 6: Ledger preview builder

**Files:**
- Create: `src/lib/csv/ledger-preview.ts`
- Test: `tests/lib/csv/ledger-preview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/csv/ledger-preview.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { buildLedgerPreview } from "@/lib/csv/ledger-preview";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("buildLedgerPreview", () => {
  it("groups by date with computed payout and lists unmapped products", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    const out = buildLedgerPreview(db, CSV);

    expect(out.shows).toHaveLength(1);
    const day = out.shows[0];
    expect(day.showDate).toBe("2026-06-12");
    expect(day.payoutCents).toBe(49 + 200 - 78);
    expect(day.saleCount).toBe(2);
    expect(day.giveawayCount).toBe(1);
    expect(out.unmapped).toContain("Mystery Mini Dumpling");
    expect(out.unmapped).not.toContain("Cheese Squishy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/csv/ledger-preview.test.ts`
Expected: FAIL — cannot find module `@/lib/csv/ledger-preview`.

- [ ] **Step 3: Implement**

Create `src/lib/csv/ledger-preview.ts`:

```typescript
import type { DB } from "@/lib/db/connection";
import { parseLedger, type LedgerRow } from "@/lib/csv/ledger";
import { unmappedNames } from "@/lib/db/aliases";

export interface LedgerPreviewShow {
  showDate: string;
  payoutCents: number;
  saleCount: number;
  giveawayCount: number;
  tipCount: number;
  bonusCount: number;
  otherCount: number;
}

export interface LedgerPreview {
  rows: LedgerRow[];
  shows: LedgerPreviewShow[];
  unmapped: string[];
}

export function buildLedgerPreview(db: DB, csvText: string): LedgerPreview {
  const rows = parseLedger(csvText);
  const byDate = new Map<string, LedgerPreviewShow>();
  for (const r of rows) {
    let s = byDate.get(r.showDate);
    if (!s) {
      s = { showDate: r.showDate, payoutCents: 0, saleCount: 0, giveawayCount: 0, tipCount: 0, bonusCount: 0, otherCount: 0 };
      byDate.set(r.showDate, s);
    }
    s.payoutCents += r.amountCents;
    if (r.kind === "sale") s.saleCount++;
    else if (r.kind === "giveaway") s.giveawayCount++;
    else if (r.kind === "tip") s.tipCount++;
    else if (r.kind === "bonus") s.bonusCount++;
    else s.otherCount++;
  }
  const saleNames = rows.filter((r) => r.kind === "sale" && r.productName).map((r) => r.productName as string);
  const unmapped = unmappedNames(db, saleNames);
  const shows = [...byDate.values()].sort((a, b) => a.showDate.localeCompare(b.showDate));
  return { rows, shows, unmapped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/csv/ledger-preview.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/ledger-preview.ts tests/lib/csv/ledger-preview.test.ts
git commit -m "feat: ledger preview grouped by date with unmapped product list"
```

---

## Task 7: Ledger import + preview API routes

**Files:**
- Create: `src/app/api/ledger/preview/route.ts`
- Create: `src/app/api/ledger/route.ts`

- [ ] **Step 1: Create the preview route**

Create `src/app/api/ledger/preview/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { buildLedgerPreview } from "@/lib/csv/ledger-preview";

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  return NextResponse.json(buildLedgerPreview(getDb(), csvText));
}
```

- [ ] **Step 2: Create the import route**

Create `src/app/api/ledger/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  const result = saveLedger(getDb(), parseLedger(csvText));
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: Build succeeds; `/api/ledger` and `/api/ledger/preview` appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ledger
git commit -m "feat: ledger preview and import API routes"
```

---

## Task 8: Ledger import UI on Shows page

**Files:**
- Create: `src/components/LedgerUpload.tsx`
- Modify: `src/app/shows/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/LedgerUpload.tsx`:

```tsx
"use client";
import { useState } from "react";

interface PreviewShow {
  showDate: string; payoutCents: number; saleCount: number;
  giveawayCount: number; tipCount: number; bonusCount: number; otherCount: number;
}
interface Preview { shows: PreviewShow[]; unmapped: string[]; rows: unknown[]; }

export function LedgerUpload() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const res = await fetch("/api/ledger/preview", { method: "POST", body: text });
    setPreview(await res.json());
  }

  async function importLedger() {
    setSaving(true);
    try {
      const res = await fetch("/api/ledger", { method: "POST", body: csvText });
      if (!res.ok) { alert(`Import failed (${res.status}). ${await res.text()}`); return; }
      const r = await res.json();
      alert(`Imported ${r.inserted} new transactions across ${r.showsTouched} show(s); skipped ${r.skipped} duplicate(s).`);
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <h2 className="mb-2 font-semibold">Import Whatnot ledger</h2>
      <input type="file" accept=".csv" onChange={onFile} />
      {preview && (
        <div className="mt-4 space-y-3 text-sm">
          {preview.unmapped.length > 0 && (
            <div className="rounded bg-yellow-50 p-2 text-yellow-800">
              Unmapped products (cost will count as $0 until mapped on the Inventory page): {preview.unmapped.join(", ")}
            </div>
          )}
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b">
              <th className="p-1">Date</th><th className="p-1">Payout</th><th className="p-1">Sales</th>
              <th className="p-1">Giveaways</th><th className="p-1">Tips</th><th className="p-1">Bonus</th><th className="p-1">Other</th>
            </tr></thead>
            <tbody>
              {preview.shows.map((s) => (
                <tr key={s.showDate} className="border-b">
                  <td className="p-1">{s.showDate}</td>
                  <td className="p-1">${(s.payoutCents / 100).toFixed(2)}</td>
                  <td className="p-1">{s.saleCount}</td>
                  <td className="p-1">{s.giveawayCount}</td>
                  <td className="p-1">{s.tipCount}</td>
                  <td className="p-1">{s.bonusCount}</td>
                  <td className="p-1">{s.otherCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50" onClick={importLedger} disabled={saving}>
            {saving ? "Importing…" : "Import ledger"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it on the Shows page**

In `src/app/shows/page.tsx`, add the import near the top:

```tsx
import { LedgerUpload } from "@/components/LedgerUpload";
```

And render `<LedgerUpload />` as the first child inside the outer `div`, above `<ShowUpload />`.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/LedgerUpload.tsx src/app/shows/page.tsx
git commit -m "feat: ledger import UI on Shows page"
```

---

## Task 9: Report calc

**Files:**
- Create: `src/lib/calc/ledger-report.ts`
- Test: `tests/lib/calc/ledger-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/calc/ledger-report.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { updateSettings } from "@/lib/db/settings";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

// One Cheese sale ($0.49) + one unmapped Mystery sale ($2.00) + one giveaway (-$0.78) on Jun 12.
const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""
"Jun 12, 2026, 10:14:56 AM","-$0.78","L2","O2","Charged deduction of $0.78 for giveaway order zzz","completed","SALES","x"`;

let db: DB;
beforeEach(() => {
  db = createDb(":memory:");
  const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
  setAlias(db, "Cheese Squishy", cheese);
  saveLedger(db, parseLedger(CSV));
});

describe("buildLedgerReport", () => {
  it("reports per-product cost, revenue and profit within a show", () => {
    const rep = buildLedgerReport(db);
    expect(rep.shows).toHaveLength(1);
    const show = rep.shows[0];
    const cheese = show.products.find((p) => p.productName === "Cheese Squishy")!;
    expect(cheese.mapped).toBe(true);
    expect(cheese.qty).toBe(1);
    expect(cheese.unitCostCents).toBe(250);
    expect(cheese.costCents).toBe(250);
    expect(cheese.revenueCents).toBe(49);
    expect(cheese.profitCents).toBe(49 - 250);
  });

  it("treats unmapped products as $0 cost and flags them", () => {
    const rep = buildLedgerReport(db);
    const mystery = rep.shows[0].products.find((p) => p.productName === "Mystery Mini Dumpling")!;
    expect(mystery.mapped).toBe(false);
    expect(mystery.costCents).toBe(0);
    expect(mystery.revenueCents).toBe(200);
    expect(rep.unmappedNames).toContain("Mystery Mini Dumpling");
    expect(rep.unmappedCount).toBe(1);
  });

  it("computes show net = payout - COGS - shipping", () => {
    const rep = buildLedgerReport(db);
    const show = rep.shows[0];
    expect(show.payoutCents).toBe(49 + 200 - 78); // 171
    expect(show.cogsCents).toBe(250);             // only the mapped Cheese
    expect(show.shippingSuppliesCents).toBe(0);
    expect(show.netCents).toBe(171 - 250 - 0);    // -79
  });

  it("computes grand totals and owner share from the configured split", () => {
    updateSettings(db, { ownerSharePct: 80, giveawayUnitCents: 500, defaultShippingSuppliesCents: 0 });
    const rep = buildLedgerReport(db);
    expect(rep.totals.netCents).toBe(-79);
    // partner = floor(-79 * 0.2) = floor(-15.8) = -16; owner = -79 - (-16) = -63
    expect(rep.totals.partnerShareCents).toBe(-16);
    expect(rep.totals.ownerShareCents).toBe(-63);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/calc/ledger-report.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/ledger-report`.

- [ ] **Step 3: Implement**

Create `src/lib/calc/ledger-report.ts`:

```typescript
import type { DB } from "@/lib/db/connection";
import { listShows } from "@/lib/db/shows";
import { listItems } from "@/lib/db/inventory";
import { listLedgerTransactions } from "@/lib/db/ledger";
import { resolveItemId } from "@/lib/db/aliases";
import { getSettings } from "@/lib/db/settings";
import { splitProfit } from "./show-pnl";

export interface ReportProductLine {
  productName: string;
  itemId: number | null;
  mapped: boolean;
  qty: number;
  unitCostCents: number | null;
  costCents: number;
  revenueCents: number;
  profitCents: number;
}

export interface ReportShow {
  showId: number;
  showDate: string;
  products: ReportProductLine[];
  giveawayTotalCents: number;
  tipTotalCents: number;
  bonusTotalCents: number;
  otherTotalCents: number;
  payoutCents: number;
  cogsCents: number;
  shippingSuppliesCents: number;
  netCents: number;
}

export interface LedgerReport {
  shows: ReportShow[];
  totals: {
    revenueCents: number;
    cogsCents: number;
    shippingSuppliesCents: number;
    netCents: number;
    ownerShareCents: number;
    partnerShareCents: number;
  };
  unmappedNames: string[];
  unmappedCount: number;
}

export function buildLedgerReport(db: DB): LedgerReport {
  const settings = getSettings(db);
  const itemCost = new Map(listItems(db).map((i) => [i.id, i.unitCostCents]));
  const txns = listLedgerTransactions(db);
  const byShow = new Map<number, typeof txns>();
  for (const t of txns) {
    if (!byShow.has(t.showId)) byShow.set(t.showId, []);
    byShow.get(t.showId)!.push(t);
  }

  const unmapped = new Set<string>();
  const shows: ReportShow[] = [];

  for (const s of listShows(db)) {
    const rows = byShow.get(s.id) ?? [];
    const productMap = new Map<string, ReportProductLine>();
    let giveaway = 0, tip = 0, bonus = 0, other = 0, payout = 0;

    for (const t of rows) {
      payout += t.amountCents;
      if (t.kind === "sale" && t.productName) {
        let line = productMap.get(t.productName);
        if (!line) {
          const itemId = resolveItemId(db, t.productName); // live resolution
          const unitCostCents = itemId != null ? (itemCost.get(itemId) ?? null) : null;
          line = {
            productName: t.productName, itemId, mapped: itemId != null,
            unitCostCents, qty: 0, costCents: 0, revenueCents: 0, profitCents: 0,
          };
          productMap.set(t.productName, line);
          if (itemId == null) unmapped.add(t.productName);
        }
        line.qty += 1;
        line.revenueCents += t.amountCents;
        line.costCents = line.unitCostCents != null ? line.qty * line.unitCostCents : 0;
        line.profitCents = line.revenueCents - line.costCents;
      } else if (t.kind === "giveaway") giveaway += t.amountCents;
      else if (t.kind === "tip") tip += t.amountCents;
      else if (t.kind === "bonus") bonus += t.amountCents;
      else if (t.kind === "other") other += t.amountCents;
    }

    const products = [...productMap.values()].sort((a, b) => a.productName.localeCompare(b.productName));
    const cogsCents = products.reduce((sum, p) => sum + p.costCents, 0);
    const netCents = payout - cogsCents - s.shippingSuppliesCents;
    shows.push({
      showId: s.id, showDate: s.showDate, products,
      giveawayTotalCents: giveaway, tipTotalCents: tip, bonusTotalCents: bonus, otherTotalCents: other,
      payoutCents: payout, cogsCents, shippingSuppliesCents: s.shippingSuppliesCents, netCents,
    });
  }

  const revenueCents = shows.reduce((sum, s) => sum + s.products.reduce((a, p) => a + p.revenueCents, 0), 0);
  const cogsCents = shows.reduce((sum, s) => sum + s.cogsCents, 0);
  const shippingSuppliesCents = shows.reduce((sum, s) => sum + s.shippingSuppliesCents, 0);
  const netCents = shows.reduce((sum, s) => sum + s.netCents, 0);
  const { ownerShareCents, partnerShareCents } = splitProfit(netCents, settings.ownerSharePct);

  return {
    shows,
    totals: { revenueCents, cogsCents, shippingSuppliesCents, netCents, ownerShareCents, partnerShareCents },
    unmappedNames: [...unmapped].sort(),
    unmappedCount: unmapped.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/calc/ledger-report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/ledger-report.ts tests/lib/calc/ledger-report.test.ts
git commit -m "feat: ledger profit report calc (per-product/per-show + totals)"
```

---

## Task 10: Report API + page

**Files:**
- Create: `src/app/api/report/route.ts`
- Create: `src/app/report/page.tsx`

- [ ] **Step 1: Create the API route**

Create `src/app/api/report/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

export async function GET() {
  return NextResponse.json(buildLedgerReport(getDb()));
}
```

- [ ] **Step 2: Create the page**

Create `src/app/report/page.tsx`:

```tsx
import { getDb } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { Money } from "@/components/Money";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  const rep = buildLedgerReport(getDb());
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Profit report</h1>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Revenue" cents={rep.totals.revenueCents} />
        <Stat label="COGS" cents={rep.totals.cogsCents} />
        <Stat label="Net profit so far" cents={rep.totals.netCents} />
        <Stat label="Your share" cents={rep.totals.ownerShareCents} />
      </div>

      {rep.unmappedCount > 0 && (
        <div className="rounded bg-yellow-50 p-2 text-sm text-yellow-800">
          {rep.unmappedCount} unmapped product(s) counted at $0 cost: {rep.unmappedNames.join(", ")}. Map them on the Inventory page for accurate profit.
        </div>
      )}

      {rep.shows.length === 0 && <p className="text-gray-500">No ledger imported yet. Import your Whatnot ledger on the Shows page.</p>}

      {rep.shows.map((s) => (
        <div key={s.showId} className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex justify-between">
            <h2 className="font-semibold">{s.showDate}</h2>
            <span>Net: <Money cents={s.netCents} /></span>
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b">
              <th className="p-1">Product</th><th className="p-1">Qty</th><th className="p-1">Unit cost</th>
              <th className="p-1">Cost</th><th className="p-1">Revenue</th><th className="p-1">Profit</th>
            </tr></thead>
            <tbody>
              {s.products.map((p) => (
                <tr key={p.productName} className="border-b">
                  <td className="p-1">{p.productName}{!p.mapped && <span className="ml-1 text-yellow-700">(unmapped)</span>}</td>
                  <td className="p-1">{p.qty}</td>
                  <td className="p-1">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
                  <td className="p-1"><Money cents={p.costCents} /></td>
                  <td className="p-1"><Money cents={p.revenueCents} /></td>
                  <td className="p-1"><Money cents={p.profitCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-gray-600">
            Payout <Money cents={s.payoutCents} /> · Giveaways <Money cents={s.giveawayTotalCents} /> ·
            Tips <Money cents={s.tipTotalCents} /> · Bonus <Money cents={s.bonusTotalCents} /> ·
            Shipping <Money cents={s.shippingSuppliesCents} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-xl font-semibold"><Money cents={cents} /></div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build + render**

Run: `npm run build`
Expected: Build succeeds; `/report` and `/api/report` appear in the route list.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/report/route.ts src/app/report/page.tsx
git commit -m "feat: profit report page and API"
```

---

## Task 11: Alias product-name dropdown

**Files:**
- Modify: `src/lib/db/aliases.ts`
- Create: `src/app/api/aliases/seen/route.ts`
- Modify: `src/app/inventory/page.tsx`
- Modify: `src/components/InventoryForms.tsx`
- Test: `tests/lib/db/aliases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/db/aliases.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, seenProductNames } from "@/lib/db/aliases";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";

const CSV = `"Created Date","Amount","Listing ID","Order ID","Message","Status","Transaction Type","Completed Date"
"Jun 12, 2026, 10:14:57 AM","$0.49","L1","O1","Earnings for selling a Cheese Squishy #3","processing","SALES",""
"Jun 12, 2026, 10:13:00 AM","$2.00","L3","O3","Earnings for selling a Mystery Mini Dumpling #1","processing","SALES",""`;

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("seenProductNames", () => {
  it("lists distinct ledger sale product names with a mapped flag, unmapped first", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    saveLedger(db, parseLedger(CSV));
    const seen = seenProductNames(db);
    expect(seen).toEqual([
      { productName: "Mystery Mini Dumpling", mapped: false },
      { productName: "Cheese Squishy", mapped: true },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/db/aliases.test.ts`
Expected: FAIL — `seenProductNames` is not exported.

- [ ] **Step 3: Implement `seenProductNames`**

Append to `src/lib/db/aliases.ts`:

```typescript
export interface SeenProductName { productName: string; mapped: boolean; }

/** Distinct product names seen in imported ledger sales and legacy show lines,
 *  with whether each is already mapped. Unmapped names come first. */
export function seenProductNames(db: DB): SeenProductName[] {
  const names = db.prepare(`
    SELECT DISTINCT product_name AS productName FROM ledger_transactions
      WHERE kind = 'sale' AND product_name IS NOT NULL AND product_name <> ''
    UNION
    SELECT DISTINCT product_name AS productName FROM show_line_items
      WHERE product_name IS NOT NULL AND product_name <> ''
  `).all() as { productName: string }[];
  const out = names.map((n) => ({ productName: n.productName, mapped: resolveItemId(db, n.productName) != null }));
  out.sort((a, b) => (a.mapped === b.mapped ? a.productName.localeCompare(b.productName) : a.mapped ? 1 : -1));
  return out;
}
```

Note: `show_line_items` stores the already-stripped base name (see `saveShow`), and `resolveItemId` strips again harmlessly, so both sources resolve consistently.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/db/aliases.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Create the seen-names API route**

Create `src/app/api/aliases/seen/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { seenProductNames } from "@/lib/db/aliases";

export async function GET() {
  return NextResponse.json(seenProductNames(getDb()));
}
```

- [ ] **Step 6: Pass seen names into the inventory form**

In `src/app/inventory/page.tsx`, import and fetch the seen names, then pass them to the form. Add the import:

```tsx
import { seenProductNames } from "@/lib/db/aliases";
```

In `InventoryPage`, after the `items` line add:

```tsx
  const seen = seenProductNames(db);
```

Change the `<InventoryForms ... />` render to:

```tsx
      <InventoryForms items={items.map((i) => ({ id: i.id, name: i.name }))} seenNames={seen} />
```

- [ ] **Step 7: Turn the alias field into a combobox**

In `src/components/InventoryForms.tsx`, update the component signature and the alias field. Change the function signature line to:

```tsx
export function InventoryForms({ items, seenNames = [] }: { items: { id: number; name: string }[]; seenNames?: { productName: string; mapped: boolean }[] }) {
```

Replace the alias product-name `<input>` with a `datalist`-backed combobox (keeps free typing, adds suggestions, unmapped first):

```tsx
        <input className="w-full border p-1" list="seen-product-names" placeholder="Whatnot product name"
          value={alias.productName} onChange={(e) => setAlias({ ...alias, productName: e.target.value })} />
        <datalist id="seen-product-names">
          {seenNames.map((s) => <option key={s.productName} value={s.productName}>{s.mapped ? "(mapped) " : ""}{s.productName}</option>)}
        </datalist>
```

- [ ] **Step 8: Verify build + tests**

Run: `npm run build && npm test -- tests/lib/db/aliases.test.ts`
Expected: Build succeeds; alias test PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/aliases.ts src/app/api/aliases/seen/route.ts src/app/inventory/page.tsx src/components/InventoryForms.tsx tests/lib/db/aliases.test.ts
git commit -m "feat: alias product-name combobox sourced from seen ledger products"
```

---

## Task 12: $400 double-count fix in seed

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Remove the incentive expense from the seed**

In `scripts/seed.ts`, delete the incentive expense line and its `insertExpense` import if now unused. Remove:

```typescript
insertExpense(db, { description: "Whatnot incentive", type: "one_time", category: "incentive", amountCents: toCents(-400) });
```

If `insertExpense` is no longer referenced anywhere else in the file, also remove its import line:

```typescript
import { insertExpense } from "../src/lib/db/expenses";
```

Add a short comment in its place:

```typescript
// The $400 New Seller Sales Match Bonus now comes from the imported ledger
// (kind = "bonus"), so it is NOT seeded as a negative expense here — that would double-count it.
```

- [ ] **Step 2: Verify the project still builds and the full suite passes**

Run: `npm run build && npm test`
Expected: Build succeeds; all tests PASS (existing + the new settings, ledger, ledger-preview, ledger-report, aliases suites).

- [ ] **Step 3: Commit**

```bash
git add scripts/seed.ts
git commit -m "fix: stop seeding the \$400 incentive expense (now sourced from ledger)"
```

---

## Task 13: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: All suites PASS. Confirm the new files are covered: `settings`, `show-pnl` (`splitProfit`), `ledger`, `ledger` db, `ledger-preview`, `ledger-report`, `aliases`.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: Succeeds; routes include `/settings`, `/report`, `/api/settings`, `/api/ledger`, `/api/ledger/preview`, `/api/report`, `/api/aliases/seen`.

- [ ] **Step 3: Manual smoke test against the real ledger**

```bash
PORT=3001 npm run dev   # then in another shell:
curl -s -X POST --data-binary @/home/mhamida/Downloads/ledger.csv http://localhost:3001/api/ledger/preview | head -c 400
curl -s -X POST --data-binary @/home/mhamida/Downloads/ledger.csv http://localhost:3001/api/ledger
curl -s http://localhost:3001/api/report | head -c 600
```

Expected: preview returns 4 shows (Jun 8/9/10/12) with computed payouts; import returns `inserted` ~273 with `skipped: 0` first time, then `inserted: 0` on a second call (idempotent); report returns per-show products with a non-empty `unmappedNames` list for products not yet aliased.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test: verify ledger import and report end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** §1 parser→T4; §2 storage/idempotency→T1(schema)+T5; §3 import UI→T7,T8; §4 report→T9,T10; §5 settings→T1,T2,T3; §6 alias dropdown→T11; §7 $400 fix→T12. All covered.
- **Type consistency:** `LedgerRow` (T4) is reused by `saveLedger` (T5), `buildLedgerPreview` (T6), and indirectly the report. `splitProfit(net, pct)` defined in T2 is reused in T9. `Settings` shape is identical across T1/T3/T9. `seenProductNames` return type matches the `seenNames` prop in T11.
- **Idempotency** is enforced by `dedup_key UNIQUE` (T1) + `INSERT OR IGNORE` (T5) and asserted in T5/T13.
- **No behavioral surprise:** legacy per-show upload (`ShowUpload`) is left intact; only the seed's $400 line changes existing behavior, per the approved spec.
