import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerPreview } from "@/lib/csv/ledger-preview";

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  return NextResponse.json(buildLedgerPreview(await dbForRequest(), csvText));
}
