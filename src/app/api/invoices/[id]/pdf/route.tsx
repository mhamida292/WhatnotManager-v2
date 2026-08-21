import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, listInvoiceLines } from "@/lib/db/invoices";
import { getSettings } from "@/lib/db/settings";
import { invoicePdfModel } from "@/lib/pdf/invoice-model";
import { InvoicePdf } from "@/components/pdf/InvoicePdf";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const invoice = getInvoice(db, id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const model = invoicePdfModel(invoice, listInvoiceLines(db, id), getSettings(db));
  const buffer = await renderToBuffer(<InvoicePdf model={model} />);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
    },
  });
}
