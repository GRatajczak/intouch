import type { ContactFacts } from "@/lib/contact-history/facts";
import type { RankingEntryViewModel, RankingViewModel } from "@/lib/ranking/store";
import type { TimeWindow } from "@/lib/validation/ranking";

/**
 * Calendar days between two reminder emails to one owner.
 *
 * The NFR's ceiling is one per day; three keeps it near two a week, which is
 * the restraint FR-008's Socrates note asked for. Deliberately a constant and
 * not a user setting: the product's claim is that the app decides, and a
 * frequency slider hands that back. F-06's funnel is what should eventually
 * replace this number with a measured one -- until then it is a judgement,
 * and naming it makes retuning a one-line edit.
 *
 * Enforced in SQL, not here: public.reminder_candidates() takes it as an
 * argument and compares calendar dates in Europe/Warsaw, so the boundary
 * cannot wobble with cron jitter.
 */
export const REMINDER_COOLDOWN_DAYS = 3;

/**
 * The windows that mean "time-sensitive". `this_month` and `no_rush` produce
 * silence, and that is the feature: it is what makes the cadence decay-driven
 * rather than calendar-driven. A rule that always found someone to nudge would
 * be the plain calendar reminder the vision statement rejects.
 */
export const URGENT_WINDOWS: readonly TimeWindow[] = ["this_week", "two_weeks"];

/**
 * Ceiling on rankings refreshed in one sweep invocation. Bounds both AI spend
 * and wall-clock time for a single cron run; reminder_candidates() applies it
 * as its LIMIT, ordered oldest-waiting first so the cap is fair rather than
 * arbitrary.
 */
export const MAX_REFRESHES_PER_RUN = 25;

/** How many entries follow the hero in the "W kolejce, ale bez pośpiechu" list. */
export const QUEUE_SIZE = 2;

/** One "Dlaczego akurat teraz" bullet. `kind` drives the dot colour in phase 4's template. */
export interface ReasonFactor {
  kind: "weight" | "silence" | "failed_attempt" | "rhythm";
  text: string;
}

/** FR-004's scale. Named so the mock's "5 na 5" can never creep back in. */
const WEIGHT_MAX = 10;

function silencePhrase(days: number): string {
  if (days === 0) {
    return "Cisza od dzisiaj";
  }
  if (days === 1) {
    return "Cisza od wczoraj";
  }
  return `Cisza od ${String(days)} dni`;
}

/**
 * The "Dlaczego akurat teraz" bullets, built from recorded data only.
 *
 * Every bullet is **omitted rather than defaulted** when its source is absent
 * -- the rule facts.ts and the ranking prompt already follow. A missing source
 * means the app does not know, and a shorter honest list beats a longer one
 * padded with confident statements about nothing. That matters more here than
 * on screen: this text arrives in an inbox, unprompted, arguing that the user
 * should act.
 *
 * Order follows the design mock (InTouch.dc.html:1097-1113): weight, silence,
 * failed attempt, rhythm -- strongest standing claim first, softest last.
 */
export function buildReasonFactors(hero: RankingEntryViewModel, facts: ContactFacts | undefined): ReasonFactor[] {
  const factors: ReasonFactor[] = [
    { kind: "weight", text: `Waga relacji ${String(hero.person.weight)} na ${String(WEIGHT_MAX)}` },
  ];

  // Null exactly when there is no successful contact to measure from;
  // undefined when the person has no recorded events at all, which is how
  // facts.ts represents "never contacted". Both mean the same thing here.
  const silentDays = facts?.daysSinceLastHappened;
  if (silentDays !== null && silentDays !== undefined) {
    factors.push({ kind: "silence", text: silencePhrase(silentDays) });
  }

  if (facts?.lastAttemptFailed) {
    factors.push({ kind: "failed_attempt", text: "Poprzednia próba kontaktu nie doszła do skutku" });
  }

  if (hero.rhythmNote) {
    factors.push({ kind: "rhythm", text: `Twój rytm: ${hero.rhythmNote}` });
  }

  return factors;
}

export interface ReminderSelection {
  /** The one person this email is about. */
  hero: RankingEntryViewModel;
  /** The entries immediately after the hero, for the "W kolejce" teaser. */
  queue: RankingEntryViewModel[];
}

/**
 * Whether this entry may be the subject of a reminder email.
 *
 * Three independent reasons to pass someone over, all of them about the entry
 * being out of date rather than about the person being unimportant:
 *
 *  1. Not urgent. The model (narrowed by the recency floor) already judged the
 *     timing, and this respects that judgement rather than second-guessing it.
 *  2. Deactivated. FR-005 excludes them from AI consideration while keeping
 *     their history; a ranking computed before the deactivation still lists
 *     them, and the sweep must not resurrect them by email.
 *  3. Already contacted since this ranking was computed. The user acted on the
 *     suggestion and told the app so; emailing about it anyway is the app
 *     failing to notice, which is the staleness S-03 exists to remove.
 *
 * The third check compares against the ranking's own timestamp, not "has any
 * successful contact ever" -- a contact the ranking already knew about was
 * weighed when it ranked this person urgent, and that judgement stands.
 */
function isEligibleHero(
  entry: RankingEntryViewModel,
  facts: Map<string, ContactFacts>,
  rankingCreatedAt: number,
): boolean {
  if (entry.person.status !== "active") {
    return false;
  }
  if (!URGENT_WINDOWS.includes(entry.timeWindow)) {
    return false;
  }

  const lastHappenedAt = facts.get(entry.person.id)?.lastHappenedAt;
  if (lastHappenedAt && new Date(lastHappenedAt).getTime() > rankingCreatedAt) {
    return false;
  }

  return true;
}

/**
 * Picks the one person a reminder email should be about, plus the short queue
 * shown beneath them -- or `null` when nothing is urgent enough to be worth an
 * email at all.
 *
 * Walks `entries` in order rather than re-deriving urgency: run.ts already
 * sorts by urgency before persisting and `rank_position` is the array index
 * plus one, so the first eligible entry *is* the most urgent one. Adding a
 * second notion of urgency here would be a place for the two to disagree.
 *
 * The queue is deliberately not filtered by urgency -- its job is to show the
 * app is watching more than one relationship, so a calm entry belongs in it.
 */
export function selectHero(ranking: RankingViewModel, facts: Map<string, ContactFacts>): ReminderSelection | null {
  const rankingCreatedAt = new Date(ranking.createdAt).getTime();
  const heroIndex = ranking.entries.findIndex((entry) => isEligibleHero(entry, facts, rankingCreatedAt));

  if (heroIndex === -1) {
    return null;
  }

  return {
    hero: ranking.entries[heroIndex],
    queue: ranking.entries.slice(heroIndex + 1, heroIndex + 1 + QUEUE_SIZE),
  };
}
