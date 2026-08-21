export type RowStatus = "confirmed" | "cancelled" | "failed" | "giveaway" | "suspected_duplicate";

export interface RawRow {
  buyerUsername: string;
  productName: string;
  quantity: number;
  priceCents: number;
  cancelledOrFailed: string;
  shipmentId: string;
  giftedTo: string;
}

export interface ClassifiedRow extends RawRow {
  status: RowStatus;
}
