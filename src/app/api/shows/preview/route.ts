import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { buildPreview } from "@/lib/csv/preview";

export async function POST(req: NextRequest) {
  const csvText = await req.text();
  return NextResponse.json(buildPreview(await dbForRequest(), csvText));
}
