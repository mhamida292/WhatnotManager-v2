import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { buildLedgerReport } from "@/lib/calc/ledger-report";

export async function GET() {
  return NextResponse.json(buildLedgerReport(await dbForRequest()));
}
