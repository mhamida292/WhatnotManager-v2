import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { seenProductNames } from "@/lib/db/aliases";

export async function GET() {
  return NextResponse.json(seenProductNames(await dbForRequest()));
}
