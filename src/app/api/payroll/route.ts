import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";

export async function GET() {
  return NextResponse.json(listPayroll(await dbForRequest()));
}
export async function POST(req: NextRequest) {
  const b = await req.json();
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return NextResponse.json({ error: "Person is required" }, { status: 400 });
  if (!Number.isFinite(Number(b.amountCents))) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  // Fields are taken as given for now; Task 5 derives hours/amount server-side
  // from the shift and rejects a malformed or zero-length one.
  const id = insertPayroll(await dbForRequest(), {
    person,
    workDate: b.workDate ?? "",
    startTime: b.startTime ?? "",
    endTime: b.endTime ?? "",
    hours: Number(b.hours) || 0,
    rateCents: Math.trunc(Number(b.rateCents)) || 0,
    amountCents: Math.trunc(Number(b.amountCents)), note: b.note ?? null,
  });
  return NextResponse.json({ id });
}
