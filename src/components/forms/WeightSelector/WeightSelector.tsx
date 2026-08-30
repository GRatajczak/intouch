import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WeightSelectorProps } from "./types";

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 10;

// Shared with the read-only WeightIndicator (src/components/people/WeightIndicator)
// so the two never visually drift apart.
export function weightSegmentClassName(filled: boolean): string {
  return cn(
    "size-6 rounded-md border transition-colors",
    filled ? "bg-primary border-primary" : "bg-input border-border",
  );
}

const WEIGHT_VALUES = Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, i) => i + WEIGHT_MIN);

export function WeightSelector({ name = "weight", value, onChange, label, error }: WeightSelectorProps) {
  return (
    <div>
      <label className="text-muted-foreground mb-1 block text-sm">{label}</label>
      <div className="flex gap-1">
        {WEIGHT_VALUES.map((segment) => (
          <button
            key={segment}
            type="button"
            aria-label={`Waga ${segment}`}
            aria-pressed={segment <= value}
            onClick={() => {
              onChange(segment);
            }}
            className={weightSegmentClassName(segment <= value)}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={value} />
      {error && (
        <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
          <CircleAlert className="size-3" />
          {error}
        </p>
      )}
    </div>
  );
}
