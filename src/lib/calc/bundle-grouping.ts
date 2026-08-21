export interface BundleComp { itemId: number; qty: number }
export interface LoadedBundle { ledgerTxnId: number; components: BundleComp[] }
export interface BundleGroup { lineIds: number[]; components: BundleComp[] }

/** Canonical, order-independent key for a component multiset. */
function recipeKey(components: BundleComp[]): string {
  return JSON.stringify(
    [...components].sort((a, b) => a.itemId - b.itemId).map((c) => [c.itemId, c.qty])
  );
}

/** Merge txns that share an identical component multiset into one group. */
export function groupBundles(bundles: LoadedBundle[]): BundleGroup[] {
  const byKey = new Map<string, BundleGroup>();
  const order: string[] = [];
  for (const b of bundles) {
    const key = recipeKey(b.components);
    let g = byKey.get(key);
    if (!g) { g = { lineIds: [], components: b.components }; byKey.set(key, g); order.push(key); }
    g.lineIds.push(b.ledgerTxnId);
  }
  return order.map((k) => byKey.get(k)!);
}

/** Expand each group to one bundle per line id. */
export function flattenBundles(groups: BundleGroup[]): LoadedBundle[] {
  const out: LoadedBundle[] = [];
  for (const g of groups) {
    for (const id of g.lineIds) out.push({ ledgerTxnId: id, components: g.components });
  }
  return out;
}
