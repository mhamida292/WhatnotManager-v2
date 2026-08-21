import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { addInvoiceLine, addInvoiceCharge, updateInvoiceLine, deleteInvoiceLine } from "@/lib/db/invoices";

const qtyOk = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1;
const costOk = (v: unknown) => Number.isFinite(Number(v)) && Number(v) >= 0;
const itemIdOf = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const invoiceId = Number((await params).id);
  const b = await req.json();
  if (b.kind === "charge") {
    if (typeof b.name !== "string" || !b.name.trim() || !Number.isFinite(Number(b.amountCents)) || Number(b.amountCents) === 0)
      return NextResponse.json({ error: "Invalid charge" }, { status: 400 });
    try {
      const id = addInvoiceCharge(await dbForRequest(), { invoiceId, name: b.name.trim(), amountCents: Math.trunc(Number(b.amountCents)) });
      return NextResponse.json({ id });
    } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
  }
  if (typeof b.productName !== "string" || !b.productName.trim() || !qtyOk(b.quantity) || !costOk(b.unitCostCents))
    return NextResponse.json({ error: "Invalid line" }, { status: 400 });
  try {
    const id = addInvoiceLine(await dbForRequest(), {
      invoiceId, itemId: itemIdOf(b.itemId), productName: b.productName.trim(),
      quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
      unitPriceCents: Number.isFinite(Number(b.unitPriceCents)) ? Math.trunc(Number(b.unitPriceCents)) : null,
    });
    return NextResponse.json({ id });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!Number.isInteger(Number(b.id)) || typeof b.productName !== "string" || !b.productName.trim() || !qtyOk(b.quantity) || !costOk(b.unitCostCents))
    return NextResponse.json({ error: "Invalid line" }, { status: 400 });
  try {
    updateInvoiceLine(await dbForRequest(), Number(b.id), {
      itemId: itemIdOf(b.itemId), productName: b.productName.trim(),
      quantity: Math.trunc(Number(b.quantity)), unitCostCents: Math.trunc(Number(b.unitCostCents)),
      unitPriceCents: Number.isFinite(Number(b.unitPriceCents)) ? Math.trunc(Number(b.unitPriceCents)) : null,
    });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}

export async function DELETE(req: NextRequest) {
  const b = await req.json();
  if (!Number.isInteger(Number(b.id))) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    deleteInvoiceLine(await dbForRequest(), Number(b.id));
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Posted invoice is locked" }, { status: 409 }); }
}
