import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { resetApp } from "@/lib/db/admin";

export async function POST() {
  resetApp(await dbForRequest());
  return NextResponse.json({ ok: true });
}
