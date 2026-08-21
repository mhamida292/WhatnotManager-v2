import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { dashboardSummary } from "@/lib/calc/dashboard";

export async function GET() {
  return NextResponse.json(dashboardSummary(await dbForRequest()));
}
