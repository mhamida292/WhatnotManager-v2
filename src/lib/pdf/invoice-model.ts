import type { Invoice, InvoiceLine } from "@/lib/db/invoices";
import type { Settings } from "@/lib/db/settings";
import { longDate } from "@/lib/format-date";

export interface InvoicePdfModel {
  heading: string;
  number: string;
  partyLabel: string;
  partyValue: string;
  date: string;
  unitLabel: string;
  lines: { qty: number; description: string; unitCents: number; amountCents: number }[];
  totalCents: number;
  totalPieces: number;
  contact: string[];
}

/** Pure, direction-aware view-model for the invoice PDF. */
export function invoicePdfModel(invoice: Invoice, lines: InvoiceLine[], settings: Settings): InvoicePdfModel {
  const isSale = invoice.direction === "sale";
  const modelLines = lines.map((l) => {
    const unitCents = isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents;
    if (l.kind === "charge") {
      // Charges/deductions are a single signed amount with no meaningful qty/unit
      // breakdown. The PDF table has no blank-cell support, so qty is shown as 1
      // and the unit column mirrors the (signed) amount; the amount/total are exact.
      return { qty: 1, description: l.displayName, unitCents, amountCents: unitCents };
    }
    return { qty: l.quantity, description: l.displayName, unitCents, amountCents: l.quantity * unitCents };
  });
  const contact: string[] = [];
  if (settings.invoiceShowPhone && settings.invoicePhone) contact.push(settings.invoicePhone);
  if (settings.invoiceShowAddress && settings.invoiceAddress) contact.push(settings.invoiceAddress);
  if (settings.invoiceShowEmail && settings.invoiceEmail) contact.push(settings.invoiceEmail);
  return {
    heading: isSale ? "INVOICE" : "PURCHASE INVOICE",
    number: `No. ${invoice.number}`,
    partyLabel: isSale ? "SOLD TO" : "SUPPLIER",
    partyValue: (isSale ? invoice.customer : invoice.supplier) ?? "",
    date: longDate(invoice.invoiceDate),
    unitLabel: isSale ? "Unit price" : "Unit cost",
    lines: modelLines,
    totalCents: modelLines.reduce((s, l) => s + l.amountCents, 0),
    totalPieces: lines.reduce((s, l) => s + (l.kind === "charge" ? 0 : l.quantity), 0),
    contact,
  };
}
