# Mobile responsive pass — WORK-IN-PROGRESS brainstorm notes

**Date:** 2026-06-26
**Status:** 🚧 BRAINSTORM IN PROGRESS — not yet a finalized spec. Resume here.
**Trigger:** Mobile screenshot of the show-detail page (`/shows/[id]`) — top bar cramped, Products table columns pushed off-screen, bundle component fields truncated.

## How to resume (next-laptop checklist)
1. Re-read this file.
2. Re-launch the visual companion if you want mockups:
   `~/.claude/plugins/cache/claude-plugins-official/superpowers/<ver>/skills/brainstorming/scripts/start-server.sh --project-dir <repo> --open`
   (The companion server is local-only; it does NOT travel between laptops — relaunch fresh.)
3. Continue the brainstorming skill from the **Open decisions** below, in order.
4. When all decisions are made → write the real design doc `2026-06-26-mobile-responsive-pass-design.md` → writing-plans → implement.

## Decided so far
- **Scope = whole app, all pages** (not just the show page). Fix shared pieces once (nav + a reusable responsive-table pattern), then sweep every page: Dashboard `/`, Shows `/shows`, show detail `/shows/[id]`, Inventory `/inventory`, Invoices `/invoices`, Expenses `/expenses`, Report `/report`, Settings `/settings`, Users `/settings/users`.

## Open decisions (resume here, in order)
1. **Wide-table strategy on mobile** (the big reusable decision — affects every table page). Options shown to user in the visual companion; NOT yet chosen:
   - **A · Stacked cards** — each row becomes a labeled card; every value visible, no horizontal scroll; desktop keeps the normal table. *(Claude's recommendation — only option where Profit/Revenue are visible at a glance on a phone; reuses cleanly across Inventory/Report.)*
   - **B · Priority columns + tap to expand** — show Product/Qty/Profit on mobile, tap a row to reveal Unit cost/Cost/Revenue/Avg.
   - **C · Horizontal swipe** — keep full table, freeze the Product column, swipe right for the rest. Least work; still requires swiping.
   - Mockup file: `.superpowers/brainstorm/254575-1782500196/content/mobile-tables.html` (gitignored — relaunch companion to view).
2. **Top bar / nav on mobile** — options NOT yet presented. Likely a hamburger/drawer menu on small screens (the 8 links don't fit). Need to confirm pattern (hamburger drawer vs. bottom tab bar vs. collapse-to-overflow) and whether username/Logout stay visible.
3. **Bundle editor on mobile** — component item-name fields and the orders dropdown are cramped; decide stacking/full-width treatment (part of the show-detail sweep).

## Known problem spots (file:line, for the eventual plan)
- `src/components/Nav.tsx` — all 8 links (`Dashboard, Shows, Inventory, Invoices, Expenses, Report, Settings` + admin `Users`) live in one `flex ... overflow-x-auto` row (lines 22–44). On a phone they scroll awkwardly and crowd the `username · Logout` cluster. This is the shared nav rendered by `src/app/layout.tsx` for every page → fixing it once helps everywhere.
- `src/components/ui/DataTable.tsx` — forces `min-w-[640px]` on `<table>` (line ~9), so on a phone the right-hand columns (Cost/Revenue/Avg/Profit) get pushed off the viewport with only an overflow scroll. This is the shared table wrapper used across pages → the chosen table strategy should live here (or alongside it).
- `src/components/ProductsTable.tsx` — the show/report Products table (client, sortable). On mobile its 7 columns overflow; whatever strategy is chosen must keep sort working and keep the bundle `▸ bundle (N items)` indicator + component subtext.
- Root layout `src/app/layout.tsx` — `<main className="mx-auto max-w-6xl px-6 py-8">`; the `px-6` side padding is a bit tight on small phones (consider `px-4 sm:px-6`).
- Bundle editor `src/components/BundleEditor.tsx` — component rows (ItemCombobox + qty + cost + remove) and the new orders dropdown are cramped at phone width.

## Constraints / context
- Tailwind CSS; mobile-first breakpoints (`sm:`/`lg:`). Prefer responsive utility classes over JS where possible.
- App runs self-hosted behind Tailscale; used on the user's phone. No new heavy deps — keep it dependency-free (the codebase favors native solutions, e.g. native `<datalist>` for comboboxes).
- Money is integer cents; render via `<Money>`.
- Don't regress desktop: desktop should keep the current table layout. Mobile changes gated behind small-screen breakpoints.

## Recently shipped (already on master, context for the sweep)
- Bundle qty + sale #s, units-sold, sortable Products tables (merged `c41aa6b`).
- Collapsed searchable bundle order picker (merged `9319a59`).
