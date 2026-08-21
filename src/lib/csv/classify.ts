import type { RawRow, ClassifiedRow, RowStatus } from "./types";

/** Strip the trailing " #N" listing suffix to get the product's base name. */
export function baseProductName(name: string): string {
  return name.replace(/\s*#\d+\s*$/, "").trim();
}

function baseStatus(r: RawRow): RowStatus {
  if (/GIFTCARD GIVVY/i.test(r.productName)) return "giveaway";
  const flag = r.cancelledOrFailed.toLowerCase();
  if (flag === "cancelled") return "cancelled";
  if (flag === "failed") return "failed";
  if (flag) return "cancelled"; // any other non-empty flag => treat as not sold
  return r.shipmentId ? "confirmed" : "cancelled";
}

export function classifyRows(rows: RawRow[]): ClassifiedRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    let status = baseStatus(r);
    if (status === "confirmed") {
      const key = `${r.buyerUsername}|${baseProductName(r.productName)}|${r.priceCents}`;
      if (seen.has(key)) status = "suspected_duplicate";
      else seen.add(key);
    }
    return { ...r, status };
  });
}
