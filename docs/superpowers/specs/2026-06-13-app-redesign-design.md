# Whatnot Business Manager — Full UI Redesign (Design Spec)

**Date:** 2026-06-13
**Status:** Approved for planning
**Scope:** Presentation-layer redesign across all pages, plus one new dashboard chart over existing data. No changes to data model, calculations, or business logic.

## Goal

A complete visual refresh of the app: a new, consistent visual identity and a
reorganized Dashboard. Direction and identity chosen during brainstorming:

- **Layout direction:** "Chart-first story" dashboard with a **top-bar nav**
  (brainstorm Direction C).
- **Aesthetic:** Clean-light (Stripe/Linear feel) — bright background, soft
  shadows, refined typography, generous spacing.
- **Accent color:** Emerald (`emerald-600` primary).
- **No dark mode** for now (tokens make it easy to add later).

Success = every page shares one consistent, polished design system; the
dashboard leads with a net-profit trend chart; all 79 existing tests stay green;
no behavioral or data changes.

## Constraints / Non-Goals

- **Lean stack preserved.** No charting library or UI-component library is
  added. The stack stays `next` + `react` + `better-sqlite3` + `papaparse` +
  `tailwindcss`. The chart is hand-rolled SVG.
- **No information-architecture changes** beyond visual consistency. Same six
  pages, same data, same flows. Inventory keeps its stock badges; show detail
  keeps the Avg/unit column.
- **Calc/DB/CSV layers untouched.** This is `src/app/**` and
  `src/components/**` only, plus Tailwind/font config.
- **No dark mode, no auth, no new business features.**

## Visual System (tokens)

Implemented via Tailwind theme `extend` plus a few CSS variables in
`globals.css`.

- **Font:** Inter, loaded with `next/font/google` (self-hosted by Next — no
  runtime network dependency), applied on `<body>`.
- **Color roles:**
  - Accent / primary: `emerald-600` (hover `emerald-700`), soft `emerald-50`.
  - Ink: `slate-900`; secondary text: `slate-500`; borders: `slate-200`
    (token `--line`).
  - Surface: white cards on a `slate-50` app background.
  - Money semantics stay independent of accent: positive `green-600`,
    negative `red-600`. (Accepted minor overlap between emerald accent and
    profit-green; money values are the only green-text usage besides the
    chart.)
- **Radius:** cards `rounded-2xl`, controls/tiles `rounded-xl`, pills
  `rounded-full`.
- **Shadow:** one soft elevation token
  (`0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)`).

## Component Library (`src/components/ui/`)

Each is a small, presentational, prop-driven component with a single
responsibility. No data access inside UI components.

- **`Card`** — white surface, border, soft shadow, padding. Optional `title`.
- **`Stat`** — KPI tile: uppercase label, large value (`ReactNode`, usually
  `<Money>`), optional secondary line. Used in the dashboard KPI strip.
- **`PageHeader`** — page title + optional right-aligned action slot
  (e.g. a Button). Appears on every page.
- **`Button`** — variants: `primary` (emerald), `secondary` (subtle/bordered).
  Renders `<button>` or, with `href`, a Next `<Link>`.
- **`Badge`** — pill with variants `red | amber | emerald | slate`. The
  existing `stockBadge` helper maps onto the `red`/`amber` variants so
  inventory badges go through this component.
- **`DataTable`** — thin styling wrapper enforcing consistent table chrome
  (header row, row borders, alignment). Columns/rows are passed by the caller;
  this does not own data or sorting.
- **`ProfitChart`** — see below.

Existing helpers kept as-is and reused: `Money`, `EditableQty`,
`stockBadge`/`avgPerUnitCents`. The legacy ad-hoc table/card markup in pages is
replaced by these primitives.

### `ProfitChart` (custom SVG)

- **Input:** `points: { label: string; valueCents: number }[]` — already
  computed by the page from `report.shows` (sorted by date:
  `{ label: showDate, valueCents: netCents }`). No new data layer.
- **Render:** responsive `<svg viewBox preserveAspectRatio="none">` line with a
  soft emerald area fill; hover dots with a tooltip showing the show date and
  net amount; a baseline at zero so negative shows dip below it.
- **Edge cases:** 0 points → empty state ("No shows yet"); 1 point → single dot;
  all-equal values → flat line at mid-height. Negative values handled by a
  y-scale spanning min..max including zero.
- **Pure core, testable:** a helper `chartGeometry(points, width, height)`
  returns the scaled coordinates / polyline string. This is unit-tested; the
  SVG component is a thin renderer around it.

## Page-by-Page Application

All pages adopt `PageHeader` + `Card` + `DataTable` + `Button` and the token
system. Data sources and routes are unchanged.

- **Dashboard (`/`)** — Direction C:
  1. Restyled top-bar nav (shared `Nav`).
  2. Full-width `Card` with `ProfitChart` (net profit per show) and the
     all-time net-profit total in the corner.
  3. KPI strip of `Stat` tiles: Your N% share, Gross sales, Total payout,
     Inventory spend, Total expenses, Units on hand.
  4. **Show breakdown** `DataTable`: per-show payout / COGS / net, with badges,
     each row linking to `/shows/[id]`. Built from `report.shows`.
- **Shows (`/shows`)** — restyled upload card + shows list table.
- **Show detail (`/shows/[id]`)** — restyled summary card + product table
  (keeps the Avg/unit column).
- **Inventory (`/inventory`)** — restyled spend card + items `DataTable`;
  stock badges rendered through the new `Badge` component.
- **Expenses (`/expenses`)** — restyled expense form + list.
- **Report (`/report`)** — restyled totals + tables.
- **Settings (`/settings`)** — restyled form inputs/buttons; Danger Zone styled
  as a clearly-separated destructive section.

## Navigation Shell

Top-bar nav (`src/components/Nav.tsx`) restyled: brand mark on the left, links
with an emerald active-state underline (active detected via `usePathname`),
white bar on the slate-50 app background. Layout container widths preserved
(`max-w-5xl` for content; the dashboard may use a slightly wider container if
needed for the chart — `max-w-6xl`).

## Data Flow

Unchanged. Pages remain server components calling `getDb()` →
`buildLedgerReport` / `listItems` / etc., then pass plain props into the new
presentational UI components. The dashboard additionally maps
`report.shows → points` for `ProfitChart`. No new APIs, tables, or queries.

## Error / Empty States

- Dashboard with no shows: KPI tiles show `$0.00`/`0`; `ProfitChart` shows its
  empty state; breakdown table shows an empty-state row.
- Unmapped products, not-found show, etc.: existing handling preserved, just
  restyled.

## Testing

- **Unit tests (Vitest):** `chartGeometry` (scaling, zero baseline, negative
  values, 0/1/n points). Pure-helper coverage consistent with the existing
  `stock-status` / `avg-per-unit` pattern.
- **No snapshot/visual tests** (not set up in this repo).
- **Regression:** full suite must stay green (currently 79 tests). Because
  calc/DB/CSV are untouched, those tests should be unaffected.
- **Manual verification:** run `npm run dev`, load each page, confirm HTTP 200
  and that the restyled UI renders with real data (per the project `run` flow).

## Out of Scope (future)

- Dark mode (tokens make it a later addition).
- Richer charts (axes/zoom/multiple series) — would justify a charting library.
- Chart metric toggles (per-show vs cumulative vs your-share). Ships as
  net-profit-per-show; toggle can come later.
