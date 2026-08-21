import { NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { exportWorkbook } from "@/lib/backup/workbook";

export async function GET() {
  try {
    const buf = await exportWorkbook(await dbForRequest());
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="whatnot-backup-${date}.xlsx"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Export failed: ${e instanceof Error ? e.message : e}` }, { status: 500 });
  }
}
