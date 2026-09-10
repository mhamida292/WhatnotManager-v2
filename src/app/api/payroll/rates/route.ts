import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { listPayrollRates, setPayrollRate, deletePayrollRate } from "@/lib/db/payroll-rates";
import type { PayrollBasis } from "@/lib/db/payroll";

const BASES: PayrollBasis[] = ["hour", "piece", "package"];

export async function GET() {
  return NextResponse.json(listPayrollRates(await dbForRequest()));
}

export async function PUT(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>;
  const person = typeof b.person === "string" ? b.person.trim() : "";
  if (!person) return NextResponse.json({ error: "Person is required" }, { status: 400 });
  const basis = b.basis as PayrollBasis;
  if (!BASES.includes(basis)) return NextResponse.json({ error: "Basis must be hour, piece or package" }, { status: 400 });

  const db = await dbForRequest();
  const rateCents = b.rateCents == null ? 0 : Math.trunc(Number(b.rateCents));
  if (!Number.isFinite(rateCents) || rateCents < 0) {
    return NextResponse.json({ error: "Rate cannot be negative" }, { status: 400 });
  }
  // Clearing the field removes the default rather than saving a $0 one, which
  // would pre-fill an amount the form then refuses to submit.
  if (rateCents === 0) deletePayrollRate(db, person, basis);
  else setPayrollRate(db, person, basis, rateCents);
  return NextResponse.json({ ok: true });
}
