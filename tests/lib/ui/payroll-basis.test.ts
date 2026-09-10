import { describe, it, expect } from "vitest";
import { PAYROLL_BASES, basisLabel, qtyLabel, rateLabel, workLabel } from "@/lib/ui/payroll-basis";

describe("payroll basis labels", () => {
  it("lists the three bases in entry order", () => {
    expect(PAYROLL_BASES).toEqual(["hour", "piece", "package"]);
  });

  it("labels each basis", () => {
    expect(PAYROLL_BASES.map(basisLabel)).toEqual(["Hour", "Piece", "Package"]);
    expect(PAYROLL_BASES.map(qtyLabel)).toEqual(["Hours", "Pieces", "Packages"]);
    expect(PAYROLL_BASES.map(rateLabel)).toEqual(["$/hr", "$/piece", "$/package"]);
  });

  it("shows hours to two places and counts as whole numbers", () => {
    expect(workLabel("hour", 5.5)).toBe("5.50 hrs");
    expect(workLabel("piece", 300)).toBe("300 pieces");
    expect(workLabel("package", 120)).toBe("120 packages");
  });

  it("does not say '1 pieces'", () => {
    expect(workLabel("piece", 1)).toBe("1 piece");
    expect(workLabel("package", 1)).toBe("1 package");
  });

  it("groups a large count for readability", () => {
    expect(workLabel("piece", 2000)).toBe("2,000 pieces");
  });
});
