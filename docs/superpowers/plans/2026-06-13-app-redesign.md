# Whatnot App UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply a full clean-light, emerald-accented visual redesign across all pages and add a chart-first dashboard (brainstorm Direction C) with a custom-SVG net-profit trend chart, changing only presentation — no data, calc, or business-logic changes.

**Architecture:** Introduce design tokens (Tailwind theme + Inter font) and a small presentational component library under `src/components/ui/`. Pages stay server components that fetch via existing `lib/` functions and pass plain props into the new UI primitives. The dashboard maps the already-computed `report.shows` into points for a hand-rolled `ProfitChart`; its scaling math lives in a pure, unit-tested `chartGeometry` helper.

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind 3.4, `next/font`, Vitest (node env — no component/DOM tests; only pure helpers are unit-tested). Money is integer cents. Path alias `@/` → `src/`.

**Important testing note:** `vitest.config.ts` uses `environment: "node"`, so there is **no** JSDOM/React Testing Library. Only pure functions get unit tests (`chartGeometry`). UI components are verified by `tsc --noEmit`, `npm run build`, and manual `npm run dev` inspection. Do **not** add component-render tests — the infra isn't present and adding it is out of scope.

**Regression bar:** The full suite is currently **79 tests**. It must stay green after every task. Run `npx vitest run` to confirm.

---

## File Structure

**Create:**
- `src/components/ui/Card.tsx` — white surface container
- `src/components/ui/PageHeader.tsx` — page title + optional action slot
- `src/components/ui/Button.tsx` — emerald primary / subtle secondary; `<button>` or `<Link>`
- `src/components/ui/Badge.tsx` — pill with `red|amber|emerald|slate` variants
- `src/components/ui/Stat.tsx` — KPI tile (label + value node + optional sub)
- `src/components/ui/DataTable.tsx` — consistent table chrome wrapper
- `src/lib/calc/chart-geometry.ts` — pure SVG scaling helper
- `src/components/ProfitChart.tsx` — SVG line/area chart (uses chartGeometry)
- `tests/lib/calc/chart-geometry.test.ts` — unit tests for the helper
- `src/lib/ui/inputs.ts` — shared input className constant for forms

**Modify:**
- `tailwind.config.ts` — theme tokens (colors, radius, shadow)
- `src/app/globals.css` — CSS vars + base body styles
- `src/app/layout.tsx` — Inter font + app background
- `src/components/Nav.tsx` — restyled top bar with active state
- `src/app/page.tsx` — Direction C dashboard
- `src/app/inventory/page.tsx` — restyle with ui primitives (keeps stock badges)
- `src/app/shows/page.tsx` — restyle
- `src/app/shows/[id]/page.tsx` — restyle (keeps Avg/unit column)
- `src/app/expenses/page.tsx` — restyle
- `src/app/report/page.tsx` — restyle
- `src/app/settings/page.tsx` — restyle heading
- `src/components/ShowUpload.tsx`, `LedgerUpload.tsx`, `ExpenseForm.tsx`, `SettingsForm.tsx`, `DangerZone.tsx`, `InventoryForms.tsx` — swap raw buttons/inputs for `Button` + `INPUT_CLASS`

---

## Task 1: Design tokens, font, and base styles

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Extend the Tailwind theme**

Replace the contents of `tailwind.config.ts` with:

```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfdf5", 100: "#d1fae5", 600: "#059669", 700: "#047857",
        },
        line: "#e2e8f0",
      },
      borderRadius: { xl: "0.75rem", "2xl": "1rem" },
      boxShadow: {
        soft: "0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)",
      },
      fontFamily: { sans: ["var(--font-inter)", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 2: Set base body styles in globals.css**

Replace the contents of `src/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-slate-50 text-slate-900 antialiased;
}
```

- [ ] **Step 3: Load Inter and apply background in the layout**

Replace the contents of `src/app/layout.tsx` with:

```tsx
import "./globals.css";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = { title: "Whatnot Business Manager" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Nav />
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no output (clean). (The `Nav` import already exists; it is restyled in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.ts src/app/globals.css src/app/layout.tsx
git commit -m "feat(ui): design tokens, Inter font, app background"
```

---

## Task 2: UI primitives — Card, PageHeader, Button, Badge, Stat, DataTable

**Files:**
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/PageHeader.tsx`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Badge.tsx`
- Create: `src/components/ui/Stat.tsx`
- Create: `src/components/ui/DataTable.tsx`

These are pure presentational components. No tests (node env — verified by tsc/build).

- [ ] **Step 1: Create Card**

`src/components/ui/Card.tsx`:

```tsx
import { ReactNode } from "react";

export function Card({ title, children, className = "" }: {
  title?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-line bg-white shadow-soft ${className}`}>
      {title && (
        <div className="border-b border-line px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create PageHeader**

`src/components/ui/PageHeader.tsx`:

```tsx
import { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
```

- [ ] **Step 3: Create Button**

`src/components/ui/Button.tsx`:

```tsx
import { ReactNode, ButtonHTMLAttributes } from "react";
import Link from "next/link";

type Variant = "primary" | "secondary";
const styles: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-line bg-white text-slate-700 hover:bg-slate-50",
};
const base =
  "inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50";

export function Button(
  { variant = "primary", href, className = "", children, ...rest }:
  { variant?: Variant; href?: string; className?: string; children: ReactNode } &
  ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const cls = `${base} ${styles[variant]} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button className={cls} {...rest}>{children}</button>;
}
```

- [ ] **Step 4: Create Badge**

`src/components/ui/Badge.tsx`:

```tsx
import { ReactNode } from "react";

export type BadgeVariant = "red" | "amber" | "emerald" | "slate";
const variants: Record<BadgeVariant, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-brand-100 text-brand-700",
  slate: "bg-slate-100 text-slate-600",
};

export function Badge({ variant = "slate", children }: {
  variant?: BadgeVariant; children: ReactNode;
}) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Create Stat**

`src/components/ui/Stat.tsx`:

```tsx
import { ReactNode } from "react";

export function Stat({ label, value, sub }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 shadow-soft">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
```

- [ ] **Step 6: Create DataTable**

`src/components/ui/DataTable.tsx`:

```tsx
import { ReactNode } from "react";

export function DataTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-soft">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 8: Commit**

```bash
git add src/components/ui
git commit -m "feat(ui): Card, PageHeader, Button, Badge, Stat, DataTable primitives"
```

---

## Task 3: `chartGeometry` pure helper (TDD)

**Files:**
- Create: `src/lib/calc/chart-geometry.ts`
- Test: `tests/lib/calc/chart-geometry.test.ts`

This converts data points into SVG coordinates. It is the one piece of the chart with real logic, so it is unit-tested.

- [ ] **Step 1: Write the failing test**

`tests/lib/calc/chart-geometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { chartGeometry } from "@/lib/calc/chart-geometry";

describe("chartGeometry", () => {
  it("returns null for no points", () => {
    expect(chartGeometry([], 100, 50)).toBeNull();
  });

  it("places a single point at the vertical middle", () => {
    const g = chartGeometry([{ label: "a", valueCents: 500 }], 100, 50)!;
    expect(g.coords).toHaveLength(1);
    expect(g.coords[0].x).toBe(0);
    expect(g.coords[0].y).toBeCloseTo(25); // mid-height
  });

  it("scales min to bottom and max to top within padding", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 0 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.coords[0].x).toBe(0);
    expect(g.coords[1].x).toBe(100);
    expect(g.coords[0].y).toBeGreaterThan(g.coords[1].y); // higher value = smaller y
  });

  it("includes zero in the range so negatives dip below the baseline", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: -100 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.zeroY).toBeGreaterThan(g.coords[1].y); // baseline below the +100 point
    expect(g.zeroY).toBeLessThan(g.coords[0].y);    // baseline above the -100 point
  });

  it("builds a polyline string from the coords", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 0 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.line).toMatch(/^\d/);
    expect(g.line.split(" ")).toHaveLength(2);
  });

  it("flat series renders at mid-height", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 50 }, { label: "b", valueCents: 50 }],
      100, 100,
    )!;
    expect(g.coords[0].y).toBeCloseTo(50);
    expect(g.coords[1].y).toBeCloseTo(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/calc/chart-geometry.test.ts`
Expected: FAIL — cannot find module `@/lib/calc/chart-geometry`.

- [ ] **Step 3: Implement the helper**

`src/lib/calc/chart-geometry.ts`:

```ts
export interface ChartPoint { label: string; valueCents: number; }
export interface ChartGeometry {
  coords: { x: number; y: number; point: ChartPoint }[];
  line: string;   // "x,y x,y ..." for a <polyline>
  area: string;   // closed path points for the fill
  zeroY: number;  // y of the zero baseline
}

const PAD = 0.12; // fraction of height kept as top/bottom breathing room

/** Map points to SVG coords. Y range always includes zero so negative
 *  values dip below the baseline. Higher value = smaller y (SVG y grows down). */
export function chartGeometry(
  points: ChartPoint[], width: number, height: number,
): ChartGeometry | null {
  if (points.length === 0) return null;

  const values = points.map((p) => p.valueCents);
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; } // flat series -> mid-height

  const padPx = height * PAD;
  const usable = height - 2 * padPx;
  const yFor = (v: number) => padPx + (max - v) / (max - min) * usable;
  const xFor = (i: number) =>
    points.length === 1 ? 0 : (i / (points.length - 1)) * width;

  const coords = points.map((point, i) => ({ x: xFor(i), y: yFor(point.valueCents), point }));
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `${xFor(0)},${height} ${line} ${xFor(points.length - 1)},${height}`;
  return { coords, line, area, zeroY: yFor(0) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/calc/chart-geometry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc/chart-geometry.ts tests/lib/calc/chart-geometry.test.ts
git commit -m "feat(chart): chartGeometry scaling helper with zero baseline"
```

---

## Task 4: `ProfitChart` SVG component

**Files:**
- Create: `src/components/ProfitChart.tsx`

- [ ] **Step 1: Implement the component**

`src/components/ProfitChart.tsx`:

```tsx
import { chartGeometry, ChartPoint } from "@/lib/calc/chart-geometry";
import { formatUSD } from "@/lib/money";

const W = 800, H = 200;

export function ProfitChart({ points }: { points: ChartPoint[] }) {
  const g = chartGeometry(points, W, H);
  if (!g) {
    return <div className="grid h-40 place-items-center text-sm text-slate-400">No shows yet</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-44 w-full">
      <defs>
        <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#059669" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={g.zeroY} x2={W} y2={g.zeroY} stroke="#e2e8f0" strokeWidth="1" />
      <polygon points={g.area} fill="url(#profitFill)" />
      <polyline points={g.line} fill="none" stroke="#059669" strokeWidth="2.5"
        vectorEffect="non-scaling-stroke" />
      {g.coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3" fill="#059669">
          <title>{`${c.point.label}: ${formatUSD(c.point.valueCents)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/components/ProfitChart.tsx
git commit -m "feat(chart): ProfitChart SVG line+area component"
```

---

## Task 5: Restyle the top-bar nav with active state

**Files:**
- Modify: `src/components/Nav.tsx`

- [ ] **Step 1: Replace Nav with an active-aware client component**

`src/components/Nav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links: [string, string][] = [
  ["/", "Dashboard"], ["/shows", "Shows"], ["/inventory", "Inventory"],
  ["/expenses", "Expenses"], ["/report", "Report"], ["/settings", "Settings"],
];

export function Nav() {
  const path = usePathname();
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6">
        <span className="py-4 text-sm font-bold tracking-tight text-brand-600">◆ Whatnot</span>
        <div className="flex gap-5">
          {links.map(([href, label]) => {
            const on = isActive(href);
            return (
              <Link key={href} href={href}
                className={`border-b-2 py-4 text-sm transition-colors ${
                  on ? "border-brand-600 font-semibold text-slate-900"
                     : "border-transparent text-slate-500 hover:text-slate-900"}`}>
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add src/components/Nav.tsx
git commit -m "feat(ui): restyled top-bar nav with emerald active underline"
```

---

## Task 6: Direction C dashboard

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Rebuild the dashboard**

Replace the contents of `src/app/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { dashboardSummary } from "@/lib/calc/dashboard";
import { qtyRemaining, listItems } from "@/lib/db/inventory";
import { getSettings } from "@/lib/db/settings";
import { Money } from "@/components/Money";
import { ProfitChart } from "@/components/ProfitChart";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const db = getDb();
  const d = dashboardSummary(db);
  const rep = buildLedgerReport(db);
  const { ownerSharePct } = getSettings(db);
  const unitsOnHand = listItems(db).reduce((s, i) => s + qtyRemaining(db, i.id), 0);

  const shows = [...rep.shows].sort((a, b) => a.showDate.localeCompare(b.showDate));
  const points = shows.map((s) => ({ label: s.showDate, valueCents: s.netCents }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Profit across all your Whatnot shows" />

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net profit · {shows.length} show{shows.length === 1 ? "" : "s"}
          </h2>
          <div className="text-2xl font-semibold"><Money cents={d.totalNetProfitCents} /></div>
        </div>
        <div className="mt-3"><ProfitChart points={points} /></div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={`Your ${ownerSharePct}%`} value={<Money cents={d.ownerShareCents} />} />
        <Stat label="Gross sales" value={<Money cents={d.grossSalesCents} />} />
        <Stat label="Total payout" value={<Money cents={d.totalPayoutCents} />} />
        <Stat label="Inventory spend" value={<Money cents={d.netInventorySpendCents} />} />
        <Stat label="Expenses" value={<Money cents={d.totalExpensesCents} />} />
        <Stat label="Units on hand" value={unitsOnHand} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Show breakdown</h2>
        <DataTable head={<>
          <th className="px-4 py-2">Show</th>
          <th className="px-4 py-2">Payout</th>
          <th className="px-4 py-2">COGS</th>
          <th className="px-4 py-2 text-right">Net</th>
        </>}>
          {shows.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-3 text-slate-500">
              No shows yet. Import your Whatnot ledger on the Shows page.
            </td></tr>
          )}
          {[...shows].reverse().map((s) => (
            <tr key={s.showId} className="border-t border-line hover:bg-slate-50">
              <td className="px-4 py-2">
                <a href={`/shows/${s.showId}`} className="font-medium text-brand-700 hover:underline">
                  {s.showDate}
                </a>
              </td>
              <td className="px-4 py-2"><Money cents={s.payoutCents} /></td>
              <td className="px-4 py-2"><Money cents={-s.cogsCents} /></td>
              <td className="px-4 py-2 text-right"><Money cents={s.netCents} /></td>
            </tr>
          ))}
        </DataTable>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; tests still **80 passing** (79 prior + 6 new chart-geometry from Task 3 minus none = 85 actually; just confirm all green, no failures).
> Note: exact count rises with the chart-geometry tests. The bar is **zero failures**, not a specific number.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(dashboard): Direction C — profit chart, KPI strip, show breakdown"
```

---

## Task 7: Restyle Inventory (keeps stock badges via Badge)

**Files:**
- Modify: `src/app/inventory/page.tsx`

- [ ] **Step 1: Rebuild the inventory page using ui primitives**

Replace the contents of `src/app/inventory/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { listItems, qtyRemaining, qtySold } from "@/lib/db/inventory";
import { netInventorySpend } from "@/lib/calc/inventory-spend";
import { InventoryForms } from "@/components/InventoryForms";
import { seenProductNames } from "@/lib/db/aliases";
import { Money } from "@/components/Money";
import { EditableQty } from "@/components/EditableQty";
import { stockBadge } from "@/lib/calc/stock-status";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

export const dynamic = "force-dynamic";

export default function InventoryPage() {
  const db = getDb();
  const items = listItems(db).map((i) => ({ ...i, sold: qtySold(db, i.id), remaining: qtyRemaining(db, i.id) }));
  const seen = seenProductNames(db);
  const itemCosts = items.map((i) => i.unitCostCents * i.qtyPurchased);
  const brother = db.prepare("SELECT kind, owner_cost_cents as ownerCostCents, amount_cents as amountCents FROM brother_transactions").all() as any[];
  const spend = netInventorySpend({ itemCostsCents: itemCosts, brotherTxns: brother });

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" subtitle="Items, costs, and what's left to sell" />
      <div className="max-w-xs">
        <Stat label="True net inventory spend" value={<Money cents={spend} />} />
      </div>

      <DataTable head={<>
        <th className="px-3 py-2">Item</th>
        <th className="px-3 py-2">Unit cost</th>
        <th className="px-3 py-2">Purchased</th>
        <th className="px-3 py-2">Sold</th>
        <th className="px-3 py-2">Samples</th>
        <th className="px-3 py-2">Remaining</th>
      </>}>
        {items.map((i) => {
          const badge = stockBadge(i.remaining);
          return (
            <tr key={i.id} className="border-t border-line">
              <td className="px-3 py-2">
                {i.name}
                {badge && (
                  <span className="ml-2 align-middle">
                    <Badge variant={i.remaining <= 0 ? "red" : "amber"}>{badge.label}</Badge>
                  </span>
                )}
              </td>
              <td className="px-3 py-2"><Money cents={i.unitCostCents} /></td>
              <td className="px-3 py-2"><EditableQty id={i.id} value={i.qtyPurchased} field="qtyPurchased" /></td>
              <td className="px-3 py-2">{i.sold}</td>
              <td className="px-3 py-2"><EditableQty id={i.id} value={i.qtySamples} field="qtySamples" /></td>
              <td className="px-3 py-2">{i.remaining}</td>
            </tr>
          );
        })}
      </DataTable>

      <InventoryForms items={items.map((i) => ({ id: i.id, name: i.name }))} seenNames={seen} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/inventory/page.tsx
git commit -m "feat(ui): restyle Inventory with ui primitives + Badge"
```

---

## Task 8: Restyle Shows list and Show detail

**Files:**
- Modify: `src/app/shows/page.tsx`
- Modify: `src/app/shows/[id]/page.tsx`

- [ ] **Step 1: Rebuild the shows list page**

Replace the contents of `src/app/shows/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { listShows } from "@/lib/db/shows";
import { getSettings } from "@/lib/db/settings";
import { ShowUpload } from "@/components/ShowUpload";
import { LedgerUpload } from "@/components/LedgerUpload";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

export default function ShowsPage() {
  const db = getDb();
  const shows = listShows(db);
  const settings = getSettings(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Shows" subtitle="Import your Whatnot ledger and review each show" />
      <LedgerUpload />
      <ShowUpload defaultGiveawayUnitCents={settings.giveawayUnitCents} defaultShippingCents={settings.defaultShippingSuppliesCents} />
      <DataTable head={<>
        <th className="px-4 py-2">Date</th>
        <th className="px-4 py-2 text-right">Payout</th>
      </>}>
        {shows.length === 0 && (
          <tr><td colSpan={2} className="px-4 py-3 text-slate-500">
            No shows saved yet. Upload a CSV above, fill in the date and payout, then Save.
          </td></tr>
        )}
        {shows.map((s) => (
          <tr key={s.id} className="border-t border-line hover:bg-slate-50">
            <td className="px-4 py-2">
              <a className="font-medium text-brand-700 hover:underline" href={`/shows/${s.id}`}>
                {s.showDate || `Show #${s.id} (no date)`}
              </a>
            </td>
            <td className="px-4 py-2 text-right"><Money cents={s.payoutCents} /></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
```

- [ ] **Step 2: Restyle the show detail page**

In `src/app/shows/[id]/page.tsx`, keep all data logic and the `avgPerUnitCents` column. Replace the **return JSX** (the `return ( ... )` block for the found-show case, starting at `<div className="space-y-4">`) with:

```tsx
    <div className="space-y-6">
      <PageHeader title={`Show ${show.showDate}`} subtitle="Profit and loss for this show" />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="Summary">
          <table className="w-full text-sm">
            <tbody>{rows.map(([k, v], i) => (
              <tr key={i} className="border-b border-line last:border-0">
                <td className="py-2 pr-8 text-slate-500">{k}</td>
                <td className="py-2 text-right">{v}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>

        {show.products.length > 0 && (
          <DataTable head={<>
            <th className="px-3 py-2">Product</th><th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Unit cost</th><th className="px-3 py-2">Cost</th>
            <th className="px-3 py-2">Revenue</th><th className="px-3 py-2">Avg/unit</th>
            <th className="px-3 py-2 text-right">Profit</th>
          </>}>
            {show.products.map((p) => (
              <tr key={p.productName} className="border-t border-line">
                <td className="px-3 py-2">{p.productName}{!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}</td>
                <td className="px-3 py-2">{p.qty}</td>
                <td className="px-3 py-2">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
                <td className="px-3 py-2"><Money cents={p.costCents} /></td>
                <td className="px-3 py-2"><Money cents={p.revenueCents} /></td>
                <td className="px-3 py-2">{(() => { const a = avgPerUnitCents(p.revenueCents, p.qty); return a == null ? "—" : <Money cents={a} />; })()}</td>
                <td className="px-3 py-2 text-right"><Money cents={p.profitCents} /></td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
```

Then add these imports at the top of `src/app/shows/[id]/page.tsx` (alongside the existing imports):

```tsx
import { Card } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
```

(The "Show not found" branch can keep its existing markup or be wrapped in `PageHeader title="Show not found"` — leave as-is is acceptable.)

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/shows/page.tsx "src/app/shows/[id]/page.tsx"
git commit -m "feat(ui): restyle Shows list and Show detail"
```

---

## Task 9: Restyle Expenses and Report

**Files:**
- Modify: `src/app/expenses/page.tsx`
- Modify: `src/app/report/page.tsx`

- [ ] **Step 1: Rebuild Expenses**

Replace the contents of `src/app/expenses/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { listExpenses, totalExpensesCents } from "@/lib/db/expenses";
import { ExpenseForm } from "@/components/ExpenseForm";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { DataTable } from "@/components/ui/DataTable";

export const dynamic = "force-dynamic";

export default function ExpensesPage() {
  const db = getDb();
  const expenses = listExpenses(db);
  return (
    <div className="space-y-6">
      <PageHeader title="Expenses" subtitle="Business costs after incentive offsets" />
      <div className="max-w-xs">
        <Stat label="Total expenses (after offsets)" value={<Money cents={totalExpensesCents(db)} />} />
      </div>
      <DataTable head={<>
        <th className="px-3 py-2">Description</th><th className="px-3 py-2">Type</th>
        <th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Amount</th>
      </>}>
        {expenses.map((e) => (
          <tr key={e.id} className="border-t border-line">
            <td className="px-3 py-2">{e.description}</td>
            <td className="px-3 py-2">{e.type}</td>
            <td className="px-3 py-2">{e.category}</td>
            <td className="px-3 py-2 text-right"><Money cents={e.amountCents} /></td>
          </tr>
        ))}
      </DataTable>
      <ExpenseForm />
    </div>
  );
}
```

- [ ] **Step 2: Rebuild Report**

Replace the contents of `src/app/report/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { buildLedgerReport } from "@/lib/calc/ledger-report";
import { Money } from "@/components/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Stat } from "@/components/ui/Stat";
import { Card } from "@/components/ui/Card";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  const rep = buildLedgerReport(getDb());
  return (
    <div className="space-y-6">
      <PageHeader title="Profit report" subtitle="Full breakdown by show" />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Revenue" value={<Money cents={rep.totals.revenueCents} />} />
        <Stat label="COGS" value={<Money cents={rep.totals.cogsCents} />} />
        <Stat label="Net profit so far" value={<Money cents={rep.totals.netCents} />} />
        <Stat label="Your share" value={<Money cents={rep.totals.ownerShareCents} />} />
      </div>

      {rep.unmappedCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {rep.unmappedCount} unmapped product(s) counted at $0 cost: {rep.unmappedNames.join(", ")}. Map them on the Inventory page for accurate profit.
        </div>
      )}

      {rep.shows.length === 0 && <p className="text-slate-500">No ledger imported yet. Import your Whatnot ledger on the Shows page.</p>}

      {rep.shows.map((s) => (
        <Card key={s.showId} title={<div className="flex justify-between"><span>{s.showDate}</span><span className="normal-case">Net: <Money cents={s.netCents} /></span></div>}>
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-line text-slate-500">
              <th className="p-1">Product</th><th className="p-1">Qty</th><th className="p-1">Unit cost</th>
              <th className="p-1">Cost</th><th className="p-1">Revenue</th><th className="p-1">Profit</th>
            </tr></thead>
            <tbody>
              {s.products.map((p) => (
                <tr key={p.productName} className="border-b border-line">
                  <td className="p-1">{p.productName}{!p.mapped && <span className="ml-1 text-amber-700">(unmapped)</span>}</td>
                  <td className="p-1">{p.qty}</td>
                  <td className="p-1">{p.unitCostCents == null ? "—" : <Money cents={p.unitCostCents} />}</td>
                  <td className="p-1"><Money cents={p.costCents} /></td>
                  <td className="p-1"><Money cents={p.revenueCents} /></td>
                  <td className="p-1"><Money cents={p.profitCents} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-slate-500">
            Payout <Money cents={s.payoutCents} /> ·{" "}
            Giveaways {s.giveawayCount} × <Money cents={rep.giveawayUnitCents} /> = <Money cents={-s.giveawayCostCents} /> ·{" "}
            Tips <Money cents={s.tipTotalCents} /> · Bonus <Money cents={s.bonusTotalCents} /> ·
            Other <Money cents={s.otherTotalCents} /> · Shipping <Money cents={s.shippingSuppliesCents} />
          </div>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/expenses/page.tsx src/app/report/page.tsx
git commit -m "feat(ui): restyle Expenses and Report pages"
```

---

## Task 10: Shared input style + restyle form components & Settings

**Files:**
- Create: `src/lib/ui/inputs.ts`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/components/SettingsForm.tsx`, `ExpenseForm.tsx`, `ShowUpload.tsx`, `LedgerUpload.tsx`, `DangerZone.tsx`, `InventoryForms.tsx`

- [ ] **Step 1: Create the shared input class constant**

`src/lib/ui/inputs.ts`:

```ts
/** Consistent styling for text/number/select inputs across forms. */
export const INPUT_CLASS =
  "rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";
```

- [ ] **Step 2: Restyle the Settings page heading**

Replace the contents of `src/app/settings/page.tsx` with:

```tsx
import { getDb } from "@/lib/db/connection";
import { getSettings } from "@/lib/db/settings";
import { SettingsForm } from "@/components/SettingsForm";
import { DangerZone } from "@/components/DangerZone";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Profit split, giveaway cost, and defaults" />
      <SettingsForm initial={getSettings(getDb())} />
      <DangerZone />
    </div>
  );
}
```

- [ ] **Step 3: Restyle each form component**

For each of `SettingsForm.tsx`, `ExpenseForm.tsx`, `ShowUpload.tsx`, `LedgerUpload.tsx`, `InventoryForms.tsx`:
1. Read the file.
2. Import the shared pieces where used:
   ```tsx
   import { Button } from "@/components/ui/Button";
   import { INPUT_CLASS } from "@/lib/ui/inputs";
   ```
3. Replace each raw `<input .../>` / `<select>...</select>` `className` with `INPUT_CLASS` (append any layout-specific widths, e.g. `` className={`${INPUT_CLASS} w-32`} ``).
4. Replace each submit/action `<button ...>Label</button>` with `<Button ...>Label</Button>` (keep existing `onClick`/`type`/`disabled` props — `Button` forwards button attributes). Wrap any outer container card markup in `<Card>` from `@/components/ui/Card` if the form currently uses an ad-hoc `rounded border bg-white` wrapper.

For `DangerZone.tsx`: read it, wrap its content in a visually distinct destructive section — replace its outer wrapper with:
```tsx
<div className="rounded-2xl border border-red-200 bg-red-50 p-5">
```
and render its action button as `<Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-100" ...>` keeping the existing confirm/onClick logic.

> These components keep all existing state, handlers, and behavior. Only `className` strings and the button/input elements change.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/inputs.ts src/app/settings/page.tsx src/components
git commit -m "feat(ui): shared input style; restyle forms, Settings, Danger Zone"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: zero failures (all prior tests + the new `chart-geometry` tests pass).

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 4: Manual run-through**

Run the app (`PORT=3001 npm run dev`) and load each page; confirm HTTP 200 and that the restyled UI renders with real data:

```bash
for p in / /shows /inventory /expenses /report /settings; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001$p)"
done
```
Expected: every route prints `200`. Spot-check the dashboard shows the profit chart, KPI strip, and show-breakdown table; Inventory shows stock badges; a show-detail page shows the Avg/unit column.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(ui): redesign verification fixes"
```

(If no fixes were needed, skip this commit.)

---

## Self-Review Notes

- **Spec coverage:** tokens/font (Task 1) ✓; component library Card/PageHeader/Button/Badge/Stat/DataTable (Task 2) ✓; `chartGeometry` tested + `ProfitChart` (Tasks 3–4) ✓; nav (Task 5) ✓; Direction C dashboard with chart/KPIs/breakdown (Task 6) ✓; Inventory keeps badges (Task 7) ✓; Shows + show detail keeps Avg/unit (Task 8) ✓; Expenses + Report (Task 9) ✓; Settings + forms + Danger Zone (Task 10) ✓; verification incl. 79-test regression + build + manual run (Task 11) ✓. No dark mode, no new features, calc/DB untouched — matches spec non-goals.
- **Type consistency:** `chartGeometry`/`ChartPoint`/`ChartGeometry` names match across Tasks 3–4 and the dashboard's `points` mapping (`{ label, valueCents }`). `Badge` variants (`red|amber|emerald|slate`) match usage in Inventory. `Stat` uses `value` (ReactNode) consistently. `Button` forwards button attrs (used by forms in Task 10).
- **Placeholders:** none — every code step shows full content. Task 10 form edits reference real files the executor reads, with exact class/element swaps and the concrete `INPUT_CLASS` string.
```
