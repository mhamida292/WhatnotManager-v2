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
  const id = insertPayroll(await dbForRequest(), {
    person, periodStart: b.periodStart || null, periodEnd: b.periodEnd || null,
    hours: b.hours == null || b.hours === "" ? null : Number(b.hours),
    rateCents: b.rateCents == null || b.rateCents === "" ? null : Math.trunc(Number(b.rateCents)),
    amountCents: Math.trunc(Number(b.amountCents)), note: b.note ?? null,
  });
  return NextResponse.json({ id });
}
