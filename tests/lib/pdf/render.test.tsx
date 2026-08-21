import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf } from "@/components/pdf/InvoicePdf";
import type { InvoicePdfModel } from "@/lib/pdf/invoice-model";

const model: InvoicePdfModel = {
  heading: "INVOICE",
  number: "No. INV-0007",
  partyLabel: "SOLD TO",
  partyValue: "FE Wholesale",
  date: "July 19, 2026",
  unitLabel: "Unit price",
  lines: [
    { qty: 6, description: "Booster Box — Surging Sparks", unitCents: 11000, amountCents: 66000 },
    { qty: 4, description: "Graded slab mystery", unitCents: 4500, amountCents: 18000 },
  ],
  totalCents: 84000,
  totalPieces: 10,
  contact: ["(313) 555-0142", "123 Warehouse Ave", "b@x.com"],
};

describe("InvoicePdf render", () => {
  it("renders a valid PDF buffer (single page)", async () => {
    const buf = await renderToBuffer(<InvoicePdf model={model} />);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a multi-page PDF when there are many line items", async () => {
    const many: InvoicePdfModel = {
      ...model,
      lines: Array.from({ length: 60 }, (_, i) => ({
        qty: 1, description: `Item ${i + 1}`, unitCents: 1000, amountCents: 1000,
      })),
      totalCents: 60000,
      totalPieces: 60,
    };
    const buf = await renderToBuffer(<InvoicePdf model={many} />);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = buf.toString("latin1");
    const m = text.match(/\/Count (\d+)/);
    expect(m && Number(m[1])).toBeGreaterThanOrEqual(2);
  });
});
