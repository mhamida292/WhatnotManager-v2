import { formatUSD } from "@/lib/money";
export function Money({ cents }: { cents: number }) {
  return <span className={cents < 0 ? "text-red-600" : ""}>{formatUSD(cents)}</span>;
}
