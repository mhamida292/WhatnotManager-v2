import { bestMatch, MATCH_THRESHOLD } from "@/lib/calc/name-match";

export interface MapSuggestion {
  productName: string;
  suggestedItemId: number | null;
  suggestedItemName: string | null;
  score: number;
  confident: boolean;
}

/** Pair each unmapped Whatnot name with its best-match inventory item.
 *  Pure: no DB. Sorted worst-score-first so shaky guesses are easiest to review. */
export function buildMapSuggestions(
  unmappedNames: string[],
  items: { id: number; name: string }[],
): MapSuggestion[] {
  const byId = new Map(items.map((i) => [i.id, i.name]));
  const out: MapSuggestion[] = unmappedNames.map((productName) => {
    const m = bestMatch(productName, items);
    return {
      productName,
      suggestedItemId: m ? m.itemId : null,
      suggestedItemName: m ? byId.get(m.itemId) ?? null : null,
      score: m ? m.score : 0,
      confident: m ? m.score >= MATCH_THRESHOLD : false,
    };
  });
  out.sort((a, b) => (a.score === b.score ? a.productName.localeCompare(b.productName) : a.score - b.score));
  return out;
}
