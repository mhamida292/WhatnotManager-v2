"use client";
import { useState } from "react";
import { INPUT_CLASS } from "@/lib/ui/inputs";

export function ItemCombobox({
  items, value, onChange, listId = "item-combobox-list", placeholder = "Search item…",
}: {
  items: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  listId?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(items.find((i) => i.id === value)?.name ?? "");
  return (
    <>
      <input
        className={`w-full ${INPUT_CLASS}`}
        list={listId}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          const match = items.find((i) => i.name === v);
          onChange(match ? match.id : null);
        }}
      />
      <datalist id={listId}>
        {items.map((i) => <option key={i.id} value={i.name} />)}
      </datalist>
    </>
  );
}
