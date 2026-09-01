import { cn } from "@/lib/utils";
import type { ChoiceChipsProps } from "./types";

const chipBase =
  "rounded-full border px-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const chipSelected = "bg-accent border-accent-foreground/20 text-accent-foreground font-semibold";
const chipUnselected = "bg-secondary border-border text-muted-foreground hover:border-accent-foreground/30";

export function ChoiceChips({ id, name, label, options, value, onChange, mode, hint }: ChoiceChipsProps) {
  const labelId = `${id}-label`;
  const isSingle = mode === "single";

  function toggle(optionValue: string) {
    const selected = value.includes(optionValue);
    if (isSingle) {
      onChange(selected ? [] : [optionValue]);
    } else {
      onChange(selected ? value.filter((v) => v !== optionValue) : [...value, optionValue]);
    }
  }

  return (
    <div>
      <div id={labelId} className="text-muted-foreground mb-2 block text-sm">
        {label}
      </div>
      <div id={id} role={isSingle ? "radiogroup" : "group"} aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role={isSingle ? "radio" : "checkbox"}
              aria-checked={selected}
              onClick={() => {
                toggle(option.value);
              }}
              className={cn(chipBase, selected ? chipSelected : chipUnselected)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint}
      {value.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
    </div>
  );
}
