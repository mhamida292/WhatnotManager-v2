import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertPayroll, listPayroll } from "@/lib/db/payroll";
import { parseShiftInput } from "@/lib/calc/payroll-amount";
import { rangeFromParams } from "@/lib/ui/expense-range";

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  return NextResponse.json(listPayroll(await dbForRequest(), rangeFromParams(sp)));
}

export async function POST(req: NextRequest) {
  const parsed = parseShiftInput(await req.json());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const id = insertPayroll(await dbForRequest(), parsed.value);
  return NextResponse.json({ id });
}
