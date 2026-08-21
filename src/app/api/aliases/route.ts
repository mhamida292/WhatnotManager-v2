import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { setAlias, removeAlias } from "@/lib/db/aliases";

export async function POST(req: NextRequest) {
  const { productName, itemId } = await req.json();
  setAlias(await dbForRequest(), productName, Number(itemId));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { aliasId } = await req.json();
  removeAlias(await dbForRequest(), Number(aliasId));
  return NextResponse.json({ ok: true });
}
