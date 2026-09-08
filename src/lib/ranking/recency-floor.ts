import type { ContactFacts } from "@/lib/contact-history/facts";
import { TIME_WINDOW_VALUES, type TimeWindow } from "@/lib/validation/ranking";

/**
 * A lower bound on calm: a person contacted recently, with no failed attempt
 * since, cannot come back from the model marked urgent.
 *
 * This is the one place where code decides part of the ranking's content --
 * narrowing, not replacing, S-03's "nothing about the order is computed in
 * code". It is deliberately one-directional: the floor cools urgency down and
 * never pushes it up, because a long silence can be a deliberate choice while
 * "we spoke yesterday" cannot be argued with.
 *
 * Everything here is a pure function of a `timeWindow` and a `ContactFacts`:
 * no clock, no network, no database, so the test needs no fake timers, no
 * OpenAI mock and no row factory -- none of which exist in this repo.
 */

/** Contacted this recently, the calmest floor applies: nothing more urgent than no_rush. */
export const NO_RUSH_MAX_DAYS = 2;
/** Contacted this recently, urgency is capped at this_month. */
export const THIS_MONTH_MAX_DAYS = 6;

// dni od udanego kontaktu -> najpilniejsze dozwolone okno. Longest-ago last;
// the first row whose maxDays covers the day count wins. Past
// THIS_MONTH_MAX_DAYS there is no floor at all and the model decides alone.
const FLOOR_THRESHOLDS: readonly { readonly maxDays: number; readonly floor: TimeWindow }[] = [
  { maxDays: NO_RUSH_MAX_DAYS, floor: "no_rush" },
  { maxDays: THIS_MONTH_MAX_DAYS, floor: "this_month" },
];

/**
 * TIME_WINDOW_VALUES is already ordered most-urgent-first, so an index into it
 * *is* an urgency rank. Naming that here makes the property explicit rather
 * than something two call sites silently depend on.
 */
export function urgencyRank(timeWindow: TimeWindow): number {
  return TIME_WINDOW_VALUES.indexOf(timeWindow);
}

export interface RecencyFloorResult {
  /** The window to persist: the model's, or the floor when the model went more urgent. */
  timeWindow: TimeWindow;
  /** True when the floor overrode the model. */
  applied: boolean;
  /** A reason built from the same facts, non-null exactly when `applied`. */
  reason: string | null;
}

/**
 * The calmest-allowed window for a person, or null when no floor applies.
 *
 * `failedAttemptsSinceLastHappened > 0` subsumes `lastAttemptFailed`: a failed
 * attempt after the last successful contact always increments that counter
 * (facts.ts), so "we spoke" followed by "not yet" the same day is deliberately
 * NOT cooled down -- that sequence is a person who has become hard to reach.
 */
function floorFor(facts: ContactFacts | undefined): TimeWindow | null {
  if (!facts) {
    return null;
  }
  if (facts.lastHappenedAt === null || facts.daysSinceLastHappened === null) {
    return null;
  }
  if (facts.failedAttemptsSinceLastHappened > 0) {
    return null;
  }
  const days = facts.daysSinceLastHappened;
  return FLOOR_THRESHOLDS.find((threshold) => days <= threshold.maxDays)?.floor ?? null;
}

function daysPhrase(days: number): string {
  if (days <= 0) {
    return "dzisiaj";
  }
  if (days === 1) {
    return "wczoraj";
  }
  return `${String(days)} dni temu`;
}

/**
 * The reason that replaces the model's when the floor fires. The floor only
 * fires when the model misjudged this person, so its prose argues for a window
 * that no longer exists -- keeping it would recreate exactly the contradiction
 * this change removes. Code-authored reasons are an established pattern here
 * (run.ts writes one for a person the model skipped). Polish, second person,
 * and far inside `ranking_entries.reason`'s 400-character CHECK.
 */
export function buildRecencyFloorReason(facts: ContactFacts, timeWindow: TimeWindow): string {
  const phrase = daysPhrase(facts.daysSinceLastHappened ?? 0);
  const opening = `Ostatni udany kontakt masz odnotowany ${phrase}, bez nieudanej próby od tego czasu.`;
  const closing =
    timeWindow === "no_rush"
      ? "Ta relacja jest na bieżąco, więc nie ma pośpiechu. Odezwij się, kiedy pojawi się naturalny powód."
      : "Kontakt jest wciąż świeży, więc spokojnie. Wróć do tej osoby w ciągu najbliższych tygodni.";
  return `${opening} ${closing}`;
}

/**
 * Applies the floor to one model entry.
 *
 * "Floor" means *no more urgent than*: when the model already chose something
 * calmer than the floor, its choice stands and nothing is overridden.
 */
export function applyRecencyFloor(timeWindow: TimeWindow, facts: ContactFacts | undefined): RecencyFloorResult {
  const floor = floorFor(facts);
  if (floor === null || !facts) {
    return { timeWindow, applied: false, reason: null };
  }
  if (urgencyRank(timeWindow) >= urgencyRank(floor)) {
    return { timeWindow, applied: false, reason: null };
  }
  return { timeWindow: floor, applied: true, reason: buildRecencyFloorReason(facts, floor) };
}

/**
 * Orders entries by urgency so a card's position cannot contradict its badge
 * colour (rank_position is just the array index + 1, and timeWindow drives the
 * whole card palette).
 *
 * Array.prototype.sort has been stable since ES2019, and sorting on the
 * urgency rank alone is what keeps the model's ordering intact *within* one
 * window -- which is precisely what limits how far this narrows S-03's rule.
 * Do not add a second sort key.
 */
export function sortByUrgency<T extends { timeWindow: TimeWindow }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => urgencyRank(a.timeWindow) - urgencyRank(b.timeWindow));
}
