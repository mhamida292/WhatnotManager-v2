import { Money } from "@/components/Money";
import { longDate } from "@/lib/format-date";
import type { Invoice, InvoiceLine } from "@/lib/db/invoices";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium text-slate-800">{value}</div>
    </div>
  );
}

/** Read-only, branding-free invoice document. Direction-aware:
 *  - purchase: "Purchase Invoice", From (supplier) / To (business), unit cost column.
 *  - sale: "Invoice", From (business) / To (customer), unit price column + PAID marker.
 *  Shows a DRAFT marker when not posted. Used by the posted view and the print page. */
export function InvoiceDocument({ invoice, lines, businessName }: {
  invoice: Invoice; lines: InvoiceLine[]; businessName: string | null;
}) {
  const isSale = invoice.direction === "sale";
  const total = lines.reduce(
    (s, l) => s + l.quantity * (isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents),
    0,
  );
  const itemLines = lines.filter((l) => l.kind !== "charge");
  const units = itemLines.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="space-y-6 text-slate-800">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{isSale ? "Invoice" : "Purchase Invoice"}</h1>
        <span className="text-xl font-semibold text-slate-500">{invoice.number}</span>
        {invoice.status === "draft" && (
          <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">Draft</span>
        )}
        {isSale && invoice.paid && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">Paid</span>
        )}
      </div>

      <div className="flex flex-wrap gap-8">
        {isSale ? (
          <>
            <Field label="From (you)" value={businessName ?? "—"} />
            <Field label="To (customer)" value={invoice.customer ?? "—"} />
          </>
        ) : (
          <>
            <Field label="From (supplier)" value={invoice.supplier ?? "—"} />
            <Field label="To" value={businessName ?? "—"} />
          </>
        )}
        <Field label="Date" value={longDate(invoice.invoiceDate)} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="border-b-2 border-slate-800 py-1.5">Product</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">Qty</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">{isSale ? "Unit price" : "Unit cost"}</th>
            <th className="border-b-2 border-slate-800 py-1.5 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) =>
            l.kind === "charge" ? (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2">{l.displayName}</td>
                <td className="py-2 text-right tabular-nums"></td>
                <td className="py-2 text-right tabular-nums"></td>
                <td className="py-2 text-right tabular-nums">
                  <Money cents={isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents} />
                </td>
              </tr>
            ) : (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2">{l.displayName}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">
                  <Money cents={isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents} />
                </td>
                <td className="py-2 text-right tabular-nums">
                  <Money cents={l.quantity * (isSale ? (l.unitPriceCents ?? 0) : l.unitCostCents)} />
                </td>
              </tr>
            ),
          )}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className="border-t-2 border-slate-800 py-2.5" colSpan={3}>Total</td>
            <td className="border-t-2 border-slate-800 py-2.5 text-right tabular-nums"><Money cents={total} /></td>
          </tr>
          <tr>
            <td className="pt-1 text-sm text-slate-500" colSpan={4}>
              {units} {units === 1 ? "unit" : "units"} across {itemLines.length} {itemLines.length === 1 ? "product" : "products"}
            </td>
          </tr>
        </tfoot>
      </table>

      {invoice.notes && <p className="text-sm text-slate-500">{invoice.notes}</p>}
    </div>
  );
}
