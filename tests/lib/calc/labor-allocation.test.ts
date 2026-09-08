import { describe, it, expect } from "vitest";
import { allocateLabor } from "@/lib/calc/labor-allocation";

const show = (id: number, showDate: string, sessionSeq = 0) => ({ id, showDate, sessionSeq });

describe("allocateLabor", () => {
  it("charges a day's wages to that day's only show", () => {
    const a = allocateLabor([{ workDate: "2026-07-08", amountCents: 7500 }], [show(1, "2026-07-08")]);
    expect(a.byShowId.get(1)).toBe(7500);
    expect(a.unallocatedCents).toBe(0);
  });

  it("splits evenly across same-day sessions", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 20000 }],
      [show(1, "2026-07-08", 0), show(2, "2026-07-08", 1)],
    );
    expect(a.byShowId.get(1)).toBe(10000);
    expect(a.byShowId.get(2)).toBe(10000);
  });

  it("gives the remainder cent to the lowest session_seq", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 101 }],
      [show(2, "2026-07-08", 1), show(1, "2026-07-08", 0)], // deliberately out of order
    );
    expect(a.byShowId.get(1)).toBe(51);
    expect(a.byShowId.get(2)).toBe(50);
    expect(a.byShowId.get(1)! + a.byShowId.get(2)!).toBe(101); // no cent lost
  });

  it("sums every person working that date before splitting", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-08", amountCents: 6000 }, { workDate: "2026-07-08", amountCents: 4000 }],
      [show(1, "2026-07-08", 0), show(2, "2026-07-08", 1)],
    );
    expect(a.byShowId.get(1)).toBe(5000);
    expect(a.byShowId.get(2)).toBe(5000);
  });

  it("reports wages on a date with no show as unallocated", () => {
    const a = allocateLabor(
      [{ workDate: "2026-07-09", amountCents: 3000 }],
      [show(1, "2026-07-08")],
    );
    expect(a.byShowId.size).toBe(0);
    expect(a.unallocatedCents).toBe(3000);
  });

  it("handles empty input", () => {
    const a = allocateLabor([], []);
    expect(a.byShowId.size).toBe(0);
    expect(a.unallocatedCents).toBe(0);
  });
});
