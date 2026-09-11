/**
 * One notion of "a day" for the whole app.
 *
 * The server is a Cloudflare Worker (UTC) and the browser runs in whatever
 * zone the viewer sits in, so "today" used to mean two different things:
 * facts.ts counted 24-hour blocks from UTC, ContactChips compared local
 * calendar dates. A contact 23 hours old was "0 dni" in the prompt and
 * "wczoraj" on the chip.
 *
 * The product is Polish-only and `profiles` has no timezone column, so the
 * zone is a named constant rather than per-user config -- one place to change
 * if that ever stops being true.
 */
export const APP_TIME_ZONE = "Europe/Warsaw";

// en-CA renders as YYYY-MM-DD, which Date.parse reads back as a UTC midnight.
// Built once per module: the zone is a constant, and a ranking run formats
// up to PEOPLE_CAP dates.
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date an instant falls on in APP_TIME_ZONE, as a UTC midnight. */
function toZonedMidnight(instant: Date): number {
  return Date.parse(`${dayFormatter.format(instant)}T00:00:00Z`);
}

/**
 * Full calendar days between two instants as seen in APP_TIME_ZONE: 0 when
 * both fall on the same local date, 1 when `earlier` was yesterday, and so on.
 * Negative if `earlier` is actually the later of the two.
 *
 * Shifting both instants to their local dates first is what makes this a
 * calendar-day count rather than a count of elapsed 24-hour blocks -- 23:50
 * to 00:10 is one day, not zero.
 */
export function calendarDaysBetween(earlier: Date, later: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toZonedMidnight(later) - toZonedMidnight(earlier)) / msPerDay);
}

/**
 * The calendar date an instant falls on in APP_TIME_ZONE, as `YYYY-MM-DD`.
 *
 * S-17's free-tier claim (src/lib/ranking/free-tier.ts) compares this against
 * `profiles.free_recompute_claimed_on`, encoding the same rule
 * `reminder_candidates` (20260908090338_create_reminder_sends.sql) enforces in
 * SQL: a calendar-day boundary in Europe/Warsaw, never an elapsed interval.
 * Deliberately a DIFFERENT clock from `STALE_AFTER_MS`: the free claim resets
 * at local midnight regardless of when it was last spent, while the automatic
 * refresh is a rolling 24-hour window from its own last run.
 */
export function appCalendarDate(at: Date = new Date()): string {
  return dayFormatter.format(at);
}
