import { calendarDaysBetween } from "@/lib/dates";
import type { ContactChipsProps } from "./types";

// Same dziś-check + toLocaleDateString fallback shape as
// RefreshBanner.tsx's formatComputedAt -- "X dni temu" only for a recent
// window, an actual date once it's stale enough that a day count stops
// being useful. The day count comes from the shared APP_TIME_ZONE helper so
// this chip and the prompt cannot disagree about which day an event fell on.
function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const diffDays = calendarDaysBetween(date, new Date());
  if (diffDays === 0) {
    return "dziś";
  }
  if (diffDays === 1) {
    return "wczoraj";
  }
  if (diffDays < 30) {
    return `${String(diffDays)} dni temu`;
  }
  return date.toLocaleDateString("pl-PL", { day: "numeric", month: "long" });
}

/**
 * Renders strictly from ContactFacts, never from model output -- the design
 * bundle's two history chips (InTouch.dc.html:255-257). Both chips can show
 * at once (a failed attempt after an earlier successful one is real data).
 */
export function ContactChips({ facts }: ContactChipsProps) {
  if (!facts) {
    return null;
  }

  const hasLastHappened = facts.lastHappenedAt !== null;
  if (!hasLastHappened && !facts.lastAttemptFailed) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {facts.lastHappenedAt && (
        <div className="border-border bg-card flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Ostatni kontakt</span>
          <span className="text-urgent font-bold">{formatRelativeDate(facts.lastHappenedAt)}</span>
        </div>
      )}
      {facts.lastAttemptFailed && (
        <div className="border-border bg-card flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Poprzednia próba</span>
          <span className="text-urgent font-bold">nie udała się</span>
        </div>
      )}
    </div>
  );
}
