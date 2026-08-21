import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { bulkDeleteImpact } from "@/lib/db/inventory";

export async function POST(req: NextRequest) {
  const b = await req.json();
  const ids: unknown = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "ids must be a non-empty array of integers" }, { status: 400 });
  }
  return NextResponse.json(bulkDeleteImpact(await dbForRequest(), ids as number[]));
}
