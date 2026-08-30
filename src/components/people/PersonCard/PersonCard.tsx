import { UsersRound } from "lucide-react";
import { RELATIONSHIP_TYPE_LABELS } from "@/lib/validation/person";
import { WeightIndicator } from "@/components/people/WeightIndicator";
import type { PersonCardProps } from "./types";

export function PersonCard({ person }: PersonCardProps) {
  return (
    <div className="border-border bg-card text-card-foreground rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-foreground font-semibold">{person.name}</h3>
          <span className="bg-muted text-muted-foreground mt-1 inline-block rounded-full px-2 py-0.5 text-xs">
            {RELATIONSHIP_TYPE_LABELS[person.relationship_type as keyof typeof RELATIONSHIP_TYPE_LABELS]}
          </span>
        </div>
        {person.is_collective && (
          <span className="text-text-tertiary inline-flex items-center gap-1 text-xs">
            <UsersRound className="size-3.5" />
            Grupa
          </span>
        )}
      </div>
      <p className="text-muted-foreground mt-2 text-sm">{person.description}</p>
      <div className="mt-3">
        <WeightIndicator value={person.weight} />
      </div>
    </div>
  );
}
