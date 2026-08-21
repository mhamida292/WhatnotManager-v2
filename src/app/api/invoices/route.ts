import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { createInvoice, listInvoices } from "@/lib/db/invoices";

export async function GET() {
  return NextResponse.json(listInvoices(await dbForRequest()));
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const direction = b.direction === "sale" || b.direction === "purchase" ? b.direction : undefined;
  const id = createInvoice(await dbForRequest(), {
    ...(direction !== undefined ? { direction } : {}),
    supplier: typeof b.supplier === "string" ? b.supplier : null,
    customer: typeof b.customer === "string" ? b.customer : null,
    invoiceDate: typeof b.invoiceDate === "string" ? b.invoiceDate : null,
    notes: typeof b.notes === "string" ? b.notes : null,
  });
  return NextResponse.json({ id });
}
