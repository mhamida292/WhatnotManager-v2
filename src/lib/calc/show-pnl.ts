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
