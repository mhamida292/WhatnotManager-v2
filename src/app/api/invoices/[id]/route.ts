import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, listInvoiceLines, updateInvoice, deleteInvoice } from "@/lib/db/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const invoice = getInvoice(db, id);
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ invoice, lines: listInvoiceLines(db, id) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const db = await dbForRequest();
  const inv = getInvoice(db, id);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (inv.status !== "draft") return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 });
  const b = await req.json().catch(() => ({}));
  updateInvoice(db, id, {
    supplier: typeof b.supplier === "string" ? b.supplier : null,
    customer: typeof b.customer === "string" ? b.customer : null,
    invoiceDate: typeof b.invoiceDate === "string" ? b.invoiceDate : null,
    notes: typeof b.notes === "string" ? b.notes : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deleteInvoice(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
