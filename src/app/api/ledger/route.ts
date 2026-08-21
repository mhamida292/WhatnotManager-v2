import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { parseLedger } from "@/lib/csv/ledger";
import { saveLedger } from "@/lib/db/ledger";

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  const result = saveLedger(await dbForRequest(), parseLedger(csvText));
  return NextResponse.json(result);
}
