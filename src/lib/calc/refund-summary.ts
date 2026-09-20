import type { RefundRow } from "@/lib/db/ledger-refunds";

export interface RefundSummary {
  productCents: number;    // refunds against merchandise (negative)
  productCount: number;
  shippingCents: number;   // return-shipping refunds (negative)
  shippingCount: number;
  topProduct: string | null;    // most refunded BY TOTAL, not by single largest
  topProductCents: number;
  topProductCount: number;
}

/** Headline figures for the refunds page. Amounts stay negative, matching the
 *  ledger, so they read as money leaving. */
export function summariseRefunds(refunds: RefundRow[]): RefundSummary {
  let productCents = 0, productCount = 0, shippingCents = 0, shippingCount = 0;
  // Group by name, not itemId: an unmapped refund has no item but still has a
  // name worth counting.
  const byProduct = new Map<string, { cents: number; count: number }>();

  for (const r of refunds) {
    if (r.isShipping) {
      shippingCents += r.amountCents;
      shippingCount += 1;
      continue;
    }
    productCents += r.amountCents;
    productCount += 1;
    if (!r.productName) continue;
    const e = byProduct.get(r.productName) ?? { cents: 0, count: 0 };
    e.cents += r.amountCents;
    e.count += 1;
    byProduct.set(r.productName, e);
  }

  let topProduct: string | null = null;
  let topProductCents = 0, topProductCount = 0;
  for (const [name, e] of byProduct) {
    // Refunds are negative, so "most refunded" is the smallest number.
    if (e.cents < topProductCents || topProduct == null) {
      topProduct = name;
      topProductCents = e.cents;
      topProductCount = e.count;
    }
  }

  return { productCents, productCount, shippingCents, shippingCount, topProduct, topProductCents, topProductCount };
}
