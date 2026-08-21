import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { getInvoice, setInvoicePaid } from "@/lib/db/invoices";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json().catch(() => ({}));
  if (typeof b.paid !== "boolean") return NextResponse.json({ error: "paid must be boolean" }, { status: 400 });
  const db = await dbForRequest();
  const inv = getInvoice(db, id);
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 400 });
  try {
    setInvoicePaid(db, id, b.paid, typeof b.paidOn === "string" ? b.paidOn : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cannot update paid status" }, { status: 400 });
  }
}
