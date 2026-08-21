export function toCents(dollars: number): number {
  return Math.round((dollars + Number.EPSILON) * 100);
}
export function toDollars(cents: number): number {
  return cents / 100;
}
export function formatUSD(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const value = (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${value}`;
}
