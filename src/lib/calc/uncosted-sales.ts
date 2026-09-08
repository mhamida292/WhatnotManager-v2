import type { LedgerReport } from "./ledger-report";

export interface UncostedSales {
  count: number;               // units sold carrying no cost
  revenueCents: number;        // their revenue, booked as pure profit today
  estimatedCostCents: number;  // what they probably cost; a prompt, never a total
}

/** Sales the report priced at $0 because nothing told it what they cost: a
 *  product that resolves to no inventory item and is not a bundle with
 *  components entered.
 *
 *  These do not appear in `unmappedNames` when their name was dismissed, which
 *  is how a real workspace reached 64 such sales worth $584 of revenue with no
 *  warning anywhere. The estimate uses the average cost of bundles that DO have
 *  components — the closest evidence available — and exists to prompt a fix,
 *  never to enter a total. */
export function uncostedSales(report: LedgerReport): UncostedSales {
  let count = 0, revenueCents = 0;
  let costedBundles = 0, costedTotal = 0;

  for (const show of report.shows) {
    for (const p of show.products) {
      if (p.isBundle && p.costCents > 0) {
        costedBundles += 1;
        costedTotal += p.costCents;
      } else if (!p.mapped && !p.isBundle) {
        count += p.qty;
        revenueCents += p.revenueCents;
      }
    }
  }

  const average = costedBundles > 0 ? Math.round(costedTotal / costedBundles) : 0;
  return { count, revenueCents, estimatedCostCents: count * average };
}
