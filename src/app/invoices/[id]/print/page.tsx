import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { getSettings } from "@/lib/db/settings";
import { InvoiceDocument } from "@/components/InvoiceDocument";

export const dynamic = "force-dynamic";

export default async function InvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const invoice = getInvoice(db, id);
  if (!invoice) return <p className="p-8">Invoice not found.</p>;
  return (
    <div className="mx-auto max-w-2xl bg-white p-8">
      <InvoiceDocument invoice={invoice} lines={listInvoiceLines(db, id)} businessName={getSettings(db).businessName} />
      <p className="mt-8 text-xs text-slate-400">Use your browser's print (Ctrl/Cmd+P) to save as PDF.</p>
    </div>
  );
}
