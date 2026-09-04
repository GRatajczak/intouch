import { WEIGHT_MIN, WEIGHT_MAX } from "@/components/forms/WeightSelector";
import { RELATIONSHIP_TYPE_SWATCH } from "@/lib/validation/person";
import { cn } from "@/lib/utils";
import type { WeightIndicatorProps } from "./types";

const WEIGHT_VALUES = Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, i) => i + WEIGHT_MIN);

export function WeightIndicator({ value, relationshipType }: WeightIndicatorProps) {
  return (
    <div className="flex gap-2" aria-label={`Waga relacji: ${value}`}>
      {WEIGHT_VALUES.map((segment) => (
        <span
          key={segment}
          // Fixed size (not flex-1 shrink-to-fit) so it never gets squeezed
          // by whatever width the parent happens to have -- callers that
          // need it compact should give it less room, not the other way
          // around. Filled segments take the person's own relationship-type
          // swatch color, matching their avatar square.
          className={cn(
            "aspect-square size-3.5 rounded-full border transition-colors",
            segment <= value
              ? `${RELATIONSHIP_TYPE_SWATCH[relationshipType]} border-transparent`
              : "bg-input border-border",
          )}
        />
      ))}
    </div>
  );
}
