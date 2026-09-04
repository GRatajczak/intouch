import { RELATIONSHIP_TYPE_LABELS, RELATIONSHIP_TYPE_SWATCH, type RelationshipType } from "@/lib/validation/person";
import { WeightIndicator } from "@/components/people/WeightIndicator";
import type { PersonCardProps } from "./types";

// Same dziś/wczoraj/"X dni temu" shape ContactChips and ContactHistorySheet
// each own locally -- no shared date-utils module exists in this repo.
function formatLastContact(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return "dziś";
  }
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) {
    return "wczoraj";
  }
  if (diffDays >= 0 && diffDays < 30) {
    return `${String(diffDays)} dni temu`;
  }
  return date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

/**
 * Stays un-hydrated -- no `client:` directive anywhere this renders. The
 * "Historia" affordance is a plain button carrying data attributes; a single
 * delegated click listener in people/index.astro's own <script> dispatches
 * the open event, so the catalog grid ships zero React islands.
 *
 * Layout follows the design bundle's catalog card
 * (.ai/intouch-design-preparation/project/InTouch.dc.html:435-445): a
 * relationship-swatch square top-left, the weight meter top-right, name and
 * "Typ · osoba/grupa" beneath, then a status line -- here the recorded
 * last-contact fact, which the mock doesn't have a real value for yet.
 */
export function PersonCard({ person, facts }: PersonCardProps) {
  const relationshipType = person.relationship_type as RelationshipType;

  return (
    <div className="border-border bg-card text-card-foreground rounded-[18px] border p-5">
      <div className="flex items-start justify-between">
        <div className={`size-10 rounded-[13px] ${RELATIONSHIP_TYPE_SWATCH[relationshipType]}`} aria-hidden="true" />
        <div className="w-[88px] pt-1.5">
          <WeightIndicator value={person.weight} />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <h3 className="text-foreground text-[17px] font-bold">{person.name}</h3>
        <div className="text-text-tertiary text-[13px]">
          {RELATIONSHIP_TYPE_LABELS[relationshipType]} · {person.is_collective ? "grupa" : "osoba"}
        </div>
      </div>
      {person.context_tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {person.context_tags.map((tag) => (
            <span
              key={tag}
              className="bg-accent border-accent-foreground/20 text-accent-foreground rounded-[12px] border px-2 py-0.5 text-xs font-semibold"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        {facts?.lastHappenedAt ? (
          <span className="text-muted-foreground text-[13px]">
            Ostatni kontakt {formatLastContact(facts.lastHappenedAt)}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          data-open-contact-history={person.id}
          data-person-name={person.name}
          className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-2 hover:underline"
        >
          Historia
        </button>
      </div>
    </div>
  );
}
