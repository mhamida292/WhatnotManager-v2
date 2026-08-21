import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { postInvoice, unpostInvoice } from "@/lib/db/invoices";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const body = await req.json().catch(() => ({}));
  try {
    postInvoice(await dbForRequest(), id, Array.isArray(body?.resolutions) ? body.resolutions : []);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cannot post" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  unpostInvoice(await dbForRequest(), id);
  return NextResponse.json({ ok: true });
}
