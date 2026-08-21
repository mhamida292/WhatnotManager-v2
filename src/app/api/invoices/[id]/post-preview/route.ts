import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { previewPurchasePost } from "@/lib/db/invoices";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  return NextResponse.json(previewPurchasePost(await dbForRequest(), id));
}
