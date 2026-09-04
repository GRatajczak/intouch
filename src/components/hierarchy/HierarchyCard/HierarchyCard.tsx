import { Check, ChevronDown, ChevronUp, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { RELATIONSHIP_TYPE_LABELS, type RelationshipType } from "@/lib/validation/person";
import { TIME_WINDOW_LABELS, type TimeWindow } from "@/lib/validation/ranking";
import { WeightIndicator } from "@/components/people/WeightIndicator";
import { ContactChips } from "@/components/hierarchy/ContactChips";
import { ContactMarker } from "@/components/hierarchy/ContactMarker";
import { openContactHistory } from "@/components/contact-history/ContactHistorySheet/openContactHistory";
import type { HierarchyCardProps } from "./types";

// Same urgency tokens the landing page's preview card already promises
// (src/components/landing/LandingHero.astro) -- this card is what that
// preview was standing in for.
const TIME_WINDOW_TONE: Record<TimeWindow, { badge: string; label: string; border: string }> = {
  this_week: { badge: "bg-urgent-bg text-urgent", label: "text-urgent", border: "border-urgent-bg" },
  two_weeks: { badge: "bg-warning-bg text-warning", label: "text-warning", border: "border-warning-bg" },
  this_month: { badge: "bg-success-bg text-success", label: "text-success", border: "border-success-bg" },
  no_rush: { badge: "bg-muted text-muted-foreground", label: "text-muted-foreground", border: "border-border" },
};

export function HierarchyCard({ entry, rank, expanded, onToggleExpanded, facts, onMarked }: HierarchyCardProps) {
  const { person } = entry;
  const relationshipType = person.relationship_type as RelationshipType;
  const tone = TIME_WINDOW_TONE[entry.timeWindow];
  const timeWindowLabel = TIME_WINDOW_LABELS[entry.timeWindow];

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          onToggleExpanded(person.id);
        }}
        className="border-border bg-card hover:bg-accent/40 flex w-full items-center gap-3 rounded-lg border px-[18px] py-3.5 text-left transition-colors"
      >
        <div
          className={cn(
            "flex size-[30px] flex-shrink-0 items-center justify-center rounded-[10px] text-[13px] font-bold",
            tone.badge,
          )}
        >
          {rank}
        </div>
        <div className="text-foreground min-w-0 flex-1 truncate text-[15px] font-semibold">{person.name}</div>
        {facts && (
          <span className="text-success flex-shrink-0" aria-label="Potwierdzono kontakt" title="Potwierdzono kontakt">
            <Check className="size-3.5" />
          </span>
        )}
        <div className={cn("text-xs whitespace-nowrap", tone.label)}>{timeWindowLabel}</div>
        <span className="text-muted-foreground inline-flex items-center gap-0.5 text-xs font-medium whitespace-nowrap">
          Rozwiń
          <ChevronDown className="size-3.5" />
        </span>
      </button>
    );
  }

  return (
    <div className={cn("bg-card flex flex-col gap-3 rounded-lg border p-[18px]", tone.border)}>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-[34px] flex-shrink-0 items-center justify-center rounded-[11px] text-sm font-bold",
            tone.badge,
          )}
        >
          {rank}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-foreground text-base font-bold">{person.name}</span>
            {person.is_collective && (
              <span className="text-text-tertiary inline-flex items-center gap-1 text-xs">
                <UsersRound className="size-3.5" />
                Grupa
              </span>
            )}
          </div>
          <div className="text-text-tertiary text-xs">{RELATIONSHIP_TYPE_LABELS[relationshipType]}</div>
        </div>
        <div className={cn("rounded-full px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap", tone.badge)}>
          {timeWindowLabel}
        </div>
        <button
          type="button"
          onClick={() => {
            onToggleExpanded(person.id);
          }}
          aria-label="Zwiń"
          className="text-text-tertiary hover:text-foreground flex-shrink-0"
        >
          <ChevronUp className="size-4" />
        </button>
      </div>

      <div>
        <div className="text-muted-foreground mb-1 text-xs font-bold tracking-[0.06em] uppercase">Dlaczego teraz</div>
        <p className="bg-secondary text-foreground/80 rounded-xl p-3 text-[13px] leading-[1.55]">{entry.reason}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <WeightIndicator value={person.weight} />
        {entry.contextNote && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">{entry.contextNote}</span>
        )}
        {entry.rhythmNote && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">{entry.rhythmNote}</span>
        )}
        <ContactChips facts={facts} />
        <button
          type="button"
          onClick={() => {
            openContactHistory(person.id, person.name);
          }}
          className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-2 hover:underline"
        >
          Historia
        </button>
      </div>

      <ContactMarker
        personId={person.id}
        rankingEntryId={entry.id}
        facts={facts}
        onMarked={(nextFacts) => {
          onMarked(person.id, nextFacts);
        }}
      />
    </div>
  );
}
