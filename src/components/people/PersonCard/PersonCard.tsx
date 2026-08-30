import { UsersRound } from "lucide-react";
import { RELATIONSHIP_TYPE_LABELS, RELATIONSHIP_TYPE_SWATCH, type RelationshipType } from "@/lib/validation/person";
import { WeightIndicator } from "@/components/people/WeightIndicator";
import type { PersonCardProps } from "./types";

export function PersonCard({ person }: PersonCardProps) {
  const relationshipType = person.relationship_type as RelationshipType;

  return (
    <div className="border-border bg-card text-card-foreground shadow-card flex flex-col gap-3 rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className={`size-10 rounded-md ${RELATIONSHIP_TYPE_SWATCH[relationshipType]}`} aria-hidden="true" />
        {person.is_collective && (
          <span className="text-text-tertiary inline-flex items-center gap-1 text-xs">
            <UsersRound className="size-3.5" />
            Grupa
          </span>
        )}
      </div>
      <div className="flex flex-col items-start gap-1">
        <h3 className="text-foreground font-semibold">{person.name}</h3>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          {RELATIONSHIP_TYPE_LABELS[relationshipType]}
        </span>
      </div>
      <div className="mt-auto">
        <WeightIndicator value={person.weight} />
      </div>
    </div>
  );
}
