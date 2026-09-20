import Link from "next/link";
import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { listItems } from "@/lib/db/inventory";
import { getSettings } from "@/lib/db/settings";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { InvoiceEditor } from "@/components/InvoiceEditor";
import { InvoiceDocument } from "@/components/InvoiceDocument";
import { InvoiceActions } from "@/components/InvoiceActions";
import { Stat } from "@/components/ui/Stat";
import { Money } from "@/components/Money";
import { invoiceAverages } from "@/lib/calc/invoice-averages";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const invoice = getInvoice(db, id);
  if (!invoice) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Invoice not found</h1>
        <Link className="text-emerald-700 hover:underline" href="/invoices">← Invoices</Link>
      </div>
    );
  }
  const lines = listInvoiceLines(db, id);
  const items = listItems(db).map((i) => ({ id: i.id, name: i.name }));
  const businessName = getSettings(db).businessName;

  const isSale = invoice.direction === "sale";
  // Page-only figures: deliberately outside InvoiceDocument, which the print
  // page and the PDF render as the document the supplier/customer sees.
  const avg = invoiceAverages(lines, invoice.direction);
  const subtitle =
    invoice.status === "draft"
      ? isSale
        ? "Draft — add lines, then Post to record the sale"
        : "Draft — add lines, then Post to stock inventory"
      : isSale
        ? "Posted sale"
        : "Posted to inventory";

  return (
    <div className="space-y-6">
      <PageHeader title={invoice.number}
        subtitle={subtitle}
        action={<Link className="text-sm text-emerald-700 hover:underline" href="/invoices">← Invoices</Link>} />

      <InvoiceActions id={invoice.id} status={invoice.status} canPost={lines.length > 0} paid={invoice.paid} items={items} />

      {avg.avgItemCents != null && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Units" value={avg.units} sub={<><Money cents={avg.itemCents} /> of merchandise</>} />
          <Stat label={isSale ? "Avg price / unit" : "Avg cost / unit"} value={<Money cents={avg.avgItemCents} />}
            sub="Item lines only" />
          <Stat label="With charges" value={<Money cents={avg.avgLandedCents!} />}
            sub={avg.chargeCents === 0
              ? "No charge lines"
              : <><Money cents={avg.chargeCents} /> in charges spread over {avg.units} units</>} />
        </div>
      )}

      <Card title={invoice.status === "draft" ? "Edit invoice" : "Invoice"}>
        {invoice.status === "draft"
          ? <InvoiceEditor invoice={invoice} lines={lines} items={items} />
          : <InvoiceDocument invoice={invoice} lines={lines} businessName={businessName} />}
      </Card>
    </div>
  );
}
