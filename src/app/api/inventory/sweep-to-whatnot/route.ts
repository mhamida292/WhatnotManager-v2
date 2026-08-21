import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { sweepWarehouseToWhatnot } from "@/lib/db/inventory";

export async function POST() {
  const db = await dbForRequest();
  try {
    return NextResponse.json(sweepWarehouseToWhatnot(db));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
