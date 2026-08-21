import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { importWorkbook, BackupError } from "@/lib/backup/workbook";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const { counts, legacy, skipped } = await importWorkbook(await dbForRequest(), buf);
    return NextResponse.json({ ok: true, counts, legacy, skipped });
  } catch (e) {
    if (e instanceof BackupError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `Restore failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
