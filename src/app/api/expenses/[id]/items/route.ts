import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { replaceExpenseItems } from "@/lib/db/expense-items";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const b = await req.json();
  const raw: unknown[] = Array.isArray(b.items) ? b.items : [];
  const items = raw.map((it) => {
    const i = it as { name?: unknown; qty?: unknown; unit?: unknown };
    const qtyNum = i.qty === "" || i.qty == null ? null : Number(i.qty);
    const unitNum = i.unit === "" || i.unit == null ? null : Math.round(Number(i.unit) * 100);
    return {
      name: typeof i.name === "string" ? i.name : "",
      qty: qtyNum != null && Number.isFinite(qtyNum) ? qtyNum : null,
      unitCents: unitNum != null && Number.isFinite(unitNum) ? unitNum : null,
    };
  });
  replaceExpenseItems(await dbForRequest(), id, items);
  return NextResponse.json({ ok: true });
}
