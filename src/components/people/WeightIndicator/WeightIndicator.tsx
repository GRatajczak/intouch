import { WEIGHT_MIN, WEIGHT_MAX, weightSegmentShapeClassName } from "@/components/forms/WeightSelector";
import { cn } from "@/lib/utils";
import type { WeightIndicatorProps } from "./types";

const WEIGHT_VALUES = Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, i) => i + WEIGHT_MIN);

export function WeightIndicator({ value }: WeightIndicatorProps) {
  return (
    <div className="flex gap-1" aria-label={`Waga relacji: ${value}`}>
      {WEIGHT_VALUES.map((segment) => (
        <span
          key={segment}
          // At the selector's fixed `size-6` the 10 segments need 276px, which
          // overflows a `lg:grid-cols-3` catalog cell (~248px of content). Shrink
          // to fill the available width instead, capped at the selector's size.
          className={cn(weightSegmentShapeClassName(segment <= value), "h-6 w-auto max-w-6 min-w-0 flex-1")}
        />
      ))}
    </div>
  );
}
