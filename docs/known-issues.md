# Known Issues

Tracked, non-blocking issues to revisit. Each entry: what it is, why it happens,
impact, and the intended fix.

## Phantom "shows" on saleless dates

**Status:** Open — deferred 2026-06-24. Cosmetic only.

**Symptom:** The Shows list contains tiny "shows" that weren't real streams —
dates that only had a stray fee, a $0 row, an adjustment, or a bank payout. Real
examples seen in production: `2026-06-14` (−$2.76 fee), `2026-06-17` ($0.00),
`2026-06-22` ($1.00 adjustment) — all with 0 sales.

**Root cause:** `saveLedger` (`src/lib/db/ledger.ts`) calls `findOrCreateShow`
for **every** transaction, so any date with any ledger transaction gets a show —
including dates with zero `kind='sale'` rows. `regroupLedgerShows` keeps one show
even when `assignSessions` sees no sales ("no sales → single session"), so
re-importing the ledger does **not** clean these up.

**Impact:** Cosmetic clutter only. These carry ≈$0 in sales, so profit/COGS and
the owner/partner split are unaffected. Current workaround: delete each junk show
from its show page (`deleteShow` / `DeleteShowButton`).

**Intended fix:** Don't create a show for a date whose transactions include zero
`kind='sale'` rows; on `regroupLedgerShows`, if a date has no sales, delete its
ledger show(s) instead of keeping one. Likely touch points: `findOrCreateShow`
(skip when the date has no sale) and the no-sales branch of `regroupLedgerShows`.

**Watch-outs when building it:**
- A real show date can legitimately carry the $400 "Sales Match Bonus" (kind
  `bonus`) and tips alongside its sales — those must still count. The rule keys
  on "has ≥1 sale," not "has only sales."
- Decide what happens to the non-sale transactions on a now-show-less date
  (orphan vs. drop). They're excluded from the payout sum anyway.
- Re-import is idempotent for transactions (`dedup_key`) but recomputes shows, so
  the fix should also retroactively remove existing phantom shows on the next
  import/backfill.
- Needs its own brainstorm/spec + a server rebuild to deploy.

**Not a bug (confirmed working):** Same-day session split is correct — e.g.
`2026-06-16` is stored as two shows ($570.87 + $60.62 = $631.49), matching the
CSV's single-date $631.49 preview row. The import **preview** always shows one
row per date (no session logic); the **stored** shows reflect the splits. A date
showing an incomplete payout (e.g. 06-23 at $727.34 vs. CSV $1013.14) just means
it was adopted from a stale `whatnot.db` — re-importing the full ledger fills it
in and splits it.
