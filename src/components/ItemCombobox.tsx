"use client";
import { useState } from "react";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ItemCombobox({
  items, value, onChange, onTextChange, listId = "item-combobox-list",
  placeholder = "Search item…", className,
}: {
  items: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  /** Raw text, for callers where a non-matching entry is meaningful in itself —
   *  the name of a product that does not exist yet. */
  onTextChange?: (text: string) => void;
  listId?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(items.find((i) => i.id === value)?.name ?? "");
  return (
    <>
      <input
        className={className ?? `w-full ${INPUT_CLASS}`}
        list={listId}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const match = items.find((i) => i.name === v);
          onChange(match ? match.id : null);
          onTextChange?.(v);
        }}
      />
      <datalist id={listId}>
        {items.map((i) => <option key={i.id} value={i.name} />)}
      </datalist>
    </>
  );
}
