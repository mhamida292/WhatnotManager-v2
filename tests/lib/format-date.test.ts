import { describe, it, expect } from "vitest";
import { longDate } from "@/lib/format-date";

describe("longDate", () => {
  it("formats a YYYY-MM-DD date as a long date", () => {
    expect(longDate("2026-06-15")).toBe("June 15, 2026");
  });
  it("does not zero-pad the day", () => {
    expect(longDate("2026-06-05")).toBe("June 5, 2026");
  });
  it("returns an em dash for null/empty/unparseable", () => {
    expect(longDate(null)).toBe("—");
    expect(longDate("")).toBe("—");
    expect(longDate("nope")).toBe("—");
  });
  it("returns an em dash for an out-of-range month or day", () => {
    expect(longDate("2026-00-10")).toBe("—");
    expect(longDate("2026-06-00")).toBe("—");
  });
});
