import { describe, it, expect } from "vitest";
import { periodHref, periodMode } from "@/lib/ui/expense-range";

describe("periodHref", () => {
  it("appends the query to the base path", () => {
    expect(periodHref("/expenses", "month=2026-07")).toBe("/expenses?month=2026-07");
    expect(periodHref("/", "month=2026-07")).toBe("/?month=2026-07");
  });

  it("returns the bare path when there is no query", () => {
    expect(periodHref("/expenses", "")).toBe("/expenses");
    expect(periodHref("/", "")).toBe("/");
  });
});

describe("periodMode", () => {
  it("resolves mode: all param → 'all'", () => {
    expect(periodMode({ all: "1" }, "week")).toBe("all");
  });

  it("resolves mode: month param → 'month'", () => {
    expect(periodMode({ month: "2026-07" }, "week")).toBe("month");
  });

  it("resolves mode: week param → 'week'", () => {
    expect(periodMode({ week: "2026-W36" }, "all")).toBe("week");
  });

  it("resolves mode: empty params → fallback 'week'", () => {
    expect(periodMode({}, "week")).toBe("week");
  });

  it("resolves mode: empty params → fallback 'all'", () => {
    expect(periodMode({}, "all")).toBe("all");
  });

  it("resolves mode: precedence all > month > week", () => {
    expect(periodMode({ week: "2026-W36", month: "2026-07", all: "1" }, "week")).toBe("all");
    expect(periodMode({ week: "2026-W36", month: "2026-07" }, "week")).toBe("month");
  });
});
