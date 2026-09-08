export interface LaborEntry {
  workDate: string;      // 'YYYY-MM-DD'
  amountCents: number;
}

export interface LaborShow {
  id: number;
  showDate: string;      // 'YYYY-MM-DD'
  sessionSeq: number;
}

export interface LaborAllocation {
  byShowId: Map<number, number>;  // show id -> labor cents charged to it
  unallocatedCents: number;       // wages on dates with no show; NOT in any net
}

/** Charge each day's wages to the shows that ran that day, split evenly across
 *  same-day sessions. The remainder cent goes to the lowest session_seq so the
 *  parts always sum back to the total — same reasoning as splitProfit giving
 *  the floor to one side. Wages on a date with no show can't belong to a net,
 *  so they're reported separately rather than dropped. */
export function allocateLabor(entries: LaborEntry[], shows: LaborShow[]): LaborAllocation {
  const totalByDate = new Map<string, number>();
  for (const e of entries) {
    totalByDate.set(e.workDate, (totalByDate.get(e.workDate) ?? 0) + e.amountCents);
  }

  const showsByDate = new Map<string, LaborShow[]>();
  for (const s of shows) {
    if (!showsByDate.has(s.showDate)) showsByDate.set(s.showDate, []);
    showsByDate.get(s.showDate)!.push(s);
  }

  const byShowId = new Map<number, number>();
  let unallocatedCents = 0;

  for (const [date, total] of totalByDate) {
    const day = showsByDate.get(date);
    if (!day || day.length === 0) {
      unallocatedCents += total;
      continue;
    }
    const ordered = [...day].sort((a, b) => a.sessionSeq - b.sessionSeq);
    const base = Math.floor(total / ordered.length);
    const remainder = total - base * ordered.length;
    ordered.forEach((s, i) => {
      byShowId.set(s.id, (byShowId.get(s.id) ?? 0) + base + (i === 0 ? remainder : 0));
    });
  }

  return { byShowId, unallocatedCents };
}
