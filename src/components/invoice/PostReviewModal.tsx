"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ItemCombobox } from "@/components/ItemCombobox";

export interface LineReview {
  lineId: number; productName: string;
  suggestedItemId: number | null; suggestedItemName: string | null;
  score: number; confident: boolean;
}
type Resolution = { lineId: number; itemId: number } | { lineId: number; createName: string };

export function PostReviewModal({
  reviews, items, onCancel, onConfirm,
}: {
  reviews: LineReview[];
  items: { id: number; name: string }[];
  onCancel: () => void;
  onConfirm: (resolutions: Resolution[]) => void;
}) {
  // Per line: chosen item id (pre-filled with the suggestion), or "create new" toggle.
  const [choice, setChoice] = useState<Record<number, { itemId: number | null; createNew: boolean }>>(
    () => Object.fromEntries(reviews.map((r) => [r.lineId, { itemId: r.suggestedItemId, createNew: false }])),
  );

  const ready = reviews.every((r) => {
    const c = choice[r.lineId];
    return c.createNew || c.itemId != null;
  });

  function build(): Resolution[] {
    return reviews.map((r) => {
      const c = choice[r.lineId];
      return c.createNew
        ? { lineId: r.lineId, createName: r.productName }
        : { lineId: r.lineId, itemId: c.itemId! };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl">
        <h2 className="text-lg font-semibold">Confirm items before posting</h2>
        <p className="mt-1 text-sm text-slate-500">{reviews.length} line(s) aren&apos;t linked to an inventory item yet.</p>
        <div className="mt-3 space-y-3">
          {reviews.map((r) => {
            const c = choice[r.lineId];
            const pct = Math.round(r.score * 100);
            return (
              <div key={r.lineId} className="rounded-lg border border-line p-3 text-sm">
                <div className="font-medium">{r.productName}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {r.suggestedItemName
                    ? <>Best match: <span className="font-mono">{r.suggestedItemName}</span> ({pct}%){!r.confident && " — low confidence"}</>
                    : "No match found"}
                </div>
                {!c.createNew && (
                  <div className="mt-2">
                    <ItemCombobox items={items} value={c.itemId}
                      onChange={(id) => setChoice({ ...choice, [r.lineId]: { itemId: id, createNew: false } })}
                      listId={`post-review-${r.lineId}`} placeholder="Search inventory item…" />
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={c.createNew}
                    onChange={(e) => setChoice({ ...choice, [r.lineId]: { itemId: c.itemId, createNew: e.target.checked } })} />
                  Create a new item named &quot;{r.productName}&quot;
                </label>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ready} onClick={() => onConfirm(build())}>Confirm all &amp; post</Button>
        </div>
      </div>
    </div>
  );
}
