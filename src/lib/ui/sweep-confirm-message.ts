/** Human-readable confirmation for the "sweep Warehouse stock to Whatnot" action.
 *  `blockers` are the still-blocking Warehouse balances shown in Settings — some
 *  positive (stock to move to Whatnot) and some negative (a correction back to zero). */
export function sweepConfirmMessage(blockers: { qty: number }[]): string {
  const positive = blockers.filter((b) => b.qty > 0);
  const negative = blockers.filter((b) => b.qty < 0);
  const units = positive.reduce((sum, b) => sum + b.qty, 0);
  const positiveClause = `move ${units} unit${units === 1 ? "" : "s"} across ${positive.length} item${positive.length === 1 ? "" : "s"} from Warehouse to Whatnot`;
  const negativeClause = negative.length > 0
    ? `, plus ${negative.length} item${negative.length === 1 ? "" : "s"} with a negative Warehouse balance, which will be corrected`
    : "";
  return `This will ${positiveClause}${negativeClause}, then turn on Whatnot-only mode.\n\nContinue?`;
}
