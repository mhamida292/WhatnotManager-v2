export const MATCH_THRESHOLD = 0.5;

// Tokens that carry no discriminating signal in this squishy-toy catalog.
const NOISE = new Set([
  "squishy", "squishies", "assorted", "color", "colors", "glitter",
  "the", "and", "with", "a",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t));
}

function normalized(s: string): string {
  return tokens(s).join(" ");
}

// Levenshtein edit distance on two strings.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

// Token-set containment: fraction of the shorter side's tokens present in the other.
function tokenContainment(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const bSet = new Set(bTokens);
  const shorter = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const longerSet = aTokens.length <= bTokens.length ? bSet : new Set(aTokens);
  let hit = 0;
  for (const t of shorter) if (longerSet.has(t)) hit++;
  return hit / shorter.length;
}

/** Normalized similarity in 0..1; 1 for an exact normalized match. */
export function score(a: string, b: string): number {
  const na = normalized(a);
  const nb = normalized(b);
  if (na === nb && na.length > 0) return 1;
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  const containment = tokenContainment(aTokens, bTokens);
  const maxLen = Math.max(na.length, nb.length) || 1;
  const editSim = 1 - editDistance(na, nb) / maxLen;
  // Token containment carries most of the weight; edit distance is the fallback.
  return 0.7 * containment + 0.3 * editSim;
}

export function bestMatch(
  name: string,
  items: { id: number; name: string }[],
): { itemId: number; score: number } | null {
  if (items.length === 0) return null;
  let best: { itemId: number; score: number; itemName: string } | null = null;
  for (const it of items) {
    const s = score(name, it.name);
    if (
      best === null ||
      s > best.score ||
      (s === best.score &&
        (it.name.length < best.itemName.length ||
          (it.name.length === best.itemName.length && it.id < best.itemId)))
    ) {
      best = { itemId: it.id, score: s, itemName: it.name };
    }
  }
  return best ? { itemId: best.itemId, score: best.score } : null;
}
