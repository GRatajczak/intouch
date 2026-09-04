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
 * card-to-detail-page link is a separate `absolute inset-0` overlay `<a>`
 * covering the card, rather than the whole card being an `<a>` -- an anchor
 * wrapping a `<button>` ("Historia") is invalid HTML and was fragile
 * (relied on a delegated `preventDefault()`). This way "Historia" is a
 * normal, non-nested button; a single delegated click listener in
 * people/index.astro's own <script> still dispatches its open event, so the
 * catalog grid ships zero React islands. Card-to-detail-page link --
 * plan.md Phase 4 §5.
 *
 * The overlay must paint ABOVE the card's static content, not behind it: it
 * previously carried `-z-10`, which left it hit-testable only where no
 * in-flow box sits on top. Every content row here is a full-width block, so
 * that reduced the tap target to the 20px padding ring and the ~12px gaps
 * between rows -- reachable with a mouse pointer, but not with a thumb, so
 * on mobile the card was effectively not a link at all. "Historia" stays
 * clickable by being positioned (`relative z-10`) above the overlay.
 *
 * Layout follows the design bundle's catalog card
 * (.ai/intouch-design-preparation/project/InTouch.dc.html:435-445): a
 * relationship-swatch square top-left, the weight meter top-right, name and
 * "Typ · osoba/grupa" beneath, then a status line -- here the recorded
 * last-contact fact, which the mock doesn't have a real value for yet. A
 * deactivated card gets the mock's dimmed/badged treatment at :495-505.
 */
export function PersonCard({ person, facts }: PersonCardProps) {
  const relationshipType = person.relationship_type as RelationshipType;
  const isDeactivated = person.status === "deactivated";

  return (
    <div
      className={`border-border bg-card text-card-foreground hover:shadow-card relative rounded-[18px] border p-5 transition-shadow ${isDeactivated ? "opacity-75" : ""}`}
    >
      <a
        href={`/people/${person.id}`}
        aria-label={`Zobacz profil: ${person.name}`}
        className="absolute inset-0 rounded-[18px]"
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className={`size-10 rounded-[13px] ${RELATIONSHIP_TYPE_SWATCH[relationshipType]}`} aria-hidden="true" />
        {isDeactivated ? (
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">
            nieaktywna
          </span>
        ) : (
          <div className="pt-1.5">
            <WeightIndicator value={person.weight} relationshipType={relationshipType} />
          </div>
        )}
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
        {isDeactivated ? (
          <span className="text-muted-foreground text-[13px]">Pominięty w podpowiedziach, historia zachowana</span>
        ) : facts?.lastHappenedAt ? (
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
          className="text-muted-foreground hover:text-foreground relative z-10 text-xs font-medium underline-offset-2 hover:underline"
        >
          Historia
        </button>
      </div>
    </div>
  );
}
