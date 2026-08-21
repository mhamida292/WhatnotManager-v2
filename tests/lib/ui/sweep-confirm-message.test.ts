import { describe, it, expect } from "vitest";
import { sweepConfirmMessage } from "@/lib/ui/sweep-confirm-message";

describe("sweepConfirmMessage", () => {
  it("describes an all-positive sweep with no correction clause", () => {
    const msg = sweepConfirmMessage([
      { qty: 50 }, { qty: 30 }, { qty: 20 },
    ]);
    expect(msg).toBe(
      "This will move 100 units across 3 items from Warehouse to Whatnot, then turn on Whatnot-only mode.\n\nContinue?",
    );
  });

  it("separates negative-balance corrections from the positive move", () => {
    const msg = sweepConfirmMessage([
      { qty: 50 }, { qty: 30 }, { qty: 20 }, { qty: -5 }, { qty: -3 },
    ]);
    expect(msg).toBe(
      "This will move 100 units across 3 items from Warehouse to Whatnot, plus 2 items with a negative Warehouse balance, which will be corrected, then turn on Whatnot-only mode.\n\nContinue?",
    );
  });

  it("uses singular wording for one unit / one item", () => {
    const msg = sweepConfirmMessage([{ qty: 1 }, { qty: -1 }]);
    expect(msg).toBe(
      "This will move 1 unit across 1 item from Warehouse to Whatnot, plus 1 item with a negative Warehouse balance, which will be corrected, then turn on Whatnot-only mode.\n\nContinue?",
    );
  });
});
