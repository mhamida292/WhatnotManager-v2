import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { updateExpense, deleteExpense, getExpense, setReimbursed } from "@/lib/db/expenses";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  const db = await dbForRequest();
  const existing = getExpense(db, id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (b.reimbursedOn !== undefined) {
    setReimbursed(db, id, b.reimbursedOn); // string date or null
    return NextResponse.json({ ok: true });
  }
  if (b.amount === "" || b.amount == null) return NextResponse.json({ error: "Amount required" }, { status: 400 });
  const amountCents = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(amountCents)) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  if (typeof b.description !== "string" || b.description.trim() === "")
    return NextResponse.json({ error: "Description required" }, { status: 400 });
  const type = b.type === "recurring" ? "recurring" : "one_time";
  updateExpense(db, id, {
    description: b.description.trim(), type,
    category: typeof b.category === "string" && b.category.trim() ? b.category.trim() : null,
    amountCents, incurredOn: typeof b.incurredOn === "string" && b.incurredOn ? b.incurredOn : null,
    paidBy: existing.paidBy, reimbursable: existing.reimbursable, reimbursedOn: existing.reimbursedOn,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deleteExpense(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
