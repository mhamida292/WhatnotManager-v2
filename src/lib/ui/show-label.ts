/** Human label for a show: just the date, or "<date> · Show N · <time range>" when
 *  the date has more than one session. */
export function showSessionLabel(s: {
  showDate: string;
  sessionSeq: number;
  timeRange: string;
  dateHasMultipleSessions: boolean;
}): string {
  if (!s.dateHasMultipleSessions) return s.showDate;
  return `${s.showDate} · Show ${s.sessionSeq + 1} · ${s.timeRange}`;
}
