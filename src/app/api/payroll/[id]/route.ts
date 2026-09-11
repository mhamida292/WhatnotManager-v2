import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { deletePayroll, getPayroll, updatePayroll } from "@/lib/db/payroll";
import { parsePayrollInput } from "@/lib/calc/payroll-amount";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const parsed = parsePayrollInput(await req.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const db = await dbForRequest();
  if (!getPayroll(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  updatePayroll(db, id, parsed.value);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deletePayroll(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
