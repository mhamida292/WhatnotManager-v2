import { describe, it, expect } from "vitest";
import { groupBundles, flattenBundles } from "@/lib/calc/bundle-grouping";

describe("groupBundles", () => {
  it("merges txns with identical component sets (order-independent)", () => {
    const groups = groupBundles([
      { ledgerTxnId: 10, components: [{ itemId: 1, qty: 1 }, { itemId: 2, qty: 1 }] },
      { ledgerTxnId: 11, components: [{ itemId: 2, qty: 1 }, { itemId: 1, qty: 1 }] }, // same recipe, reordered
      { ledgerTxnId: 12, components: [{ itemId: 1, qty: 2 }] },                        // different
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lineIds).toEqual([10, 11]);
    expect(groups[1].lineIds).toEqual([12]);
  });
});

describe("flattenBundles", () => {
  it("emits one bundle per line id with the group's components", () => {
    const out = flattenBundles([
      { lineIds: [10, 11], components: [{ itemId: 1, qty: 1 }] },
      { lineIds: [12], components: [{ itemId: 3, qty: 2 }] },
    ]);
    expect(out).toEqual([
      { ledgerTxnId: 10, components: [{ itemId: 1, qty: 1 }] },
      { ledgerTxnId: 11, components: [{ itemId: 1, qty: 1 }] },
      { ledgerTxnId: 12, components: [{ itemId: 3, qty: 2 }] },
    ]);
  });
});
