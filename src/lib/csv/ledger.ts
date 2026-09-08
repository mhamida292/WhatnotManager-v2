import Papa from "papaparse";
import { toCents } from "@/lib/money";
import { baseProductName } from "@/lib/csv/classify";

export type LedgerKind = "sale" | "giveaway" | "bonus" | "tip" | "other" | "payout" | "refund";

export interface LedgerRow {
  createdAt: string;        // raw "Created Date" string
  showDate: string;         // YYYY-MM-DD
  amountCents: number;      // signed
  kind: LedgerKind;
  productName: string | null;
  listingId: string;
  orderId: string;
  message: string;
  status: string;
  txnType: string;
  dedupKey: string;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "Jun 12, 2026, 10:14:57 AM" -> "2026-06-12" without timezone drift. */
export function ledgerShowDate(createdDate: string): string {
  const m = createdDate.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return "";
  const [, mon, day, year] = m;
  const month = MONTHS[mon];
  if (!month) return "";
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

/** "Jun 12, 2026, 5:02:11 PM" -> seconds since midnight (timezone-safe, no Date). */
export function ledgerTimeOfDaySeconds(createdDate: string): number {
  const m = createdDate.match(/(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0;
  let hour = Number(m[1]) % 12;
  if (/PM/i.test(m[4])) hour += 12;
  return hour * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** "$0.49" / "-$0.78" / "$400.00" -> signed integer cents. */
export function parseAmountCents(amount: string): number {
  const neg = amount.trim().startsWith("-");
  const num = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  return toCents(num) * (neg ? -1 : 1);
}

/** A payout that bounced. Whatnot never marks the original PAYOUT row as failed --
 *  its Status stays 'completed' -- and returns the money days later as a separate
 *  ADJUSTMENT credit. Only the message links the two. */
const PAYOUT_FAILURE_RE = /payout\s+failure/i;

/** True for the ADJUSTMENT credit that returns a bounced payout's money. Stored as
 *  kind 'payout' so it cancels the withdrawal, but worth showing: a failed payout
 *  means money you expected in the bank never arrived. */
export function isPayoutFailure(message: string): boolean {
  return PAYOUT_FAILURE_RE.test(message ?? "");
}

/** An ADJUSTMENT that talks about a payout but matches no rule we know. Whatnot
 *  could reword "Payout failure refund" at any time, and the fallback for an
 *  unmatched adjustment is 'other', which counts as show revenue -- so a silent
 *  miss reads as profit. Callers surface these for a human to look at. */
export function unrecognizedPayoutMessage(txnType: string, message: string): boolean {
  if (txnType !== "ADJUSTMENT") return false;
  if (!/payout/i.test(message)) return false;
  return !PAYOUT_FAILURE_RE.test(message);
}

function classify(txnType: string, message: string): LedgerKind {
  if (txnType === "PAYOUT") return "payout";
  if (txnType === "TIP") return "tip";
  if (txnType === "ADJUSTMENT") {
    // Before the refund test, whose word this message contains: money returning
    // from a failed payout is a payout-line event, not a sale and not an order
    // refund. As 'payout' it cancels the original withdrawal and stays out of
    // show profit; as 'refund' it would be booked as revenue for that day.
    if (PAYOUT_FAILURE_RE.test(message)) return "payout";
    if (/refund/i.test(message)) return "refund";
    return /Sales Match Bonus/i.test(message) ? "bonus" : "other";
  }
  if (txnType === "SALES") {
    if (/giveaway/i.test(message)) return "giveaway";
    if (/Earnings for selling/i.test(message)) return "sale";
  }
  return "other";
}

/** "Earnings for selling a Highland Cow Squishy (Assorted Colors)  #3" -> base product name. */
function extractProductName(message: string): string | null {
  const m = message.match(/Earnings for selling an?\s+(.*)$/i);
  if (!m) return null;
  return baseProductName(m[1]);
}

/** Whatnot's per-stream sale sequence number from a message's trailing "#N"
 *  (e.g. "...On Screen Bundle! #10" -> "10"). null when there is no trailing #N. */
export function extractSaleNumber(message: string): string | null {
  const m = message.match(/#(\d+)\s*$/);
  return m ? m[1] : null;
}

export function parseLedger(text: string): LedgerRow[] {
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return data.map((r) => {
    const createdAt = (r["Created Date"] ?? "").trim();
    const amountCents = parseAmountCents(r["Amount"] ?? "");
    const message = (r["Message"] ?? "").trim();
    const txnType = (r["Transaction Type"] ?? "").trim();
    const kind = classify(txnType, message);
    const orderId = (r["Order ID"] ?? "").trim();
    const listingId = (r["Listing ID"] ?? "").trim();
    return {
      createdAt,
      showDate: ledgerShowDate(createdAt),
      amountCents,
      kind,
      productName: kind === "sale" ? extractProductName(message) : null,
      listingId,
      orderId,
      message,
      status: (r["Status"] ?? "").trim(),
      txnType,
      dedupKey: `${createdAt}|${amountCents}|${orderId}|${listingId}|${message}`,
    };
  });
}
