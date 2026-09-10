import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { getPayroll, setPayrollPaid } from "@/lib/db/payroll";

/** Paid state moves on its own endpoint so an ordinary edit of an entry can
 *  never clear the date it was settled on. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = await req.json() as { paidOn?: unknown };
  const raw = body.paidOn;
  const paidOn = raw == null ? null : String(raw).trim();
  if (paidOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) {
    return NextResponse.json({ error: "Paid date must be YYYY-MM-DD" }, { status: 400 });
  }
  const db = await dbForRequest();
  if (!getPayroll(db, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  setPayrollPaid(db, id, paidOn);
  return NextResponse.json({ ok: true });
}
