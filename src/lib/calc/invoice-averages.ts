import { avgPerUnitCents } from "./avg-per-unit";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

export interface InvoiceAverages {
  units: number;              // Σ quantity of item lines (charges carry no units)
  itemCents: number;          // Σ item-line totals
  chargeCents: number;        // Σ charge-line amounts (shipping, fees, ...)
  avgItemCents: number | null;   // merchandise per unit; null when units <= 0
  avgLandedCents: number | null; // merchandise + charges per unit; null when units <= 0
}

/** Per-unit averages for one invoice. A sale values lines at unit price, a
 *  purchase at unit cost. Charge lines have no quantity, so they sit outside
 *  the merchandise average and are spread over the units in the landed one. */
export function invoiceAverages(lines: InvoiceLine[], direction: Invoice["direction"]): InvoiceAverages {
  const amount = (l: InvoiceLine) => (direction === "sale" ? l.unitPriceCents ?? 0 : l.unitCostCents);
  let units = 0, itemCents = 0, chargeCents = 0;
  for (const l of lines) {
    if (l.kind === "charge") { chargeCents += amount(l); continue; }
    units += l.quantity;
    itemCents += l.quantity * amount(l);
  }
  return {
    units, itemCents, chargeCents,
    avgItemCents: avgPerUnitCents(itemCents, units),
    avgLandedCents: avgPerUnitCents(itemCents + chargeCents, units),
  };
}
