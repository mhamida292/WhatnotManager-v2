import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { workspaceCounts } from "@/lib/backup/workbook";

export async function GET() {
  return NextResponse.json({ counts: workspaceCounts(await dbForRequest()) });
}
