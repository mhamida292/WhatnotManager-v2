import { describe, it, expect } from "vitest";
import { showSessionLabel } from "@/lib/ui/show-label";

describe("showSessionLabel", () => {
  it("returns just the date for a single-session day", () => {
    expect(showSessionLabel({ showDate: "2026-06-12", sessionSeq: 0, timeRange: "10:00 AM–11:00 AM", dateHasMultipleSessions: false }))
      .toBe("2026-06-12");
  });
  it("adds Show number and time range for a multi-session day", () => {
    expect(showSessionLabel({ showDate: "2026-06-12", sessionSeq: 1, timeRange: "5:02 PM–7:30 PM", dateHasMultipleSessions: true }))
      .toBe("2026-06-12 · Show 2 · 5:02 PM–7:30 PM");
  });
});
