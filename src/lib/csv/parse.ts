import Papa from "papaparse";
import { toCents } from "@/lib/money";
import type { RawRow } from "./types";

export function parseCsv(text: string): RawRow[] {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return data.map((r) => ({
    buyerUsername: (r.buyer_username ?? "").trim(),
    productName: (r.product_name ?? "").trim(),
    quantity: Number(r.product_quantity ?? "0") || 0,
    priceCents: toCents(Number(r.original_item_price ?? "0") || 0),
    cancelledOrFailed: (r.cancelled_or_failed ?? "").trim(),
    shipmentId: (r.shipment_id ?? "").trim(),
    giftedTo: (r.gifted_to ?? "").trim(),
  }));
}
