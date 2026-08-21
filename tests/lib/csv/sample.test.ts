import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "@/lib/csv/parse";
import { classifyRows } from "@/lib/csv/classify";

describe("real sample show", () => {
  const text = readFileSync(resolve(__dirname, "../../fixtures/sample-show.csv"), "utf8");
  const rows = classifyRows(parseCsv(text));

  it("parses 60 data rows", () => {
    expect(rows).toHaveLength(60);
  });
  it("finds 7 giveaways", () => {
    expect(rows.filter((r) => r.status === "giveaway")).toHaveLength(7);
  });
  it("finds 4 cancelled/failed", () => {
    expect(rows.filter((r) => r.status === "cancelled" || r.status === "failed")).toHaveLength(4);
  });
  it("every cancelled/failed row has no shipment id", () => {
    for (const r of rows.filter((r) => r.status === "cancelled" || r.status === "failed")) {
      expect(r.shipmentId).toBe("");
    }
  });
  it("finds 6 suspected duplicates", () => {
    expect(rows.filter((r) => r.status === "suspected_duplicate")).toHaveLength(6);
  });
});
