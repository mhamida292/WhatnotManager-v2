import { NextRequest, NextResponse } from "next/server";
import { dbForRequest } from "@/lib/auth/request";
import { archiveItems, unarchiveItems, deleteItems } from "@/lib/db/inventory";

const ACTIONS = ["archive", "unarchive", "delete"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const b = await req.json();
  const action = b.action as Action;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });
  const ids: unknown = b.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n))) {
    return NextResponse.json({ error: "ids must be a non-empty array of integers" }, { status: 400 });
  }
  const db = await dbForRequest();
  const list = ids as number[];
  if (action === "archive") archiveItems(db, list);
  else if (action === "unarchive") unarchiveItems(db, list);
  else deleteItems(db, list);
  return NextResponse.json({ ok: true });
}
