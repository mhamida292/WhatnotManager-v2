import type { DB } from "@/lib/db/connection";
import { listShows } from "@/lib/db/shows";
import { listItems } from "@/lib/db/inventory";
import { listLedgerTransactions } from "@/lib/db/ledger";
import { allocateLabor } from "./labor-allocation";
import { listPayroll } from "@/lib/db/payroll";
import { isPayoutFailure, unrecognizedPayoutMessage } from "@/lib/csv/ledger";
import { resolveItemId } from "@/lib/db/aliases";
import { getSettings } from "@/lib/db/settings";
import { splitProfit } from "./show-pnl";
import { getAllocations, listGiveawayItems } from "@/lib/db/giveaway-items";
import { getBundleComponentsByTxn } from "@/lib/db/bundles";
import { secondsToClock } from "./sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";
import { invoiceNumber } from "@/lib/db/invoices";
import { computePoolCost } from "./pool-cost";

export interface ReportBundleComponent {
  name: string;
  qty: number;
  unitCostCents: number;
  costCents: number;
}

export interface ReportProductLine {
  productName: string;
  itemId: number | null;
  mapped: boolean;
  qty: number;
  unitCostCents: number | null;
  costCents: number;
  revenueCents: number;
  profitCents: number;
  isBundle?: boolean;
  components?: ReportBundleComponent[];
}

export interface ReportPooledSale {
  amountCents: number;
  costCents: number;
  createdAt: string;
}

export interface ReportShow {
  showId: number;
  showDate: string;
  sessionSeq: number;
  timeRange: string;
  dateHasMultipleSessions: boolean;
  products: ReportProductLine[];
  pooledSales?: ReportPooledSale[];
  giveawayTotalCents: number;   // Whatnot's fee on giveaway orders (already inside payout)
  giveawayCount: number;        // number of items given away this show
  giveawayCostCents: number;    // Σ alloc.count × (packCostCents/packQty), rounded once (merchandise cost, NOT in payout)
  giveawayUnallocated: boolean; // true when the show has detected giveaways but no allocation rows
  tipTotalCents: number;
  bonusTotalCents: number;
  otherTotalCents: number;
  payoutCents: number;
  withdrawnToBankCents: number;   // Σ of bank-withdrawal (payout-kind) amounts; signed (negative)
  payoutFailureCents: number;     // Σ of money returned by a bounced payout; positive, already inside withdrawnToBankCents
  cogsCents: number;
  shippingSuppliesCents: number;
  laborCents: number;             // wages for the day this show ran, split across its sessions
  netCents: number;
  unitsSold: number;            // Σ product-line qty (each sale + each bundle order = 1)
  saleCount: number;            // count of kind==='sale' transactions per show
}

export interface WholesaleInvoiceLine {
  invoiceId: number;
  number: string;
  customer: string | null;
  paid: boolean;
  qty: number;
  revenueCents: number;
  cogsCents: number;
  profitCents: number;
}

export interface WholesaleRollup {
  invoices: WholesaleInvoiceLine[];
  paidRevenueCents: number;
  paidCogsCents: number;
  paidProfitCents: number;
  owedToYouCents: number;
}

export interface PoolSummary {
  currentAvgUnitCostCents: number;
  totalUnitsPurchased: number;
  totalSaleCount: number;
  unitsOnHand: number;
  valueOnHandCents: number;
}

export interface LedgerReport {
  shows: ReportShow[];
  giveawayUnitCents: number;
  totals: {
    revenueCents: number;
    cogsCents: number;
    giveawayCostCents: number;
    shippingSuppliesCents: number;
    laborCents: number;
    unallocatedLaborCents: number;   // wages on dates with no show; NOT inside netCents
    netCents: number;
    ownerShareCents: number;
    partnerShareCents: number;
    withdrawnToBankCents: number;
    payoutFailureCents: number;
    unitsSold: number;
  };
  wholesale: WholesaleRollup;
  unmappedNames: string[];
  unmappedCount: number;
  /** ADJUSTMENT messages mentioning a payout that no rule recognised. They fall
   *  through to 'other' and count as revenue, so a new Whatnot wording surfaces
   *  here instead of silently reading as profit. */
  unrecognizedPayoutMessages: string[];
  pool?: PoolSummary;
}

export function buildLedgerReport(db: DB): LedgerReport {
  const settings = getSettings(db);
  const items = listItems(db);
  const itemCost = new Map(items.map((i) => [i.id, i.unitCostCents]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const giveawayUnit = new Map(
    listGiveawayItems(db).map((g) => [g.id, g.packCostCents / g.packQty])
  );
  const resolvedCache = new Map<string, number | null>();
  const resolve = (name: string): number | null => {
    if (!resolvedCache.has(name)) resolvedCache.set(name, resolveItemId(db, name));
    return resolvedCache.get(name)!;
  };
  const pool = settings.costingMode === "pooled" ? computePoolCost(db, settings.avgMethod) : null;
  const txns = listLedgerTransactions(db);
  const byShow = new Map<number, typeof txns>();
  for (const t of txns) {
    if (!byShow.has(t.showId)) byShow.set(t.showId, []);
    byShow.get(t.showId)!.push(t);
  }

  const unmapped = new Set<string>();
  const unrecognizedPayouts = new Set<string>();
  const shows: ReportShow[] = [];

  const allShows = listShows(db);

  // Labor resolves live at report time, like COGS through the alias map --
  // nothing is stored per show, so editing a shift reflows every report.
  const labor = allocateLabor(
    listPayroll(db).map((p) => ({ workDate: p.workDate, amountCents: p.amountCents })),
    allShows.map((s) => ({ id: s.id, showDate: s.showDate, sessionSeq: s.sessionSeq })),
  );
  const dateCounts = new Map<string, number>();
  for (const s of allShows) dateCounts.set(s.showDate, (dateCounts.get(s.showDate) ?? 0) + 1);

  for (const s of allShows) {
    const rows = byShow.get(s.id) ?? [];
    const productMap = new Map<string, ReportProductLine>();
    const bundleLines: ReportProductLine[] = [];
    const pooledSales: ReportPooledSale[] = [];
    const componentsByTxn = getBundleComponentsByTxn(db, s.id);
    let giveaway = 0, giveawayCount = 0, tip = 0, bonus = 0, other = 0, payout = 0, withdrawn = 0, saleCount = 0, payoutFailure = 0;

    for (const t of rows) {
      if (t.kind === "payout") {
        withdrawn += t.amountCents;
        // A returned payout still nets to zero against its withdrawal; tracked
        // separately only so the UI can say the money never reached the bank.
        if (isPayoutFailure(t.message ?? "")) payoutFailure += t.amountCents;
        continue;
      }
      if (unrecognizedPayoutMessage(t.txnType ?? "", t.message ?? "")) unrecognizedPayouts.add(t.message!);
      payout += t.amountCents;
      if (t.kind === "sale") saleCount += 1;
      if (pool && t.kind === "sale") {
        pooledSales.push({
          amountCents: t.amountCents,
          costCents: pool.costBySaleTxnId.get(t.id) ?? 0,
          createdAt: t.createdAt,
        });
      } else if (t.kind === "sale" && componentsByTxn.has(t.id)) {
        const comps = componentsByTxn.get(t.id)!;
        const components = comps.map((c) => {
          const unitCostCents = itemCost.get(c.itemId) ?? 0;
          return { name: itemName.get(c.itemId) ?? "?", qty: c.qty, unitCostCents, costCents: unitCostCents * c.qty };
        });
        const costCents = components.reduce((sum, c) => sum + c.costCents, 0);
        bundleLines.push({
          productName: t.productName ?? "Bundle", itemId: null, mapped: true,
          unitCostCents: null, qty: 1, costCents, revenueCents: t.amountCents,
          profitCents: t.amountCents - costCents, isBundle: true, components,
        });
      } else if (t.kind === "sale" && t.productName) {
        let line = productMap.get(t.productName);
        if (!line) {
          const itemId = resolve(t.productName); // live resolution (memoized per build)
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
        line.costCents += line.unitCostCents ?? 0;
        line.profitCents = line.revenueCents - line.costCents;
      } else if (t.kind === "giveaway") { giveaway += t.amountCents; giveawayCount += 1; }
      else if (t.kind === "tip") tip += t.amountCents;
      else if (t.kind === "bonus") bonus += t.amountCents;
      else if (t.kind === "other") other += t.amountCents;
    }

    const products = pool ? [] : [...productMap.values(), ...bundleLines].sort((a, b) => a.productName.localeCompare(b.productName));
    const unitsSold = pool ? saleCount : products.reduce((sum, p) => sum + p.qty, 0);
    const cogsCents = pool ? pooledSales.reduce((sum, ps) => sum + ps.costCents, 0) : products.reduce((sum, p) => sum + p.costCents, 0);
    // Each giveaway costs us a unit of merchandise computed from per-show allocations.
    // This is a real cost NOT present in the ledger (the ledger only has Whatnot's small fee).
    const allocs = getAllocations(db, s.id);
    const giveawayCostCents = Math.round(
      allocs.reduce((sum, a) => sum + a.count * (giveawayUnit.get(a.giveawayItemId) ?? 0), 0)
    );
    const giveawayUnallocated = giveawayCount > 0 && allocs.length === 0;
    const laborCents = labor.byShowId.get(s.id) ?? 0;
    const netCents = payout - cogsCents - giveawayCostCents - s.shippingSuppliesCents - laborCents;
    const times = rows.map((t) => ledgerTimeOfDaySeconds(t.createdAt));
    const timeRange = times.length
      ? `${secondsToClock(Math.min(...times))}–${secondsToClock(Math.max(...times))}`
      : "";
    shows.push({
      showId: s.id, showDate: s.showDate,
      sessionSeq: s.sessionSeq,
      timeRange,
      dateHasMultipleSessions: (dateCounts.get(s.showDate) ?? 0) > 1,
      products,
      pooledSales: pool ? pooledSales : undefined,
      giveawayTotalCents: giveaway, giveawayCount, giveawayCostCents, giveawayUnallocated,
      tipTotalCents: tip, bonusTotalCents: bonus, otherTotalCents: other,
      payoutCents: payout, withdrawnToBankCents: withdrawn, payoutFailureCents: payoutFailure, cogsCents, shippingSuppliesCents: s.shippingSuppliesCents, laborCents, netCents, unitsSold, saleCount,
    });
  }

  // build wholesale rollup
  const saleInvoices = db.prepare(
    "SELECT id, customer, paid FROM invoices WHERE direction='sale' AND status='posted' ORDER BY id DESC"
  ).all() as { id: number; customer: string | null; paid: number }[];
  const wholesaleInvoices = saleInvoices.map((inv) => {
    const lines = db.prepare("SELECT item_id AS itemId, quantity, unit_price_cents AS price FROM invoice_lines WHERE invoice_id = ? AND kind = 'item'").all(inv.id) as { itemId: number; quantity: number; price: number }[];
    let qty = 0, revenue = 0, cogs = 0;
    for (const l of lines) { qty += l.quantity; revenue += l.quantity * (l.price ?? 0); cogs += l.quantity * (itemCost.get(l.itemId) ?? 0); }
    return { invoiceId: inv.id, number: invoiceNumber(inv.id), customer: inv.customer, paid: !!inv.paid, qty, revenueCents: revenue, cogsCents: cogs, profitCents: revenue - cogs };
  });
  const paidWholesale = wholesaleInvoices.filter((w) => w.paid);
  const wholesale: WholesaleRollup = {
    invoices: wholesaleInvoices,
    paidRevenueCents: paidWholesale.reduce((s, w) => s + w.revenueCents, 0),
    paidCogsCents: paidWholesale.reduce((s, w) => s + w.cogsCents, 0),
    paidProfitCents: paidWholesale.reduce((s, w) => s + w.profitCents, 0),
    owedToYouCents: wholesaleInvoices.filter((w) => !w.paid).reduce((s, w) => s + w.revenueCents, 0),
  };

  let revenueCents = shows.reduce((sum, s) => sum + (pool
    ? (s.pooledSales ?? []).reduce((a, ps) => a + ps.amountCents, 0)
    : s.products.reduce((a, p) => a + p.revenueCents, 0)), 0);
  let cogsCents = shows.reduce((sum, s) => sum + s.cogsCents, 0);
  const giveawayCostCents = shows.reduce((sum, s) => sum + s.giveawayCostCents, 0);
  const shippingSuppliesCents = shows.reduce((sum, s) => sum + s.shippingSuppliesCents, 0);
  const laborCents = shows.reduce((sum, s) => sum + s.laborCents, 0);
  let netCents = shows.reduce((sum, s) => sum + s.netCents, 0);
  const withdrawnToBankCents = shows.reduce((sum, s) => sum + s.withdrawnToBankCents, 0);
  const payoutFailureCents = shows.reduce((sum, s) => sum + s.payoutFailureCents, 0);
  let unitsSold = shows.reduce((sum, s) => sum + s.unitsSold, 0);

  // fold ONLY paid wholesale into the grand totals
  revenueCents += wholesale.paidRevenueCents;
  cogsCents += wholesale.paidCogsCents;
  netCents += wholesale.paidProfitCents;
  unitsSold += paidWholesale.reduce((s, w) => s + w.qty, 0);

  const { ownerShareCents, partnerShareCents } = splitProfit(netCents, settings.ownerSharePct);

  const poolSummary: PoolSummary | undefined = pool
    ? {
        currentAvgUnitCostCents: pool.currentAvgUnitCostCents,
        totalUnitsPurchased: pool.totalUnitsPurchased,
        totalSaleCount: pool.totalSaleCount,
        unitsOnHand: pool.totalUnitsPurchased - pool.totalSaleCount,
        valueOnHandCents: (pool.totalUnitsPurchased - pool.totalSaleCount) * pool.currentAvgUnitCostCents,
      }
    : undefined;

  return {
    shows,
    giveawayUnitCents: settings.giveawayUnitCents,
    totals: { revenueCents, cogsCents, giveawayCostCents, shippingSuppliesCents, laborCents, unallocatedLaborCents: labor.unallocatedCents, netCents, ownerShareCents, partnerShareCents, withdrawnToBankCents, payoutFailureCents, unitsSold },
    wholesale,
    unrecognizedPayoutMessages: [...unrecognizedPayouts].sort(),
    unmappedNames: [...unmapped].sort(),
    unmappedCount: unmapped.size,
    pool: poolSummary,
  };
}
