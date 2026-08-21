import type { DB } from "@/lib/db/connection";
import { parseCsv } from "@/lib/csv/parse";
import { classifyRows } from "@/lib/csv/classify";
import { unmappedNames } from "@/lib/db/aliases";
import type { ClassifiedRow } from "@/lib/csv/types";

export interface PreviewResult { rows: ClassifiedRow[]; unmapped: string[]; }

export function buildPreview(db: DB, csvText: string): PreviewResult {
  const rows = classifyRows(parseCsv(csvText));
  const sellable = rows.filter((r) => r.status !== "giveaway").map((r) => r.productName);
  const unmapped = unmappedNames(db, sellable);
  return { rows, unmapped };
}
