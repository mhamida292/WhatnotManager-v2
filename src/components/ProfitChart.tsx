import { chartGeometry, ChartPoint } from "@/lib/calc/chart-geometry";
import { formatUSD } from "@/lib/money";

const W = 800, H = 200;

export function ProfitChart({ points }: { points: ChartPoint[] }) {
  const g = chartGeometry(points, W, H);
  if (!g) {
    return <div className="grid h-40 place-items-center text-sm text-slate-400">No shows yet</div>;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-44 w-full">
      <defs>
        <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#059669" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1={g.zeroY} x2={W} y2={g.zeroY} stroke="#e2e8f0" strokeWidth="1" />
      <polygon points={g.area} fill="url(#profitFill)" />
      <polyline points={g.line} fill="none" stroke="#059669" strokeWidth="2.5"
        vectorEffect="non-scaling-stroke" />
      {g.coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r="3" fill="#059669">
          <title>{`${c.point.label}: ${formatUSD(c.point.valueCents)}`}</title>
        </circle>
      ))}
    </svg>
  );
}
