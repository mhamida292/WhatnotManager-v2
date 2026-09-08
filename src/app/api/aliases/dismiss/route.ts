import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { dismissProductName, restoreProductName } from "@/lib/db/dismissed-names";

/** A blank name would normalize to an empty code and dismiss nothing while
 *  reporting success, so it is rejected rather than silently accepted. */
function nameFrom(b: unknown): string | null {
  const n = typeof (b as { productName?: unknown })?.productName === "string"
    ? ((b as { productName: string }).productName).trim() : "";
  return n === "" ? null : n;
}

export async function POST(req: NextRequest) {
  const productName = nameFrom(await req.json());
  if (!productName) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  dismissProductName(await dbForRequest(), productName);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const productName = nameFrom(await req.json());
  if (!productName) return NextResponse.json({ error: "Product name is required" }, { status: 400 });
  restoreProductName(await dbForRequest(), productName);
  return NextResponse.json({ ok: true });
}
