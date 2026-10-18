/**
 * The browser-side record of an analytics choice.
 *
 * A visitor has no `profiles` row until they complete a profile, so their
 * choice cannot live in the database yet: it lives in `localStorage`, and is
 * copied onto `profiles.analytics_consent` once a row exists (see
 * src/components/analytics/ConsentBanner).
 *
 * Imports nothing, so it is safe in any client bundle and costs the page no SDK.
 * Storage can be disabled or throw (private windows, blocked site data); every
 * accessor degrades to "no choice recorded", which means "do not load PostHog".
 */

export type StoredConsent = "granted" | "denied";

export const CONSENT_STORAGE_KEY = "intouch.analytics.consent";

/** Fired on `window` when the visitor answers the banner; `detail` is the choice. */
export const CONSENT_EVENT = "intouch:analytics-consent";

export function readStoredConsent(): StoredConsent | null {
  try {
    const value = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredConsent(choice: StoredConsent): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
  } catch {
    // Storage is a convenience: without it the banner simply asks again.
  }
}
