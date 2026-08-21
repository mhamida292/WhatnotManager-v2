import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { insertExpense, listExpenses } from "@/lib/db/expenses";

export async function GET() {
  return NextResponse.json(listExpenses(await dbForRequest()));
}
export async function POST(req: NextRequest) {
  const b = await req.json();
  const id = insertExpense(await dbForRequest(), {
    description: b.description, type: b.type, category: b.category ?? null,
    amountCents: b.amountCents, incurredOn: b.incurredOn ?? null,
    paidBy: b.paidBy ?? null, reimbursable: b.reimbursable ? 1 : 0,
  });
  return NextResponse.json({ id });
}
