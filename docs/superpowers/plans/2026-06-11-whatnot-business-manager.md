# Whatnot Business Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Next.js + SQLite web app to track Whatnot show profit, inventory spend, and business expenses, with CSV auto-classification.

**Architecture:** Single Next.js (App Router, TypeScript) app. Pure business logic lives in framework-free modules under `src/lib/` (fully unit-tested with Vitest). A thin `better-sqlite3` data layer exposes typed repository functions. API routes call repositories + lib. React Server/Client components render four pages. One Docker container; one SQLite file at `data/whatnot.db`.

**Tech Stack:** Next.js 15 (App Router, TS), better-sqlite3, papaparse, Vitest, Tailwind CSS, Docker.

---

## File Structure

```
src/
  lib/
    csv/
      parse.ts            # raw CSV text -> RawRow[]
      classify.ts         # RawRow[] -> ClassifiedRow[] (status assignment)
      types.ts            # RawRow, ClassifiedRow, RowStatus
    money.ts              # cents<->dollars helpers, rounding
    calc/
      cogs.ts             # line COGS from qty * unit cost
      show-pnl.ts         # per-show net profit + 80/20 split
      inventory-spend.ts  # true net inventory spend from lots + brother txns
    db/
      schema.sql          # CREATE TABLE statements
      connection.ts       # opens better-sqlite3, runs schema
      shows.ts            # Show + ShowLineItem repositories
      inventory.ts        # InventoryItem, Lot, BrotherTransaction repositories
      aliases.ts          # ProductAlias repository
      expenses.ts         # Expense repository
  app/
    layout.tsx
    page.tsx              # Dashboard
    shows/page.tsx
    shows/[id]/page.tsx
    inventory/page.tsx
    expenses/page.tsx
    api/.../route.ts      # see API tasks
  components/             # shared UI
scripts/seed.ts           # loads known seed data
tests/                    # mirrors src/lib
```

---

## Phase 0: Project Scaffold

### Task 1: Initialize Next.js + TypeScript + Tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "whatnot-business-manager",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "next": "15.1.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "better-sqlite3": "11.7.0",
    "papaparse": "5.4.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.11",
    "@types/node": "22.10.0",
    "@types/papaparse": "5.3.15",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "typescript": "5.7.2",
    "vitest": "2.1.8",
    "tsx": "4.19.2",
    "tailwindcss": "3.4.17",
    "postcss": "8.4.49",
    "autoprefixer": "10.4.20"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors. (`better-sqlite3` compiles a native binary; on failure install build tools `python3`, `make`, `g++`.)

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create config files**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { output: "standalone", serverExternalPackages: ["better-sqlite3"] };
export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Verify the test runner works**

Run: `npx vitest run`
Expected: exits successfully reporting "No test files found" (acceptable at this stage).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + TypeScript + Vitest + Tailwind"
```

---

## Phase 1: Money Helper

### Task 2: Money utilities (store cents, avoid float drift)

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/lib/money.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toCents, toDollars, formatUSD } from "@/lib/money";

describe("money", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(2.5)).toBe(250);
    expect(toCents(732)).toBe(73200);
    expect(toCents(2.25)).toBe(225);
  });
  it("rounds to nearest cent (no float drift)", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it("converts cents back to dollars", () => {
    expect(toDollars(250)).toBe(2.5);
  });
  it("formats USD", () => {
    expect(formatUSD(73200)).toBe("$732.00");
    expect(formatUSD(-500)).toBe("-$5.00");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/money.test.ts`
Expected: FAIL — cannot find module `@/lib/money`.

- [ ] **Step 3: Write minimal implementation**

```ts
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
export function toDollars(cents: number): number {
  return cents / 100;
}
export function formatUSD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/money.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/money.ts tests/lib/money.test.ts
git commit -m "feat: add money helpers (cents storage, USD formatting)"
```

---

## Phase 2: CSV Parsing & Classification (core logic)

### Task 3: CSV types and raw parser

**Files:**
- Create: `src/lib/csv/types.ts`, `src/lib/csv/parse.ts`
- Test: `tests/lib/csv/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "@/lib/csv/parse";

const SAMPLE = `order_id,buyer_username,product_name,product_quantity,original_item_price,cancelled_or_failed,shipment_id,gifted_to
abc,bradley543,Cheese Squishy #1,1,3.0,,387292926,
xyz,ariarod71890,Highland Cow Squishy (Assorted Colors)  #2,1,3.0,cancelled,,`;

describe("parseCsv", () => {
  it("parses rows with the columns we use", () => {
    const rows = parseCsv(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      buyerUsername: "bradley543",
      productName: "Cheese Squishy #1",
      quantity: 1,
      priceCents: 300,
      cancelledOrFailed: "",
      shipmentId: "387292926",
    });
    expect(rows[1].cancelledOrFailed).toBe("cancelled");
    expect(rows[1].shipmentId).toBe("");
  });
  it("tolerates missing optional columns", () => {
    const rows = parseCsv("buyer_username,product_name,product_quantity,original_item_price\nu,Item,2,1.5");
    expect(rows[0]).toMatchObject({ buyerUsername: "u", quantity: 2, priceCents: 150, shipmentId: "" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/parse.test.ts`
Expected: FAIL — cannot find module `@/lib/csv/parse`.

- [ ] **Step 3: Write types**

`src/lib/csv/types.ts`:
```ts
export type RowStatus = "confirmed" | "cancelled" | "failed" | "giveaway" | "suspected_duplicate";

export interface RawRow {
  buyerUsername: string;
  productName: string;
  quantity: number;
  priceCents: number;
  cancelledOrFailed: string;
  shipmentId: string;
  giftedTo: string;
}

export interface ClassifiedRow extends RawRow {
  status: RowStatus;
}
```

- [ ] **Step 4: Write the parser**

`src/lib/csv/parse.ts`:
```ts
import Papa from "papaparse";
import { toCents } from "@/lib/money";
import type { RawRow } from "./types";

export function parseCsv(text: string): RawRow[] {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return data.map((r) => ({
    buyerUsername: (r.buyer_username ?? "").trim(),
    productName: (r.product_name ?? "").trim(),
    quantity: Number(r.product_quantity ?? "0") || 0,
    priceCents: toCents(Number(r.original_item_price ?? "0") || 0),
    cancelledOrFailed: (r.cancelled_or_failed ?? "").trim(),
    shipmentId: (r.shipment_id ?? "").trim(),
    giftedTo: (r.gifted_to ?? "").trim(),
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/parse.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/csv tests/lib/csv/parse.test.ts
git commit -m "feat: parse Whatnot CSV into typed rows"
```

---

### Task 4: Row classifier

**Files:**
- Create: `src/lib/csv/classify.ts`
- Test: `tests/lib/csv/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyRows } from "@/lib/csv/classify";
import type { RawRow } from "@/lib/csv/types";

function row(p: Partial<RawRow>): RawRow {
  return { buyerUsername: "u", productName: "Item #1", quantity: 1, priceCents: 300,
    cancelledOrFailed: "", shipmentId: "ship1", giftedTo: "", ...p };
}

describe("classifyRows", () => {
  it("confirmed when shipment present and not cancelled", () => {
    expect(classifyRows([row({})])[0].status).toBe("confirmed");
  });
  it("cancelled and failed from the cancelled_or_failed column", () => {
    expect(classifyRows([row({ cancelledOrFailed: "cancelled", shipmentId: "" })])[0].status).toBe("cancelled");
    expect(classifyRows([row({ cancelledOrFailed: "failed", shipmentId: "" })])[0].status).toBe("failed");
  });
  it("giveaway when product name contains GIFTCARD GIVVY", () => {
    expect(classifyRows([row({ productName: "AMAZON $5 GIFTCARD GIVVY #3", priceCents: 0 })])[0].status).toBe("giveaway");
  });
  it("flags suspected duplicate: same buyer + product base + price within show", () => {
    const rows = [
      row({ buyerUsername: "bob", productName: "Cheese Squishy #1", priceCents: 300 }),
      row({ buyerUsername: "bob", productName: "Cheese Squishy #5", priceCents: 300 }),
    ];
    const out = classifyRows(rows);
    expect(out[0].status).toBe("confirmed");
    expect(out[1].status).toBe("suspected_duplicate");
  });
  it("does not flag duplicate when price differs", () => {
    const rows = [
      row({ buyerUsername: "bob", productName: "Cheese Squishy #1", priceCents: 300 }),
      row({ buyerUsername: "bob", productName: "Cheese Squishy #5", priceCents: 500 }),
    ];
    expect(classifyRows(rows).every((r) => r.status === "confirmed")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/csv/classify.test.ts`
Expected: FAIL — cannot find module `@/lib/csv/classify`.

- [ ] **Step 3: Write implementation**

`src/lib/csv/classify.ts`:
```ts
import type { RawRow, ClassifiedRow, RowStatus } from "./types";

/** Strip the trailing " #N" listing suffix to get the product's base name. */
export function baseProductName(name: string): string {
  return name.replace(/\s*#\d+\s*$/, "").trim();
}

function baseStatus(r: RawRow): RowStatus {
  if (/GIFTCARD GIVVY/i.test(r.productName)) return "giveaway";
  const flag = r.cancelledOrFailed.toLowerCase();
  if (flag === "cancelled") return "cancelled";
  if (flag === "failed") return "failed";
  if (flag) return "cancelled"; // any other non-empty flag => treat as not sold
  return r.shipmentId ? "confirmed" : "cancelled";
}

export function classifyRows(rows: RawRow[]): ClassifiedRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    let status = baseStatus(r);
    if (status === "confirmed") {
      const key = `${r.buyerUsername}|${baseProductName(r.productName)}|${r.priceCents}`;
      if (seen.has(key)) status = "suspected_duplicate";
      else seen.add(key);
    }
    return { ...r, status };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv/classify.ts tests/lib/csv/classify.test.ts
git commit -m "feat: classify CSV rows (confirmed/cancelled/failed/giveaway/duplicate)"
```

---

### Task 5: Classifier integration test against the real sample file

**Files:**
- Create: `tests/fixtures/sample-show.csv` (copy of the real June 11 export)
- Test: `tests/lib/csv/sample.test.ts`

- [ ] **Step 1: Copy the real CSV into the fixtures folder**

```bash
mkdir -p tests/fixtures
cp "/home/mhamida/Downloads/live-2dacc6d3-9f1c-40da-9d0f-1bcb8cbf5c1a(1).csv" tests/fixtures/sample-show.csv
```

- [ ] **Step 2: Write the failing test (locks in the known counts)**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv/parse";
import { classifyRows } from "@/lib/csv/classify";

describe("real sample show", () => {
  const text = readFileSync(resolve(__dirname, "../../fixtures/sample-show.csv"), "utf8");
  const rows = classifyRows(parseCsv(text));

  it("parses 60 data rows", () => {
    expect(rows).toHaveLength(60);
  });
  it("finds 7 giveaways", () => {
    expect(rows.filter((r) => r.status === "giveaway")).toHaveLength(7);
  });
  it("finds 4 cancelled/failed", () => {
    expect(rows.filter((r) => r.status === "cancelled" || r.status === "failed")).toHaveLength(4);
  });
  it("every cancelled/failed row has no shipment id", () => {
    for (const r of rows.filter((r) => r.status === "cancelled" || r.status === "failed")) {
      expect(r.shipmentId).toBe("");
    }
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/lib/csv/sample.test.ts`
Expected: PASS (4 tests). If giveaway/cancelled counts differ, the classifier rules need revisiting before proceeding.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/sample-show.csv tests/lib/csv/sample.test.ts
git commit -m "test: lock CSV classification against real sample show"
```

---

## Phase 3: Calculation Logic

### Task 6: COGS per line

**Files:**
- Create: `src/lib/calc/cogs.ts`
- Test: `tests/lib/calc/cogs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { lineCogs, totalCogs } from "@/lib/calc/cogs";

describe("cogs", () => {
  it("multiplies quantity by unit cost in cents", () => {
    expect(lineCogs(2, 250)).toBe(500);
  });
  it("sums confirmed line cogs, ignores unmapped (null) costs as zero", () => {
    const lines = [
      { quantity: 1, unitCostCents: 250 },
      { quantity: 3, unitCostCents: 150 },
      { quantity: 1, unitCostCents: null },
    ];
    expect(totalCogs(lines)).toBe(250 + 450 + 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/cogs.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/cogs`.

- [ ] **Step 3: Write implementation**

`src/lib/calc/cogs.ts`:
```ts
export function lineCogs(quantity: number, unitCostCents: number): number {
  return quantity * unitCostCents;
}
export function totalCogs(lines: { quantity: number; unitCostCents: number | null }[]): number {
  return lines.reduce((sum, l) => sum + (l.unitCostCents == null ? 0 : lineCogs(l.quantity, l.unitCostCents)), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/cogs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/cogs.ts tests/lib/calc/cogs.test.ts
git commit -m "feat: compute COGS per line and per show"
```

---

### Task 7: Per-show P&L and 80/20 split

**Files:**
- Create: `src/lib/calc/show-pnl.ts`
- Test: `tests/lib/calc/show-pnl.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { showPnl } from "@/lib/calc/show-pnl";

describe("showPnl", () => {
  it("net = payout - cogs - giveaways - shipping; split 80/20", () => {
    const r = showPnl({
      payoutCents: 20000,
      cogsCents: 5000,
      giveawayCount: 6,
      giveawayUnitCents: 500,
      shippingSuppliesCents: 1000,
    });
    expect(r.giveawayTotalCents).toBe(3000);
    expect(r.netProfitCents).toBe(20000 - 5000 - 3000 - 1000); // 11000
    expect(r.ownerShareCents).toBe(8800);   // 80%
    expect(r.partnerShareCents).toBe(2200);  // 20%
  });
  it("rounds split to whole cents with owner absorbing the remainder", () => {
    const r = showPnl({ payoutCents: 101, cogsCents: 0, giveawayCount: 0, giveawayUnitCents: 0, shippingSuppliesCents: 0 });
    expect(r.partnerShareCents).toBe(20);    // floor(101*0.2)=20
    expect(r.ownerShareCents).toBe(81);      // remainder to owner
    expect(r.ownerShareCents + r.partnerShareCents).toBe(101);
  });
  it("net can be negative", () => {
    const r = showPnl({ payoutCents: 1000, cogsCents: 2000, giveawayCount: 0, giveawayUnitCents: 0, shippingSuppliesCents: 0 });
    expect(r.netProfitCents).toBe(-1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/show-pnl.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/show-pnl`.

- [ ] **Step 3: Write implementation**

`src/lib/calc/show-pnl.ts`:
```ts
export interface ShowPnlInput {
  payoutCents: number;
  cogsCents: number;
  giveawayCount: number;
  giveawayUnitCents: number;
  shippingSuppliesCents: number;
}
export interface ShowPnl {
  giveawayTotalCents: number;
  netProfitCents: number;
  ownerShareCents: number;
  partnerShareCents: number;
}

export function showPnl(i: ShowPnlInput): ShowPnl {
  const giveawayTotalCents = i.giveawayCount * i.giveawayUnitCents;
  const netProfitCents = i.payoutCents - i.cogsCents - giveawayTotalCents - i.shippingSuppliesCents;
  const partnerShareCents = Math.floor(netProfitCents * 0.2);
  const ownerShareCents = netProfitCents - partnerShareCents;
  return { giveawayTotalCents, netProfitCents, ownerShareCents, partnerShareCents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/show-pnl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/show-pnl.ts tests/lib/calc/show-pnl.test.ts
git commit -m "feat: per-show net profit and 80/20 split"
```

---

### Task 8: True net inventory spend

**Files:**
- Create: `src/lib/calc/inventory-spend.ts`
- Test: `tests/lib/calc/inventory-spend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { netInventorySpend, brotherShipmentOwnerCost } from "@/lib/calc/inventory-spend";

describe("inventory spend", () => {
  it("owner cost of a split shipment = full - brother share", () => {
    expect(brotherShipmentOwnerCost(10000, 4000)).toBe(6000);
  });
  it("net spend = lot costs + brother adjustments", () => {
    // lots cost 73200. Brother txns:
    //  split_shipment: owner paid 6000 (already owner's share) -> +6000
    //  bought_from_brother: +1500
    //  gave_to_brother: -800 (items leave; reduces effective spend on remaining)
    //  payback_received: -500
    const result = netInventorySpend({
      lotCostsCents: [73200],
      brotherTxns: [
        { kind: "split_shipment", ownerCostCents: 6000 },
        { kind: "bought_from_brother", amountCents: 1500 },
        { kind: "gave_to_brother", amountCents: 800 },
        { kind: "payback_received", amountCents: 500 },
      ],
    });
    expect(result).toBe(73200 + 6000 + 1500 - 800 - 500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/inventory-spend.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/inventory-spend`.

- [ ] **Step 3: Write implementation**

`src/lib/calc/inventory-spend.ts`:
```ts
export function brotherShipmentOwnerCost(fullCents: number, brotherShareCents: number): number {
  return fullCents - brotherShareCents;
}

export type BrotherTxnKind =
  | "split_shipment"
  | "bought_from_brother"
  | "gave_to_brother"
  | "payback_received";

export interface BrotherTxnForSpend {
  kind: BrotherTxnKind;
  // For split_shipment, pass the owner's already-computed cost in ownerCostCents.
  // For the others, pass amountCents.
  ownerCostCents?: number;
  amountCents?: number;
}

export function netInventorySpend(input: {
  lotCostsCents: number[];
  brotherTxns: BrotherTxnForSpend[];
}): number {
  let total = input.lotCostsCents.reduce((a, b) => a + b, 0);
  for (const t of input.brotherTxns) {
    switch (t.kind) {
      case "split_shipment": total += t.ownerCostCents ?? 0; break;
      case "bought_from_brother": total += t.amountCents ?? 0; break;
      case "gave_to_brother": total -= t.amountCents ?? 0; break;
      case "payback_received": total -= t.amountCents ?? 0; break;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/inventory-spend.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/inventory-spend.ts tests/lib/calc/inventory-spend.test.ts
git commit -m "feat: compute true net inventory spend from lots + brother txns"
```

---

## Phase 4: Database Layer

### Task 9: Schema and connection

**Files:**
- Create: `src/lib/db/schema.sql`, `src/lib/db/connection.ts`
- Test: `tests/lib/db/connection.test.ts`

- [ ] **Step 1: Write the schema**

`src/lib/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  purchased_on TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  unit_cost_cents INTEGER NOT NULL,
  qty_purchased INTEGER NOT NULL DEFAULT 0,
  lot_id INTEGER REFERENCES lots(id)
);

CREATE TABLE IF NOT EXISTS brother_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN
    ('split_shipment','bought_from_brother','gave_to_brother','payback_received')),
  label TEXT,
  occurred_on TEXT,
  full_cost_cents INTEGER,        -- split_shipment only
  brother_share_cents INTEGER,    -- split_shipment only
  owner_cost_cents INTEGER,       -- split_shipment: full - share
  amount_cents INTEGER,           -- the other kinds
  item_id INTEGER REFERENCES inventory_items(id),
  qty INTEGER
);

CREATE TABLE IF NOT EXISTS shows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_date TEXT NOT NULL,
  payout_cents INTEGER NOT NULL DEFAULT 0,
  shipping_supplies_cents INTEGER NOT NULL DEFAULT 0,
  giveaway_count INTEGER NOT NULL DEFAULT 0,
  giveaway_unit_cents INTEGER NOT NULL DEFAULT 500,
  source_hash TEXT                -- to detect re-upload of same show
);

CREATE TABLE IF NOT EXISTS show_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  buyer_username TEXT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  revenue_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  item_id INTEGER REFERENCES inventory_items(id)  -- resolved via alias at save time
);

CREATE TABLE IF NOT EXISTS product_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name TEXT NOT NULL UNIQUE,   -- the Whatnot base product name
  item_id INTEGER NOT NULL REFERENCES inventory_items(id)
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('one_time','recurring')),
  category TEXT,
  amount_cents INTEGER NOT NULL,   -- negative for offsets like the $400 incentive
  incurred_on TEXT
);
```

- [ ] **Step 2: Write the failing test**

`tests/lib/db/connection.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db/connection";

describe("createDb", () => {
  it("creates all tables in an in-memory db", () => {
    const db = createDb(":memory:");
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const t of ["lots","inventory_items","brother_transactions","shows","show_line_items","product_aliases","expenses"]) {
      expect(names).toContain(t);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/connection.test.ts`
Expected: FAIL — cannot find module `@/lib/db/connection`.

- [ ] **Step 4: Write the connection module**

`src/lib/db/connection.ts`:
```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type DB = Database.Database;

export function createDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

let singleton: DB | null = null;
export function getDb(): DB {
  if (!singleton) singleton = createDb(process.env.DB_PATH ?? resolve(process.cwd(), "data/whatnot.db"));
  return singleton;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/connection.test.ts`
Expected: PASS. (Ensure `data/` exists for non-memory use: `mkdir -p data`.)

- [ ] **Step 6: Commit**

```bash
mkdir -p data
git add src/lib/db/schema.sql src/lib/db/connection.ts tests/lib/db/connection.test.ts
git commit -m "feat: SQLite schema and connection factory"
```

---

### Task 10: Inventory repository (items, lots, brother txns)

**Files:**
- Create: `src/lib/db/inventory.ts`
- Test: `tests/lib/db/inventory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import {
  insertItem, listItems, insertLot, insertBrotherTxn, qtySoldByItem, qtyRemaining,
} from "@/lib/db/inventory";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("inventory repo", () => {
  it("inserts and lists items", () => {
    const lot = insertLot(db, { name: "Lot 1", totalCostCents: 73200, purchasedOn: "2026-06-01" });
    insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: lot });
    const items = listItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Cheese", unitCostCents: 250, qtyPurchased: 20 });
  });

  it("computes qty remaining = purchased - confirmed sold - gave to brother", () => {
    const id = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: null });
    // simulate confirmed sales of 5 via a show
    db.prepare("INSERT INTO shows (show_date) VALUES ('2026-06-10')").run();
    const showId = db.prepare("SELECT id FROM shows").get() as any;
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 5, 'confirmed', ?)`).run(showId.id, id);
    db.prepare(`INSERT INTO show_line_items (show_id, product_name, quantity, status, item_id)
                VALUES (?, 'Cheese Squishy', 2, 'cancelled', ?)`).run(showId.id, id);
    insertBrotherTxn(db, { kind: "gave_to_brother", amountCents: 0, itemId: id, qty: 3 });
    expect(qtySoldByItem(db, id)).toBe(5);          // cancelled not counted
    expect(qtyRemaining(db, id)).toBe(20 - 5 - 3);  // 12
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: FAIL — cannot find module `@/lib/db/inventory`.

- [ ] **Step 3: Write implementation**

`src/lib/db/inventory.ts`:
```ts
import type { DB } from "./connection";
import { brotherShipmentOwnerCost } from "@/lib/calc/inventory-spend";

export interface ItemRow { id: number; name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null; }

export function insertLot(db: DB, l: { name: string; totalCostCents: number; purchasedOn?: string | null }): number {
  const info = db.prepare("INSERT INTO lots (name, total_cost_cents, purchased_on) VALUES (?,?,?)")
    .run(l.name, l.totalCostCents, l.purchasedOn ?? null);
  return Number(info.lastInsertRowid);
}

export function insertItem(db: DB, i: { name: string; unitCostCents: number; qtyPurchased: number; lotId: number | null }): number {
  const info = db.prepare("INSERT INTO inventory_items (name, unit_cost_cents, qty_purchased, lot_id) VALUES (?,?,?,?)")
    .run(i.name, i.unitCostCents, i.qtyPurchased, i.lotId);
  return Number(info.lastInsertRowid);
}

export function listItems(db: DB): ItemRow[] {
  return db.prepare("SELECT id, name, unit_cost_cents as unitCostCents, qty_purchased as qtyPurchased, lot_id as lotId FROM inventory_items ORDER BY name").all() as ItemRow[];
}

export function insertBrotherTxn(db: DB, t: {
  kind: "split_shipment" | "bought_from_brother" | "gave_to_brother" | "payback_received";
  label?: string | null; occurredOn?: string | null;
  fullCostCents?: number | null; brotherShareCents?: number | null;
  amountCents?: number | null; itemId?: number | null; qty?: number | null;
}): number {
  const ownerCost = t.kind === "split_shipment"
    ? brotherShipmentOwnerCost(t.fullCostCents ?? 0, t.brotherShareCents ?? 0)
    : null;
  const info = db.prepare(`INSERT INTO brother_transactions
    (kind,label,occurred_on,full_cost_cents,brother_share_cents,owner_cost_cents,amount_cents,item_id,qty)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      t.kind, t.label ?? null, t.occurredOn ?? null,
      t.fullCostCents ?? null, t.brotherShareCents ?? null, ownerCost,
      t.amountCents ?? null, t.itemId ?? null, t.qty ?? null);
  return Number(info.lastInsertRowid);
}

export function qtySoldByItem(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COALESCE(SUM(quantity),0) as q FROM show_line_items
    WHERE item_id = ? AND status = 'confirmed'`).get(itemId) as any;
  return Number(r.q);
}

export function qtyGivenToBrother(db: DB, itemId: number): number {
  const r = db.prepare(`SELECT COALESCE(SUM(qty),0) as q FROM brother_transactions
    WHERE item_id = ? AND kind = 'gave_to_brother'`).get(itemId) as any;
  return Number(r.q);
}

export function qtyRemaining(db: DB, itemId: number): number {
  const item = db.prepare("SELECT qty_purchased as q FROM inventory_items WHERE id = ?").get(itemId) as any;
  return Number(item.q) - qtySoldByItem(db, itemId) - qtyGivenToBrother(db, itemId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/db/inventory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/inventory.ts tests/lib/db/inventory.test.ts
git commit -m "feat: inventory repository with qty-remaining derivation"
```

---

### Task 11: Aliases + Shows + Expenses repositories

**Files:**
- Create: `src/lib/db/aliases.ts`, `src/lib/db/shows.ts`, `src/lib/db/expenses.ts`
- Test: `tests/lib/db/shows.test.ts`, `tests/lib/db/expenses.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/lib/db/shows.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias, resolveItemId } from "@/lib/db/aliases";
import { saveShow, getShowWithLines, listShows } from "@/lib/db/shows";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("aliases", () => {
  it("maps a product base name to an item and resolves it", () => {
    const item = insertItem(db, { name: "Pushy Squishy Ice Cream", unitCostCents: 200, qtyPurchased: 0, lotId: null });
    setAlias(db, "Nice-Sicle Ice Cream", item);
    expect(resolveItemId(db, "Nice-Sicle Ice Cream")).toBe(item);
    expect(resolveItemId(db, "Unknown Thing")).toBeNull();
  });
});

describe("shows", () => {
  it("saves a show with lines and reads it back", () => {
    const item = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", item);
    const showId = saveShow(db, {
      showDate: "2026-06-11", payoutCents: 20000, shippingSuppliesCents: 1000,
      giveawayCount: 7, giveawayUnitCents: 500, sourceHash: "h1",
      lines: [
        { buyerUsername: "bob", productName: "Cheese Squishy", quantity: 1, revenueCents: 300, status: "confirmed" },
        { buyerUsername: "x", productName: "AMAZON $5 GIFTCARD GIVVY", quantity: 1, revenueCents: 0, status: "giveaway" },
      ],
    });
    const show = getShowWithLines(db, showId);
    expect(show.payoutCents).toBe(20000);
    expect(show.lines).toHaveLength(2);
    expect(show.lines[0].itemId).toBe(item);  // resolved via alias
    expect(listShows(db)).toHaveLength(1);
  });

  it("re-saving the same sourceHash replaces the prior show (no duplicate)", () => {
    const base = { showDate: "2026-06-11", payoutCents: 1, shippingSuppliesCents: 0,
      giveawayCount: 0, giveawayUnitCents: 500, sourceHash: "same", lines: [] as any[] };
    saveShow(db, base);
    saveShow(db, { ...base, payoutCents: 999 });
    const shows = listShows(db);
    expect(shows).toHaveLength(1);
    expect(shows[0].payoutCents).toBe(999);
  });
});
```

`tests/lib/db/expenses.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertExpense, listExpenses, totalExpensesCents } from "@/lib/db/expenses";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("expenses", () => {
  it("sums expenses including negative offsets (the $400 incentive)", () => {
    insertExpense(db, { description: "Shipping supplies", type: "one_time", category: "shipping", amountCents: 5000 });
    insertExpense(db, { description: "Streaming setup", type: "one_time", category: "equipment", amountCents: 12000 });
    insertExpense(db, { description: "Whatnot incentive", type: "one_time", category: "incentive", amountCents: -40000 });
    expect(totalExpensesCents(db)).toBe(5000 + 12000 - 40000);
    expect(listExpenses(db)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/db/shows.test.ts tests/lib/db/expenses.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the repositories**

`src/lib/db/aliases.ts`:
```ts
import type { DB } from "./connection";
import { baseProductName } from "@/lib/csv/classify";

export function setAlias(db: DB, productName: string, itemId: number): void {
  const base = baseProductName(productName);
  db.prepare(`INSERT INTO product_aliases (product_name, item_id) VALUES (?, ?)
    ON CONFLICT(product_name) DO UPDATE SET item_id = excluded.item_id`).run(base, itemId);
}

export function resolveItemId(db: DB, productName: string): number | null {
  const base = baseProductName(productName);
  const r = db.prepare("SELECT item_id as id FROM product_aliases WHERE product_name = ?").get(base) as any;
  return r ? Number(r.id) : null;
}

export function unmappedNames(db: DB, productNames: string[]): string[] {
  const out = new Set<string>();
  for (const n of productNames) if (resolveItemId(db, n) === null) out.add(baseProductName(n));
  return [...out];
}
```

`src/lib/db/shows.ts`:
```ts
import type { DB } from "./connection";
import { resolveItemId } from "./aliases";
import type { RowStatus } from "@/lib/csv/types";

export interface ShowLineInput {
  buyerUsername: string; productName: string; quantity: number; revenueCents: number; status: RowStatus;
}
export interface SaveShowInput {
  showDate: string; payoutCents: number; shippingSuppliesCents: number;
  giveawayCount: number; giveawayUnitCents: number; sourceHash: string; lines: ShowLineInput[];
}

export function saveShow(db: DB, s: SaveShowInput): number {
  const tx = db.transaction((s: SaveShowInput) => {
    const existing = db.prepare("SELECT id FROM shows WHERE source_hash = ?").get(s.sourceHash) as any;
    if (existing) db.prepare("DELETE FROM shows WHERE id = ?").run(existing.id); // cascade clears lines
    const info = db.prepare(`INSERT INTO shows
      (show_date,payout_cents,shipping_supplies_cents,giveaway_count,giveaway_unit_cents,source_hash)
      VALUES (?,?,?,?,?,?)`).run(
        s.showDate, s.payoutCents, s.shippingSuppliesCents, s.giveawayCount, s.giveawayUnitCents, s.sourceHash);
    const showId = Number(info.lastInsertRowid);
    const insLine = db.prepare(`INSERT INTO show_line_items
      (show_id,buyer_username,product_name,quantity,revenue_cents,status,item_id)
      VALUES (?,?,?,?,?,?,?)`);
    for (const l of s.lines) {
      insLine.run(showId, l.buyerUsername, l.productName, l.quantity, l.revenueCents, l.status,
        resolveItemId(db, l.productName));
    }
    return showId;
  });
  return tx(s);
}

export interface ShowLineRow extends ShowLineInput { id: number; itemId: number | null; }
export interface ShowRow {
  id: number; showDate: string; payoutCents: number; shippingSuppliesCents: number;
  giveawayCount: number; giveawayUnitCents: number;
}

export function listShows(db: DB): ShowRow[] {
  return db.prepare(`SELECT id, show_date as showDate, payout_cents as payoutCents,
    shipping_supplies_cents as shippingSuppliesCents, giveaway_count as giveawayCount,
    giveaway_unit_cents as giveawayUnitCents FROM shows ORDER BY show_date DESC`).all() as ShowRow[];
}

export function getShowWithLines(db: DB, id: number): ShowRow & { lines: ShowLineRow[] } {
  const show = db.prepare(`SELECT id, show_date as showDate, payout_cents as payoutCents,
    shipping_supplies_cents as shippingSuppliesCents, giveaway_count as giveawayCount,
    giveaway_unit_cents as giveawayUnitCents FROM shows WHERE id = ?`).get(id) as ShowRow;
  const lines = db.prepare(`SELECT id, buyer_username as buyerUsername, product_name as productName,
    quantity, revenue_cents as revenueCents, status, item_id as itemId
    FROM show_line_items WHERE show_id = ? ORDER BY id`).all(id) as ShowLineRow[];
  return { ...show, lines };
}
```

`src/lib/db/expenses.ts`:
```ts
import type { DB } from "./connection";

export interface ExpenseRow {
  id: number; description: string; type: "one_time" | "recurring";
  category: string | null; amountCents: number; incurredOn: string | null;
}

export function insertExpense(db: DB, e: {
  description: string; type: "one_time" | "recurring";
  category?: string | null; amountCents: number; incurredOn?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO expenses (description,type,category,amount_cents,incurred_on)
    VALUES (?,?,?,?,?)`).run(e.description, e.type, e.category ?? null, e.amountCents, e.incurredOn ?? null);
  return Number(info.lastInsertRowid);
}

export function listExpenses(db: DB): ExpenseRow[] {
  return db.prepare(`SELECT id, description, type, category, amount_cents as amountCents,
    incurred_on as incurredOn FROM expenses ORDER BY incurred_on`).all() as ExpenseRow[];
}

export function totalExpensesCents(db: DB): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount_cents),0) as t FROM expenses").get() as any;
  return Number(r.t);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/db/shows.test.ts tests/lib/db/expenses.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/aliases.ts src/lib/db/shows.ts src/lib/db/expenses.ts tests/lib/db/shows.test.ts tests/lib/db/expenses.test.ts
git commit -m "feat: aliases, shows, and expenses repositories"
```

---

## Phase 5: API Routes

### Task 12: Show preview endpoint (parse + classify, no save)

**Files:**
- Create: `src/app/api/shows/preview/route.ts`
- Test: `tests/api/preview.test.ts`

- [ ] **Step 1: Write the failing test (exercises the handler function directly)**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { buildPreview } from "@/app/api/shows/preview/route";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

const CSV = `buyer_username,product_name,product_quantity,original_item_price,cancelled_or_failed,shipment_id
bob,Cheese Squishy #1,1,3.0,,ship1
x,AMAZON $5 GIFTCARD GIVVY #1,1,0,,ship2
y,Mystery Mini Dumpling #1,1,2.0,,ship3`;

describe("buildPreview", () => {
  it("classifies rows and reports unmapped product names", () => {
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 0, lotId: null });
    setAlias(db, "Cheese Squishy", cheese);
    const out = buildPreview(db, CSV);
    expect(out.rows).toHaveLength(3);
    expect(out.rows.find((r) => r.productName.startsWith("Cheese"))!.status).toBe("confirmed");
    // giveaways excluded from unmapped; Mystery Mini is unmapped
    expect(out.unmapped).toContain("Mystery Mini Dumpling");
    expect(out.unmapped).not.toContain("Cheese Squishy");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/preview.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the route + helper**

`src/app/api/shows/preview/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import type { DB } from "@/lib/db/connection";
import { getDb } from "@/lib/db/connection";
import { parseCsv } from "@/lib/csv/parse";
import { classifyRows, baseProductName } from "@/lib/csv/classify";
import { unmappedNames } from "@/lib/db/aliases";
import type { ClassifiedRow } from "@/lib/csv/types";

export interface PreviewResult { rows: ClassifiedRow[]; unmapped: string[]; }

export function buildPreview(db: DB, csvText: string): PreviewResult {
  const rows = classifyRows(parseCsv(csvText));
  const sellable = rows.filter((r) => r.status !== "giveaway").map((r) => r.productName);
  const unmapped = unmappedNames(db, sellable);
  return { rows, unmapped };
}

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  return NextResponse.json(buildPreview(getDb(), csvText));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/preview.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/shows/preview/route.ts tests/api/preview.test.ts
git commit -m "feat: show preview API (parse + classify + unmapped names)"
```

---

### Task 13: Remaining API routes (save show, aliases, inventory, expenses, dashboard)

**Files:**
- Create: `src/app/api/shows/route.ts`, `src/app/api/aliases/route.ts`, `src/app/api/inventory/route.ts`, `src/app/api/inventory/brother/route.ts`, `src/app/api/expenses/route.ts`, `src/app/api/dashboard/route.ts`
- Create: `src/lib/calc/dashboard.ts`
- Test: `tests/lib/calc/dashboard.test.ts`

- [ ] **Step 1: Write the failing dashboard-aggregation test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDb, type DB } from "@/lib/db/connection";
import { insertItem, insertLot } from "@/lib/db/inventory";
import { setAlias } from "@/lib/db/aliases";
import { saveShow } from "@/lib/db/shows";
import { insertExpense } from "@/lib/db/expenses";
import { dashboardSummary } from "@/lib/calc/dashboard";

let db: DB;
beforeEach(() => { db = createDb(":memory:"); });

describe("dashboardSummary", () => {
  it("aggregates net profit, owner share, inventory spend, expenses", () => {
    const lot = insertLot(db, { name: "Lot 1", totalCostCents: 73200 });
    const cheese = insertItem(db, { name: "Cheese", unitCostCents: 250, qtyPurchased: 20, lotId: lot });
    setAlias(db, "Cheese Squishy", cheese);
    saveShow(db, {
      showDate: "2026-06-11", payoutCents: 20000, shippingSuppliesCents: 1000,
      giveawayCount: 6, giveawayUnitCents: 500, sourceHash: "h1",
      lines: [{ buyerUsername: "b", productName: "Cheese Squishy", quantity: 4, revenueCents: 1200, status: "confirmed" }],
    });
    insertExpense(db, { description: "Incentive", type: "one_time", amountCents: -40000 });

    const d = dashboardSummary(db);
    // cogs = 4 * 250 = 1000; net = 20000 - 1000 - 3000 - 1000 = 15000
    expect(d.totalNetProfitCents).toBe(15000);
    expect(d.ownerShareCents).toBe(12000);
    expect(d.netInventorySpendCents).toBe(73200);
    expect(d.totalExpensesCents).toBe(-40000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/dashboard.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/dashboard`.

- [ ] **Step 3: Write the dashboard aggregation**

`src/lib/calc/dashboard.ts`:
```ts
import type { DB } from "@/lib/db/connection";
import { listShows, getShowWithLines } from "@/lib/db/shows";
import { listItems } from "@/lib/db/inventory";
import { totalExpensesCents } from "@/lib/db/expenses";
import { totalCogs } from "./cogs";
import { showPnl } from "./show-pnl";
import { netInventorySpend } from "./inventory-spend";

export interface DashboardSummary {
  totalNetProfitCents: number;
  ownerShareCents: number;
  partnerShareCents: number;
  netInventorySpendCents: number;
  totalExpensesCents: number;
}

export function dashboardSummary(db: DB): DashboardSummary {
  const itemCost = new Map(listItems(db).map((i) => [i.id, i.unitCostCents]));
  let net = 0, owner = 0, partner = 0;
  for (const s of listShows(db)) {
    const full = getShowWithLines(db, s.id);
    const cogs = totalCogs(full.lines
      .filter((l) => l.status === "confirmed")
      .map((l) => ({ quantity: l.quantity, unitCostCents: l.itemId != null ? (itemCost.get(l.itemId) ?? null) : null })));
    const p = showPnl({
      payoutCents: s.payoutCents, cogsCents: cogs,
      giveawayCount: s.giveawayCount, giveawayUnitCents: s.giveawayUnitCents,
      shippingSuppliesCents: s.shippingSuppliesCents,
    });
    net += p.netProfitCents; owner += p.ownerShareCents; partner += p.partnerShareCents;
  }
  const lotCosts = (db.prepare("SELECT total_cost_cents as c FROM lots").all() as any[]).map((r) => Number(r.c));
  const brother = (db.prepare("SELECT kind, owner_cost_cents as ownerCostCents, amount_cents as amountCents FROM brother_transactions").all() as any[]);
  const netInventorySpendCents = netInventorySpend({ lotCostsCents: lotCosts, brotherTxns: brother });
  return {
    totalNetProfitCents: net, ownerShareCents: owner, partnerShareCents: partner,
    netInventorySpendCents, totalExpensesCents: totalExpensesCents(db),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the thin API routes (no new logic; delegate to repos/lib)**

`src/app/api/shows/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { saveShow, listShows } from "@/lib/db/shows";

export async function GET() {
  return NextResponse.json(listShows(getDb()));
}
export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = saveShow(getDb(), body);
  return NextResponse.json({ id });
}
```

`src/app/api/aliases/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { setAlias } from "@/lib/db/aliases";

export async function POST(req: NextRequest) {
  const { productName, itemId } = await req.json();
  setAlias(getDb(), productName, Number(itemId));
  return NextResponse.json({ ok: true });
}
```

`src/app/api/inventory/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { insertItem, insertLot, listItems, qtyRemaining } from "@/lib/db/inventory";

export async function GET() {
  const db = getDb();
  const items = listItems(db).map((i) => ({ ...i, qtyRemaining: qtyRemaining(db, i.id) }));
  return NextResponse.json(items);
}
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  if (body.kind === "lot") return NextResponse.json({ id: insertLot(db, body) });
  return NextResponse.json({ id: insertItem(db, body) });
}
```

`src/app/api/inventory/brother/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { insertBrotherTxn } from "@/lib/db/inventory";

export async function POST(req: NextRequest) {
  const id = insertBrotherTxn(getDb(), await req.json());
  return NextResponse.json({ id });
}
```

`src/app/api/expenses/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { insertExpense, listExpenses } from "@/lib/db/expenses";

export async function GET() {
  return NextResponse.json(listExpenses(getDb()));
}
export async function POST(req: NextRequest) {
  const id = insertExpense(getDb(), await req.json());
  return NextResponse.json({ id });
}
```

`src/app/api/dashboard/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { dashboardSummary } from "@/lib/calc/dashboard";

export async function GET() {
  return NextResponse.json(dashboardSummary(getDb()));
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/calc/dashboard.ts tests/lib/calc/dashboard.test.ts src/app/api
git commit -m "feat: dashboard aggregation and API routes"
```

---

## Phase 6: UI

### Task 14: App shell, layout, navigation

**Files:**
- Create: `src/app/layout.tsx`, `src/components/Nav.tsx`, `src/components/Money.tsx`

- [ ] **Step 1: Write the layout**

`src/app/layout.tsx`:
```tsx
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata = { title: "Whatnot Business Manager" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <Nav />
        <main className="mx-auto max-w-5xl p-6">{children}</main>
      </body>
    </html>
  );
}
```

`src/components/Nav.tsx`:
```tsx
import Link from "next/link";
const links = [["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"], ["/expenses", "Expenses"]];
export function Nav() {
  return (
    <nav className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl gap-6 p-4">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className="font-medium text-gray-700 hover:text-black">{label}</Link>
        ))}
      </div>
    </nav>
  );
}
```

`src/components/Money.tsx`:
```tsx
import { formatUSD } from "@/lib/money";
export function Money({ cents }: { cents: number }) {
  return <span className={cents < 0 ? "text-red-600" : ""}>{formatUSD(cents)}</span>;
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds (pages may be near-empty; that's fine).

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx src/components/Nav.tsx src/components/Money.tsx
git commit -m "feat: app shell, nav, and money display component"
```

---

### Task 15: Dashboard page

**Files:**
- Create: `src/app/page.tsx`

- [ ] **Step 1: Write the dashboard (server component, reads aggregation directly)**

`src/app/page.tsx`:
```tsx
import { getDb } from "@/lib/db/connection";
import { dashboardSummary } from "@/lib/calc/dashboard";
import { qtyRemaining, listItems } from "@/lib/db/inventory";
import { Money } from "@/components/Money";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const db = getDb();
  const d = dashboardSummary(db);
  const unitsOnHand = listItems(db).reduce((sum, i) => sum + qtyRemaining(db, i.id), 0);
  const cards: [string, React.ReactNode][] = [
    ["Total net profit", <Money cents={d.totalNetProfitCents} />],
    ["Your 80% share", <Money cents={d.ownerShareCents} />],
    ["Partner 20% share", <Money cents={d.partnerShareCents} />],
    ["Net inventory spend", <Money cents={d.netInventorySpendCents} />],
    ["Total expenses (after offsets)", <Money cents={d.totalExpensesCents} />],
    ["Units on hand", <span>{unitsOnHand}</span>],
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-lg border bg-white p-5">
          <div className="text-sm text-gray-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: dashboard page with summary cards"
```

---

### Task 16: Shows list + upload/review page

**Files:**
- Create: `src/app/shows/page.tsx`, `src/components/ShowUpload.tsx`
- Create: `src/app/shows/[id]/page.tsx`

- [ ] **Step 1: Write the shows list + upload client component**

`src/app/shows/page.tsx`:
```tsx
import Link from "next/link";
import { getDb } from "@/lib/db/connection";
import { listShows } from "@/lib/db/shows";
import { ShowUpload } from "@/components/ShowUpload";

export const dynamic = "force-dynamic";

export default function ShowsPage() {
  const shows = listShows(getDb());
  return (
    <div className="space-y-6">
      <ShowUpload />
      <table className="w-full bg-white text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">Date</th><th className="p-2">Payout</th></tr></thead>
        <tbody>
          {shows.map((s) => (
            <tr key={s.id} className="border-b hover:bg-gray-50">
              <td className="p-2"><Link className="text-blue-600 underline" href={`/shows/${s.id}`}>{s.showDate}</Link></td>
              <td className="p-2">${(s.payoutCents / 100).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

`src/components/ShowUpload.tsx`:
```tsx
"use client";
import { useState } from "react";

interface PreviewRow { buyerUsername: string; productName: string; quantity: number; priceCents: number; status: string; }
interface Preview { rows: PreviewRow[]; unmapped: string[]; }

export function ShowUpload() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [csvText, setCsvText] = useState("");
  const [showDate, setShowDate] = useState("");
  const [payout, setPayout] = useState("");
  const [shipping, setShipping] = useState("");
  const [giveUnit, setGiveUnit] = useState("5");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const res = await fetch("/api/shows/preview", { method: "POST", body: text });
    setPreview(await res.json());
  }

  async function save() {
    const rows = preview!.rows;
    const giveawayCount = rows.filter((r) => r.status === "giveaway").length;
    const lines = rows.map((r) => ({
      buyerUsername: r.buyerUsername, productName: r.productName,
      quantity: r.quantity, revenueCents: r.priceCents, status: r.status,
    }));
    await fetch("/api/shows", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        showDate, payoutCents: Math.round(Number(payout) * 100),
        shippingSuppliesCents: Math.round(Number(shipping) * 100),
        giveawayCount, giveawayUnitCents: Math.round(Number(giveUnit) * 100),
        sourceHash: showDate + ":" + rows.length, lines,
      }),
    });
    location.reload();
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <input type="file" accept=".csv" onChange={onFile} />
      {preview && (
        <div className="mt-4 space-y-3">
          {preview.unmapped.length > 0 && (
            <div className="rounded bg-yellow-50 p-2 text-sm text-yellow-800">
              Unmapped products (map them on the Inventory page first): {preview.unmapped.join(", ")}
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            <label>Date <input className="border p-1" value={showDate} onChange={(e) => setShowDate(e.target.value)} placeholder="2026-06-11" /></label>
            <label>Payout $ <input className="border p-1" value={payout} onChange={(e) => setPayout(e.target.value)} /></label>
            <label>Shipping supplies $ <input className="border p-1" value={shipping} onChange={(e) => setShipping(e.target.value)} /></label>
            <label>Giveaway unit $ <input className="border p-1 w-16" value={giveUnit} onChange={(e) => setGiveUnit(e.target.value)} /></label>
          </div>
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b"><th className="p-1">Buyer</th><th className="p-1">Product</th><th className="p-1">Qty</th><th className="p-1">Price</th><th className="p-1">Status</th></tr></thead>
            <tbody>
              {preview.rows.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="p-1">{r.buyerUsername}</td>
                  <td className="p-1">{r.productName}</td>
                  <td className="p-1">{r.quantity}</td>
                  <td className="p-1">${(r.priceCents / 100).toFixed(2)}</td>
                  <td className="p-1">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={save}>Save show</button>
        </div>
      )}
    </div>
  );
}
```

`src/app/shows/[id]/page.tsx`:
```tsx
import { getDb } from "@/lib/db/connection";
import { getShowWithLines } from "@/lib/db/shows";
import { listItems } from "@/lib/db/inventory";
import { totalCogs } from "@/lib/calc/cogs";
import { showPnl } from "@/lib/calc/show-pnl";
import { Money } from "@/components/Money";

export const dynamic = "force-dynamic";

export default async function ShowDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const show = getShowWithLines(db, Number(id));
  const itemCost = new Map(listItems(db).map((i) => [i.id, i.unitCostCents]));
  const confirmed = show.lines.filter((l) => l.status === "confirmed");
  const cogs = totalCogs(confirmed.map((l) => ({ quantity: l.quantity, unitCostCents: l.itemId != null ? (itemCost.get(l.itemId) ?? null) : null })));
  const p = showPnl({ payoutCents: show.payoutCents, cogsCents: cogs,
    giveawayCount: show.giveawayCount, giveawayUnitCents: show.giveawayUnitCents,
    shippingSuppliesCents: show.shippingSuppliesCents });
  const rows: [string, React.ReactNode][] = [
    ["Payout", <Money cents={show.payoutCents} />],
    ["COGS", <Money cents={-cogs} />],
    ["Giveaways", <Money cents={-p.giveawayTotalCents} />],
    ["Shipping supplies", <Money cents={-show.shippingSuppliesCents} />],
    ["Net profit", <Money cents={p.netProfitCents} />],
    ["Your 80%", <Money cents={p.ownerShareCents} />],
    ["Partner 20%", <Money cents={p.partnerShareCents} />],
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Show {show.showDate}</h1>
      <table className="bg-white text-sm">
        <tbody>{rows.map(([k, v]) => (<tr key={k} className="border-b"><td className="p-2 pr-8 text-gray-500">{k}</td><td className="p-2 text-right">{v}</td></tr>))}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open `http://localhost:3000/shows`, upload `tests/fixtures/sample-show.csv`, confirm the review table shows 60 rows with statuses, enter a date + payout, save, then open the show to see the P&L.
Expected: show appears in list; detail page shows net profit.

- [ ] **Step 4: Commit**

```bash
git add src/app/shows src/components/ShowUpload.tsx
git commit -m "feat: shows list, CSV upload/review, and per-show P&L page"
```

---

### Task 17: Inventory page (items, lots, aliases, brother txns)

**Files:**
- Create: `src/app/inventory/page.tsx`, `src/components/InventoryForms.tsx`

- [ ] **Step 1: Write the inventory page**

`src/app/inventory/page.tsx`:
```tsx
import { getDb } from "@/lib/db/connection";
import { listItems, qtyRemaining } from "@/lib/db/inventory";
import { netInventorySpend } from "@/lib/calc/inventory-spend";
import { InventoryForms } from "@/components/InventoryForms";
import { Money } from "@/components/Money";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  const db = getDb();
  const items = listItems(db).map((i) => ({ ...i, remaining: qtyRemaining(db, i.id) }));
  const lotCosts = (db.prepare("SELECT total_cost_cents as c FROM lots").all() as any[]).map((r) => Number(r.c));
  const brother = (db.prepare("SELECT kind, owner_cost_cents as ownerCostCents, amount_cents as amountCents FROM brother_transactions").all() as any[]);
  const spend = netInventorySpend({ lotCostsCents: lotCosts, brotherTxns: brother });
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm text-gray-500">True net inventory spend</div>
        <div className="text-2xl font-semibold"><Money cents={spend} /></div>
      </div>
      <table className="w-full bg-white text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">Item</th><th className="p-2">Unit cost</th><th className="p-2">Purchased</th><th className="p-2">Remaining</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b">
              <td className="p-2">{i.name}</td>
              <td className="p-2"><Money cents={i.unitCostCents} /></td>
              <td className="p-2">{i.qtyPurchased}</td>
              <td className="p-2">{i.remaining}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <InventoryForms items={items.map((i) => ({ id: i.id, name: i.name }))} />
    </div>
  );
}
```

`src/components/InventoryForms.tsx`:
```tsx
"use client";
import { useState } from "react";

async function post(url: string, body: unknown) {
  await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  location.reload();
}

export function InventoryForms({ items }: { items: { id: number; name: string }[] }) {
  const [item, setItem] = useState({ name: "", unitCost: "", qty: "" });
  const [alias, setAlias] = useState({ productName: "", itemId: items[0]?.id ?? 0 });
  const [bro, setBro] = useState({ kind: "split_shipment", label: "", full: "", share: "", amount: "" });

  return (
    <div className="grid gap-6 sm:grid-cols-3 text-sm">
      <form className="space-y-2 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault();
        post("/api/inventory", { name: item.name, unitCostCents: Math.round(Number(item.unitCost) * 100), qtyPurchased: Number(item.qty), lotId: null }); }}>
        <h3 className="font-semibold">Add item</h3>
        <input className="w-full border p-1" placeholder="Name" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
        <input className="w-full border p-1" placeholder="Unit cost $" value={item.unitCost} onChange={(e) => setItem({ ...item, unitCost: e.target.value })} />
        <input className="w-full border p-1" placeholder="Qty purchased" value={item.qty} onChange={(e) => setItem({ ...item, qty: e.target.value })} />
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
      </form>

      <form className="space-y-2 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault();
        post("/api/aliases", { productName: alias.productName, itemId: alias.itemId }); }}>
        <h3 className="font-semibold">Map Whatnot name → item</h3>
        <input className="w-full border p-1" placeholder="Whatnot product name" value={alias.productName} onChange={(e) => setAlias({ ...alias, productName: e.target.value })} />
        <select className="w-full border p-1" value={alias.itemId} onChange={(e) => setAlias({ ...alias, itemId: Number(e.target.value) })}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Map</button>
      </form>

      <form className="space-y-2 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault();
        const body: any = { kind: bro.kind, label: bro.label };
        if (bro.kind === "split_shipment") { body.fullCostCents = Math.round(Number(bro.full) * 100); body.brotherShareCents = Math.round(Number(bro.share) * 100); }
        else body.amountCents = Math.round(Number(bro.amount) * 100);
        post("/api/inventory/brother", body); }}>
        <h3 className="font-semibold">Brother transaction</h3>
        <select className="w-full border p-1" value={bro.kind} onChange={(e) => setBro({ ...bro, kind: e.target.value })}>
          <option value="split_shipment">Split shipment</option>
          <option value="bought_from_brother">Bought from brother</option>
          <option value="gave_to_brother">Gave to brother</option>
          <option value="payback_received">Payback received</option>
        </select>
        <input className="w-full border p-1" placeholder="Label" value={bro.label} onChange={(e) => setBro({ ...bro, label: e.target.value })} />
        {bro.kind === "split_shipment" ? (
          <>
            <input className="w-full border p-1" placeholder="Full cost $" value={bro.full} onChange={(e) => setBro({ ...bro, full: e.target.value })} />
            <input className="w-full border p-1" placeholder="Brother share $" value={bro.share} onChange={(e) => setBro({ ...bro, share: e.target.value })} />
          </>
        ) : (
          <input className="w-full border p-1" placeholder="Amount $" value={bro.amount} onChange={(e) => setBro({ ...bro, amount: e.target.value })} />
        )}
        <button className="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/inventory src/components/InventoryForms.tsx
git commit -m "feat: inventory page with item, alias, and brother-transaction forms"
```

---

### Task 18: Expenses page

**Files:**
- Create: `src/app/expenses/page.tsx`, `src/components/ExpenseForm.tsx`

- [ ] **Step 1: Write the expenses page**

`src/app/expenses/page.tsx`:
```tsx
import { getDb } from "@/lib/db/connection";
import { listExpenses, totalExpensesCents } from "@/lib/db/expenses";
import { ExpenseForm } from "@/components/ExpenseForm";
import { Money } from "@/components/Money";

export const dynamic = "force-dynamic";

export default function ExpensesPage() {
  const db = getDb();
  const expenses = listExpenses(db);
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm text-gray-500">Total expenses (after offsets)</div>
        <div className="text-2xl font-semibold"><Money cents={totalExpensesCents(db)} /></div>
      </div>
      <table className="w-full bg-white text-left text-sm">
        <thead><tr className="border-b"><th className="p-2">Description</th><th className="p-2">Type</th><th className="p-2">Category</th><th className="p-2">Amount</th></tr></thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-b">
              <td className="p-2">{e.description}</td><td className="p-2">{e.type}</td>
              <td className="p-2">{e.category}</td><td className="p-2"><Money cents={e.amountCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <ExpenseForm />
    </div>
  );
}
```

`src/components/ExpenseForm.tsx`:
```tsx
"use client";
import { useState } from "react";

export function ExpenseForm() {
  const [f, setF] = useState({ description: "", type: "one_time", category: "", amount: "" });
  return (
    <form className="space-y-2 rounded-lg border bg-white p-4 text-sm max-w-sm" onSubmit={async (e) => {
      e.preventDefault();
      await fetch("/api/expenses", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: f.description, type: f.type, category: f.category,
          amountCents: Math.round(Number(f.amount) * 100) }) });
      location.reload();
    }}>
      <h3 className="font-semibold">Add expense (use negative for offsets like the $400 incentive)</h3>
      <input className="w-full border p-1" placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <select className="w-full border p-1" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
        <option value="one_time">One-time</option><option value="recurring">Recurring</option>
      </select>
      <input className="w-full border p-1" placeholder="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
      <input className="w-full border p-1" placeholder="Amount $ (negative = offset)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <button className="rounded bg-blue-600 px-3 py-1 text-white">Add</button>
    </form>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/expenses src/components/ExpenseForm.tsx
git commit -m "feat: expenses page with offset support"
```

---

## Phase 7: Seed Data & Deployment

### Task 19: Seed script for known data

**Files:**
- Create: `scripts/seed.ts`

- [ ] **Step 1: Write the seed script**

`scripts/seed.ts`:
```ts
import { createDb } from "../src/lib/db/connection";
import { insertLot, insertItem } from "../src/lib/db/inventory";
import { setAlias } from "../src/lib/db/aliases";
import { insertExpense } from "../src/lib/db/expenses";
import { toCents } from "../src/lib/money";

const db = createDb(process.env.DB_PATH ?? "data/whatnot.db");

// Lot 1
const lot1 = insertLot(db, { name: "Lot 1", totalCostCents: toCents(732), purchasedOn: "2026-06-01" });

// Per-item costs (qty_purchased left 0 — fill in real counts as known)
const costs: [string, number][] = [
  ["Axolotl", 2], ["Pushy Squishy Ice Cream", 2], ["Rainbow Dumpling", 2.5],
  ["Orbeez Stuffed", 2.5], ["Viral Mystery", 2.5], ["Mini Squish", 1.5],
  ["Butter", 1.5], ["Strawberry", 1.5], ["Pink Strawberry", 1.5], ["Tie Dye Butter", 1.5],
  ["Jumbo Butter", 4], ["Gummy Bear", 1.5], ["Cheese", 2.5], ["Highland Cow", 2.5],
];
const ids: Record<string, number> = {};
for (const [name, dollars] of costs) {
  ids[name] = insertItem(db, { name, unitCostCents: toCents(dollars), qtyPurchased: 0, lotId: lot1 });
}

// Aliases: map observed Whatnot CSV product names to items
const aliases: [string, string][] = [
  ["Cheese Squishy", "Cheese"],
  ["Highland Cow Squishy (Assorted Colors)", "Highland Cow"],
  ["Viral Mystery Dumpling (Assorted Colors)", "Viral Mystery"],
  ["Orbeez Stuffed Glitter Dumpling", "Orbeez Stuffed"],
  ["Nice-Sicle Ice Cream", "Pushy Squishy Ice Cream"],
  ["Rainbow Squishy Dumpling", "Rainbow Dumpling"],
  ["Mini Squish Dumplings (Assorted Colors)", "Mini Squish"],
  ["Mystery Mini Dumpling", "Mini Squish"],
];
for (const [whatnotName, itemName] of aliases) {
  if (ids[itemName]) setAlias(db, whatnotName, ids[itemName]);
}

// Startup expenses (examples; adjust to real receipts) and the $400 incentive offset
insertExpense(db, { description: "Whatnot incentive", type: "one_time", category: "incentive", amountCents: toCents(-400) });

console.log("Seed complete.");
```

- [ ] **Step 2: Run the seed against a throwaway DB**

Run: `DB_PATH=data/seed-test.db npx tsx scripts/seed.ts`
Expected: prints "Seed complete." and creates `data/seed-test.db`. Verify:
`sqlite3 data/seed-test.db "SELECT name, unit_cost_cents FROM inventory_items;"` shows 14 items.
Then remove it: `rm data/seed-test.db*`.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: seed script for lots, items, aliases, and incentive offset"
```

> **Note for executor:** The Slow Rise Bunny / Slow-Rise Jellyfish products appear in the sample CSV but were not in the owner's cost list. Surface this to the user during execution and ask for their unit cost + which inventory item they map to before finalizing seed aliases. Do not invent a cost.

---

### Task 20: Dockerfile and run docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md`

- [ ] **Step 1: Write the Dockerfile (Next standalone output)**

`Dockerfile`:
```dockerfile
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/* \
 && npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DB_PATH=/app/data/whatnot.db
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/src/lib/db/schema.sql ./src/lib/db/schema.sql
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
```

`.dockerignore`:
```
node_modules
.next
data
.git
```

- [ ] **Step 2: Write the README**

`README.md`:
```markdown
# Whatnot Business Manager

Self-hosted Next.js + SQLite app to track Whatnot show profit, inventory, and expenses.

## Develop
    npm install
    npm run seed        # loads lots, items, aliases, incentive offset
    npm run dev         # http://localhost:3000

## Test
    npm test

## Deploy (homelab)
    docker build -t whatnot-manager .
    docker run -d -p 3000:3000 -v /your/host/path/data:/app/data whatnot-manager

The entire database is the single file under the mounted `data/` volume — back it up by copying it.

## Workflow
1. Inventory page: add items, map Whatnot product names to items.
2. Shows page: upload the Whatnot CSV, review auto-classified rows, enter payout + shipping supplies, save.
3. Dashboard: net profit, your 80% share, inventory spend, expenses.
```

- [ ] **Step 3: Build the image**

Run: `docker build -t whatnot-manager .`
Expected: image builds successfully.

- [ ] **Step 4: Smoke-test the container**

Run: `docker run --rm -p 3000:3000 -v "$PWD/data:/app/data" whatnot-manager` then open `http://localhost:3000`.
Expected: dashboard loads. Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore README.md
git commit -m "feat: Dockerfile and run documentation"
```

---

### Task 21: Full test suite green + final verification

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: final verification — all tests and build green"
```

---

## Spec Coverage Check

- Shows CSV upload + parse (items, qty, buyers, revenue, cancellations) → Tasks 3–5, 12, 16
- Payout (manual), giveaways, shipping supplies, net profit, 80/20 split → Tasks 7, 13, 16
- Inventory lots, per-unit cost, qty remaining → Tasks 9–10, 17
- Brother split shipments / buy / give / payback, true net spend → Tasks 8, 10, 17
- Expenses one-time/recurring + $400 incentive offset → Tasks 11, 18
- COGS per item per show, merchandise not expensed until sold → Tasks 6, 13 (COGS only on confirmed lines; inventory never enters expenses)
- Product-name → inventory alias mapping → Tasks 11, 12, 17, 19
- Re-upload updates show (no duplicate) → Task 11 (sourceHash replace)
- Suspected-duplicate flagging (advisory) → Task 4
- Self-hosted single container, portable single DB file → Tasks 9, 20
- Seed known data (3 shows, Lot 1, expenses, per-item costs) → Task 19 (shows themselves uploaded via UI from CSVs)
```
