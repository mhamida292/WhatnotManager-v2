const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** "2026-06-15" -> "June 15, 2026". Parses the parts directly (no Date, so no
 *  timezone drift). Returns "—" for null/empty/unparseable input. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  const name = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!name || !day) return "—";
  return `${name} ${day}, ${m[1]}`;
}
