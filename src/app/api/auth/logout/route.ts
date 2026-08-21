import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/request";

export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
