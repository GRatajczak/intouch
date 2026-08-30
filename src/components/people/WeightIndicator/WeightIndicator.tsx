import { WEIGHT_MIN, WEIGHT_MAX, weightSegmentClassName } from "@/components/forms/WeightSelector";
import type { WeightIndicatorProps } from "./types";

const WEIGHT_VALUES = Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, i) => i + WEIGHT_MIN);

export function WeightIndicator({ value }: WeightIndicatorProps) {
  return (
    <div className="flex gap-1" aria-label={`Waga relacji: ${value}`}>
      {WEIGHT_VALUES.map((segment) => (
        <span key={segment} className={weightSegmentClassName(segment <= value)} />
      ))}
    </div>
  );
}
