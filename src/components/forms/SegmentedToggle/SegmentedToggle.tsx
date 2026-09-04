import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SegmentedToggleProps } from "./types";

const optionBase =
  "flex-1 h-[46px] rounded-[var(--radius)] border text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring";
const optionSelected = "bg-accent border-accent-foreground/20 text-accent-foreground";
const optionUnselected =
  "bg-secondary border-border text-muted-foreground font-normal hover:border-accent-foreground/30";

/**
 * A 2-button (or few-button) full-width segmented radio, matching the design
 * bundle's "To jedna osoba czy grupa?" toggle
 * (`.ai/intouch-design-preparation/project/InTouch.dc.html:616-620`) rather
 * than `ChoiceChips`' auto-width pill group, which is styled for a different
 * mock section. Submits via a single hidden input (single-select only).
 */
export function SegmentedToggle({ id, name, label, options, value, onChange, error, hint }: SegmentedToggleProps) {
  const labelId = `${id}-label`;

  return (
    <div>
      <div id={labelId} className="text-muted-foreground mb-1 block text-sm">
        {label}
      </div>
      <div id={id} role="radiogroup" aria-labelledby={labelId} className="flex gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                onChange(option.value);
              }}
              className={cn(optionBase, selected ? optionSelected : optionUnselected)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
