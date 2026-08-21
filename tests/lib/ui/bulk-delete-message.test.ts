import { describe, it, expect } from "vitest";
import { bulkDeleteMessage } from "@/lib/ui/bulk-delete-message";

describe("bulkDeleteMessage", () => {
  it("spells out mappings and sales", () => {
    const msg = bulkDeleteMessage({ items: 3, mappings: 5, ledgerSales: 40, showLineSales: 0 });
    expect(msg).toContain("Delete 3 items?");
    expect(msg).toContain("unmaps 5 Whatnot names (40 ledger sales become unmapped)");
    expect(msg).toContain("Cannot be undone.");
  });
  it("omits the detail clause when there is no blast radius", () => {
    const msg = bulkDeleteMessage({ items: 1, mappings: 0, ledgerSales: 0, showLineSales: 0 });
    expect(msg).toBe("Delete 1 item? Sales data is kept — re-add and re-map to restore counts. Cannot be undone.");
  });
});
