import type { DB } from "@/lib/db/connection";
import { parseLedger, type LedgerRow } from "@/lib/csv/ledger";
import { unmappedNames } from "@/lib/db/aliases";

export interface LedgerPreviewShow {
  showDate: string;
  payoutCents: number;
  saleCount: number;
  giveawayCount: number;
  tipCount: number;
  bonusCount: number;
  payoutCount: number;
  otherCount: number;
}

export interface LedgerPreview {
  rows: LedgerRow[];
  shows: LedgerPreviewShow[];
  unmapped: string[];
}

export function buildLedgerPreview(db: DB, csvText: string): LedgerPreview {
  const rows = parseLedger(csvText);
  const byDate = new Map<string, LedgerPreviewShow>();
  for (const r of rows) {
    let s = byDate.get(r.showDate);
    if (!s) {
      s = { showDate: r.showDate, payoutCents: 0, saleCount: 0, giveawayCount: 0, tipCount: 0, bonusCount: 0, payoutCount: 0, otherCount: 0 };
      byDate.set(r.showDate, s);
    }
    if (r.kind !== "payout") s.payoutCents += r.amountCents;
    if (r.kind === "sale") s.saleCount++;
    else if (r.kind === "giveaway") s.giveawayCount++;
    else if (r.kind === "tip") s.tipCount++;
    else if (r.kind === "bonus") s.bonusCount++;
    else if (r.kind === "payout") s.payoutCount++;
    else s.otherCount++;
  }
  const saleNames = rows.filter((r) => r.kind === "sale" && r.productName).map((r) => r.productName as string);
  const unmapped = unmappedNames(db, saleNames);
  const shows = [...byDate.values()].sort((a, b) => a.showDate.localeCompare(b.showDate));
  return { rows, shows, unmapped };
}
