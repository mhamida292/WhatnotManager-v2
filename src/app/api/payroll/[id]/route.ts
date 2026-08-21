import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { deletePayroll } from "@/lib/db/payroll";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  deletePayroll(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
