import { describe, it, expect } from "vitest";
import { sessionizeByGap, secondsToClock, SESSION_GAP_MINUTES, assignSessions } from "@/lib/calc/sessions";
import { ledgerTimeOfDaySeconds } from "@/lib/csv/ledger";

const H = 3600, M = 60;

describe("sessionizeByGap", () => {
  it("returns all-zero for an empty or single input", () => {
    expect(sessionizeByGap([], 60 * M)).toEqual([]);
    expect(sessionizeByGap([10 * H], 60 * M)).toEqual([0]);
  });

  it("keeps one session when all gaps are <= threshold", () => {
    // 10:00, 10:30, 11:00 — 30-min gaps
    expect(sessionizeByGap([10 * H, 10 * H + 30 * M, 11 * H], 60 * M)).toEqual([0, 0, 0]);
  });

  it("starts a new session when a gap exceeds the threshold", () => {
    // 10:00, 10:30, then 17:00 (>60 min later), 17:20
    expect(sessionizeByGap([10 * H, 10 * H + 30 * M, 17 * H, 17 * H + 20 * M], 60 * M))
      .toEqual([0, 0, 1, 1]);
  });

  it("treats exactly 60 minutes as the same session, 61 as a new one", () => {
    expect(sessionizeByGap([10 * H, 11 * H], 60 * M)).toEqual([0, 0]);         // exactly 60
    expect(sessionizeByGap([10 * H, 11 * H + 1 * M], 60 * M)).toEqual([0, 1]); // 61
  });

  it("supports three sessions", () => {
    expect(sessionizeByGap([9 * H, 12 * H, 18 * H], 60 * M)).toEqual([0, 1, 2]);
  });
});

describe("secondsToClock", () => {
  it("formats 12-hour clock with AM/PM", () => {
    expect(secondsToClock(0)).toBe("12:00 AM");
    expect(secondsToClock(12 * H)).toBe("12:00 PM");
    expect(secondsToClock(13 * H + 5 * M)).toBe("1:05 PM");
    expect(secondsToClock(9 * H + 14 * M)).toBe("9:14 AM");
  });
});

describe("ledgerTimeOfDaySeconds", () => {
  it("parses the time of day from a Created Date string", () => {
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 10:14:57 AM")).toBe(10 * H + 14 * M + 57);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 5:02:11 PM")).toBe(17 * H + 2 * M + 11);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 12:00:00 PM")).toBe(12 * H);
    expect(ledgerTimeOfDaySeconds("Jun 12, 2026, 12:30:00 AM")).toBe(30 * M);
  });
  it("returns 0 on parse failure", () => {
    expect(ledgerTimeOfDaySeconds("garbage")).toBe(0);
  });
  it("exposes the 60-minute constant", () => {
    expect(SESSION_GAP_MINUTES).toBe(60);
  });
});

describe("assignSessions", () => {
  const sale = (timeSeconds: number) => ({ timeSeconds, isSale: true });
  const other = (timeSeconds: number) => ({ timeSeconds, isSale: false });

  it("returns all-zero when there are no sales (only fees/withdrawals)", () => {
    expect(assignSessions([other(6 * H + 30 * M), other(10 * H)], 60 * M)).toEqual([0, 0]);
  });

  it("keeps one selling session and folds stray non-sales into it", () => {
    // real 4 PM stream + a 6:30 AM fee + a 10:13 AM withdrawal -> all one show
    const items = [other(6 * H + 30 * M), other(10 * H + 13 * M), sale(16 * H), sale(16 * H + 30 * M)];
    expect(assignSessions(items, 60 * M)).toEqual([0, 0, 0, 0]);
  });

  it("splits two real sale clusters and attaches non-sales to the nearest", () => {
    // morning sales (10:00,10:30) and evening sales (17:00,17:20); non-sales at 09:00, 14:00, 23:00
    const items = [
      other(9 * H),            // before morning -> session 0
      sale(10 * H), sale(10 * H + 30 * M),
      other(14 * H),           // 3.5h after 10:30 vs 3h before 17:00 -> nearer session 1
      sale(17 * H), sale(17 * H + 20 * M),
      other(23 * H),           // after evening -> session 1
    ];
    expect(assignSessions(items, 60 * M)).toEqual([0, 0, 0, 1, 1, 1, 1]);
  });
});
