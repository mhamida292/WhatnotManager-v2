export interface ChartPoint { label: string; valueCents: number; }
export interface ChartGeometry {
  coords: { x: number; y: number; point: ChartPoint }[];
  line: string;   // "x,y x,y ..." for a <polyline>
  area: string;   // closed path points for the fill
  zeroY: number;  // y of the zero baseline
}

const PAD = 0.12; // fraction of height kept as top/bottom breathing room

/** Map points to SVG coords. Y range always includes zero so negative
 *  values dip below the baseline. Higher value = smaller y (SVG y grows down). */
export function chartGeometry(
  points: ChartPoint[], width: number, height: number,
): ChartGeometry | null {
  if (points.length === 0) return null;

  const values = points.map((p) => p.valueCents);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  let min = Math.min(0, lo);
  let max = Math.max(0, hi);
  if (lo === hi) {
    // perfectly flat data: center it regardless of sign distance to zero
    const mid = lo;
    min = mid - 1; max = mid + 1;
  }

  const padPx = height * PAD;
  const usable = height - 2 * padPx;
  const yFor = (v: number) => padPx + (max - v) / (max - min) * usable;
  const xFor = (i: number) =>
    points.length === 1 ? 0 : (i / (points.length - 1)) * width;

  const coords = points.map((point, i) => ({ x: xFor(i), y: yFor(point.valueCents), point }));
  const line = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const area = `${xFor(0)},${height} ${line} ${xFor(points.length - 1)},${height}`;
  return { coords, line, area, zeroY: yFor(0) };
}
