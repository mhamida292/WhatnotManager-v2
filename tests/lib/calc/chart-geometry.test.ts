import { describe, it, expect } from "vitest";
import { chartGeometry } from "@/lib/calc/chart-geometry";

describe("chartGeometry", () => {
  it("returns null for no points", () => {
    expect(chartGeometry([], 100, 50)).toBeNull();
  });

  it("places a single point at the vertical middle", () => {
    const g = chartGeometry([{ label: "a", valueCents: 500 }], 100, 50)!;
    expect(g.coords).toHaveLength(1);
    expect(g.coords[0].x).toBe(0);
    expect(g.coords[0].y).toBeCloseTo(25); // mid-height
  });

  it("scales min to bottom and max to top within padding", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 0 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.coords[0].x).toBe(0);
    expect(g.coords[1].x).toBe(100);
    expect(g.coords[0].y).toBeGreaterThan(g.coords[1].y); // higher value = smaller y
  });

  it("includes zero in the range so negatives dip below the baseline", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: -100 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.zeroY).toBeGreaterThan(g.coords[1].y); // baseline below the +100 point
    expect(g.zeroY).toBeLessThan(g.coords[0].y);    // baseline above the -100 point
  });

  it("builds a polyline string from the coords", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 0 }, { label: "b", valueCents: 100 }],
      100, 100,
    )!;
    expect(g.line).toMatch(/^\d/);
    expect(g.line.split(" ")).toHaveLength(2);
  });

  it("flat series renders at mid-height", () => {
    const g = chartGeometry(
      [{ label: "a", valueCents: 50 }, { label: "b", valueCents: 50 }],
      100, 100,
    )!;
    expect(g.coords[0].y).toBeCloseTo(50);
    expect(g.coords[1].y).toBeCloseTo(50);
  });
});
